import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildCosmeticAssetInventory,
  inferFormat,
  storagePathFromLocation,
} = require('./cosmeticsAssetMigrationCore');

describe('cosmetic asset migration inventory', () => {
  it('finds legacy assets without mutating source records', () => {
    const documents = [
      {
        collection: 'storeCatalog',
        id: 'royal-car',
        data: {
          category: 'cars',
          previewAssetUrl: 'https://cdn.example.test/cars/royal/preview.png',
          animationAssetUrl: 'https://cdn.example.test/cars/royal/entrance.mp4',
        },
      },
      {
        collection: 'giftCatalog',
        id: 'rose',
        data: { name: { en: 'Rose' } },
      },
    ];
    const original = structuredClone(documents);
    const report = buildCosmeticAssetInventory(documents);

    expect(documents).toEqual(original);
    expect(report.summary).toMatchObject({ documentsScanned: 2, referencesFound: 2 });
    expect(report.documentsWithoutVisuals).toEqual([
      { collection: 'giftCatalog', documentId: 'rose' },
    ]);
    expect(report.items.find((item) => item.format === 'mp4')?.issues)
      .not.toContain('missing-static-fallback');
    expect(report.items.every((item) => item.suggestedCategory === 'entrance-effect')).toBe(true);
  });

  it('flags legacy, duplicate, mutable, and fallback problems', () => {
    const location = 'rocket-assets/current/explosion.webp';
    const report = buildCosmeticAssetInventory([
      {
        collection: 'roomRocketCampaigns',
        id: 'current',
        data: {
          appearance: {
            animationAsset: { format: 'animated-webp', storagePath: location },
            duplicateAnimationAsset: { format: 'animated-webp', storagePath: location },
            soundAsset: { format: 'mp3', storagePath: 'rocket-assets/current/sound.mp3' },
          },
        },
      },
    ]);

    expect(report.issueCounts).toMatchObject({
      'duplicate-reference': 2,
      'legacy-format-requires-conversion': 3,
      'missing-static-fallback': 2,
      'mutable-or-unversioned-location': 3,
    });
  });

  it('infers safe extensions and extracts Firebase object paths only', () => {
    expect(inferFormat('https://example.test/a.JPG?token=x')).toBe('jpeg');
    expect(inferFormat('x/effect.webp', 'appearance.animationAsset.uri')).toBe('animated-webp');
    expect(storagePathFromLocation(
      'https://firebasestorage.googleapis.com/v0/b/demo/o/cosmetics%2Fv1%2Fa.png?alt=media',
    )).toBe('cosmetics/v1/a.png');
    expect(storagePathFromLocation('https://example.test/a.png')).toBe('');
  });
});
