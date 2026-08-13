'use strict';

const crypto = require('node:crypto');

const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const RELATIONSHIP_ID_PATTERN = /^rel_[a-f0-9]{40}$/;
const VERSION_ID_PATTERN = /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/;
const PROFILE_MODES = Object.freeze(['off', 'static', 'looping']);
const BORDER_MODES = Object.freeze(['off', 'static', 'looping']);
const ENTRANCE_MODES = Object.freeze(['off', 'static', 'one-shot']);

function createRelationshipId(coupleId, nonce) {
  const normalizedCoupleId = readString(coupleId);
  const normalizedNonce = readString(nonce);
  if (!normalizedCoupleId || !normalizedNonce) return '';
  return `rel_${crypto.createHash('sha256')
    .update(`couple-effect-relationship-v1\u0000${normalizedCoupleId}\u0000${normalizedNonce}`)
    .digest('hex')
    .slice(0, 40)}`;
}

function resolveRelationshipId(couple, coupleId) {
  const explicit = readString(couple?.relationshipId);
  if (RELATIONSHIP_ID_PATTERN.test(explicit)) return explicit;
  const createdAtMs = readTimestampMs(couple?.createdAt);
  return Number.isSafeInteger(createdAtMs) && createdAtMs >= 0
    ? createRelationshipId(coupleId, `created-${createdAtMs}`)
    : '';
}

function createCoupleIdHash(relationshipId) {
  return RELATIONSHIP_ID_PATTERN.test(relationshipId || '')
    ? crypto.createHash('sha256')
      .update(`couple-effect-public-v1\u0000${relationshipId}`)
      .digest('hex')
    : '';
}

function mapCoupleEffectPresentation(value) {
  if (!isRecord(value) || Object.keys(value).some((key) => ![
    'borderMode', 'entranceMode', 'profileMode',
  ].includes(key))) return undefined;
  if (
    !PROFILE_MODES.includes(value.profileMode)
    || !BORDER_MODES.includes(value.borderMode)
    || !ENTRANCE_MODES.includes(value.entranceMode)
    || [value.profileMode, value.borderMode, value.entranceMode].every((mode) => mode === 'off')
  ) return undefined;
  return {
    borderMode: value.borderMode,
    entranceMode: value.entranceMode,
    profileMode: value.profileMode,
  };
}

function normalizeCoupleEffectPurchaseInput(input) {
  if (!isRecord(input) || Object.keys(input).some((key) => !['currency', 'itemId'].includes(key))) {
    return invalidRequest();
  }
  const itemId = readString(input.itemId);
  if (!ITEM_ID_PATTERN.test(itemId) || !['coins', 'diamonds'].includes(input.currency)) return invalidRequest();
  return { ok: true, value: { currency: input.currency, itemId } };
}

function normalizeCoupleEffectEquipInput(input) {
  if (!isRecord(input) || Object.keys(input).some((key) => key !== 'itemId')) return invalidRequest();
  const itemId = readString(input.itemId);
  return ITEM_ID_PATTERN.test(itemId)
    ? { ok: true, value: { itemId } }
    : invalidRequest();
}

function normalizeCoupleEffectEmptyInput(input) {
  return input === undefined || (isRecord(input) && Object.keys(input).length === 0)
    ? { ok: true, value: {} }
    : invalidRequest();
}

function inspectActiveCouple({
  actorMembership,
  actorProfile,
  actorUid,
  couple,
  coupleId,
  partnerMembership,
  partnerProfile,
}) {
  const memberUids = Array.isArray(couple?.memberUids) ? [...couple.memberUids].sort() : [];
  const partnerUid = readString(actorMembership?.partnerUid);
  const relationshipId = resolveRelationshipId(couple, coupleId);
  if (
    !actorUid
    || !partnerUid
    || partnerUid === actorUid
    || memberUids.length !== 2
    || memberUids[0] === memberUids[1]
    || !memberUids.includes(actorUid)
    || !memberUids.includes(partnerUid)
    || actorMembership?.uid !== actorUid
    || actorMembership?.coupleId !== coupleId
    || partnerMembership?.uid !== partnerUid
    || partnerMembership?.partnerUid !== actorUid
    || partnerMembership?.coupleId !== coupleId
    || (actorMembership.relationshipId !== undefined && actorMembership.relationshipId !== relationshipId)
    || (partnerMembership.relationshipId !== undefined && partnerMembership.relationshipId !== relationshipId)
    || actorProfile?.uid !== actorUid
    || partnerProfile?.uid !== partnerUid
    || actorProfile?.moderationStatus !== 'active'
    || partnerProfile?.moderationStatus !== 'active'
    || !relationshipId
  ) return { ok: false, code: 'STALE_RELATIONSHIP' };
  return {
    ok: true,
    value: {
      coupleId,
      coupleIdHash: createCoupleIdHash(relationshipId),
      memberUids,
      partnerUid,
      relationshipId,
    },
  };
}

function inspectApprovedCoupleEffect({ approval, fallback, reference, summary, version }) {
  const assetId = readString(reference?.assetId);
  const assetVersionId = readString(reference?.assetVersionId);
  const expectedApprovalId = `${assetId}__${assetVersionId}`;
  if (
    !ASSET_ID_PATTERN.test(assetId)
    || !VERSION_ID_PATTERN.test(assetVersionId)
    || !isRecord(summary)
    || !isRecord(version)
    || !isRecord(approval)
    || summary.moderationStatus !== 'approved'
    || summary.publicationStatus !== 'published'
    || summary.renderingEnabled !== true
    || summary.approvedVersionId !== assetVersionId
    || summary.publishedVersionId !== assetVersionId
    || summary.approvalId !== expectedApprovalId
    || version.assetId !== assetId
    || version.assetVersionId !== assetVersionId
    || version.category !== 'couple-effect'
    || !['png', 'lottie-json'].includes(version.format)
    || version.audioAssetId !== undefined
    || version.audioAssetVersionId !== undefined
    || approval.assetId !== assetId
    || approval.assetVersionId !== assetVersionId
    || approval.decision !== 'approved'
    || typeof version.sha256 !== 'string'
    || approval.checksum !== version.sha256
  ) return { ok: false };

  if (version.format === 'lottie-json') {
    const fallbackAssetId = readString(version.fallbackAssetId);
    const fallbackAssetVersionId = readString(version.fallbackAssetVersionId);
    if (
      !ASSET_ID_PATTERN.test(fallbackAssetId)
      || !VERSION_ID_PATTERN.test(fallbackAssetVersionId)
      || !inspectStaticFallback(fallback, fallbackAssetId, fallbackAssetVersionId)
    ) return { ok: false };
    return {
      ok: true,
      descriptor: {
        assetId,
        assetVersionId,
        fallbackAssetId,
        fallbackAssetVersionId,
        format: 'lottie-json',
      },
    };
  }

  if (version.fallbackAssetId !== undefined || version.fallbackAssetVersionId !== undefined) return { ok: false };
  return {
    ok: true,
    descriptor: {
      assetId,
      assetVersionId,
      fallbackAssetId: assetId,
      fallbackAssetVersionId: assetVersionId,
      format: 'png',
    },
  };
}

function inspectStaticFallback(records, assetId, assetVersionId) {
  const approvalId = `${assetId}__${assetVersionId}`;
  return Boolean(
    isRecord(records?.summary)
    && isRecord(records?.version)
    && isRecord(records?.approval)
    && records.summary.moderationStatus === 'approved'
    && records.summary.publicationStatus === 'published'
    && records.summary.renderingEnabled === true
    && records.summary.approvedVersionId === assetVersionId
    && records.summary.publishedVersionId === assetVersionId
    && records.summary.approvalId === approvalId
    && records.version.assetId === assetId
    && records.version.assetVersionId === assetVersionId
    && records.version.category === 'couple-effect'
    && records.version.format === 'png'
    && typeof records.version.sha256 === 'string'
    && records.approval.assetId === assetId
    && records.approval.assetVersionId === assetVersionId
    && records.approval.decision === 'approved'
    && records.approval.checksum === records.version.sha256
  );
}

function buildCoupleEffectProjection({ coupleIdHash, descriptor, itemId, presentation }) {
  return {
    assetId: descriptor.assetId,
    assetVersionId: descriptor.assetVersionId,
    borderMode: presentation.borderMode,
    coupleIdHash,
    entranceMode: presentation.entranceMode,
    fallbackAssetId: descriptor.fallbackAssetId,
    fallbackAssetVersionId: descriptor.fallbackAssetVersionId,
    format: descriptor.format,
    itemId,
    profileMode: presentation.profileMode,
  };
}

function mapPublicCoupleEffectProjection(value) {
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => ![
      'assetId', 'assetVersionId', 'borderMode', 'coupleIdHash', 'entranceMode',
      'fallbackAssetId', 'fallbackAssetVersionId', 'format', 'itemId', 'profileMode',
    ].includes(key))
    || !ASSET_ID_PATTERN.test(readString(value.assetId))
    || !VERSION_ID_PATTERN.test(readString(value.assetVersionId))
    || !ASSET_ID_PATTERN.test(readString(value.fallbackAssetId))
    || !VERSION_ID_PATTERN.test(readString(value.fallbackAssetVersionId))
    || !ITEM_ID_PATTERN.test(readString(value.itemId))
    || !/^[a-f0-9]{64}$/.test(readString(value.coupleIdHash))
    || !['png', 'lottie-json'].includes(value.format)
    || !PROFILE_MODES.includes(value.profileMode)
    || !BORDER_MODES.includes(value.borderMode)
    || !ENTRANCE_MODES.includes(value.entranceMode)
  ) return undefined;
  return {
    assetId: value.assetId,
    assetVersionId: value.assetVersionId,
    borderMode: value.borderMode,
    coupleIdHash: value.coupleIdHash,
    entranceMode: value.entranceMode,
    fallbackAssetId: value.fallbackAssetId,
    fallbackAssetVersionId: value.fallbackAssetVersionId,
    format: value.format,
    itemId: value.itemId,
    profileMode: value.profileMode,
  };
}

function mapCoupleEffectOwnership(data, documentId) {
  if (
    !isRecord(data)
    || data.kind !== 'couple-effect-ownership'
    || data.itemId !== documentId
    || data.ownershipId !== documentId
    || !RELATIONSHIP_ID_PATTERN.test(data.relationshipId || '')
    || !Array.isArray(data.memberUids)
    || data.memberUids.length !== 2
    || !data.memberUids.includes(data.purchaserUid)
    || !['active', 'expired', 'refunded', 'revoked'].includes(data.state)
  ) return undefined;
  return { ...data };
}

function readTimestampMs(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
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
  RELATIONSHIP_ID_PATTERN,
  buildCoupleEffectProjection,
  createCoupleIdHash,
  createRelationshipId,
  inspectActiveCouple,
  inspectApprovedCoupleEffect,
  mapCoupleEffectOwnership,
  mapCoupleEffectPresentation,
  mapPublicCoupleEffectProjection,
  normalizeCoupleEffectEmptyInput,
  normalizeCoupleEffectEquipInput,
  normalizeCoupleEffectPurchaseInput,
  resolveRelationshipId,
};
