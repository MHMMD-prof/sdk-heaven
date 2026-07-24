import { describe, expect, it } from 'vitest';

import {
  isMockStoreItemId,
  mockMyStoreItems,
  mockStoreCatalogItems,
  mockStoreFeaturedItemId,
} from '../mockStoreData';

describe('mock store data', () => {
  it('covers every store category with unique mock items', () => {
    const ids = mockStoreCatalogItems.map((item) => item.itemId);
    const categories = new Set(mockStoreCatalogItems.map((item) => item.category));

    expect(new Set(ids).size).toBe(ids.length);
    expect(categories).toEqual(new Set([
      'avatar-frames',
      'cars',
      'chat-themes',
      'custom-ids',
      'game-items',
    ]));
    expect(mockStoreCatalogItems.some((item) => item.itemId === mockStoreFeaturedItemId)).toBe(true);
    expect(ids.every(isMockStoreItemId)).toBe(true);
  });

  it('keeps mock ownerships linked to catalog entries', () => {
    const catalogIds = new Set(mockStoreCatalogItems.map((item) => item.itemId));

    expect(mockMyStoreItems).toHaveLength(5);
    expect(mockMyStoreItems.every((row) => catalogIds.has(row.ownership.itemId))).toBe(true);
    expect(mockMyStoreItems.some((row) => row.ownership.equipped)).toBe(true);
    expect(mockMyStoreItems.some((row) => row.ownership.state === 'expired')).toBe(true);
  });

  it('uses a valid seven-digit custom ID', () => {
    const customIdItem = mockStoreCatalogItems.find((item) => item.category === 'custom-ids');

    expect(customIdItem?.customId).toMatch(/^\d{7}$/);
  });
});
