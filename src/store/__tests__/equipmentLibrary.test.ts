import { describe, expect, it } from 'vitest';

import { orderEquipmentItems } from '../equipmentLibrary';
import { mockMyStoreItems } from '../mockStoreData';

describe('equipment library', () => {
  it('pins the equipped item before active and expired items', () => {
    const frames = mockMyStoreItems.filter((row) => row.ownership.category === 'avatar-frames');
    const ordered = orderEquipmentItems([...frames].reverse());

    expect(ordered[0]?.ownership.equipped).toBe(true);
    expect(ordered[1]?.ownership.state).toBe('active');
    expect(ordered.at(-1)?.ownership.state).toBe('expired');
  });

  it('does not mutate the caller collection', () => {
    const frames = mockMyStoreItems.filter((row) => row.ownership.category === 'avatar-frames').reverse();
    const originalIds = frames.map((row) => row.ownership.itemId);

    orderEquipmentItems(frames);

    expect(frames.map((row) => row.ownership.itemId)).toEqual(originalIds);
  });
});
