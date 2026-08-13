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
  hasOnlineMatchProgress,
  shouldClaimHostAfterAuthorityProbe,
  syncPresenceWithHostTransfer,
} from '../online/onlineReliability';
import {
  battleshipOnlineReducer,
  canStartOnlinePlacement,
  createBattleshipOnlineStateFromLaunch,
} from '../online/onlineSessionModel';
import { resolveBattleshipLaunch } from '../resolveBattleshipLaunch';
import {
  createBattleMessage,
  createControlMessage,
  createSnapshotMessage,
  getControlPayload,
  getSnapshotPayload,
} from '../transport/battleshipMessages';
import { MockBattleshipTransport } from '../transport/MockBattleshipTransport';
import type { BattleshipInboundMessage } from '../transport/types';

const ROOM_ID = 'voice-room-naval-remount';
const SESSION_ID = 'rgs_session_naval_remount_0001';
const HOST_UID = 'host-uid';
const JOINER_UID = 'joiner-uid';
const LIVE_MATCH = 'nd_live_remount';

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

const hostLaunch = () =>
  resolveBattleshipLaunch({
    displayName: 'Host',
    hostUid: HOST_UID,
    mode: 'online',
    playerId: HOST_UID,
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    source: 'voice-room',
  });

const joinerLaunch = () =>
  resolveBattleshipLaunch({
    displayName: 'Sara',
    hostUid: HOST_UID,
    mode: 'online',
    playerId: JOINER_UID,
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    source: 'voice-room',
  });

async function advanceToBattleWithShot() {
  const hostSeal = await createFleetReadySeal(hostFleet());
  const joinerSeal = await createFleetReadySeal(joinerFleet());

  let hostState = createBattleshipOnlineStateFromLaunch(hostLaunch(), () => LIVE_MATCH);
  let joinerState = createBattleshipOnlineStateFromLaunch(joinerLaunch());

  hostState = battleshipOnlineReducer(hostState, {
    type: 'placement-started',
    matchId: LIVE_MATCH,
  });
  joinerState = battleshipOnlineReducer(joinerState, {
    type: 'placement-started',
    matchId: LIVE_MATCH,
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
    matchId: LIVE_MATCH,
    now: 10,
  });
  joinerState = battleshipOnlineReducer(joinerState, {
    type: 'battle-started',
    firstPlayerId: HOST_UID,
    matchId: LIVE_MATCH,
    now: 10,
  });

  const resolved = resolveIncomingShot({
    attackerId: HOST_UID,
    cellId: '5-5',
    defenderId: JOINER_UID,
    incomingGuesses: new Set(),
    localFleet: joinerFleet(),
    shotId: 'shot-mid',
  });

  hostState = battleshipOnlineReducer(hostState, {
    type: 'shot-fired-local',
    cellId: '5-5',
    shotId: 'shot-mid',
  });
  hostState = battleshipOnlineReducer(hostState, {
    type: 'apply-shot-resolved',
    shot: resolved,
  });
  joinerState = battleshipOnlineReducer(joinerState, {
    type: 'apply-shot-resolved',
    shot: resolved,
  });

  return { hostState, joinerState, resolved };
}

describe('Naval Duel remount integration (mock transport)', () => {
  it('survivor keeps battle after host drop; remounter probes and adopts via snapshot', async () => {
    const { hostState, joinerState, resolved } = await advanceToBattleWithShot();
    expect(hostState.phase).toBe('battle');
    expect(joinerState.outgoingResults['5-5'] || joinerState.incomingResults['5-5']).toBe(
      resolved.result,
    );

    // Host drops from transport; joiner becomes sticky host with live battle.
    const afterHostLeave = syncPresenceWithHostTransfer({
      localDisplayName: 'Sara',
      localPlayerId: JOINER_UID,
      players: [{ id: JOINER_UID, displayName: 'Sara', joinedAt: 2, isConnected: true }],
      state: {
        ...joinerState,
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
    expect(afterHostLeave.state.phase).toBe('battle');
    expect(afterHostLeave.state.matchId).toBe(LIVE_MATCH);

    let survivorState = afterHostLeave.state;

    // Original host remounts with a fresh empty match id (new createBattleshipMatchId).
    let remounterState = createBattleshipOnlineStateFromLaunch(
      hostLaunch(),
      () => 'nd_fresh_after_remount',
    );
    remounterState = battleshipOnlineReducer(remounterState, {
      type: 'connection-status-changed',
      status: 'connected',
    });
    expect(hasOnlineMatchProgress(remounterState)).toBe(false);
    expect(canStartOnlinePlacement({
      ...remounterState,
      opponentConnected: true,
      players: [
        {
          id: HOST_UID,
          displayName: 'Host',
          joinedAt: 10,
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
    })).toBe(true);
    // Remount path must probe instead of claiming over a present peer.
    expect(
      shouldClaimHostAfterAuthorityProbe({
        consecutivePeerAbsentIntervals: 0,
        hasClaimedLobby: false,
        hasMatchProgress: false,
        isLocalHost: true,
        peersConnected: true,
      }),
    ).toBe(false);

    const transport = new MockBattleshipTransport();
    const survivorConn = await transport.connect({
      roomId: ROOM_ID,
      playerId: JOINER_UID,
      displayName: 'Sara',
    });
    const remounterConn = await transport.connect({
      roomId: ROOM_ID,
      playerId: HOST_UID,
      displayName: 'Host',
    });

    const remounterInbox: BattleshipInboundMessage[] = [];
    remounterConn.onMessage((message) => {
      remounterInbox.push(message);
    });

    const survivorReplies: Promise<void>[] = [];

    // Survivor answers remounter probe the way the session hook does for hosts.
    survivorConn.onMessage((message) => {
      const snapshotRequest = getSnapshotPayload(message);
      if (snapshotRequest?.type === 'snapshot-request') {
        const snapshot = createPublicBattleshipSnapshot(survivorState);
        survivorReplies.push(
          survivorConn.publish(
            createSnapshotMessage({
              matchId: survivorState.matchId,
              messageId: 'snap-remount-1',
              senderId: JOINER_UID,
              clientTime: Date.now(),
              sequence: 1,
              payload: { type: 'public-snapshot', snapshot },
            }),
          ),
        );
        return;
      }

      const control = getControlPayload(message);
      if (control?.type === 'lobby-request' && survivorState.localPlayerId === survivorState.hostId) {
        survivorReplies.push(
          survivorConn.publish(
            createControlMessage({
              matchId: survivorState.matchId,
              messageId: 'announce-remount-1',
              senderId: JOINER_UID,
              clientTime: Date.now(),
              sequence: 2,
              payload: {
                type: 'lobby-announce',
                matchId: survivorState.matchId,
                hostId: JOINER_UID,
                players: survivorState.players.map((player) => ({
                  id: player.id,
                  displayName: player.displayName,
                  joinedAt: player.joinedAt,
                  isConnected: player.isConnected,
                })),
              },
            }),
          ),
        );
      }
    });

    // Remounter probe: lobby-request + snapshot-request (asProbe path).
    await remounterConn.publish(
      createControlMessage({
        matchId: remounterState.matchId,
        messageId: 'probe-lobby-1',
        senderId: HOST_UID,
        clientTime: Date.now(),
        sequence: 1,
        payload: { type: 'lobby-request' },
      }),
    );
    await remounterConn.publish(
      createSnapshotMessage({
        matchId: remounterState.matchId,
        messageId: 'probe-snap-1',
        senderId: HOST_UID,
        clientTime: Date.now(),
        sequence: 2,
        payload: { type: 'snapshot-request' },
      }),
    );
    await Promise.all(survivorReplies);

    expect(remounterInbox.length).toBeGreaterThanOrEqual(1);

    const announce = remounterInbox.find(
      (message) => getControlPayload(message)?.type === 'lobby-announce',
    );
    const snapshotMessage = remounterInbox.find(
      (message) => getSnapshotPayload(message)?.type === 'public-snapshot',
    );

    expect(getControlPayload(announce!)?.type).toBe('lobby-announce');
    expect(snapshotMessage).toBeTruthy();

    // Hook path: yield then apply foreign battle snapshot.
    remounterState = battleshipOnlineReducer(remounterState, {
      type: 'host-yielded',
      hostId: JOINER_UID,
      matchId: LIVE_MATCH,
    });
    const snapshotPayload = getSnapshotPayload(snapshotMessage!);
    expect(snapshotPayload?.type).toBe('public-snapshot');
    if (snapshotPayload?.type !== 'public-snapshot') {
      throw new Error('expected public-snapshot');
    }

    remounterState = battleshipOnlineReducer(remounterState, {
      type: 'apply-public-snapshot',
      displayName: 'Host',
      snapshot: snapshotPayload.snapshot,
    });

    expect(remounterState.hostId).toBe(JOINER_UID);
    expect(remounterState.matchId).toBe(LIVE_MATCH);
    expect(remounterState.phase).toBe('battle');
    expect(remounterState.resolvedShots).toHaveLength(1);
    expect(remounterState.outgoingResults['5-5']).toBe(resolved.result);
    expect(JSON.stringify(createPublicBattleshipSnapshot(remounterState))).not.toMatch(
      /localFleet|"cells":/,
    );

    await remounterConn.disconnect();
    await survivorConn.disconnect();
  });

  it('rejects remounter placement progress from adopting survivor battle (S1 guard)', async () => {
    const { joinerState } = await advanceToBattleWithShot();
    const survivor = syncPresenceWithHostTransfer({
      localDisplayName: 'Sara',
      localPlayerId: JOINER_UID,
      players: [{ id: JOINER_UID, displayName: 'Sara', joinedAt: 2, isConnected: true }],
      state: {
        ...joinerState,
        players: [
          {
            id: HOST_UID,
            displayName: 'Host',
            joinedAt: 1,
            isConnected: false,
            isHost: false,
          },
          {
            id: JOINER_UID,
            displayName: 'Sara',
            joinedAt: 2,
            isConnected: true,
            isHost: true,
          },
        ],
      },
    }).state;

    let remounter = createBattleshipOnlineStateFromLaunch(
      hostLaunch(),
      () => 'nd_fresh_bad_path',
    );
    remounter = battleshipOnlineReducer(remounter, {
      type: 'connection-status-changed',
      status: 'connected',
    });
    remounter = battleshipOnlineReducer(remounter, {
      type: 'placement-started',
      matchId: 'nd_fresh_bad_path',
    });
    expect(hasOnlineMatchProgress(remounter)).toBe(true);

    const adopted = applyPublicBattleshipSnapshot({
      localDisplayName: 'Host',
      localPlayerId: HOST_UID,
      previous: remounter,
      snapshot: createPublicBattleshipSnapshot(survivor),
    });

    expect(adopted.matchId).toBe('nd_fresh_bad_path');
    expect(adopted.phase).toBe('placement');
    expect(adopted.resolvedShots).toHaveLength(0);
  });

  it('delivers mid-battle shot over mock transport without sender echo', async () => {
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
    const hostInbox: unknown[] = [];
    const joinerInbox: unknown[] = [];
    hostConn.onMessage((message) => hostInbox.push(message.payload));
    joinerConn.onMessage((message) => joinerInbox.push(message.payload));

    await hostConn.publish(
      createBattleMessage({
        matchId: LIVE_MATCH,
        messageId: 'fire-echo',
        senderId: HOST_UID,
        clientTime: 1,
        sequence: 1,
        payload: { type: 'shot-fired', shotId: 's', cellId: '5-5' },
      }),
    );

    expect(hostInbox).toEqual([]);
    expect(joinerInbox).toEqual([{ type: 'shot-fired', shotId: 's', cellId: '5-5' }]);

    await hostConn.disconnect();
    await joinerConn.disconnect();
  });
});
