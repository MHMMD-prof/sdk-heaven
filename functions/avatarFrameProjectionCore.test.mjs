import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const projectionCore = require('./avatarFrameProjectionCore');

const { buildAvatarFrameProjection, inspectApprovedAvatarFrameReference, mapCosmeticAssetReference, readPublicAvatarFrameProjection } = projectionCore;
const assetId = 'gold-frame';
const versionId = 'v1-123456789abc';

describe('avatarFrameProjectionCore', () => {
  it('maps strict immutable cosmetic asset references', () => {
    expect(mapCosmeticAssetReference({ assetId, assetVersionId: versionId })).toEqual({ assetId, assetVersionId: versionId });
    expect(mapCosmeticAssetReference({ assetId, assetVersionId: versionId, surprise: true })).toBeUndefined();
    expect(mapCosmeticAssetReference({ assetId, assetVersionId: 'latest' })).toBeUndefined();
  });

  it('builds a dual-format public frame snapshot', () => {
    expect(buildAvatarFrameProjection({
      category: 'avatar-frames', cosmeticAsset: { assetId, assetVersionId: versionId }, itemId: 'gold-frame-item', previewAssetUrl: 'https://cdn.example/frame.png',
    })).toEqual({
      assetUrl: 'https://cdn.example/frame.png',
      canonicalAsset: { assetId, assetVersionId: versionId },
      itemId: 'gold-frame-item',
    });
  });

  it('reads only matching server-owned public projections', () => {
    expect(readPublicAvatarFrameProjection({
      equippedAvatarFrame: { assetUrl: 'https://cdn.example/frame.png', itemId: 'gold-frame-item' },
      equippedCosmetics: { avatarFrame: { assetId, assetVersionId: versionId, itemId: 'gold-frame-item' } },
    })).toEqual({
      assetUrl: 'https://cdn.example/frame.png', canonicalAsset: { assetId, assetVersionId: versionId }, itemId: 'gold-frame-item',
    });
    expect(readPublicAvatarFrameProjection({
      equippedAvatarFrame: { assetUrl: 'http://unsafe/frame.png', itemId: 'gold-frame-item' },
    })).toBeUndefined();
  });

  it('requires the exact approved published frame version and checksum', () => {
    const input = {
      approval: { assetId, assetVersionId: versionId, checksum: 'abc', decision: 'approved' },
      assetId,
      summary: {
        approvalId: `${assetId}__${versionId}`, approvedVersionId: versionId, moderationStatus: 'approved', publicationStatus: 'published', publishedVersionId: versionId, renderingEnabled: true,
      },
      version: { assetId, assetVersionId: versionId, category: 'avatar-frame', format: 'lottie-json', sha256: 'abc' },
      versionId,
    };
    expect(inspectApprovedAvatarFrameReference(input)).toEqual({ ok: true });
    expect(inspectApprovedAvatarFrameReference({ ...input, approval: { ...input.approval, decision: 'rejected' } })).toEqual({ ok: false });
    expect(inspectApprovedAvatarFrameReference({ ...input, version: { ...input.version, format: 'mp4' } })).toEqual({ ok: false });
  });
});
