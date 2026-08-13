'use strict';

const {
  extensionForFormat,
  validateAssetIdentityDraft,
} = require('./cosmeticsAssetValidationCore');
const {
  normalizeAdminCustomSubmissionMutation,
} = require('./cosmeticCustomSubmissionCore');

const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const VERSION_ID_PATTERN = /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
const OPERATIONS = Object.freeze([
  'validate-version',
  'approve-version',
  'reject-version',
  'publish-version',
  'emergency-disable',
  'suspend',
  'rollback-version',
  'approve-custom-submission',
  'reject-custom-submission',
  'suspend-custom-submission',
  'grant-custom-eligibility',
  'revoke-custom-eligibility',
]);

function normalizeAdminCosmeticsAssetQuery(body = {}) {
  const assetId = readString(body.assetId);
  const category = readString(body.category);
  const moderationStatus = readString(body.moderationStatus);
  const publicationStatus = readString(body.publicationStatus);
  const limit = Number.isSafeInteger(body.limit)
    ? Math.min(50, Math.max(1, body.limit))
    : 25;
  if (assetId && !ASSET_ID_PATTERN.test(assetId)) return invalid('A valid assetId is required.');
  if (
    category
    && ![
      'avatar-frame', 'profile-skin', 'chat-bubble', 'nameplate',
      'cosmetic-badge', 'entry-effect', 'seat-effect', 'gift-effect',
      'room-theme', 'room-reaction', 'couple-effect', 'effect-audio',
    ].includes(category)
  ) return invalid('A valid category is required.');
  if (
    moderationStatus
    && !['draft', 'processing', 'pending', 'approved', 'rejected', 'suspended'].includes(moderationStatus)
  ) return invalid('A valid moderation status is required.');
  if (
    publicationStatus
    && !['unpublished', 'published', 'disabled'].includes(publicationStatus)
  ) return invalid('A valid publication status is required.');
  return {
    ok: true,
    value: { assetId, category, limit, moderationStatus, publicationStatus },
  };
}

function normalizeAdminCosmeticsAssetOptionsQuery(body = {}) {
  const category = readString(body.category);
  const cursor = readString(body.cursor).slice(0, 80);
  const formats = Array.isArray(body.formats)
    ? [...new Set(body.formats.map(readString).filter(Boolean))]
    : [];
  const limit = Number.isSafeInteger(body.limit) ? Math.min(50, Math.max(1, body.limit)) : 20;
  const categories = [
    'avatar-frame', 'profile-skin', 'chat-bubble', 'nameplate',
    'cosmetic-badge', 'entry-effect', 'seat-effect', 'gift-effect',
    'room-theme', 'room-reaction', 'couple-effect', 'effect-audio',
  ];
  const allowedFormats = ['png', 'jpeg', 'legacy-webp', 'lottie-json', 'mp4', 'm4a-aac'];
  if (!categories.includes(category) || formats.length < 1 || formats.some((format) => !allowedFormats.includes(format))) {
    return invalid('A valid category and at least one compatible format are required.');
  }
  return { ok: true, value: { category, cursor, formats, limit } };
}

function normalizeAdminCosmeticsAssetMutation(body = {}) {
  const operation = readString(body.operation);
  if ([
    'approve-custom-submission',
    'reject-custom-submission',
    'suspend-custom-submission',
    'grant-custom-eligibility',
    'revoke-custom-eligibility',
  ].includes(operation)) {
    return normalizeAdminCustomSubmissionMutation(body);
  }

  const requestId = readString(body.requestId);
  const reason = readString(body.reason).slice(0, 300);
  const expectedRevision = Number.isSafeInteger(body.expectedRevision)
    && body.expectedRevision >= 0
    ? body.expectedRevision
    : null;
  if (
    !OPERATIONS.includes(operation)
    || !REQUEST_ID_PATTERN.test(requestId)
    || reason.length < 3
    || expectedRevision === null
  ) return invalid('A valid cosmetics asset mutation is required.');

  if (operation === 'validate-version') {
    const draft = validateAssetIdentityDraft(body.asset);
    if (!draft.ok) return invalid(draft.reason);
    const fallbackAssetId = readString(body.asset?.fallbackAssetId);
    const audioAssetId = readString(body.asset?.audioAssetId);
    const hasFallbackVersion = Boolean(draft.value.fallbackAssetVersionId);
    const hasAudioVersion = Boolean(draft.value.audioAssetVersionId);
    if (
      hasFallbackVersion !== ASSET_ID_PATTERN.test(fallbackAssetId)
      || hasAudioVersion !== ASSET_ID_PATTERN.test(audioAssetId)
    ) {
      return invalid('Asset references require both asset and version IDs.');
    }
    if (
      draft.value.category === 'couple-effect'
      && (
        !['png', 'lottie-json'].includes(draft.value.format)
        || hasAudioVersion
        || audioAssetId
        || (draft.value.format === 'png' && (hasFallbackVersion || fallbackAssetId))
        || (draft.value.format === 'lottie-json' && (!hasFallbackVersion || !fallbackAssetId))
      )
    ) {
      return invalid('Couple effects require PNG, or Lottie with one exact PNG fallback, and never audio.');
    }
    return {
      ok: true,
      value: {
        asset: {
          ...draft.value,
          audioAssetId,
          fallbackAssetId,
          sourceExtension: extensionForFormat(draft.value.format),
        },
        expectedRevision,
        operation,
        reason,
        requestId,
      },
    };
  }

  const assetId = readString(body.assetId);
  const assetVersionId = readString(body.assetVersionId);
  if (!ASSET_ID_PATTERN.test(assetId)) return invalid('A valid assetId is required.');
  if (
    ['approve-version', 'reject-version', 'publish-version', 'rollback-version'].includes(operation)
    && !VERSION_ID_PATTERN.test(assetVersionId)
  ) return invalid('A valid assetVersionId is required.');
  if (
    operation === 'rollback-version'
    && readString(body.confirmation) !== `ROLLBACK ${assetId} ${assetVersionId}`
  ) return invalid('Rollback confirmation does not match the target version.');
  if (
    operation === 'suspend'
    && readString(body.confirmation) !== `SUSPEND ${assetId}`
  ) return invalid('Suspension confirmation does not match the asset.');
  return {
    ok: true,
    value: {
      assetId,
      assetVersionId,
      expectedRevision,
      operation,
      reason,
      requestId,
      authoritySeparationPassed: body.authoritySeparationPassed === true,
      readableIdentityPassed: body.readableIdentityPassed === true,
    },
  };
}

function transitionCosmeticAssetSummary({
  existing,
  operation,
  version,
  approvalId = '',
}) {
  const revision = Number(existing?.revision || 0) + 1;
  if (operation === 'validate-version') {
    return {
      ...(existing || {}),
      assetId: version.assetId,
      approvedVersionId: existing?.approvedVersionId || '',
      approvalId: existing?.approvalId || '',
      category: version.category,
      currentVersionId: version.assetVersionId,
      moderationStatus: existing?.publishedVersionId ? existing.moderationStatus : 'pending',
      ownerType: version.ownerType,
      ...(version.ownerUid ? { ownerUid: version.ownerUid } : {}),
      pendingVersionId: version.assetVersionId,
      publicationStatus: existing?.publicationStatus || 'unpublished',
      publishedVersionId: existing?.publishedVersionId || '',
      renderingEnabled: existing?.renderingEnabled === true,
      revision,
      schemaVersion: 1,
      ...(version.slot ? { slot: version.slot } : {}),
    };
  }
  if (!existing) throw stateError(404, 'Asset was not found.');
  if (operation === 'approve-version') {
    return {
      ...existing,
      approvalId,
      approvedVersionId: version.assetVersionId,
      currentVersionId: version.assetVersionId,
      moderationStatus: 'approved',
      pendingVersionId: '',
      revision,
    };
  }
  if (operation === 'reject-version') {
    return {
      ...existing,
      currentVersionId: version.assetVersionId,
      moderationStatus: 'rejected',
      pendingVersionId: '',
      revision,
    };
  }
  if (operation === 'publish-version' || operation === 'rollback-version') {
    return {
      ...existing,
      approvalId,
      approvedVersionId: version.assetVersionId,
      currentVersionId: version.assetVersionId,
      moderationStatus: 'approved',
      pendingVersionId: '',
      publicationStatus: 'published',
      publishedVersionId: version.assetVersionId,
      renderingEnabled: true,
      revision,
    };
  }
  if (operation === 'emergency-disable') {
    return {
      ...existing,
      publicationStatus: 'disabled',
      renderingEnabled: false,
      revision,
    };
  }
  if (operation === 'suspend') {
    return {
      ...existing,
      moderationStatus: 'suspended',
      publicationStatus: 'disabled',
      renderingEnabled: false,
      revision,
    };
  }
  throw stateError(400, 'Asset operation is unsupported.');
}

function stateError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function invalid(error) {
  return { ok: false, status: 400, error };
}

module.exports = {
  COSMETICS_ASSET_OPERATIONS: OPERATIONS,
  normalizeAdminCosmeticsAssetMutation,
  normalizeAdminCosmeticsAssetOptionsQuery,
  normalizeAdminCosmeticsAssetQuery,
  transitionCosmeticAssetSummary,
};
