import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildCanonicalEquipmentCosmetic,
  inspectApprovedEquipmentCosmeticReference,
  readPublicEquipmentCosmetics,
} = require('./equipmentCosmeticsCore');

const assetId = 'safe-nameplate';
const versionId = 'v1-123456789abc';

function approved(category = 'nameplates', assetCategory = 'nameplate') {
  return {
    approval: {
      assetId,
      assetVersionId: versionId,
      authoritySeparationPassed: true,
      checksum: 'abc',
      decision: 'approved',
      readableIdentityPassed: true,
    },
    assetId,
    category,
    summary: {
      approvalId: `${assetId}__${versionId}`,
      approvedVersionId: versionId,
      moderationStatus: 'approved',
      publicationStatus: 'published',
      publishedVersionId: versionId,
      renderingEnabled: true,
    },
    version: { assetId, assetVersionId: versionId, category: assetCategory, format: 'lottie-json', sha256: 'abc' },
    versionId,
  };
}

describe('equipment cosmetics authority', () => {
  it('builds bounded public projections with no file URLs or moderation data', () => {
    expect(buildCanonicalEquipmentCosmetic({
      category: 'seat-effects',
      cosmeticAsset: { assetId: 'safe-seat', assetVersionId: versionId },
      itemId: 'safe-seat-item',
    })).toEqual({ assetId: 'safe-seat', assetVersionId: versionId, itemId: 'safe-seat-item' });
  });

  it('strictly preserves only known public slots during profile repair', () => {
    expect(readPublicEquipmentCosmetics({ equippedCosmetics: {
      seatEffect: { assetId: 'safe-seat', assetVersionId: versionId, itemId: 'safe-seat-item' },
      staffBadge: { assetId: 'fake-staff', assetVersionId: versionId, itemId: 'fake-staff-item' },
    } })).toEqual({ seatEffect: { assetId: 'safe-seat', assetVersionId: versionId, itemId: 'safe-seat-item' } });
  });

  it('requires exact category, publication, approval, and checksum', () => {
    expect(inspectApprovedEquipmentCosmeticReference(approved())).toMatchObject({ ok: true, projectionKey: 'nameplate' });
    expect(inspectApprovedEquipmentCosmeticReference({ ...approved(), version: { ...approved().version, category: 'seat-effect' } })).toEqual({ ok: false });
    expect(inspectApprovedEquipmentCosmeticReference({ ...approved(), summary: { ...approved().summary, renderingEnabled: false } })).toEqual({ ok: false });
  });

  it('blocks persistent MP4/audio and sensitive artwork without attestations', () => {
    expect(inspectApprovedEquipmentCosmeticReference({ ...approved(), version: { ...approved().version, format: 'mp4' } })).toEqual({ ok: false });
    expect(inspectApprovedEquipmentCosmeticReference({ ...approved(), approval: { ...approved().approval, authoritySeparationPassed: false } })).toEqual({ ok: false });
    const seat = approved('seat-effects', 'seat-effect');
    expect(inspectApprovedEquipmentCosmeticReference({ ...seat, version: { ...seat.version, audioAssetId: 'sound', audioAssetVersionId: versionId } })).toEqual({ ok: false });
  });
});
