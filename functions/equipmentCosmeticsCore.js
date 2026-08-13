'use strict';

const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const VERSION_ID_PATTERN = /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/;

const EQUIPMENT_COSMETIC_CONFIG = Object.freeze({
  'avatar-frames': Object.freeze({ assetCategory: 'avatar-frame', projectionKey: 'avatarFrame', formats: Object.freeze(['png', 'jpeg', 'lottie-json', 'legacy-webp']) }),
  'profile-skins': Object.freeze({ assetCategory: 'profile-skin', projectionKey: 'profileSkin', formats: Object.freeze(['png', 'jpeg', 'legacy-webp']) }),
  'chat-bubbles': Object.freeze({ assetCategory: 'chat-bubble', projectionKey: 'chatBubble', formats: Object.freeze(['png', 'lottie-json', 'legacy-webp']) }),
  nameplates: Object.freeze({ assetCategory: 'nameplate', projectionKey: 'nameplate', formats: Object.freeze(['png', 'lottie-json', 'legacy-webp']) }),
  'cosmetic-badges': Object.freeze({ assetCategory: 'cosmetic-badge', projectionKey: 'cosmeticBadge', formats: Object.freeze(['png', 'lottie-json', 'legacy-webp']) }),
  'seat-effects': Object.freeze({ assetCategory: 'seat-effect', projectionKey: 'seatEffect', formats: Object.freeze(['png', 'lottie-json', 'legacy-webp']) }),
  'couple-effects': Object.freeze({ assetCategory: 'couple-effect', projectionKey: 'coupleEffect', formats: Object.freeze(['png', 'lottie-json']) }),
});

const WAVE6_COSMETIC_CATEGORIES = Object.freeze(
  Object.keys(EQUIPMENT_COSMETIC_CONFIG)
    .filter((category) => !['avatar-frames', 'couple-effects'].includes(category)),
);

function getEquipmentCosmeticConfig(category) {
  return EQUIPMENT_COSMETIC_CONFIG[category];
}

function buildCanonicalEquipmentCosmetic(item) {
  const config = getEquipmentCosmeticConfig(item?.category);
  const asset = mapCosmeticAssetReference(item?.cosmeticAsset);
  return config && asset && ITEM_ID_PATTERN.test(item?.itemId || '')
    ? { ...asset, itemId: item.itemId }
    : undefined;
}

function buildEquipmentCosmeticProfileUpdate(item, fieldValue, updatedAt) {
  const config = getEquipmentCosmeticConfig(item?.category);
  if (!config || config.projectionKey === 'avatarFrame') return {};
  const canonical = buildCanonicalEquipmentCosmetic(item);
  return {
    [`equippedCosmetics.${config.projectionKey}`]: canonical || fieldValue.delete(),
    updatedAt,
  };
}

function removeEquipmentCosmeticProjection(document, category) {
  const config = getEquipmentCosmeticConfig(category);
  if (!config) return document;
  const cosmetics = isRecord(document?.cosmetics) ? { ...document.cosmetics } : {};
  delete cosmetics[config.projectionKey];
  const next = { ...(isRecord(document) ? document : {}) };
  if (Object.keys(cosmetics).length) next.cosmetics = cosmetics;
  else delete next.cosmetics;
  return next;
}

function setEquipmentCosmeticProjection(document, item) {
  const config = getEquipmentCosmeticConfig(item?.category);
  if (!config) return document;
  const cosmetics = isRecord(document?.cosmetics) ? { ...document.cosmetics } : {};
  const canonical = buildCanonicalEquipmentCosmetic(item);
  if (canonical) cosmetics[config.projectionKey] = canonical;
  else delete cosmetics[config.projectionKey];
  const next = { ...(isRecord(document) ? document : {}) };
  if (Object.keys(cosmetics).length) next.cosmetics = cosmetics;
  else delete next.cosmetics;
  return next;
}

function inspectApprovedEquipmentCosmeticReference({ approval, assetId, category, summary, version, versionId }) {
  const config = getEquipmentCosmeticConfig(category);
  const expectedApprovalId = `${assetId}__${versionId}`;
  if (
    !config
    || !ASSET_ID_PATTERN.test(assetId || '')
    || !VERSION_ID_PATTERN.test(versionId || '')
    || !isRecord(summary)
    || !isRecord(version)
    || !isRecord(approval)
    || summary.moderationStatus !== 'approved'
    || summary.publicationStatus !== 'published'
    || summary.renderingEnabled !== true
    || summary.publishedVersionId !== versionId
    || summary.approvedVersionId !== versionId
    || summary.approvalId !== expectedApprovalId
    || approval.decision !== 'approved'
    || approval.assetId !== assetId
    || approval.assetVersionId !== versionId
    || version.assetId !== assetId
    || version.assetVersionId !== versionId
    || version.category !== config.assetCategory
    || !config.formats.includes(version.format)
    || version.audioAssetId !== undefined
    || version.audioAssetVersionId !== undefined
    || typeof version.sha256 !== 'string'
    || approval.checksum !== version.sha256
    || (['nameplates', 'cosmetic-badges'].includes(category)
      && (approval.authoritySeparationPassed !== true || approval.readableIdentityPassed !== true))
  ) return { ok: false };
  return { ok: true, projectionKey: config.projectionKey };
}

function mapCosmeticAssetReference(value) {
  if (!isRecord(value) || Object.keys(value).some((key) => !['assetId', 'assetVersionId'].includes(key))) return undefined;
  const assetId = readString(value.assetId);
  const assetVersionId = readString(value.assetVersionId);
  return ASSET_ID_PATTERN.test(assetId) && VERSION_ID_PATTERN.test(assetVersionId)
    ? { assetId, assetVersionId }
    : undefined;
}

function readPublicEquipmentCosmetics(profile) {
  if (!isRecord(profile) || !isRecord(profile.equippedCosmetics)) return {};
  const projections = {};
  for (const config of Object.values(EQUIPMENT_COSMETIC_CONFIG)) {
    if (config.projectionKey === 'avatarFrame') continue;
    const value = profile.equippedCosmetics[config.projectionKey];
    const asset = mapCosmeticAssetReference({ assetId: value?.assetId, assetVersionId: value?.assetVersionId });
    const itemId = readString(value?.itemId);
    if (asset && ITEM_ID_PATTERN.test(itemId)) projections[config.projectionKey] = { ...asset, itemId };
  }
  return projections;
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

module.exports = {
  EQUIPMENT_COSMETIC_CONFIG,
  WAVE6_COSMETIC_CATEGORIES,
  buildCanonicalEquipmentCosmetic,
  buildEquipmentCosmeticProfileUpdate,
  getEquipmentCosmeticConfig,
  inspectApprovedEquipmentCosmeticReference,
  mapCosmeticAssetReference,
  readPublicEquipmentCosmetics,
  removeEquipmentCosmeticProjection,
  setEquipmentCosmeticProjection,
};
