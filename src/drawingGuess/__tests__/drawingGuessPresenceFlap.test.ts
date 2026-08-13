import { describe, expect, it } from 'vitest';

import {
  createOnlineDrawingGuessState,
} from '../controller/drawingGuessControllerModel';
import { drawingGuessReducer } from '../model/drawingGuessReducer';
import {
  createAuthorityClaimGrace,
  observePeersForAuthorityClaimGrace,
  PEER_ABSENT_INTERVALS_BEFORE_CLAIM,
  shouldClaimHostAfterAuthorityProbe,
  shouldDeferInstantHostClaimOnPresenceFlap,
  syncPresencePlayers,
  tickAuthorityClaimGraceOnProbe,
} from '../model/onlineGameplayReliability';
import { getPromptById } from '../model/wordBank';
import { MockDrawingGuessTransport } from '../transport/MockDrawingGuessTransport';
import type { DrawingGuessPresencePlayer } from '../transport/types';

const ROOM_ID = 'voice-room-dg-flap';
const HOST_UID = 'host-uid';
const JOINER_UID = 'joiner-uid';
const PROMPT = getPromptById('apple')!;

const decideClaim = (
  grace: ReturnType<typeof createAuthorityClaimGrace>,
  peersConnected: boolean,
) =>
  shouldClaimHostAfterAuthorityProbe({
    consecutivePeerAbsentIntervals: grace.consecutivePeerAbsentIntervals,
    hasClaimedHostSnapshot: false,
    hasMatchProgress: false,
    isLocalHost: true,
    peersConnected,
    requiredAbsentIntervals: PEER_ABSENT_INTERVALS_BEFORE_CLAIM,
  });

describe('Drawing Guess presence-flap claim grace', () => {
  it('does not claim on a single empty tick after seeing a peer', () => {
    let grace = createAuthorityClaimGrace();
    grace = observePeersForAuthorityClaimGrace(grace, true);
    expect(grace.sawPeerWhileUnclaimed).toBe(true);
    expect(grace.consecutivePeerAbsentIntervals).toBe(0);

    expect(
      shouldDeferInstantHostClaimOnPresenceFlap({
        hasClaimedHostSnapshot: false,
        hasMatchProgress: false,
        peersConnected: false,
        sawPeerWhileUnclaimed: grace.sawPeerWhileUnclaimed,
      }),
    ).toBe(true);

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

    grace = observePeersForAuthorityClaimGrace(grace, true);
    expect(grace.consecutivePeerAbsentIntervals).toBe(0);
    expect(grace.sawPeerWhileUnclaimed).toBe(true);
    expect(decideClaim(grace, true)).toBe(false);

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
        hasClaimedHostSnapshot: false,
        hasMatchProgress: false,
        peersConnected: false,
        sawPeerWhileUnclaimed: grace.sawPeerWhileUnclaimed,
      }),
    ).toBe(false);

    expect(
      shouldClaimHostAfterAuthorityProbe({
        consecutivePeerAbsentIntervals: 0,
        hasClaimedHostSnapshot: false,
        hasMatchProgress: false,
        isLocalHost: true,
        peersConnected: false,
        requiredAbsentIntervals: 0,
      }),
    ).toBe(true);
  });

  it('flaps peer presence on mock transport without dual-host election', async () => {
    const transport = new MockDrawingGuessTransport();
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

    let hostPresence: DrawingGuessPresencePlayer[] = [];
    hostConn.onPresence((players) => {
      hostPresence = players;
    });

    expect(hostPresence.map((player) => player.id).sort()).toEqual(
      [HOST_UID, JOINER_UID].sort(),
    );

    let hostState = createOnlineDrawingGuessState({
      roomCode: ROOM_ID,
      localPlayerId: HOST_UID,
      displayName: 'Host',
      hostId: HOST_UID,
      matchId: 'match-dg-flap',
      now: 1_000,
    });
    hostState = drawingGuessReducer(hostState, {
      type: 'connection-status-changed',
      status: 'connected',
    });
    const withPeer = syncPresencePlayers({
      localDisplayName: 'Host',
      localPlayerId: HOST_UID,
      players: hostPresence,
      state: hostState,
    });
    expect(withPeer.state.hostId).toBe(HOST_UID);

    await joinerConn.disconnect();
    expect(hostPresence.map((player) => player.id)).toEqual([HOST_UID]);

    const afterFlapOff = syncPresencePlayers({
      localDisplayName: 'Host',
      localPlayerId: HOST_UID,
      players: hostPresence,
      state: withPeer.state,
    });
    expect(afterFlapOff.state.hostId).toBe(HOST_UID);
    expect(afterFlapOff.becameHost).toBe(false);

    let grace = createAuthorityClaimGrace();
    grace = observePeersForAuthorityClaimGrace(grace, true);
    expect(
      shouldDeferInstantHostClaimOnPresenceFlap({
        hasClaimedHostSnapshot: false,
        hasMatchProgress: false,
        peersConnected: false,
        sawPeerWhileUnclaimed: grace.sawPeerWhileUnclaimed,
      }),
    ).toBe(true);
    grace = tickAuthorityClaimGraceOnProbe(grace, false);
    expect(decideClaim(grace, false)).toBe(false);

    const rejoined = await transport.connect({
      roomId: ROOM_ID,
      playerId: JOINER_UID,
      displayName: 'Sara',
    });
    expect(hostPresence.map((player) => player.id).sort()).toEqual(
      [HOST_UID, JOINER_UID].sort(),
    );

    const afterFlapOn = syncPresencePlayers({
      localDisplayName: 'Host',
      localPlayerId: HOST_UID,
      players: hostPresence,
      state: afterFlapOff.state,
    });
    expect(afterFlapOn.state.hostId).toBe(HOST_UID);

    grace = observePeersForAuthorityClaimGrace(grace, true);
    expect(grace.consecutivePeerAbsentIntervals).toBe(0);
    expect(decideClaim(grace, true)).toBe(false);

    await rejoined.disconnect();
    await hostConn.disconnect();
  });

  it('keeps sticky drawing host across a peer flap without transferring authority', () => {
    let state = createOnlineDrawingGuessState({
      roomCode: ROOM_ID,
      localPlayerId: HOST_UID,
      displayName: 'Host',
      hostId: HOST_UID,
      matchId: 'match-dg-flap-drawing',
      now: 1_000,
    });
    state = drawingGuessReducer(state, {
      type: 'player-joined',
      player: {
        id: JOINER_UID,
        displayName: 'Sara',
        avatarLabel: 'S',
        role: 'player',
        joinedAt: 2,
      },
    });
    state = drawingGuessReducer(state, {
      type: 'start-match',
      actorId: HOST_UID,
      now: 2_000,
      matchId: 'match-dg-flap-drawing',
    });
    state = drawingGuessReducer(state, {
      type: 'select-prompt',
      actorId: HOST_UID,
      prompt: PROMPT,
      now: 3_000,
    });
    expect(state.phase).toBe('drawing');

    const peerGone = syncPresencePlayers({
      localDisplayName: 'Host',
      localPlayerId: HOST_UID,
      players: [{ id: HOST_UID, displayName: 'Host', joinedAt: 1, isConnected: true }],
      state,
    });
    expect(peerGone.state.hostId).toBe(HOST_UID);
    expect(peerGone.state.phase).toBe('drawing');
    expect(peerGone.becameHost).toBe(false);

    const peerBack = syncPresencePlayers({
      localDisplayName: 'Host',
      localPlayerId: HOST_UID,
      players: [
        { id: HOST_UID, displayName: 'Host', joinedAt: 1, isConnected: true },
        { id: JOINER_UID, displayName: 'Sara', joinedAt: 2, isConnected: true },
      ],
      state: peerGone.state,
    });
    expect(peerBack.state.hostId).toBe(HOST_UID);
    expect(peerBack.state.phase).toBe('drawing');
  });
});
