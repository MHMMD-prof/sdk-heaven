import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildApprovedRegistryIndex,
  buildCosmeticMigrationPatches,
  isApprovedPublishedVersion,
  mergeDualReadCanonicalFields,
  planCosmeticAssetReferenceMigration,
} = require('./cosmeticsMigrationCore');

function approved(assetId, assetVersionId, storagePath = '') {
  return {
    approvalChecksum: 'a'.repeat(64),
    approvalDecision: 'approved',
    approvalId: `${assetId}__${assetVersionId}`,
    approvedVersionId: assetVersionId,
    assetId,
    assetVersionId,
    moderationStatus: 'approved',
    publicationStatus: 'published',
    publishedVersionId: assetVersionId,
    renderingEnabled: true,
    sha256: 'a'.repeat(64),
    storagePath,
  };
}

describe('cosmeticsMigrationCore', () => {
  it('plans dual-read patches only for approved published versions', () => {
    const registry = buildApprovedRegistryIndex([
      approved('frame-a', 'v1-aaaaaaaaaaaa', 'cosmetic-assets/frame-a/v1/a.png'),
      {
        ...approved('bad', 'v1-bbbbbbbbbbbb'),
        renderingEnabled: false,
      },
    ]);
    const documents = [
      {
        collection: 'storeCatalog',
        id: 'frame-item',
        data: {
          cosmeticAsset: { assetId: 'frame-a', assetVersionId: 'v1-aaaaaaaaaaaa' },
          previewAssetUrl: 'https://cdn.example.test/legacy.png',
        },
      },
      {
        collection: 'roomRocketCampaigns',
        id: 'rocket-1',
        data: {
          appearance: {
            animationAsset: {
              storagePath: 'cosmetic-assets/frame-a/v1/a.png',
              uri: 'https://cdn.example.test/rocket.webp',
            },
          },
        },
      },
      {
        collection: 'giftCatalog',
        id: 'gift-x',
        data: {
          presentation: {
            visualAsset: { assetId: 'missing', assetVersionId: 'v1-cccccccccccc' },
          },
        },
      },
    ];
    const original = structuredClone(documents);
    const plan = planCosmeticAssetReferenceMigration({ documents, registry });
    expect(documents).toEqual(original);
    expect(plan.summary).toMatchObject({
      alreadyCanonical: 1,
      invalidRefs: 1,
      patchesReady: 1,
    });
    const patch = plan.items.find((item) => item.action === 'patch');
    expect(patch.patch['appearance.animationAsset.canonicalAsset']).toEqual({
      assetId: 'frame-a',
      assetVersionId: 'v1-aaaaaaaaaaaa',
    });
  });

  it('keeps dry-run default and never strips legacy urls on merge', () => {
    expect(isApprovedPublishedVersion(approved('frame-a', 'v1-aaaaaaaaaaaa'))).toBe(true);
    const plan = planCosmeticAssetReferenceMigration({
      documents: [{
        collection: 'storeCatalog',
        id: 'car-1',
        data: { previewAssetUrl: 'https://cdn.example.test/car.png' },
      }],
      registry: [],
    });
    const dry = buildCosmeticMigrationPatches(plan);
    expect(dry).toMatchObject({ applied: false, dryRun: true, wouldWrite: 0 });
    const merged = mergeDualReadCanonicalFields(
      {
        previewAssetUrl: 'https://cdn.example.test/car.png',
        entryPresentation: { durationMs: 3000 },
      },
      {
        'entryPresentation.visualAsset': {
          assetId: 'entry-a',
          assetVersionId: 'v1-aaaaaaaaaaaa',
        },
      },
    );
    expect(merged.previewAssetUrl).toBe('https://cdn.example.test/car.png');
    expect(merged.entryPresentation).toMatchObject({
      durationMs: 3000,
      visualAsset: { assetId: 'entry-a', assetVersionId: 'v1-aaaaaaaaaaaa' },
    });
  });

  it('validates equipment and public profile projection refs', () => {
    const registry = buildApprovedRegistryIndex([
      approved('skin-a', 'v1-aaaaaaaaaaaa'),
    ]);
    const plan = planCosmeticAssetReferenceMigration({
      documents: [
        {
          collection: 'storeEquipment',
          id: 'user-1',
          data: {
            cosmetics: {
              profileSkin: { assetId: 'skin-a', assetVersionId: 'v1-aaaaaaaaaaaa', itemId: 'skin-item' },
            },
          },
        },
        {
          collection: 'publicProfiles',
          id: 'user-1',
          data: {
            equippedCosmetics: {
              profileSkin: { assetId: 'missing', assetVersionId: 'v1-bbbbbbbbbbbb', itemId: 'x' },
            },
          },
        },
        {
          collection: 'storeOwnerships',
          id: 'own-1',
          data: { itemId: 'skin-item' },
        },
      ],
      registry,
    });
    expect(plan.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'already-canonical', collection: 'storeEquipment' }),
      expect.objectContaining({ action: 'invalid-ref', collection: 'publicProfiles' }),
      expect.objectContaining({ action: 'skip', collection: 'storeOwnerships' }),
    ]));
  });
});
