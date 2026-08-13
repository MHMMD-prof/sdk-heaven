import { describe, expect, it } from 'vitest';

import {
  createOnlineDrawingGuessState,
  createDrawingGuessViewModel,
  resolveOnlineBootstrapMatchId,
} from '../controller/drawingGuessControllerModel';
import { resolveDrawingGuessLaunch } from '../controller/resolveDrawingGuessLaunch';
import { drawingGuessReducer } from '../model/drawingGuessReducer';
import {
  applyOnlineStateForViewer,
  resolveOnlineInboundGameplay,
  syncPresencePlayers,
} from '../model/onlineGameplayReliability';
import { chunkSnapshot, DrawingGuessSnapshotReassembler } from '../model/snapshot';
import { DrawingGuessState, DrawingStroke } from '../model/types';
import { getPromptById } from '../model/wordBank';
import {
  createControlMessage,
  createGuessMessage,
  createSnapshotChunkMessage,
  createStrokeCommitMessage,
  getSnapshotChunkFromMessage,
  mapInboundMessageToReducerEvent,
} from '../transport/drawingGuessMessages';
import { MockDrawingGuessTransport } from '../transport/MockDrawingGuessTransport';
import { DrawingGuessInboundMessage } from '../transport/types';

const ROOM_ID = 'voice-room-gate-1';
const SESSION_ID = 'rgs_session_gate_0001';
const HOST_UID = 'host-uid';
const JOINER_UID = 'joiner-uid';
const PROMPT = getPromptById('apple')!;

type Peer = {
  id: string;
  displayName: string;
  state: DrawingGuessState;
  sequence: number;
};

const createPeer = (id: string, displayName: string, isHost: boolean): Peer => ({
  id,
  displayName,
  sequence: 0,
  state: createOnlineDrawingGuessState({
    roomCode: ROOM_ID,
    localPlayerId: id,
    displayName,
    hostId: HOST_UID,
    matchId: resolveOnlineBootstrapMatchId({
      createMatchId: () => 'match-gate-1',
      hostUid: HOST_UID,
      localPlayerId: id,
      roomCode: ROOM_ID,
      sessionId: SESSION_ID,
    }),
    now: 1_000,
  }),
});

const applyOnlineMessage = (peer: Peer, message: DrawingGuessInboundMessage) => {
  const resolved = resolveOnlineInboundGameplay({
    localPlayerId: peer.id,
    message,
    state: peer.state,
  });

  if (!resolved.event) {
    return resolved;
  }

  peer.state = applyOnlineStateForViewer(
    drawingGuessReducer(peer.state, resolved.event),
    peer.id,
  );
  return resolved;
};

const nextSequence = (peer: Peer) => {
  peer.sequence += 1;
  return peer.sequence;
};

describe('Drawing Guess Wave 4 two-player online gate', () => {
  it('keeps voice-room launch bound to the shared session host and session id', () => {
    const hostLaunch = resolveDrawingGuessLaunch({
      displayName: 'Host',
      hostUid: HOST_UID,
      mode: 'online',
      playerId: HOST_UID,
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      source: 'voice-room',
    });
    const joinerLaunch = resolveDrawingGuessLaunch({
      displayName: 'Sara',
      hostUid: HOST_UID,
      mode: 'online',
      playerId: JOINER_UID,
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      source: 'voice-room',
    });
    const hostView = createDrawingGuessViewModel({
      state: createPeer(HOST_UID, 'Host', true).state,
      roomCode: ROOM_ID,
      localPlayerId: HOST_UID,
      now: 1_000,
      transportMode: 'livekit',
      launchSource: 'voice-room',
    });
    const joinerView = createDrawingGuessViewModel({
      state: createPeer(JOINER_UID, 'Sara', false).state,
      roomCode: ROOM_ID,
      localPlayerId: JOINER_UID,
      now: 1_000,
      transportMode: 'livekit',
      launchSource: 'voice-room',
    });

    expect(hostLaunch).toMatchObject({
      hostUid: HOST_UID,
      sessionId: SESSION_ID,
      source: 'voice-room',
      mode: 'online',
    });
    expect(joinerLaunch.hostUid).toBe(HOST_UID);
    expect(hostView.isHost).toBe(true);
    expect(hostView.showOnlineControls).toBe(false);
    expect(joinerView.isHost).toBe(false);
    expect(joinerView.showRoomResetControls).toBe(false);
  });

  it('syncs presence, snapshot bootstrap, draw/guess/score, and host transfer for two players', async () => {
    const transport = new MockDrawingGuessTransport();
    const host = createPeer(HOST_UID, 'Host', true);
    const joiner = createPeer(JOINER_UID, 'Sara', false);
    const hostConnection = await transport.connect({
      roomId: ROOM_ID,
      playerId: HOST_UID,
      displayName: 'Host',
      sessionId: SESSION_ID,
    });
    const joinerConnection = await transport.connect({
      roomId: ROOM_ID,
      playerId: JOINER_UID,
      displayName: 'Sara',
      sessionId: SESSION_ID,
    });
    const hostFollowUps: DrawingGuessInboundMessage[] = [];

    hostConnection.onPresence((players) => {
      const synced = syncPresencePlayers({
        localDisplayName: 'Host',
        localPlayerId: HOST_UID,
        players,
        state: host.state,
      });
      host.state = applyOnlineStateForViewer(synced.state, HOST_UID);
    });
    joinerConnection.onPresence((players) => {
      const synced = syncPresencePlayers({
        localDisplayName: 'Sara',
        localPlayerId: JOINER_UID,
        players,
        state: joiner.state,
      });
      joiner.state = applyOnlineStateForViewer(synced.state, JOINER_UID);
    });

    hostConnection.onMessage((message) => {
      if (message.senderId === HOST_UID) {
        return;
      }
      const resolved = applyOnlineMessage(host, message);
      if (resolved.hostFollowUp) {
        hostFollowUps.push(
          {
            ...createControlMessage({
              matchId: host.state.matchId,
              messageId: 'scored-follow-up',
              senderId: HOST_UID,
              clientTime: Date.now(),
              sequence: nextSequence(host),
              payload: {
                type: 'guess-scored',
                ...resolved.hostFollowUp.guessScored,
              },
            }),
            receivedAt: Date.now(),
          },
        );
        if (resolved.hostFollowUp.roundEnded) {
          hostFollowUps.push(
            {
              ...createControlMessage({
                matchId: host.state.matchId,
                messageId: 'round-follow-up',
                senderId: HOST_UID,
                clientTime: Date.now(),
                sequence: nextSequence(host),
                payload: {
                  type: 'round-ended',
                  ...resolved.hostFollowUp.roundEnded,
                },
              }),
              receivedAt: Date.now(),
            },
          );
        }
      }
    });
    joinerConnection.onMessage((message) => {
      if (message.senderId === JOINER_UID) {
        return;
      }
      const chunk = getSnapshotChunkFromMessage(message);
      if (chunk) {
        const reassembler = new DrawingGuessSnapshotReassembler();
        const snapshot = reassembler.pushChunk(chunk, Date.now());
        if (snapshot) {
          joiner.state = applyOnlineStateForViewer(
            {
              ...snapshot.state,
              connectionStatus: 'connected',
            },
            JOINER_UID,
          );
          const synced = syncPresencePlayers({
            localDisplayName: 'Sara',
            localPlayerId: JOINER_UID,
            players: [
              { id: HOST_UID, displayName: 'Host', isConnected: true },
              { id: JOINER_UID, displayName: 'Sara', isConnected: true },
            ],
            state: joiner.state,
          });
          joiner.state = applyOnlineStateForViewer(synced.state, JOINER_UID);
        }
        return;
      }
      applyOnlineMessage(joiner, message);
    });

    const publishHostControl = async (
      payload: Parameters<typeof createControlMessage>[0]['payload'],
      messageId: string,
      clientTime: number,
    ) => {
      const message = createControlMessage({
        matchId: host.state.matchId,
        messageId,
        senderId: HOST_UID,
        clientTime,
        sequence: nextSequence(host),
        payload,
      });
      // Mirror LiveKit: no sender echo — apply locally, then publish to peers.
      applyOnlineMessage(host, { ...message, receivedAt: clientTime });
      await hostConnection.publish(message);
    };

    // Host announces bootstrap snapshot after both are present.
    const snapshotChunks = chunkSnapshot('gate-snapshot-1', {
      schemaVersion: 1,
      createdAt: Date.now(),
      state: host.state,
    });
    for (const chunk of snapshotChunks) {
      await hostConnection.publish(
        createSnapshotChunkMessage({
          matchId: host.state.matchId,
          messageId: `snapshot-${chunk.chunkIndex}`,
          senderId: HOST_UID,
          clientTime: Date.now(),
          sequence: nextSequence(host),
          payload: { type: 'snapshot-chunk', chunk },
        }),
      );
    }

    expect(host.state.players.map((player) => player.id).sort()).toEqual([
      HOST_UID,
      JOINER_UID,
    ]);
    expect(joiner.state.hostId).toBe(HOST_UID);
    expect(joiner.state.matchId).toBe('match-gate-1');

    await publishHostControl(
      {
        type: 'start-match-applied',
        matchId: 'match-gate-1',
        now: 2_000,
      },
      'start-1',
      2_000,
    );

    expect(host.state.phase).toBe('prompt-select');
    expect(joiner.state.phase).toBe('prompt-select');

    await publishHostControl(
      {
        type: 'prompt-selected',
        prompt: PROMPT,
        now: 3_000,
      },
      'prompt-1',
      3_000,
    );

    expect(host.state.privatePrompt?.id).toBe('apple');
    expect(joiner.state.phase).toBe('drawing');
    expect(joiner.state.privatePrompt).toBeUndefined();
    expect(
      createDrawingGuessViewModel({
        state: joiner.state,
        roomCode: ROOM_ID,
        localPlayerId: JOINER_UID,
        now: 3_500,
        transportMode: 'livekit',
        launchSource: 'voice-room',
      }).promptTextForDrawer,
    ).toBeUndefined();

    const stroke: DrawingStroke = {
      id: 'stroke-gate-1',
      authorId: HOST_UID,
      tool: 'brush',
      color: '#111827',
      width: 8,
      points: [
        { x: 0.2, y: 0.2 },
        { x: 0.4, y: 0.35 },
      ],
      createdAt: 3_600,
      revision: host.state.canvasRevision,
    };
    host.state = applyOnlineStateForViewer(
      drawingGuessReducer(host.state, {
        type: 'commit-stroke',
        actorId: HOST_UID,
        stroke,
      }),
      HOST_UID,
    );
    await hostConnection.publish(
      createStrokeCommitMessage({
        matchId: host.state.matchId,
        messageId: 'stroke-1',
        senderId: HOST_UID,
        clientTime: 3_600,
        sequence: nextSequence(host),
        payload: {
          type: 'stroke-committed',
          stroke,
        },
      }),
    );
    expect(host.state.strokes.map((item) => item.id)).toContain('stroke-gate-1');
    expect(joiner.state.strokes.map((item) => item.id)).toContain('stroke-gate-1');

    await joinerConnection.publish(
      createGuessMessage({
        matchId: joiner.state.matchId,
        messageId: 'guess-1',
        senderId: JOINER_UID,
        clientTime: 4_000,
        sequence: nextSequence(joiner),
        payload: {
          type: 'guess-submitted',
          guessId: 'guess-gate-1',
          text: 'apple',
        },
      }),
    );

    // Deliver host follow-ups to the joiner (LiveKit does not echo to publisher).
    for (const followUp of hostFollowUps) {
      applyOnlineMessage(joiner, followUp);
    }

    expect(host.state.scores[JOINER_UID]).toBeGreaterThan(0);
    expect(joiner.state.scores[JOINER_UID]).toBe(host.state.scores[JOINER_UID]);
    expect(joiner.state.guesses[0]?.isCorrect).toBe(true);
    expect(joiner.state.phase).toBe('round-results');
    expect(joiner.state.revealedPrompt?.id).toBe('apple');

    // Host leaves transport; joiner presence sync transfers host authority.
    await hostConnection.disconnect();

    expect(joiner.state.hostId).toBe(JOINER_UID);
    expect(joiner.state.players.find((player) => player.id === HOST_UID)?.isConnected).toBe(false);
    expect(
      createDrawingGuessViewModel({
        state: joiner.state,
        roomCode: ROOM_ID,
        localPlayerId: JOINER_UID,
        now: 5_000,
        transportMode: 'livekit',
        launchSource: 'voice-room',
      }).isHost,
    ).toBe(true);
  });

  it('maps inbound host controls the same way both peers will apply them', () => {
    const startEvent = mapInboundMessageToReducerEvent({
      ...createControlMessage({
        matchId: 'match-gate-1',
        messageId: 'start',
        senderId: HOST_UID,
        clientTime: 2_000,
        sequence: 1,
        payload: {
          type: 'start-match-applied',
          matchId: 'match-gate-1',
          now: 2_000,
        },
      }),
      receivedAt: 2_001,
    });

    expect(startEvent).toMatchObject({
      type: 'start-match',
      actorId: HOST_UID,
      matchId: 'match-gate-1',
    });
  });
});
