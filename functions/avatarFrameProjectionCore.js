'use strict';

const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const VERSION_ID_PATTERN = /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/;
const SAFE_FRAME_FORMATS = Object.freeze(['png', 'jpeg', 'lottie-json', 'legacy-webp']);

function mapCosmeticAssetReference(value) {
  if (!isRecord(value) || Object.keys(value).some((key) => !['assetId', 'assetVersionId'].includes(key))) return undefined;
  const assetId = readString(value.assetId);
  const assetVersionId = readString(value.assetVersionId);
  return ASSET_ID_PATTERN.test(assetId) && VERSION_ID_PATTERN.test(assetVersionId)
    ? { assetId, assetVersionId }
    : undefined;
}

function buildAvatarFrameProjection(item) {
  if (!item || item.category !== 'avatar-frames' || !ITEM_ID_PATTERN.test(item.itemId || '')) return undefined;
  const assetUrl = readString(item.previewAssetUrl);
  if (!/^https:\/\/[^\s]{1,2039}$/.test(assetUrl) && !/^mock-store:\/\/[a-z0-9-]{3,80}$/.test(assetUrl)) return undefined;
  const canonicalAsset = mapCosmeticAssetReference(item.cosmeticAsset);
  return {
    assetUrl,
    itemId: item.itemId,
    ...(canonicalAsset ? { canonicalAsset } : {}),
  };
}

function buildCanonicalEquipmentFrame(item) {
  const cosmeticAsset = mapCosmeticAssetReference(item?.cosmeticAsset);
  return cosmeticAsset && item?.category === 'avatar-frames' && ITEM_ID_PATTERN.test(item.itemId || '')
    ? { ...cosmeticAsset, itemId: item.itemId }
    : undefined;
}

function readPublicAvatarFrameProjection(profile) {
  if (!isRecord(profile) || !isRecord(profile.equippedAvatarFrame)) return undefined;
  const itemId = readString(profile.equippedAvatarFrame.itemId);
  const assetUrl = readString(profile.equippedAvatarFrame.assetUrl);
  if (!ITEM_ID_PATTERN.test(itemId) || (!/^https:\/\/[^\s]{1,2039}$/.test(assetUrl) && !/^mock-store:\/\/[a-z0-9-]{3,80}$/.test(assetUrl))) return undefined;
  const canonicalFrame = isRecord(profile.equippedCosmetics) && isRecord(profile.equippedCosmetics.avatarFrame)
    ? profile.equippedCosmetics.avatarFrame
    : undefined;
  const canonicalAsset = canonicalFrame?.itemId === itemId
    ? mapCosmeticAssetReference({
      assetId: canonicalFrame.assetId,
      assetVersionId: canonicalFrame.assetVersionId,
    })
    : undefined;
  return { assetUrl, itemId, ...(canonicalAsset ? { canonicalAsset } : {}) };
}

function mapAvatarFrameProjectionSnapshot(value) {
  if (!isRecord(value)) return undefined;
  const legacy = readPublicAvatarFrameProjection({ equippedAvatarFrame: value });
  if (!legacy) return undefined;
  const canonicalAsset = mapCosmeticAssetReference(value.canonicalAsset);
  return { ...legacy, ...(canonicalAsset ? { canonicalAsset } : {}) };
}

function inspectApprovedAvatarFrameReference({ approval, assetId, summary, version, versionId }) {
  const expectedApprovalId = `${assetId}__${versionId}`;
  if (
    !ASSET_ID_PATTERN.test(assetId || '')
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
    || version.category !== 'avatar-frame'
    || !SAFE_FRAME_FORMATS.includes(version.format)
    || typeof version.sha256 !== 'string'
    || approval.checksum !== version.sha256
  ) return { ok: false };
  return { ok: true };
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

module.exports = {
  SAFE_FRAME_FORMATS,
  buildAvatarFrameProjection,
  buildCanonicalEquipmentFrame,
  inspectApprovedAvatarFrameReference,
  mapCosmeticAssetReference,
  mapAvatarFrameProjectionSnapshot,
  readPublicAvatarFrameProjection,
};
