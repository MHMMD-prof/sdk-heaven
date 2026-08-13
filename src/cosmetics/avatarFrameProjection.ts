export type CosmeticAssetReference = {
  assetId: string;
  assetVersionId: string;
};

export type AvatarFrameProjection = {
  assetUrl?: string;
  canonicalAsset?: CosmeticAssetReference;
  itemId: string;
  source?: 'custom';
};

const ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const VERSION_ID_PATTERN = /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/;

export function readAvatarFrameProjection(profile: unknown): AvatarFrameProjection | undefined {
  if (!isRecord(profile)) return undefined;
  const legacy = readLegacyFrame(profile.equippedAvatarFrame);
  const cosmetics = isRecord(profile.equippedCosmetics) ? profile.equippedCosmetics : {};
  const custom = readCustomFrame(cosmetics.avatarFrame);
  if (custom) return custom;
  const canonical = readCanonicalFrame(cosmetics.avatarFrame);
  if (!legacy) return undefined;
  return {
    ...legacy,
    ...(canonical && canonical.itemId === legacy.itemId
      ? { canonicalAsset: canonical.canonicalAsset }
      : {}),
  };
}

export function readProjectedAvatarFrame(value: unknown): AvatarFrameProjection | undefined {
  if (!isRecord(value)) return undefined;
  const custom = readCustomFrame(value);
  if (custom) return custom;
  const legacy = readLegacyFrame(value);
  const canonicalAsset = readCosmeticAssetReference(value.canonicalAsset);
  return legacy
    ? { ...legacy, ...(canonicalAsset ? { canonicalAsset } : {}) }
    : undefined;
}

export function readCosmeticAssetReference(value: unknown): CosmeticAssetReference | undefined {
  if (!isRecord(value)) return undefined;
  const assetId = readString(value.assetId);
  const assetVersionId = readString(value.assetVersionId);
  return ASSET_ID_PATTERN.test(assetId) && VERSION_ID_PATTERN.test(assetVersionId)
    ? { assetId, assetVersionId }
    : undefined;
}

function readCanonicalFrame(value: unknown) {
  if (!isRecord(value)) return undefined;
  const itemId = readString(value.itemId);
  const canonicalAsset = readCosmeticAssetReference(value);
  return ITEM_ID_PATTERN.test(itemId) && canonicalAsset
    ? { canonicalAsset, itemId }
    : undefined;
}

function readCustomFrame(value: unknown): AvatarFrameProjection | undefined {
  if (!isRecord(value) || value.source !== 'custom') return undefined;
  const itemId = readString(value.itemId);
  const canonicalAsset = readCosmeticAssetReference(value);
  return ITEM_ID_PATTERN.test(itemId) && canonicalAsset
    ? { canonicalAsset, itemId, source: 'custom' }
    : undefined;
}

function readLegacyFrame(value: unknown) {
  if (!isRecord(value)) return undefined;
  const itemId = readString(value.itemId);
  const assetUrl = readString(value.assetUrl);
  return ITEM_ID_PATTERN.test(itemId)
    && (/^https:\/\/[^\s]{1,2039}$/.test(assetUrl) || /^mock-store:\/\/[a-z0-9-]{3,80}$/.test(assetUrl))
    ? { assetUrl, itemId }
    : undefined;
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
