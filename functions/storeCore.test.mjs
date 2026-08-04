import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  STORE_CATEGORIES,
  isStoreAvailability,
  isStoreCategory,
  isStoreCurrency,
  isStoreDurationUnit,
  mapStoreCatalogItem,
  normalizeAdminStoreCatalogInput,
} = require('./storeCore');

describe('storeCore', () => {
  it('defines the Wave 0 store categories without a couples category', () => {
    expect(STORE_CATEGORIES).toEqual([
      'game-items',
      'chat-themes',
      'avatar-frames',
      'profile-skins',
      'chat-bubbles',
      'nameplates',
      'cosmetic-badges',
      'seat-effects',
      'stickers',
      'cars',
      'custom-ids',
    ]);
  });

  it('requires immutable assets for sticker catalog items', () => {
    const sticker = {
      availability: 'available', category: 'stickers', description: { ar: 'ملصق', en: 'Sticker' }, duration: { kind: 'permanent' },
      itemId: 'ruby-sticker', name: { ar: 'ياقوت', en: 'Ruby' }, order: 1,
      previewAssetUrl: 'https://cdn.example.com/sticker-preview.png', prices: { coins: 25 }, purchasingEnabled: true,
      stickerAsset: { assetId: 'ruby-reaction', assetVersionId: 'v1-123456789abc' }, stock: { kind: 'unlimited' }, thumbnailUrl: 'https://cdn.example.com/sticker.png',
    };
    expect(mapStoreCatalogItem(sticker, sticker.itemId)).toMatchObject({ category: 'stickers', stickerAsset: sticker.stickerAsset });
    expect(mapStoreCatalogItem({ ...sticker, stickerAsset: undefined }, sticker.itemId)).toBeUndefined();
    expect(mapStoreCatalogItem({ ...sticker, category: 'cars' }, sticker.itemId)).toBeUndefined();
  });

  it('maps a bilingual dual-currency timed catalog card', () => {
    expect(mapStoreCatalogItem({
      availability: 'available',
      category: 'avatar-frames',
      cosmeticAsset: { assetId: 'royal-frame', assetVersionId: 'v1-123456789abc' },
      description: { ar: 'إطار ملكي', en: 'Royal frame' },
      duration: { kind: 'timed', unit: 'weeks', value: 2 },
      itemId: 'royal-frame',
      name: { ar: 'الملكي', en: 'Royal' },
      order: 10,
      previewAssetUrl: 'https://cdn.example.com/preview.png',
      prices: { coins: 500, diamonds: 5 },
      purchasingEnabled: true,
      stock: { kind: 'unlimited' },
      thumbnailUrl: 'https://cdn.example.com/thumb.png',
    }, 'royal-frame')).toMatchObject({
      cosmeticAsset: { assetId: 'royal-frame', assetVersionId: 'v1-123456789abc' },
      duration: { kind: 'timed', unit: 'weeks', value: 2 },
      prices: { coins: 500, diamonds: 5 },
    });
  });

  it('requires one valid price and category-specific seven-digit custom IDs', () => {
    const base = {
      availability: 'available',
      category: 'custom-ids',
      customId: '0000777',
      description: { ar: 'معرّف مميز', en: 'Custom ID' },
      duration: { kind: 'permanent' },
      itemId: 'custom-id-0000777',
      name: { ar: '0000777', en: '0000777' },
      order: 1,
      previewAssetUrl: 'https://cdn.example.com/preview.png',
      prices: { diamonds: 10 },
      purchasingEnabled: true,
      stock: { kind: 'limited', remaining: 1 },
      thumbnailUrl: 'https://cdn.example.com/thumb.png',
    };
    expect(mapStoreCatalogItem(base, base.itemId)).toMatchObject({ customId: '0000777' });
    expect(mapStoreCatalogItem({ ...base, prices: {} }, base.itemId)).toBeUndefined();
    expect(mapStoreCatalogItem({ ...base, customId: '777' }, base.itemId)).toBeUndefined();
    expect(mapStoreCatalogItem({ ...base, category: 'cars' }, base.itemId)).toBeUndefined();
  });

  it('accepts only the agreed currencies, durations, and availability states', () => {
    expect(isStoreCurrency('coins')).toBe(true);
    expect(isStoreCurrency('diamonds')).toBe(true);
    expect(isStoreCurrency('cash')).toBe(false);
    expect(isStoreDurationUnit('days')).toBe(true);
    expect(isStoreDurationUnit('hours')).toBe(false);
    expect(isStoreAvailability('unavailable')).toBe(true);
    expect(isStoreCategory('couples')).toBe(false);
  });

  it('normalizes audited admin input and rejects client timestamps', () => {
    const item = {
      availability: 'available', category: 'cars', description: { ar: 'سيارة', en: 'Car' },
      duration: { kind: 'permanent' }, itemId: 'gold-car', name: { ar: 'ذهبية', en: 'Gold' }, order: 2,
      previewAssetUrl: 'https://cdn.example.com/preview.png', prices: { coins: 500 }, purchasingEnabled: true,
      stock: { kind: 'unlimited' }, thumbnailUrl: 'https://cdn.example.com/thumb.png',
    };
    expect(normalizeAdminStoreCatalogInput({ item, reason: 'تحديث الكتالوج', requestId: 'request_123456789' })).toMatchObject({ ok: true, value: { item, reason: 'تحديث الكتالوج' } });
    expect(normalizeAdminStoreCatalogInput({ item: { ...item, featured: true }, reason: 'تحديث العنصر المميز', requestId: 'request_123456789' })).toMatchObject({
      ok: true,
      value: { featured: true, item },
    });
    expect(normalizeAdminStoreCatalogInput({ item: { ...item, createdAt: 'fake' }, reason: 'تحديث الكتالوج', requestId: 'request_123456789' })).toMatchObject({ ok: false, status: 400 });
  });
});
