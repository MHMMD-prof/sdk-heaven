'use strict';

const crypto = require('node:crypto');
const {
  CATEGORY_FORMATS,
  FORMAT_MIME_TYPES,
  buildCanonicalStoragePath,
  extensionForFormat,
} = require('./cosmeticsAssetValidationCore');

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
const SUBMISSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,79}$/;
const VERSION_ID_PATTERN = /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/;
const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const UID_PATTERN = /^[^/\s]{1,128}$/;

const CUSTOM_UPLOAD_TTL_MS = 15 * 60 * 1_000;
const CUSTOM_DAILY_UPLOAD_LIMIT = 5;
const CUSTOM_MAX_PENDING = 3;
const CUSTOM_ATTESTATION_MIN_LENGTH = 12;
const CUSTOM_ATTESTATION_MAX_LENGTH = 500;

/** V1 custom categories only. Custom MP4 is always rejected. */
const CUSTOM_V1_CATEGORY_FORMATS = Object.freeze({
  'avatar-frame': Object.freeze(['png']),
  'entry-effect': Object.freeze(['lottie-json']),
  'profile-skin': Object.freeze(['png', 'jpeg']),
});

const CUSTOM_CATEGORY_SLOTS = Object.freeze({
  'avatar-frame': 'avatar-frame',
  'entry-effect': 'entry-effect',
  'profile-skin': 'profile-skin',
});

const CUSTOM_FORMAT_SOURCE_NAME = Object.freeze({
  jpeg: 'source.jpg',
  'lottie-json': 'source.json',
  png: 'source.png',
});

const CUSTOM_SUBMISSION_ACTIONS = Object.freeze([
  'create-cosmetic-custom-upload',
  'finalize-cosmetic-custom-upload',
  'attest-cosmetic-custom-submission',
  'list-cosmetic-custom-submissions',
  'equip-cosmetic-custom-asset',
  'unequip-cosmetic-custom-asset',
]);

function createCosmeticSubmissionId({ requestId, uid }) {
  if (!REQUEST_ID_PATTERN.test(requestId || '') || !UID_PATTERN.test(uid || '')) return '';
  const digest = crypto.createHash('sha256')
    .update(`cosmetic-submission-v1\0${uid}\0${requestId}`)
    .digest('hex');
  return `submission_${digest.slice(0, 24)}`;
}

function createCosmeticSubmissionVersionId({ requestId, submissionId, uid }) {
  if (
    !REQUEST_ID_PATTERN.test(requestId || '')
    || !SUBMISSION_ID_PATTERN.test(submissionId || '')
    || !UID_PATTERN.test(uid || '')
  ) return '';
  const digest = crypto.createHash('sha256')
    .update(`cosmetic-submission-version-v1\0${uid}\0${submissionId}\0${requestId}`)
    .digest('hex');
  return `v1-${digest.slice(0, 12)}`;
}

function createCustomAssetId({ category, submissionId, uid }) {
  if (
    !CUSTOM_V1_CATEGORY_FORMATS[category]
    || !SUBMISSION_ID_PATTERN.test(submissionId || '')
    || !UID_PATTERN.test(uid || '')
  ) return '';
  const digest = crypto.createHash('sha256')
    .update(`cosmetic-custom-asset-v1\0${uid}\0${category}\0${submissionId}`)
    .digest('hex')
    .slice(0, 20);
  return `cu-${category.slice(0, 2)}-${digest}`;
}

function cosmeticSubmissionQuarantinePath({ assetName, assetVersionId, submissionId, uid }) {
  return `cosmetic-submissions/${uid}/${submissionId}/${assetVersionId}/${assetName}`;
}

function resolveCustomContentType(format) {
  const types = FORMAT_MIME_TYPES[format];
  return types ? types[0] : '';
}

function resolveCustomMaxBytes(format) {
  if (format === 'lottie-json') return 1 * 1024 * 1024;
  return 3 * 1024 * 1024;
}

function resolveCustomUsage(format, category) {
  if (format === 'lottie-json' && category === 'entry-effect') {
    return { loop: false, usage: 'one-shot' };
  }
  return { loop: false, usage: 'static' };
}

function isCustomMp4Rejected(format, contentType) {
  return format === 'mp4'
    || contentType === 'video/mp4'
    || String(contentType || '').startsWith('video/');
}

function inspectCustomEligibility(eligibility, { category, nowMs, uid }) {
  if (
    !isRecord(eligibility)
    || eligibility.uid !== uid
    || eligibility.active !== true
    || (Number.isFinite(timestampToMillis(eligibility.revokedAt))
      && timestampToMillis(eligibility.revokedAt) <= nowMs)
    || !Array.isArray(eligibility.categories)
  ) return { ok: false, code: 'PERMISSION_DENIED' };
  // Fail closed: missing/empty categories never expand to full V1.
  const categories = [...new Set(
    eligibility.categories.filter((value) => CUSTOM_V1_CATEGORY_FORMATS[value]),
  )];
  if (!categories.length) return { ok: false, code: 'PERMISSION_DENIED' };
  if (category && !categories.includes(category)) return { ok: false, code: 'PERMISSION_DENIED' };
  return {
    ok: true,
    value: {
      categories,
      dailyUploadLimit: clampPositiveInt(eligibility.dailyUploadLimit, CUSTOM_DAILY_UPLOAD_LIMIT, 20),
      maxPending: clampPositiveInt(eligibility.maxPending, CUSTOM_MAX_PENDING, 10),
      pendingCount: Math.max(0, Number.isSafeInteger(eligibility.pendingCount) ? eligibility.pendingCount : 0),
      uid,
    },
  };
}

function inspectCustomFeatureFlags(flags, { rendering = false } = {}) {
  if (!isRecord(flags) || flags.cosmetics_custom_submissions !== true) {
    return { ok: false, code: 'FEATURE_DISABLED' };
  }
  if (rendering && flags.cosmetics_custom_rendering !== true) {
    return { ok: false, code: 'FEATURE_DISABLED' };
  }
  return { ok: true };
}

function normalizeCreateCustomUploadInput(input) {
  if (!isRecord(input)) return invalidRequest();
  const allowedKeys = new Set([
    'category', 'contentType', 'fallbackAssetId', 'fallbackAssetVersionId', 'format', 'sizeBytes',
  ]);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) return invalidRequest();
  const category = readString(input.category);
  const format = readString(input.format);
  const contentType = readString(input.contentType);
  const sizeBytes = Number(input.sizeBytes);
  const allowedFormats = CUSTOM_V1_CATEGORY_FORMATS[category];
  if (
    !allowedFormats
    || !allowedFormats.includes(format)
    || !CATEGORY_FORMATS[category]?.includes(format)
    || isCustomMp4Rejected(format, contentType)
    || resolveCustomContentType(format) !== contentType
    || !Number.isSafeInteger(sizeBytes)
    || sizeBytes < 1
    || sizeBytes > resolveCustomMaxBytes(format)
  ) return invalidRequest();

  const fallbackAssetId = readString(input.fallbackAssetId);
  const fallbackAssetVersionId = readString(input.fallbackAssetVersionId);
  if (format === 'lottie-json') {
    if (!ASSET_ID_PATTERN.test(fallbackAssetId) || !VERSION_ID_PATTERN.test(fallbackAssetVersionId)) {
      return invalidRequest();
    }
  } else if (fallbackAssetId || fallbackAssetVersionId) {
    return invalidRequest();
  }

  return {
    ok: true,
    value: {
      category,
      contentType,
      fallbackAssetId,
      fallbackAssetVersionId,
      format,
      maxBytes: resolveCustomMaxBytes(format),
      sizeBytes,
      sourceName: CUSTOM_FORMAT_SOURCE_NAME[format],
      ...resolveCustomUsage(format, category),
    },
  };
}

function normalizeFinalizeCustomUploadInput(input) {
  if (!isRecord(input) || Object.keys(input).some((key) => !['submissionId'].includes(key))) {
    return invalidRequest();
  }
  const submissionId = readString(input.submissionId);
  return SUBMISSION_ID_PATTERN.test(submissionId)
    ? { ok: true, value: { submissionId } }
    : invalidRequest();
}

function normalizeAttestCustomSubmissionInput(input) {
  if (
    !isRecord(input)
    || Object.keys(input).some((key) => !['attestation', 'submissionId'].includes(key))
  ) return invalidRequest();
  const submissionId = readString(input.submissionId);
  const attestation = readString(input.attestation);
  if (
    !SUBMISSION_ID_PATTERN.test(submissionId)
    || attestation.length < CUSTOM_ATTESTATION_MIN_LENGTH
    || attestation.length > CUSTOM_ATTESTATION_MAX_LENGTH
  ) return invalidRequest();
  return { ok: true, value: { attestation, submissionId } };
}

function normalizeListCustomSubmissionsInput(input) {
  if (input === undefined) return { ok: true, value: { limit: 25 } };
  if (!isRecord(input) || Object.keys(input).some((key) => key !== 'limit')) return invalidRequest();
  const limit = Number.isSafeInteger(input.limit)
    ? Math.min(50, Math.max(1, input.limit))
    : 25;
  return { ok: true, value: { limit } };
}

function normalizeEquipCustomAssetInput(input) {
  if (!isRecord(input) || Object.keys(input).some((key) => !['assetId'].includes(key))) {
    return invalidRequest();
  }
  const assetId = readString(input.assetId);
  return ASSET_ID_PATTERN.test(assetId)
    ? { ok: true, value: { assetId } }
    : invalidRequest();
}

function normalizeUnequipCustomAssetInput(input) {
  if (!isRecord(input) || Object.keys(input).some((key) => key !== 'category')) return invalidRequest();
  const category = readString(input.category);
  return CUSTOM_V1_CATEGORY_FORMATS[category]
    ? { ok: true, value: { category } }
    : invalidRequest();
}

function normalizeAdminCustomSubmissionMutation(body = {}) {
  const operation = readString(body.operation);
  const requestId = readString(body.requestId);
  const reason = readString(body.reason).slice(0, 300);
  if (!REQUEST_ID_PATTERN.test(requestId) || reason.length < 3) {
    return { ok: false, status: 400, error: 'A valid custom submission mutation is required.' };
  }

  if (operation === 'grant-custom-eligibility' || operation === 'revoke-custom-eligibility') {
    const uid = readString(body.uid);
    if (!UID_PATTERN.test(uid)) {
      return { ok: false, status: 400, error: 'A valid custom eligibility uid is required.' };
    }
    if (operation === 'revoke-custom-eligibility') {
      return { ok: true, value: { operation, reason, requestId, uid } };
    }
    const categories = Array.isArray(body.categories)
      ? [...new Set(body.categories.map((value) => readString(value)).filter((value) => CUSTOM_V1_CATEGORY_FORMATS[value]))]
      : [];
    if (!categories.length) {
      return { ok: false, status: 400, error: 'At least one V1 custom category is required.' };
    }
    const dailyUploadLimit = clampPositiveInt(body.dailyUploadLimit, CUSTOM_DAILY_UPLOAD_LIMIT, 20);
    const maxPending = clampPositiveInt(body.maxPending, CUSTOM_MAX_PENDING, 10);
    return {
      ok: true,
      value: {
        categories,
        dailyUploadLimit,
        maxPending,
        operation,
        reason,
        requestId,
        uid,
      },
    };
  }

  const submissionId = readString(body.submissionId);
  const expectedRevision = Number.isSafeInteger(body.expectedRevision)
    && body.expectedRevision >= 0
    ? body.expectedRevision
    : null;
  if (
    !['approve-custom-submission', 'reject-custom-submission', 'suspend-custom-submission'].includes(operation)
    || !SUBMISSION_ID_PATTERN.test(submissionId)
    || expectedRevision === null
  ) return { ok: false, status: 400, error: 'A valid custom submission mutation is required.' };
  return {
    ok: true,
    value: {
      expectedRevision,
      operation,
      reason,
      requestId,
      submissionId,
    },
  };
}

function normalizeAdminCustomSubmissionQuery(body = {}) {
  const status = readString(body.status) || 'pending';
  const ownerUid = readString(body.ownerUid);
  const limit = Number.isSafeInteger(body.limit)
    ? Math.min(50, Math.max(1, body.limit))
    : 25;
  if (
    !['pending', 'processed', 'approved', 'rejected', 'suspended', 'authorized'].includes(status)
  ) return { ok: false, status: 400, error: 'A valid custom submission status is required.' };
  if (ownerUid && !UID_PATTERN.test(ownerUid)) {
    return { ok: false, status: 400, error: 'A valid ownerUid is required.' };
  }
  return { ok: true, value: { limit, ownerUid, status } };
}

function normalizeAdminCustomSubmissionPreview(body = {}) {
  const submissionId = readString(body.submissionId);
  const reason = readString(body.reason).slice(0, 300);
  const requestId = readString(body.requestId);
  if (
    !SUBMISSION_ID_PATTERN.test(submissionId)
    || reason.length < 3
    || !REQUEST_ID_PATTERN.test(requestId)
  ) return { ok: false, status: 400, error: 'A valid custom submission preview request is required.' };
  return { ok: true, value: { reason, requestId, submissionId } };
}

function normalizeAdminCustomEligibilityQuery(body = {}) {
  const uid = readString(body.uid);
  if (!UID_PATTERN.test(uid)) return { ok: false, status: 400, error: 'A valid uid is required.' };
  return { ok: true, value: { uid } };
}

/** Admin list/detail mapping never includes quarantine sourcePath. */
function mapAdminCustomSubmission(id, data) {
  if (!isRecord(data) || data.submissionId !== id) return null;
  return {
    approvedAssetId: readString(data.approvedAssetId),
    approvedVersionId: readString(data.approvedVersionId),
    assetVersionId: readString(data.assetVersionId),
    attestation: readString(data.copyrightAttestation).slice(0, CUSTOM_ATTESTATION_MAX_LENGTH),
    attestedAtMs: timestampToMillis(data.copyrightAttestedAt) || 0,
    byteSize: Number.isSafeInteger(data.byteSize) ? data.byteSize : 0,
    category: readString(data.category),
    contentType: readString(data.contentType),
    decisionReason: readString(data.decisionReason).slice(0, 300),
    durationMs: Number.isSafeInteger(data.durationMs) ? data.durationMs : 0,
    fallbackAssetId: readString(data.fallbackAssetId),
    fallbackAssetVersionId: readString(data.fallbackAssetVersionId),
    format: readString(data.format),
    height: Number.isSafeInteger(data.height) ? data.height : 0,
    ownerUid: readString(data.ownerUid),
    revision: Number(data.revision || 0),
    sha256: readString(data.sha256).slice(0, 64),
    status: readString(data.status),
    submissionId: id,
    transparent: data.transparent === true,
    updatedAtMs: timestampToMillis(data.updatedAt) || 0,
    validationReceiptId: readString(data.validationReceiptId),
    width: Number.isSafeInteger(data.width) ? data.width : 0,
  };
}

function mapAdminCustomEligibility(uid, data) {
  if (!isRecord(data) || data.uid !== uid) {
    return {
      active: false,
      categories: [],
      dailyUploadLimit: CUSTOM_DAILY_UPLOAD_LIMIT,
      maxPending: CUSTOM_MAX_PENDING,
      uid,
    };
  }
  const categories = Array.isArray(data.categories)
    ? data.categories.filter((value) => CUSTOM_V1_CATEGORY_FORMATS[value])
    : [];
  return {
    active: data.active === true
      && categories.length > 0
      && !(Number.isFinite(timestampToMillis(data.revokedAt))
        && timestampToMillis(data.revokedAt) <= Date.now()),
    categories,
    dailyUploadLimit: clampPositiveInt(data.dailyUploadLimit, CUSTOM_DAILY_UPLOAD_LIMIT, 20),
    maxPending: clampPositiveInt(data.maxPending, CUSTOM_MAX_PENDING, 10),
    pendingCount: Math.max(0, Number.isSafeInteger(data.pendingCount) ? data.pendingCount : 0),
    revokeReason: readString(data.revokeReason).slice(0, 300),
    uid,
  };
}

function validateUploadedCustomObject({ authorization, metadata, nowMs, sourceByteLength }) {
  if (!authorization || authorization.active !== true || timestampToMillis(authorization.expiresAt) <= nowMs) {
    return { ok: false, code: 'UPLOAD_INVALID' };
  }
  const size = Number(metadata?.size);
  const custom = metadata?.metadata || {};
  if (
    !Number.isSafeInteger(size)
    || size !== authorization.sizeBytes
    || size !== sourceByteLength
    || size > authorization.maxBytes
    || metadata?.contentType !== authorization.contentType
    || custom.uploaderUid !== authorization.uid
    || custom.submissionId !== authorization.submissionId
    || isCustomMp4Rejected(authorization.format, metadata?.contentType)
  ) return { ok: false, code: 'UPLOAD_INVALID' };
  return { ok: true };
}

function inspectApprovedCustomOwnership({
  approval,
  ownership,
  summary,
  uid,
  version,
}) {
  const assetId = readString(ownership?.assetId || summary?.assetId);
  const assetVersionId = readString(ownership?.assetVersionId || summary?.approvedVersionId);
  const expectedApprovalId = `${assetId}__${assetVersionId}`;
  if (
    !ASSET_ID_PATTERN.test(assetId)
    || !VERSION_ID_PATTERN.test(assetVersionId)
    || !isRecord(ownership)
    || !isRecord(summary)
    || !isRecord(version)
    || !isRecord(approval)
    || ownership.uid !== uid
    || ownership.assetId !== assetId
    || ownership.state !== 'active'
    || ownership.checksum !== version.sha256
    || summary.ownerType !== 'user'
    || summary.ownerUid !== uid
    || summary.visibility !== 'owner-bound'
    || summary.moderationStatus !== 'approved'
    || summary.publicationStatus !== 'published'
    || summary.renderingEnabled !== true
    || summary.approvedVersionId !== assetVersionId
    || summary.publishedVersionId !== assetVersionId
    || summary.approvalId !== expectedApprovalId
    || version.assetId !== assetId
    || version.assetVersionId !== assetVersionId
    || version.ownerType !== 'user'
    || version.ownerUid !== uid
    || version.sha256 !== ownership.checksum
    || approval.decision !== 'approved'
    || approval.checksum !== version.sha256
    || approval.assetId !== assetId
    || approval.assetVersionId !== assetVersionId
    || !CUSTOM_V1_CATEGORY_FORMATS[version.category]?.includes(version.format)
    || isCustomMp4Rejected(version.format, version.contentType)
  ) return { ok: false };
  return {
    ok: true,
    value: {
      assetId,
      assetVersionId,
      category: version.category,
      format: version.format,
      slot: CUSTOM_CATEGORY_SLOTS[version.category],
    },
  };
}

/** Private storeEquipment.customCosmetics projection (includes source). */
function buildCustomEquipmentProjection({ assetId, assetVersionId, category }) {
  const slotKey = customProjectionKey(category);
  if (!slotKey) return undefined;
  return {
    assetId,
    assetVersionId,
    itemId: assetId,
    source: 'custom',
  };
}

/**
 * Public profile projection for skin/frame only.
 * Must match firestore.rules validEquipmentCosmeticProjection (no source, no entryEffect).
 */
function buildPublicCustomEquipmentProjection({ assetId, assetVersionId, category }) {
  const slotKey = customProjectionKey(category);
  if (slotKey !== 'avatarFrame' && slotKey !== 'profileSkin') return undefined;
  return {
    assetId,
    assetVersionId,
    itemId: assetId,
  };
}

function customProjectionKey(category) {
  return {
    'avatar-frame': 'avatarFrame',
    'entry-effect': 'entryEffect',
    'profile-skin': 'profileSkin',
  }[category] || '';
}

function buildOwnerBoundAssetSummary({
  approvalId,
  assetId,
  assetVersionId,
  category,
  existing,
  ownerUid,
  slot,
}) {
  const revision = Number(existing?.revision || 0) + 1;
  return {
    ...(existing || {}),
    approvalId,
    approvedVersionId: assetVersionId,
    assetId,
    category,
    currentVersionId: assetVersionId,
    moderationStatus: 'approved',
    ownerType: 'user',
    ownerUid,
    pendingVersionId: '',
    publicationStatus: 'published',
    publishedVersionId: assetVersionId,
    renderingEnabled: true,
    revision,
    schemaVersion: 1,
    slot,
    visibility: 'owner-bound',
  };
}

function rateLimitDayKey(nowMs) {
  const date = new Date(nowMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function clampPositiveInt(value, fallback, max) {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(max, value) : fallback;
}

function timestampToMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  return Number.NaN;
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function invalidRequest() {
  return { ok: false, code: 'INVALID_REQUEST' };
}

module.exports = {
  ASSET_ID_PATTERN,
  CUSTOM_ATTESTATION_MAX_LENGTH,
  CUSTOM_ATTESTATION_MIN_LENGTH,
  CUSTOM_CATEGORY_SLOTS,
  CUSTOM_DAILY_UPLOAD_LIMIT,
  CUSTOM_FORMAT_SOURCE_NAME,
  CUSTOM_MAX_PENDING,
  CUSTOM_SUBMISSION_ACTIONS,
  CUSTOM_UPLOAD_TTL_MS,
  CUSTOM_V1_CATEGORY_FORMATS,
  REQUEST_ID_PATTERN,
  SUBMISSION_ID_PATTERN,
  VERSION_ID_PATTERN,
  buildCanonicalStoragePath,
  buildCustomEquipmentProjection,
  buildOwnerBoundAssetSummary,
  buildPublicCustomEquipmentProjection,
  cosmeticSubmissionQuarantinePath,
  createCosmeticSubmissionId,
  createCosmeticSubmissionVersionId,
  createCustomAssetId,
  customProjectionKey,
  extensionForFormat,
  inspectApprovedCustomOwnership,
  inspectCustomEligibility,
  inspectCustomFeatureFlags,
  isCustomMp4Rejected,
  mapAdminCustomEligibility,
  mapAdminCustomSubmission,
  normalizeAdminCustomEligibilityQuery,
  normalizeAdminCustomSubmissionMutation,
  normalizeAdminCustomSubmissionPreview,
  normalizeAdminCustomSubmissionQuery,
  normalizeAttestCustomSubmissionInput,
  normalizeCreateCustomUploadInput,
  normalizeEquipCustomAssetInput,
  normalizeFinalizeCustomUploadInput,
  normalizeListCustomSubmissionsInput,
  normalizeUnequipCustomAssetInput,
  rateLimitDayKey,
  resolveCustomContentType,
  resolveCustomMaxBytes,
  resolveCustomUsage,
  validateUploadedCustomObject,
};
