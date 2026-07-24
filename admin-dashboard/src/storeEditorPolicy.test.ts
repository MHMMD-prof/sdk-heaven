import { describe, expect, it } from 'vitest';

import { StoreCatalogDraft, buildStoreAssetPath, parseManagedStoreAssetPath, validateStoreCatalogDraft } from './storeEditorPolicy';

const validDraft: StoreCatalogDraft = {
  availability: 'available',
  category: 'avatar-frames',
  description: { ar: 'وصف عربي', en: 'English description' },
  duration: { kind: 'permanent' },
  featured: false,
  itemId: 'gold_frame',
  name: { ar: 'الإطار الذهبي', en: 'Gold frame' },
  order: 1,
  previewAssetUrl: 'https://example.test/preview.webp',
  prices: { coins: 100 },
  purchasingEnabled: true,
  stock: { kind: 'unlimited' },
  thumbnailUrl: 'https://example.test/thumb.webp',
};

describe('store editor policy', () => {
  it('accepts a complete production catalog draft', () => {
    expect(validateStoreCatalogDraft(validDraft, 'Seasonal release', true, true)).toEqual([]);
  });

  it('collects validation failures before any asset upload', () => {
    const invalid: StoreCatalogDraft = { ...validDraft, description: { ar: '', en: '' }, duration: { kind: 'timed', unit: 'days', value: 0 }, itemId: '!', prices: {}, stock: { kind: 'limited', remaining: -1 } };
    expect(validateStoreCatalogDraft(invalid, '', false, false)).toHaveLength(7);
  });

  it('prevents a hidden catalog item from remaining featured', () => {
    expect(validateStoreCatalogDraft({ ...validDraft, availability: 'disabled', featured: true }, 'Hide item', true, true)).toContain('لا يمكن عرض عنصر متوقف كبطاقة مميّزة في واجهة المتجر.');
  });

  it('creates isolated immutable asset paths', () => {
    expect(buildStoreAssetPath('gold_frame', 'preview', 'version_123')).toBe('store-assets/gold_frame/preview/version_123');
    expect(() => buildStoreAssetPath('../escape', 'preview', 'version_123')).toThrow();
  });

  it('recognizes only managed versions for the expected item and slot', () => {
    expect(parseManagedStoreAssetPath('https://firebasestorage.googleapis.com/v0/b/sdk/o/store-assets%2Fgold_frame%2Fthumbnail%2Fversion_123?alt=media', 'gold_frame', 'thumbnail')).toBe('store-assets/gold_frame/thumbnail/version_123');
    expect(parseManagedStoreAssetPath('https://storage.googleapis.com/sdk/store-assets/gold_frame/preview/version_123', 'gold_frame', 'preview')).toBe('store-assets/gold_frame/preview/version_123');
    expect(parseManagedStoreAssetPath('https://example.com/store-assets/gold_frame/preview/version_123', 'gold_frame', 'preview')).toBe('');
    expect(parseManagedStoreAssetPath('https://storage.googleapis.com/sdk/store-assets/other/preview/version_123', 'gold_frame', 'preview')).toBe('');
    expect(parseManagedStoreAssetPath('https://storage.googleapis.com/sdk/store-assets/gold_frame/thumbnail/version_123', 'gold_frame', 'preview')).toBe('');
  });
});
