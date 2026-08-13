import { describe, expect, it } from 'vitest';

import {
  createOnlineDrawingGuessState,
} from '../controller/drawingGuessControllerModel';
import { drawingGuessReducer } from '../model/drawingGuessReducer';
import {
  applyOnlineStateForViewer,
  canAcceptForeignAuthority,
  hasOnlineMatchProgress,
  shouldAdoptPeerSnapshot,
  shouldClaimHostAfterAuthorityProbe,
  syncPresencePlayers,
} from '../model/onlineGameplayReliability';
import { chunkSnapshot, DrawingGuessSnapshotReassembler } from '../model/snapshot';
import { DrawingGuessState, DrawingStroke } from '../model/types';
import { getPromptById } from '../model/wordBank';
import {
  createControlMessage,
  createSnapshotChunkMessage,
  getSnapshotChunkFromMessage,
} from '../transport/drawingGuessMessages';
import { MockDrawingGuessTransport } from '../transport/MockDrawingGuessTransport';
import { DrawingGuessInboundMessage } from '../transport/types';

const ROOM_ID = 'voice-room-dg-remount';
const HOST_UID = 'host-uid';
const JOINER_UID = 'joiner-uid';
const LIVE_MATCH = 'match-dg-live-remount';
const PROMPT = getPromptById('apple')!;

const advanceToDrawingWithStroke = (): {
  hostState: DrawingGuessState;
  joinerState: DrawingGuessState;
  stroke: DrawingStroke;
} => {
  let hostState = createOnlineDrawingGuessState({
    roomCode: ROOM_ID,
    localPlayerId: HOST_UID,
    displayName: 'Host',
    hostId: HOST_UID,
    matchId: LIVE_MATCH,
    now: 1_000,
  });
  hostState = drawingGuessReducer(hostState, {
    type: 'player-joined',
    player: {
      id: JOINER_UID,
      displayName: 'Sara',
      avatarLabel: 'S',
      role: 'player',
      joinedAt: 2,
    },
  });
  hostState = drawingGuessReducer(hostState, {
    type: 'start-match',
    actorId: HOST_UID,
    now: 2_000,
    matchId: LIVE_MATCH,
  });
  hostState = drawingGuessReducer(hostState, {
    type: 'select-prompt',
    actorId: hostState.drawerId ?? HOST_UID,
    prompt: PROMPT,
    now: 3_000,
  });

  const stroke: DrawingStroke = {
    id: 'stroke-remount-1',
    authorId: HOST_UID,
    tool: 'brush',
    color: '#111827',
    width: 8,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.45, y: 0.4 },
    ],
    createdAt: 3_500,
    revision: hostState.canvasRevision,
  };
  hostState = drawingGuessReducer(hostState, {
    type: 'commit-stroke',
    actorId: HOST_UID,
    stroke,
  });

  const joinerState = applyOnlineStateForViewer(
    {
      ...hostState,
      connectionStatus: 'connected',
    },
    JOINER_UID,
  );

  return { hostState, joinerState, stroke };
};

describe('Drawing Guess remount integration (mock transport)', () => {
  it('survivor keeps drawing after host drop; remounter probes and adopts via snapshot', async () => {
    const { joinerState, stroke } = advanceToDrawingWithStroke();
    expect(joinerState.phase).toBe('drawing');
    expect(joinerState.strokes.map((item) => item.id)).toContain(stroke.id);

    const afterHostLeave = syncPresencePlayers({
      localDisplayName: 'Sara',
      localPlayerId: JOINER_UID,
      players: [{ id: JOINER_UID, displayName: 'Sara', joinedAt: 2, isConnected: true }],
      state: joinerState,
    });
    expect(afterHostLeave.becameHost).toBe(true);
    expect(afterHostLeave.state.hostId).toBe(JOINER_UID);
    expect(afterHostLeave.state.phase).toBe('drawing');
    expect(afterHostLeave.state.matchId).toBe(LIVE_MATCH);

    const survivorState = afterHostLeave.state;

    let remounterState = createOnlineDrawingGuessState({
      roomCode: ROOM_ID,
      localPlayerId: HOST_UID,
      displayName: 'Host',
      hostId: HOST_UID,
      matchId: 'match-fresh-after-remount',
      now: 10_000,
    });
    remounterState = drawingGuessReducer(remounterState, {
      type: 'connection-status-changed',
      status: 'connected',
    });
    expect(hasOnlineMatchProgress(remounterState)).toBe(false);
    expect(
      shouldClaimHostAfterAuthorityProbe({
        consecutivePeerAbsentIntervals: 0,
        hasClaimedHostSnapshot: false,
        hasMatchProgress: false,
        isLocalHost: true,
        peersConnected: true,
      }),
    ).toBe(false);

    const transport = new MockDrawingGuessTransport();
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

    const remounterInbox: DrawingGuessInboundMessage[] = [];
    remounterConn.onMessage((message) => {
      remounterInbox.push(message);
    });

    const survivorReplies: Promise<void>[] = [];
    survivorConn.onMessage((message) => {
      const payload = message.payload as { type?: string; snapshotId?: string };
      if (payload.type !== 'snapshot-request' || survivorState.hostId !== JOINER_UID) {
        return;
      }
      const chunks = chunkSnapshot(payload.snapshotId ?? 'snap-remount-1', {
        schemaVersion: 1,
        createdAt: Date.now(),
        state: survivorState,
      });
      chunks.forEach((chunk, index) => {
        survivorReplies.push(
          survivorConn.publish(
            createSnapshotChunkMessage({
              matchId: survivorState.matchId,
              messageId: `snap-chunk-${index}`,
              senderId: JOINER_UID,
              clientTime: Date.now(),
              sequence: index + 1,
              payload: { type: 'snapshot-chunk', chunk },
            }),
          ),
        );
      });
    });

    await remounterConn.publish(
      createControlMessage({
        matchId: remounterState.matchId,
        messageId: 'probe-snap-1',
        senderId: HOST_UID,
        clientTime: Date.now(),
        sequence: 1,
        payload: {
          type: 'snapshot-request',
          snapshotId: 'snap-remount-1',
        },
      }),
    );
    await Promise.all(survivorReplies);

    const reassembler = new DrawingGuessSnapshotReassembler();
    let adoptedSnapshotState: DrawingGuessState | undefined;
    for (const message of remounterInbox) {
      const chunk = getSnapshotChunkFromMessage(message);
      if (!chunk) {
        continue;
      }
      const snapshot = reassembler.pushChunk(chunk, Date.now());
      if (snapshot) {
        adoptedSnapshotState = snapshot.state;
      }
    }

    expect(adoptedSnapshotState).toBeTruthy();
    expect(adoptedSnapshotState?.phase).toBe('drawing');
    expect(adoptedSnapshotState?.hostId).toBe(JOINER_UID);
    expect(adoptedSnapshotState?.strokes.map((item) => item.id)).toContain(stroke.id);

    expect(
      canAcceptForeignAuthority({
        localPlayerId: HOST_UID,
        senderId: JOINER_UID,
        state: remounterState,
      }),
    ).toBe(true);
    expect(
      shouldAdoptPeerSnapshot({
        localPlayerId: HOST_UID,
        previous: remounterState,
        snapshotState: adoptedSnapshotState!,
      }),
    ).toBe(true);

    remounterState = drawingGuessReducer(remounterState, {
      type: 'host-yielded',
      hostId: JOINER_UID,
      matchId: LIVE_MATCH,
    });
    remounterState = applyOnlineStateForViewer(
      drawingGuessReducer(remounterState, {
        type: 'apply-snapshot',
        state: {
          ...adoptedSnapshotState!,
          connectionStatus: 'connected',
        },
      }),
      HOST_UID,
    );

    expect(remounterState.hostId).toBe(JOINER_UID);
    expect(remounterState.matchId).toBe(LIVE_MATCH);
    expect(remounterState.phase).toBe('drawing');
    expect(remounterState.strokes.map((item) => item.id)).toContain(stroke.id);
    expect(remounterState.privatePrompt).toBeUndefined();

    await remounterConn.disconnect();
    await survivorConn.disconnect();
  });

  it('rejects remounter with match progress from adopting survivor snapshot (S1)', () => {
    const { joinerState } = advanceToDrawingWithStroke();
    const survivor = syncPresencePlayers({
      localDisplayName: 'Sara',
      localPlayerId: JOINER_UID,
      players: [{ id: JOINER_UID, displayName: 'Sara', joinedAt: 2, isConnected: true }],
      state: joinerState,
    }).state;

    let remounter = createOnlineDrawingGuessState({
      roomCode: ROOM_ID,
      localPlayerId: HOST_UID,
      displayName: 'Host',
      hostId: HOST_UID,
      matchId: 'match-fresh-bad-path',
      now: 10_000,
    });
    remounter = drawingGuessReducer(remounter, {
      type: 'player-joined',
      player: {
        id: JOINER_UID,
        displayName: 'Sara',
        avatarLabel: 'S',
        role: 'player',
        joinedAt: 2,
      },
    });
    remounter = drawingGuessReducer(remounter, {
      type: 'start-match',
      actorId: HOST_UID,
      now: 10_100,
      matchId: 'match-fresh-bad-path',
    });
    expect(hasOnlineMatchProgress(remounter)).toBe(true);

    expect(
      shouldAdoptPeerSnapshot({
        localPlayerId: HOST_UID,
        previous: remounter,
        snapshotState: survivor,
      }),
    ).toBe(false);

    const yielded = drawingGuessReducer(remounter, {
      type: 'host-yielded',
      hostId: JOINER_UID,
      matchId: LIVE_MATCH,
    });
    expect(yielded.hostId).toBe(HOST_UID);
    expect(yielded.matchId).toBe('match-fresh-bad-path');
  });
});
