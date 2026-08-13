import { describe, expect, it } from 'vitest';

import { MiniGameTarget } from '../../types/miniGame';
import {
  createFogHitTargets,
  resolveIncomingShot,
} from '../online/onlineBattleCore';
import {
  battleshipOnlineReducer,
  createBattleshipOnlineState,
} from '../online/onlineSessionModel';
import {
  createBattleMessage,
  getBattlePayload,
} from '../transport/battleshipMessages';
import { MockBattleshipTransport } from '../transport/MockBattleshipTransport';

const fleet = (): MiniGameTarget[] => [
  {
    id: 'ship-a',
    name: 'A',
    shortLabel: 'A',
    footprint: { columns: 2, rows: 1 },
    cells: ['0-0', '0-1'],
    isPlaced: true,
  },
];

describe('naval-duel Wave 4 battle core', () => {
  it('resolves defender hits without exposing other ship cells', () => {
    const resolved = resolveIncomingShot({
      attackerId: 'attacker-1',
      cellId: '0-0',
      defenderId: 'defender-2',
      incomingGuesses: new Set(),
      localFleet: fleet(),
      shotId: 'shot-1',
    });

    expect(resolved).toMatchObject({
      result: 'hit',
      nextTurnPlayerId: 'attacker-1',
      attackerId: 'attacker-1',
    });
    expect(resolved).not.toHaveProperty('cells');
    expect(JSON.stringify(resolved)).not.toMatch(/0-1/);
  });

  it('passes the turn on miss and awards winner on final hit', () => {
    const miss = resolveIncomingShot({
      attackerId: 'attacker-1',
      cellId: '3-3',
      defenderId: 'defender-2',
      incomingGuesses: new Set(),
      localFleet: fleet(),
      shotId: 'shot-miss',
    });
    expect(miss.result).toBe('miss');
    expect(miss.nextTurnPlayerId).toBe('defender-2');

    const win = resolveIncomingShot({
      attackerId: 'attacker-1',
      cellId: '0-1',
      defenderId: 'defender-2',
      incomingGuesses: new Set(['0-0']),
      localFleet: fleet(),
      shotId: 'shot-win',
    });
    expect(win.result).toBe('hit');
    expect(win.sunkTargetId).toBe('ship-a');
    expect(win.winnerId).toBe('attacker-1');
  });

  it('builds fog targets only from known hit cells', () => {
    expect(createFogHitTargets(['1-1', '0-0']).map((target) => target.cells)).toEqual([
      ['0-0'],
      ['1-1'],
    ]);
  });
});

describe('naval-duel Wave 4 battle reducer', () => {
  const battleState = () => {
    let state = createBattleshipOnlineState({
      displayName: 'Ali',
      hostId: 'host-1',
      localPlayerId: 'host-1',
      matchId: 'nd_match',
      roomId: 'room-1',
      sessionId: 'rgs_1',
    });
    state = battleshipOnlineReducer(state, {
      type: 'battle-started',
      firstPlayerId: 'host-1',
      matchId: 'nd_match',
      now: 1,
    });
    return state;
  };

  it('tracks pending fire then applies resolved outgoing hit without handoff', () => {
    let state = battleState();
    state = battleshipOnlineReducer(state, {
      type: 'shot-fired-local',
      cellId: '2-2',
      shotId: 'shot-1',
    });
    expect(state.pendingShotId).toBe('shot-1');

    state = battleshipOnlineReducer(state, {
      type: 'apply-shot-resolved',
      shot: {
        attackerId: 'host-1',
        cellId: '2-2',
        nextTurnPlayerId: 'host-1',
        result: 'hit',
        shotId: 'shot-1',
      },
    });

    expect(state.pendingShotId).toBeUndefined();
    expect(state.outgoingResults['2-2']).toBe('hit');
    expect(state.currentTurnPlayerId).toBe('host-1');
    expect(state.phase).toBe('battle');
  });

  it('applies incoming miss and flips turn to local player', () => {
    let state = battleState();
    state = {
      ...state,
      currentTurnPlayerId: 'joiner-2',
    };
    state = battleshipOnlineReducer(state, {
      type: 'apply-shot-resolved',
      shot: {
        attackerId: 'joiner-2',
        cellId: '4-4',
        nextTurnPlayerId: 'host-1',
        result: 'miss',
        shotId: 'shot-2',
      },
    });

    expect(state.incomingResults['4-4']).toBe('miss');
    expect(state.currentTurnPlayerId).toBe('host-1');
  });
});

describe('naval-duel Wave 4 battle transport', () => {
  it('rejects battle payloads that leak boards', () => {
    const valid = createBattleMessage({
      matchId: 'nd_match',
      messageId: 'm1',
      senderId: 'host-1',
      clientTime: 1,
      sequence: 1,
      payload: {
        type: 'shot-resolved',
        shotId: 's1',
        cellId: '0-0',
        attackerId: 'host-1',
        result: 'hit',
        nextTurnPlayerId: 'host-1',
      },
    });
    expect(getBattlePayload({ ...valid, receivedAt: 1 })?.type).toBe('shot-resolved');

    expect(
      getBattlePayload({
        ...valid,
        payload: {
          ...valid.payload,
          cells: ['0-0', '0-1'],
        },
        receivedAt: 1,
      }),
    ).toBeUndefined();
  });

  it('delivers shot-fired to peers without sender echo', async () => {
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
    const guestInbox: unknown[] = [];
    guest.onMessage((message) => guestInbox.push(message.payload));

    await host.publish(
      createBattleMessage({
        matchId: 'nd_match',
        messageId: 'fire-1',
        senderId: 'host-1',
        clientTime: 1,
        sequence: 1,
        payload: {
          type: 'shot-fired',
          shotId: 'shot-1',
          cellId: '1-1',
        },
      }),
    );

    expect(guestInbox).toEqual([
      {
        type: 'shot-fired',
        shotId: 'shot-1',
        cellId: '1-1',
      },
    ]);

    await host.disconnect();
    await guest.disconnect();
  });
});
