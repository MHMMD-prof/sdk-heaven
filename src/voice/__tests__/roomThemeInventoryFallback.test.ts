import { describe, expect, it } from 'vitest';

import {
  RoomThemeInventory,
  ensureDefaultRoomThemeInventory,
} from '../roomThemeInventory';

describe('room theme inventory fallback', () => {
  const baseInventory: RoomThemeInventory = {
    equippedThemeId: 'royal-theater',
    inventory: [],
    roomId: 'room-1',
  };

  it('always exposes Majlis Default as the first free option', () => {
    const result = ensureDefaultRoomThemeInventory(baseInventory);

    expect(result.inventory[0]).toMatchObject({
      state: 'free',
      themeId: 'majlis-default',
      manifest: { themeId: 'majlis-default' },
    });
  });

  it('deduplicates a server-provided Majlis entry', () => {
    const result = ensureDefaultRoomThemeInventory({
      ...baseInventory,
      inventory: [{
        catalog: null,
        entitlement: null,
        manifest: null,
        state: 'free',
        themeId: 'majlis-default',
      }],
    });

    expect(result.inventory).toHaveLength(1);
    expect(result.inventory[0].manifest?.themeId).toBe('majlis-default');
  });
});
