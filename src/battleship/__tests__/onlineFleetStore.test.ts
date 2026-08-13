import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(storage.get(key) ?? null)),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
      return Promise.resolve();
    }),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    }),
  },
}));

import { MiniGameTarget } from '../../types/miniGame';
import {
  clearOnlineFleet,
  decodeStoredOnlineFleet,
  loadOnlineFleet,
  saveOnlineFleet,
} from '../online/onlineFleetStore';

const fleet = (): MiniGameTarget[] => [
  {
    id: 'ship-a',
    name: 'A',
    shortLabel: 'A',
    footprint: { columns: 1, rows: 1 },
    cells: ['0-0'],
    isPlaced: true,
  },
];

const seal = {
  commitment: 'a'.repeat(64),
  fleetCellCount: 1,
  targetCount: 1,
};

describe('online fleet store', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('round-trips a sealed private fleet for remount recovery', async () => {
    await saveOnlineFleet({
      fleet: fleet(),
      matchId: 'nd_match',
      playerId: 'host-1',
      seal,
    });

    const loaded = await loadOnlineFleet({
      matchId: 'nd_match',
      playerId: 'host-1',
    });

    expect(loaded?.fleet[0]?.cells).toEqual(['0-0']);
    expect(loaded?.seal.commitment).toBe(seal.commitment);
  });

  it('skips pending match ids and clears stored fleets', async () => {
    await saveOnlineFleet({
      fleet: fleet(),
      matchId: 'pending-session',
      playerId: 'host-1',
      seal,
    });
    expect(storage.size).toBe(0);

    await saveOnlineFleet({
      fleet: fleet(),
      matchId: 'nd_match',
      playerId: 'host-1',
      seal,
    });
    await clearOnlineFleet({ matchId: 'nd_match', playerId: 'host-1' });
    expect(await loadOnlineFleet({ matchId: 'nd_match', playerId: 'host-1' })).toBeUndefined();
  });

  it('rejects payloads that smuggle board cells into the seal', () => {
    expect(
      decodeStoredOnlineFleet(
        JSON.stringify({
          matchId: 'nd_match',
          playerId: 'host-1',
          fleet: fleet(),
          seal: { ...seal, cells: ['0-0'] },
        }),
      ),
    ).toBeUndefined();
  });
});
