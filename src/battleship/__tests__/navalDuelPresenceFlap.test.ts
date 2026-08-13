import { describe, expect, it } from 'vitest';

import {
  createAuthorityClaimGrace,
  observePeersForAuthorityClaimGrace,
  PEER_ABSENT_INTERVALS_BEFORE_CLAIM,
  shouldClaimHostAfterAuthorityProbe,
  shouldDeferInstantHostClaimOnPresenceFlap,
  syncPresenceWithHostTransfer,
  tickAuthorityClaimGraceOnProbe,
} from '../online/onlineReliability';
import {
  battleshipOnlineReducer,
  createBattleshipOnlineStateFromLaunch,
} from '../online/onlineSessionModel';
import { resolveBattleshipLaunch } from '../resolveBattleshipLaunch';
import { MockBattleshipTransport } from '../transport/MockBattleshipTransport';
import type { BattleshipPresencePlayer } from '../transport/types';

const ROOM_ID = 'voice-room-naval-flap';
const SESSION_ID = 'rgs_session_naval_flap_0001';
const HOST_UID = 'host-uid';
const JOINER_UID = 'joiner-uid';

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

const decideClaim = (grace: ReturnType<typeof createAuthorityClaimGrace>, peersConnected: boolean) =>
  shouldClaimHostAfterAuthorityProbe({
    consecutivePeerAbsentIntervals: grace.consecutivePeerAbsentIntervals,
    hasClaimedLobby: false,
    hasMatchProgress: false,
    isLocalHost: true,
    peersConnected,
    requiredAbsentIntervals: PEER_ABSENT_INTERVALS_BEFORE_CLAIM,
  });

describe('Naval Duel presence-flap claim grace', () => {
  it('does not claim on a single empty tick after seeing a peer', () => {
    let grace = createAuthorityClaimGrace();
    grace = observePeersForAuthorityClaimGrace(grace, true);
    expect(grace.sawPeerWhileUnclaimed).toBe(true);
    expect(grace.consecutivePeerAbsentIntervals).toBe(0);

    expect(
      shouldDeferInstantHostClaimOnPresenceFlap({
        hasClaimedLobby: false,
        hasMatchProgress: false,
        peersConnected: false,
        sawPeerWhileUnclaimed: grace.sawPeerWhileUnclaimed,
      }),
    ).toBe(true);

    // First probe-timeout while alone: still under required intervals.
    grace = tickAuthorityClaimGraceOnProbe(grace, false);
    expect(grace.consecutivePeerAbsentIntervals).toBe(1);
    expect(decideClaim(grace, false)).toBe(false);
  });

  it('resets the absent streak when the peer flaps back before claim', () => {
    let grace = createAuthorityClaimGrace();
    grace = observePeersForAuthorityClaimGrace(grace, true);
    grace = tickAuthorityClaimGraceOnProbe(grace, false);
    expect(grace.consecutivePeerAbsentIntervals).toBe(1);
    expect(decideClaim(grace, false)).toBe(false);

    // Peer reappears mid-grace — streak must clear.
    grace = observePeersForAuthorityClaimGrace(grace, true);
    expect(grace.consecutivePeerAbsentIntervals).toBe(0);
    expect(grace.sawPeerWhileUnclaimed).toBe(true);
    expect(decideClaim(grace, true)).toBe(false);

    // Another single empty tick still insufficient.
    grace = tickAuthorityClaimGraceOnProbe(grace, false);
    expect(grace.consecutivePeerAbsentIntervals).toBe(1);
    expect(decideClaim(grace, false)).toBe(false);
  });

  it('claims only after two consecutive peer-absent probe intervals', () => {
    let grace = createAuthorityClaimGrace();
    grace = observePeersForAuthorityClaimGrace(grace, true);

    grace = tickAuthorityClaimGraceOnProbe(grace, false);
    expect(decideClaim(grace, false)).toBe(false);

    grace = tickAuthorityClaimGraceOnProbe(grace, false);
    expect(grace.consecutivePeerAbsentIntervals).toBe(2);
    expect(decideClaim(grace, false)).toBe(true);
  });

  it('still allows true solo bootstrap without waiting for grace', () => {
    const grace = createAuthorityClaimGrace();
    expect(grace.sawPeerWhileUnclaimed).toBe(false);
    expect(
      shouldDeferInstantHostClaimOnPresenceFlap({
        hasClaimedLobby: false,
        hasMatchProgress: false,
        peersConnected: false,
        sawPeerWhileUnclaimed: grace.sawPeerWhileUnclaimed,
      }),
    ).toBe(false);

    // Solo claim path does not require absent intervals when never saw a peer.
    expect(
      shouldClaimHostAfterAuthorityProbe({
        consecutivePeerAbsentIntervals: 0,
        hasClaimedLobby: false,
        hasMatchProgress: false,
        isLocalHost: true,
        peersConnected: false,
        requiredAbsentIntervals: 0,
      }),
    ).toBe(true);
  });

  it('flaps peer presence on mock transport without dual-host election', async () => {
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

    let hostPresence: BattleshipPresencePlayer[] = [];
    hostConn.onPresence((players) => {
      hostPresence = players;
    });

    expect(hostPresence.map((player) => player.id).sort()).toEqual(
      [HOST_UID, JOINER_UID].sort(),
    );

    let hostState = createBattleshipOnlineStateFromLaunch(hostLaunch(), () => 'nd_flap');
    hostState = battleshipOnlineReducer(hostState, {
      type: 'connection-status-changed',
      status: 'connected',
    });
    hostState = battleshipOnlineReducer(hostState, {
      type: 'apply-presence',
      displayName: 'Host',
      players: hostPresence,
    });
    expect(hostState.hostId).toBe(HOST_UID);
    expect(hostState.opponentConnected).toBe(true);

    // Brief disconnect (one empty tick).
    await joinerConn.disconnect();
    expect(hostPresence.map((player) => player.id)).toEqual([HOST_UID]);

    const afterFlapOff = syncPresenceWithHostTransfer({
      localDisplayName: 'Host',
      localPlayerId: HOST_UID,
      players: hostPresence,
      state: hostState,
    });
    expect(afterFlapOff.state.hostId).toBe(HOST_UID);
    expect(afterFlapOff.becameHost).toBe(false);
    expect(afterFlapOff.opponentConnected).toBe(false);

    let grace = createAuthorityClaimGrace();
    grace = observePeersForAuthorityClaimGrace(grace, true);
    expect(
      shouldDeferInstantHostClaimOnPresenceFlap({
        hasClaimedLobby: false,
        hasMatchProgress: false,
        peersConnected: false,
        sawPeerWhileUnclaimed: grace.sawPeerWhileUnclaimed,
      }),
    ).toBe(true);
    grace = tickAuthorityClaimGraceOnProbe(grace, false);
    expect(decideClaim(grace, false)).toBe(false);

    // Peer returns before second interval.
    const rejoined = await transport.connect({
      roomId: ROOM_ID,
      playerId: JOINER_UID,
      displayName: 'Sara',
    });
    expect(hostPresence.map((player) => player.id).sort()).toEqual(
      [HOST_UID, JOINER_UID].sort(),
    );

    const afterFlapOn = syncPresenceWithHostTransfer({
      localDisplayName: 'Host',
      localPlayerId: HOST_UID,
      players: hostPresence,
      state: afterFlapOff.state,
    });
    expect(afterFlapOn.state.hostId).toBe(HOST_UID);
    expect(afterFlapOn.opponentConnected).toBe(true);

    grace = observePeersForAuthorityClaimGrace(grace, true);
    expect(grace.consecutivePeerAbsentIntervals).toBe(0);
    expect(decideClaim(grace, true)).toBe(false);

    await rejoined.disconnect();
    await hostConn.disconnect();
  });

  it('keeps sticky battle host across a peer flap without transferring authority', () => {
    let state = createBattleshipOnlineStateFromLaunch(hostLaunch(), () => 'nd_flap_battle');
    state = {
      ...state,
      phase: 'battle',
      hostId: HOST_UID,
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
      opponentConnected: true,
    };

    const peerGone = syncPresenceWithHostTransfer({
      localDisplayName: 'Host',
      localPlayerId: HOST_UID,
      players: [{ id: HOST_UID, displayName: 'Host', joinedAt: 1, isConnected: true }],
      state,
    });
    expect(peerGone.state.hostId).toBe(HOST_UID);
    expect(peerGone.state.phase).toBe('battle');
    expect(peerGone.becameHost).toBe(false);

    const peerBack = syncPresenceWithHostTransfer({
      localDisplayName: 'Host',
      localPlayerId: HOST_UID,
      players: [
        { id: HOST_UID, displayName: 'Host', joinedAt: 1, isConnected: true },
        { id: JOINER_UID, displayName: 'Sara', joinedAt: 2, isConnected: true },
      ],
      state: peerGone.state,
    });
    expect(peerBack.state.hostId).toBe(HOST_UID);
    expect(peerBack.state.phase).toBe('battle');
    expect(peerBack.opponentConnected).toBe(true);
  });
});
