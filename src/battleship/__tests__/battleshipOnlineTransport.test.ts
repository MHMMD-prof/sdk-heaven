import { describe, expect, it } from 'vitest';

import { resolveBattleshipLaunch } from '../resolveBattleshipLaunch';
import {
  battleshipOnlineReducer,
  createBattleshipOnlineStateFromLaunch,
  createBattleshipTransportLobbyViewModel,
  resolveOnlineBootstrapMatchId,
} from '../online/onlineSessionModel';
import { MockBattleshipTransport } from '../transport/MockBattleshipTransport';
import { createControlMessage } from '../transport/battleshipMessages';
import { BATTLESHIP_TOPICS } from '../transport/constants';
import { createBattleshipTransport } from '../transport/createBattleshipTransport';
import { LiveKitBattleshipTransport } from '../transport/LiveKitBattleshipTransport';

describe('naval-duel Wave 2 online session model', () => {
  it('gives hosts a real match id and joiners a pending bootstrap id', () => {
    expect(
      resolveOnlineBootstrapMatchId({
        createMatchId: () => 'nd_host_match',
        hostUid: 'host-1',
        localPlayerId: 'host-1',
        roomId: 'room-1',
        sessionId: 'rgs_session_naval_0001',
      }),
    ).toBe('nd_host_match');

    expect(
      resolveOnlineBootstrapMatchId({
        createMatchId: () => 'nd_host_match',
        hostUid: 'host-1',
        localPlayerId: 'joiner-2',
        roomId: 'room-1',
        sessionId: 'rgs_session_naval_0001',
      }),
    ).toBe('pending-rgs_session_naval_0001');
  });

  it('applies host lobby announce onto joiner pending state', () => {
    const launch = resolveBattleshipLaunch({
      displayName: 'Sara',
      hostUid: 'host-1',
      mode: 'online',
      playerId: 'joiner-2',
      roomId: 'room-1',
      sessionId: 'rgs_session_naval_0001',
      source: 'voice-room',
    });
    let state = createBattleshipOnlineStateFromLaunch(launch, () => 'unused');

    expect(state.matchId).toBe('pending-rgs_session_naval_0001');
    expect(state.hostId).toBe('host-1');

    state = battleshipOnlineReducer(state, {
      type: 'apply-lobby-announce',
      hostId: 'host-1',
      matchId: 'nd_shared_match',
      players: [
        {
          id: 'host-1',
          displayName: 'Ali',
          joinedAt: 1,
          isConnected: true,
        },
        {
          id: 'joiner-2',
          displayName: 'Sara',
          joinedAt: 2,
          isConnected: true,
        },
      ],
    });

    expect(state.matchId).toBe('nd_shared_match');
    expect(state.players.map((player) => player.id)).toEqual(['host-1', 'joiner-2']);
  });

  it('ignores peer lobby announces from a non-authority host while linked', () => {
    const launch = resolveBattleshipLaunch({
      displayName: 'Ali',
      hostUid: 'host-1',
      mode: 'online',
      playerId: 'host-1',
      roomId: 'room-1',
      sessionId: 'rgs_session_naval_0001',
      source: 'voice-room',
    });
    const state = createBattleshipOnlineStateFromLaunch(launch, () => 'nd_host_match');
    const next = battleshipOnlineReducer(state, {
      type: 'apply-lobby-announce',
      hostId: 'spoof-host',
      matchId: 'nd_spoof',
      players: [
        { id: 'host-1', displayName: 'Ali', joinedAt: 1, isConnected: true },
        { id: 'spoof-host', displayName: 'Spoof', joinedAt: 2, isConnected: true },
      ],
    });

    expect(next).toBe(state);
  });

  it('exposes transport-connected lobby copy without hot-seat controls', () => {
    const launch = resolveBattleshipLaunch({
      displayName: 'Ali',
      hostUid: 'host-1',
      mode: 'online',
      playerId: 'host-1',
      roomId: 'room-1',
      sessionId: 'rgs_session_naval_0001',
      source: 'voice-room',
    });
    let state = createBattleshipOnlineStateFromLaunch(launch, () => 'nd_host_match');
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

    const lobby = createBattleshipTransportLobbyViewModel({
      firestoreMaxPlayers: 2,
      firestorePlayerCount: 2,
      firestoreStatus: 'lobby',
      launch,
      state,
    });

    expect(lobby.showHandoffControls).toBe(false);
    expect(lobby.canUseLocalPersistence).toBe(false);
    expect(lobby.transportStatusLabel).toBe('Transport connected');
    expect(lobby.body).toContain('Starting private ship placement');
  });
});

describe('naval-duel Wave 2 mock transport', () => {
  it('selects LiveKit for online and mock for tests', () => {
    expect(createBattleshipTransport('online')).toBeInstanceOf(LiveKitBattleshipTransport);
    expect(createBattleshipTransport('mock')).toBeInstanceOf(MockBattleshipTransport);
  });

  it('delivers control messages to peers without sender echo', async () => {
    const transport = new MockBattleshipTransport();
    const host = await transport.connect({
      roomId: 'room-1',
      playerId: 'host-1',
      displayName: 'Ali',
      sessionId: 'rgs_session_naval_0001',
    });
    const guest = await transport.connect({
      roomId: 'room-1',
      playerId: 'joiner-2',
      displayName: 'Sara',
      sessionId: 'rgs_session_naval_0001',
    });

    const hostInbox: string[] = [];
    const guestInbox: string[] = [];
    host.onMessage((message) => hostInbox.push(message.messageId));
    guest.onMessage((message) => guestInbox.push(message.messageId));

    await host.publish(
      createControlMessage({
        matchId: 'nd_host_match',
        messageId: 'msg-1',
        senderId: 'host-1',
        clientTime: 1,
        sequence: 1,
        payload: {
          type: 'lobby-announce',
          matchId: 'nd_host_match',
          hostId: 'host-1',
          players: [
            { id: 'host-1', displayName: 'Ali', joinedAt: 1, isConnected: true },
            { id: 'joiner-2', displayName: 'Sara', joinedAt: 2, isConnected: true },
          ],
        },
      }),
    );

    expect(hostInbox).toEqual([]);
    expect(guestInbox).toEqual(['msg-1']);
    expect(BATTLESHIP_TOPICS.control).toBe('nd.v1.control');

    await host.disconnect();
    await guest.disconnect();
  });
});
