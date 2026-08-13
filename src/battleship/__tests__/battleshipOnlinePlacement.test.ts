import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    createHash('sha256').update(value).digest('hex'),
}));

import { MiniGameTarget } from '../../types/miniGame';
import {
  canonicalizeFleet,
  createFleetReadySeal,
  fleetSealLooksSafe,
} from '../online/fleetCommitment';
import {
  bothFleetsReady,
  battleshipOnlineReducer,
  canStartOnlinePlacement,
  createBattleshipOnlineState,
} from '../online/onlineSessionModel';
import {
  createPlacementMessage,
  getPlacementPayload,
} from '../transport/battleshipMessages';
import { MockBattleshipTransport } from '../transport/MockBattleshipTransport';

const placedFleet = (): MiniGameTarget[] => [
  {
    id: 'ship-a',
    name: 'A',
    shortLabel: 'A',
    footprint: { columns: 2, rows: 1 },
    cells: ['0-1', '0-0'],
    isPlaced: true,
  },
  {
    id: 'ship-b',
    name: 'B',
    shortLabel: 'B',
    footprint: { columns: 1, rows: 2 },
    cells: ['1-0', '2-0'],
    isPlaced: true,
  },
];

describe('naval-duel Wave 3 fleet commitment', () => {
  it('canonicalizes fleets without depending on cell order', () => {
    const left = canonicalizeFleet(placedFleet());
    const right = canonicalizeFleet([
      {
        ...placedFleet()[1],
        cells: ['2-0', '1-0'],
      },
      {
        ...placedFleet()[0],
        cells: ['0-0', '0-1'],
      },
    ]);

    expect(left).toBe(right);
  });

  it('creates a seal without embedding board cells', async () => {
    const seal = await createFleetReadySeal(placedFleet());

    expect(seal.commitment).toMatch(/^[a-f0-9]{64}$/i);
    expect(seal.targetCount).toBe(2);
    expect(seal.fleetCellCount).toBe(4);
    expect(JSON.stringify(seal)).not.toMatch(/0-0|cells|targets/);
    expect(fleetSealLooksSafe(seal)).toBe(true);
    expect(fleetSealLooksSafe({ ...seal, cells: ['0-0'] })).toBe(false);
  });
});

describe('naval-duel Wave 3 placement reducer', () => {
  const baseState = () => {
    let state = createBattleshipOnlineState({
      displayName: 'Ali',
      hostId: 'host-1',
      localPlayerId: 'host-1',
      matchId: 'nd_match',
      roomId: 'room-1',
      sessionId: 'rgs_session_naval_0001',
    });
    state = battleshipOnlineReducer(state, {
      type: 'connection-status-changed',
      status: 'connected',
    });
    state = battleshipOnlineReducer(state, {
      type: 'apply-presence',
      displayName: 'Ali',
      players: [
        { id: 'host-1', displayName: 'Ali', joinedAt: 1, isConnected: true },
        { id: 'joiner-2', displayName: 'Sara', joinedAt: 2, isConnected: true },
      ],
    });
    return state;
  };

  it('opens placement only when the lobby is full and match is linked', () => {
    const state = baseState();
    expect(canStartOnlinePlacement(state)).toBe(true);
    expect(
      canStartOnlinePlacement({
        ...state,
        matchId: 'pending-rgs_session_naval_0001',
      }),
    ).toBe(false);
  });

  it('keeps local fleet private while recording peer seals', async () => {
    const seal = await createFleetReadySeal(placedFleet());
    let state = battleshipOnlineReducer(baseState(), {
      type: 'placement-started',
      matchId: 'nd_match',
    });
    state = battleshipOnlineReducer(state, {
      type: 'local-fleet-sealed',
      fleet: placedFleet(),
      seal,
    });
    state = battleshipOnlineReducer(state, {
      type: 'peer-fleet-ready',
      playerId: 'joiner-2',
      seal: {
        commitment: 'b'.repeat(64),
        fleetCellCount: 4,
        targetCount: 2,
      },
    });

    expect(state.localFleet?.[0]?.cells).toEqual(['0-1', '0-0']);
    expect(state.readySeals['joiner-2']?.commitment).toBe('b'.repeat(64));
    expect(bothFleetsReady(state)).toBe(true);

    state = battleshipOnlineReducer(state, {
      type: 'battle-started',
      firstPlayerId: 'host-1',
      matchId: 'nd_match',
      now: 99,
    });
    expect(state.phase).toBe('battle');
    expect(state.firstPlayerId).toBe('host-1');
  });
});

describe('naval-duel Wave 3 placement transport', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects placement payloads that leak board cells', async () => {
    const seal = await createFleetReadySeal(placedFleet());
    const valid = createPlacementMessage({
      matchId: 'nd_match',
      messageId: 'm1',
      senderId: 'host-1',
      clientTime: 1,
      sequence: 1,
      payload: { type: 'fleet-ready', seal },
    });
    expect(getPlacementPayload({ ...valid, receivedAt: 1 })).toEqual({
      type: 'fleet-ready',
      seal,
    });

    const leaked = {
      ...valid,
      payload: {
        type: 'fleet-ready',
        seal,
        cells: ['0-0'],
      },
      receivedAt: 1,
    };
    expect(getPlacementPayload(leaked)).toBeUndefined();
  });

  it('delivers fleet-ready seals to peers without sender echo', async () => {
    const transport = new MockBattleshipTransport();
    const host = await transport.connect({
      roomId: 'room-1',
      playerId: 'host-1',
      displayName: 'Ali',
    });
    const guest = await transport.connect({
      roomId: 'room-1',
      playerId: 'joiner-2',
      displayName: 'Sara',
    });
    const seal = await createFleetReadySeal(placedFleet());
    const guestInbox: unknown[] = [];
    guest.onMessage((message) => guestInbox.push(message.payload));

    await host.publish(
      createPlacementMessage({
        matchId: 'nd_match',
        messageId: 'ready-1',
        senderId: 'host-1',
        clientTime: 1,
        sequence: 1,
        payload: { type: 'fleet-ready', seal },
      }),
    );

    expect(guestInbox).toEqual([{ type: 'fleet-ready', seal }]);
    expect(JSON.stringify(guestInbox)).not.toMatch(/"cells"/);

    await host.disconnect();
    await guest.disconnect();
  });
});
