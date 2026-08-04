import {
  type CosmeticAssetDescriptorV1,
  validateCosmeticAssetDescriptorV1,
} from './contracts';

export function mapPublishedCosmeticDescriptor(
  summary: unknown,
  version: unknown,
  uri: string,
): CosmeticAssetDescriptorV1 | undefined {
  if (!isRecord(summary) || !isRecord(version)) return undefined;
  if (
    summary.schemaVersion !== 1
    || summary.publicationStatus !== 'published'
    || summary.renderingEnabled !== true
    || summary.moderationStatus !== 'approved'
    || summary.publishedVersionId !== version.assetVersionId
    || summary.assetId !== version.assetId
    || summary.approvedVersionId !== version.assetVersionId
  ) return undefined;
  const descriptor = {
    schemaVersion: 1,
    assetId: version.assetId,
    assetVersionId: version.assetVersionId,
    ownerType: version.ownerType,
    ...(version.ownerUid ? { ownerUid: version.ownerUid } : {}),
    category: version.category,
    ...(version.slot ? { slot: version.slot } : {}),
    format: version.format,
    usage: version.usage,
    uri,
    ...(version.fallbackAssetId ? {
      fallbackAssetId: version.fallbackAssetId,
      fallbackAssetVersionId: version.fallbackAssetVersionId,
    } : {}),
    ...(version.audioAssetId ? {
      audioAssetId: version.audioAssetId,
      audioAssetVersionId: version.audioAssetVersionId,
    } : {}),
    ...(version.width ? { width: version.width } : {}),
    ...(version.height ? { height: version.height } : {}),
    ...(version.durationMs ? { durationMs: version.durationMs } : {}),
    ...(version.frameRate ? { frameRate: version.frameRate } : {}),
    byteSize: version.byteSize,
    sha256: version.sha256,
    transparent: version.transparent,
    loop: version.loop,
    performanceTier: version.performanceTier,
    minimumClientVersion: version.minimumClientVersion,
    moderationStatus: summary.moderationStatus,
    publicationStatus: summary.publicationStatus,
    approvalId: summary.approvalId,
    revision: summary.revision,
  };
  const validation = validateCosmeticAssetDescriptorV1(descriptor, {
    allowLegacyWebp: true,
    requireRenderable: true,
  });
  return validation.ok ? validation.descriptor : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
