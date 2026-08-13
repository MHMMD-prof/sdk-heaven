import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    createHash('sha256').update(value).digest('hex'),
}));

import { MiniGameTarget } from '../../types/miniGame';
import { createFleetReadySeal } from '../online/fleetCommitment';
import { resolveIncomingShot } from '../online/onlineBattleCore';
import {
  applyPublicBattleshipSnapshot,
  createPublicBattleshipSnapshot,
  syncPresenceWithHostTransfer,
} from '../online/onlineReliability';
import {
  battleshipOnlineReducer,
  createBattleshipOnlineStateFromLaunch,
  createBattleshipTransportLobbyViewModel,
  resolveOnlineBootstrapMatchId,
} from '../online/onlineSessionModel';
import { resolveBattleshipLaunch } from '../resolveBattleshipLaunch';
import {
  createBattleMessage,
  createSnapshotMessage,
  getBattlePayload,
  getSnapshotPayload,
} from '../transport/battleshipMessages';
import { MockBattleshipTransport } from '../transport/MockBattleshipTransport';

const ROOM_ID = 'voice-room-naval-gate';
const SESSION_ID = 'rgs_session_naval_gate_0001';
const HOST_UID = 'host-uid';
const JOINER_UID = 'joiner-uid';

const hostFleet = (): MiniGameTarget[] => [
  {
    id: 'host-ship',
    name: 'Host Ship',
    shortLabel: 'H',
    footprint: { columns: 1, rows: 1 },
    cells: ['0-0'],
    isPlaced: true,
  },
];

const joinerFleet = (): MiniGameTarget[] => [
  {
    id: 'joiner-ship',
    name: 'Joiner Ship',
    shortLabel: 'J',
    footprint: { columns: 1, rows: 1 },
    cells: ['5-5'],
    isPlaced: true,
  },
];

describe('Naval Duel Wave 5 two-player online gate', () => {
  it('keeps voice-room launches bound to shared host/session without hot-seat controls', () => {
    const hostLaunch = resolveBattleshipLaunch({
      displayName: 'Host',
      hostUid: HOST_UID,
      mode: 'online',
      playerId: HOST_UID,
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      source: 'voice-room',
    });
    const joinerLaunch = resolveBattleshipLaunch({
      displayName: 'Sara',
      hostUid: HOST_UID,
      mode: 'online',
      playerId: JOINER_UID,
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      source: 'voice-room',
    });

    expect(hostLaunch.isOnline).toBe(true);
    expect(hostLaunch.isHost).toBe(true);
    expect(joinerLaunch.isHost).toBe(false);
    expect(
      resolveOnlineBootstrapMatchId({
        createMatchId: () => 'nd_gate',
        hostUid: HOST_UID,
        localPlayerId: JOINER_UID,
        roomId: ROOM_ID,
        sessionId: SESSION_ID,
      }),
    ).toBe(`pending-${SESSION_ID}`);

    const lobby = createBattleshipTransportLobbyViewModel({
      launch: hostLaunch,
      state: createBattleshipOnlineStateFromLaunch(hostLaunch, () => 'nd_gate'),
    });
    expect(lobby.showHandoffControls).toBe(false);
    expect(lobby.canUseLocalPersistence).toBe(false);
  });

  it('runs sealed placement → fog battle → snapshot resync → host transfer', async () => {
    const hostSeal = await createFleetReadySeal(hostFleet());
    const joinerSeal = await createFleetReadySeal(joinerFleet());

    let hostState = createBattleshipOnlineStateFromLaunch(
      resolveBattleshipLaunch({
        displayName: 'Host',
        hostUid: HOST_UID,
        mode: 'online',
        playerId: HOST_UID,
        roomId: ROOM_ID,
        sessionId: SESSION_ID,
        source: 'voice-room',
      }),
      () => 'nd_gate_match',
    );
    let joinerState = createBattleshipOnlineStateFromLaunch(
      resolveBattleshipLaunch({
        displayName: 'Sara',
        hostUid: HOST_UID,
        mode: 'online',
        playerId: JOINER_UID,
        roomId: ROOM_ID,
        sessionId: SESSION_ID,
        source: 'voice-room',
      }),
    );

    hostState = battleshipOnlineReducer(hostState, {
      type: 'placement-started',
      matchId: 'nd_gate_match',
    });
    joinerState = battleshipOnlineReducer(joinerState, {
      type: 'placement-started',
      matchId: 'nd_gate_match',
    });
    hostState = battleshipOnlineReducer(hostState, {
      type: 'local-fleet-sealed',
      fleet: hostFleet(),
      seal: hostSeal,
    });
    joinerState = battleshipOnlineReducer(joinerState, {
      type: 'local-fleet-sealed',
      fleet: joinerFleet(),
      seal: joinerSeal,
    });
    hostState = battleshipOnlineReducer(hostState, {
      type: 'peer-fleet-ready',
      playerId: JOINER_UID,
      seal: joinerSeal,
    });
    joinerState = battleshipOnlineReducer(joinerState, {
      type: 'peer-fleet-ready',
      playerId: HOST_UID,
      seal: hostSeal,
    });
    hostState = battleshipOnlineReducer(hostState, {
      type: 'battle-started',
      firstPlayerId: HOST_UID,
      matchId: 'nd_gate_match',
      now: 10,
    });
    joinerState = battleshipOnlineReducer(joinerState, {
      type: 'battle-started',
      firstPlayerId: HOST_UID,
      matchId: 'nd_gate_match',
      now: 10,
    });

    // LiveKit-style no echo: host publishes fire, only joiner receives.
    const transport = new MockBattleshipTransport();
    const hostConn = await transport.connect({
      roomId: ROOM_ID,
      playerId: HOST_UID,
      displayName: 'Host',
    });
    const joinerConn = await transport.connect({
      roomId: ROOM_ID,
      playerId: JOINER_UID,
      displayName: 'Sara',
    });
    const joinerInbox: unknown[] = [];
    joinerConn.onMessage((message) => joinerInbox.push(message.payload));

    hostState = battleshipOnlineReducer(hostState, {
      type: 'shot-fired-local',
      cellId: '5-5',
      shotId: 'shot-win',
    });
    await hostConn.publish(
      createBattleMessage({
        matchId: 'nd_gate_match',
        messageId: 'fire-1',
        senderId: HOST_UID,
        clientTime: 11,
        sequence: 1,
        payload: { type: 'shot-fired', shotId: 'shot-win', cellId: '5-5' },
      }),
    );
    expect(joinerInbox).toEqual([
      { type: 'shot-fired', shotId: 'shot-win', cellId: '5-5' },
    ]);

    const resolved = resolveIncomingShot({
      attackerId: HOST_UID,
      cellId: '5-5',
      defenderId: JOINER_UID,
      incomingGuesses: new Set(),
      localFleet: joinerFleet(),
      shotId: 'shot-win',
    });
    expect(resolved.winnerId).toBe(HOST_UID);
    expect(JSON.stringify(resolved)).not.toMatch(/0-0|host-ship/);

    joinerState = battleshipOnlineReducer(joinerState, {
      type: 'apply-shot-resolved',
      shot: resolved,
    });
    hostState = battleshipOnlineReducer(hostState, {
      type: 'apply-shot-resolved',
      shot: resolved,
    });
    expect(hostState.winnerId).toBe(HOST_UID);
    expect(joinerState.winnerId).toBe(HOST_UID);

    const snapshot = createPublicBattleshipSnapshot(hostState);
    expect(JSON.stringify(snapshot)).not.toMatch(/localFleet|\["0-0"\]|\["5-5"\]|"cells":/);
    expect(getSnapshotPayload({
      ...createSnapshotMessage({
        matchId: 'nd_gate_match',
        messageId: 'snap-1',
        senderId: HOST_UID,
        clientTime: 12,
        sequence: 2,
        payload: { type: 'public-snapshot', snapshot },
      }),
      receivedAt: 12,
    })?.type).toBe('public-snapshot');

    const rejoin = applyPublicBattleshipSnapshot({
      localDisplayName: 'Sara',
      localPlayerId: JOINER_UID,
      previous: {
        ...createBattleshipOnlineStateFromLaunch(
          resolveBattleshipLaunch({
            displayName: 'Sara',
            hostUid: HOST_UID,
            mode: 'online',
            playerId: JOINER_UID,
            roomId: ROOM_ID,
            sessionId: SESSION_ID,
            source: 'voice-room',
          }),
        ),
        localFleet: joinerFleet(),
      },
      snapshot,
    });
    expect(rejoin.phase).toBe('battle');
    expect(rejoin.winnerId).toBe(HOST_UID);
    expect(rejoin.localFleet?.[0]?.cells).toEqual(['5-5']);
    expect(rejoin.incomingResults['5-5']).toBe('hit');

    const afterHostLeave = syncPresenceWithHostTransfer({
      localDisplayName: 'Sara',
      localPlayerId: JOINER_UID,
      players: [{ id: JOINER_UID, displayName: 'Sara', joinedAt: 2, isConnected: true }],
      state: {
        ...rejoin,
        players: [
          {
            id: HOST_UID,
            displayName: 'Host',
            joinedAt: 1,
            isConnected: true,
            isHost: true,
          },
          {
            id: JOINER_UID,
            displayName: 'Sara',
            joinedAt: 2,
            isConnected: true,
            isHost: false,
          },
        ],
      },
    });
    expect(afterHostLeave.becameHost).toBe(true);
    expect(afterHostLeave.state.hostId).toBe(JOINER_UID);
    expect(afterHostLeave.opponentConnected).toBe(false);

    expect(
      getBattlePayload({
        ...createBattleMessage({
          matchId: 'nd_gate_match',
          messageId: 'bad',
          senderId: HOST_UID,
          clientTime: 1,
          sequence: 1,
          payload: {
            type: 'shot-resolved',
            shotId: 'x',
            cellId: '1-1',
            attackerId: HOST_UID,
            result: 'hit',
            nextTurnPlayerId: HOST_UID,
            cells: ['1-1', '1-2'],
          } as never,
        }),
        receivedAt: 1,
      }),
    ).toBeUndefined();

    await hostConn.disconnect();
    await joinerConn.disconnect();
  });
});
