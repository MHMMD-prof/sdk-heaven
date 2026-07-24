import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { durationToMilliseconds, mapCustomerCatalogItem, normalizeStoreGiftInput, normalizeStorePurchaseInput } = require('./storePurchaseCore');

describe('storePurchaseCore', () => {
  it('accepts only a stable item ID and one supported currency', () => {
    expect(normalizeStorePurchaseInput({ itemId: 'gold-car', currency: 'diamonds' })).toEqual({ ok: true, value: { itemId: 'gold-car', currency: 'diamonds' } });
    expect(normalizeStorePurchaseInput({ itemId: 'gold-car', currency: 'cash' })).toMatchObject({ ok: false });
    expect(normalizeStorePurchaseInput({ itemId: 'gold-car', currency: 'coins', price: 1 })).toMatchObject({ ok: false });
  });

  it('requires a normal exact seven-digit recipient ID for store gifts', () => {
    expect(normalizeStoreGiftInput({ currency: 'coins', itemId: 'gold-car', recipientPublicId: '7654321' })).toMatchObject({ ok: true });
    expect(normalizeStoreGiftInput({ currency: 'coins', itemId: 'gold-car', recipientPublicId: '777' })).toMatchObject({ ok: false });
  });

  it('uses fixed day, week, and thirty-day month durations', () => {
    expect(durationToMilliseconds({ kind: 'timed', unit: 'days', value: 2 })).toBe(172_800_000);
    expect(durationToMilliseconds({ kind: 'timed', unit: 'weeks', value: 2 })).toBe(1_209_600_000);
    expect(durationToMilliseconds({ kind: 'timed', unit: 'months', value: 1 })).toBe(2_592_000_000);
    expect(durationToMilliseconds({ kind: 'permanent' })).toBeUndefined();
  });

  it('shows unavailable and sold-out items but hides disabled items', () => {
    const item = catalogItem();
    expect(mapCustomerCatalogItem(item, item.itemId)).toMatchObject({ soldOut: false });
    expect(mapCustomerCatalogItem({ ...item, availability: 'unavailable' }, item.itemId)).toMatchObject({ availability: 'unavailable' });
    expect(mapCustomerCatalogItem({ ...item, stock: { kind: 'limited', remaining: 0 } }, item.itemId)).toMatchObject({ soldOut: true });
    expect(mapCustomerCatalogItem({ ...item, availability: 'disabled' }, item.itemId)).toBeUndefined();
  });
});

function catalogItem() {
  return {
    availability: 'available', category: 'cars', description: { ar: 'سيارة', en: 'Car' }, duration: { kind: 'permanent' },
    itemId: 'gold-car', name: { ar: 'ذهبية', en: 'Gold' }, order: 1, previewAssetUrl: 'https://cdn.example.com/preview.png',
    prices: { coins: 40, diamonds: 4 }, purchasingEnabled: true, stock: { kind: 'unlimited' },
    thumbnailUrl: 'https://cdn.example.com/thumb.png',
  };
}
