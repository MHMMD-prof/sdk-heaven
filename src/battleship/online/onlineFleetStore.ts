import AsyncStorage from '@react-native-async-storage/async-storage';

import { MiniGameTarget } from '../../types/miniGame';
import { BattleshipFleetReadySeal, fleetSealLooksSafe } from './fleetSeal';

export const ONLINE_FLEET_STORE_PREFIX = 'sdk-heaven:naval-duel:fleet:v1:';

export type StoredOnlineFleet = {
  fleet: MiniGameTarget[];
  matchId: string;
  playerId: string;
  seal: BattleshipFleetReadySeal;
};

const storageKey = (matchId: string, playerId: string) =>
  `${ONLINE_FLEET_STORE_PREFIX}${matchId}:${playerId}`;

const hasValidFleet = (value: unknown): value is MiniGameTarget[] =>
  Array.isArray(value)
  && value.length > 0
  && value.every((target) => {
    if (!target || typeof target !== 'object') {
      return false;
    }
    const next = target as Partial<MiniGameTarget>;
    return (
      typeof next.id === 'string'
      && typeof next.name === 'string'
      && Array.isArray(next.cells)
      && next.cells.every((cell) => typeof cell === 'string')
      && Boolean(next.footprint)
      && typeof next.footprint?.columns === 'number'
      && typeof next.footprint?.rows === 'number'
    );
  });

export const encodeStoredOnlineFleet = (value: StoredOnlineFleet) => JSON.stringify(value);

export const decodeStoredOnlineFleet = (raw: string): StoredOnlineFleet | undefined => {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredOnlineFleet>;
    if (
      typeof parsed.matchId !== 'string'
      || !parsed.matchId
      || typeof parsed.playerId !== 'string'
      || !parsed.playerId
      || !hasValidFleet(parsed.fleet)
      || !fleetSealLooksSafe(parsed.seal)
    ) {
      return undefined;
    }

    return {
      matchId: parsed.matchId,
      playerId: parsed.playerId,
      fleet: parsed.fleet.map((target) => ({
        ...target,
        cells: [...target.cells],
        footprint: { ...target.footprint },
      })),
      seal: parsed.seal,
    };
  } catch {
    return undefined;
  }
};

export const saveOnlineFleet = async (value: StoredOnlineFleet) => {
  if (value.matchId.startsWith('pending-')) {
    return;
  }

  await AsyncStorage.setItem(
    storageKey(value.matchId, value.playerId),
    encodeStoredOnlineFleet(value),
  );
};

export const loadOnlineFleet = async ({
  matchId,
  playerId,
}: {
  matchId: string;
  playerId: string;
}): Promise<StoredOnlineFleet | undefined> => {
  if (!matchId || matchId.startsWith('pending-') || !playerId) {
    return undefined;
  }

  try {
    const raw = await AsyncStorage.getItem(storageKey(matchId, playerId));
    if (!raw) {
      return undefined;
    }
    const decoded = decodeStoredOnlineFleet(raw);
    if (!decoded || decoded.matchId !== matchId || decoded.playerId !== playerId) {
      return undefined;
    }
    return decoded;
  } catch {
    return undefined;
  }
};

export const clearOnlineFleet = async ({
  matchId,
  playerId,
}: {
  matchId: string;
  playerId: string;
}) => {
  if (!matchId || !playerId) {
    return;
  }

  try {
    await AsyncStorage.removeItem(storageKey(matchId, playerId));
  } catch {
    // Best-effort local cleanup.
  }
};
