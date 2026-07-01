import { describe, expect, it } from 'vitest';

import {
  createInitialDrawingGuessState,
  drawingGuessReducer,
} from '../model/drawingGuessReducer';
import { chunkSnapshot, DrawingGuessSnapshotReassembler } from '../model/snapshot';
import { DrawingGuessSnapshot, DrawingStroke } from '../model/types';
import { getPromptById } from '../model/wordBank';
import {
  createControlMessage,
  createGuessMessage,
  createSnapshotChunkMessage,
  createStrokeCommitMessage,
  createStrokePreviewMessage,
  getStrokePreviewFromMessage,
  getSnapshotChunkFromMessage,
  mapInboundMessageToReducerEvent,
} from '../transport/drawingGuessMessages';
import { DRAWING_GUESS_PROTOCOL_VERSION, DRAWING_GUESS_TOPICS } from '../model/constants';
import { MockDrawingGuessTransport } from '../transport/MockDrawingGuessTransport';
import {
  validateDrawingGuessMessage,
  validateTopicCompatibleDrawingGuessMessage,
} from '../transport/messageValidation';
import { createDrawingGuessViewModel } from '../controller/drawingGuessControllerModel';

const baseMessageInput = {
  matchId: 'match-1',
  messageId: 'message-1',
  senderId: 'p1',
  clientTime: 1000,
  sequence: 7,
};

const createLobbyState = () => {
  let state = createInitialDrawingGuessState({ roomId: 'room-1', matchId: 'match-1' });

  state = drawingGuessReducer(state, {
    type: 'player-joined',
    player: {
      id: 'p1',
      displayName: 'Host',
      avatarLabel: 'H',
      role: 'player',
      joinedAt: 1,
    },
  });
  state = drawingGuessReducer(state, {
    type: 'player-joined',
    player: {
      id: 'p2',
      displayName: 'Guesser',
      avatarLabel: 'G',
      role: 'player',
      joinedAt: 2,
    },
  });

  return state;
};

const createDrawingState = () => {
  let state = createLobbyState();

  state = drawingGuessReducer(state, {
    type: 'start-match',
    actorId: 'p1',
    matchId: 'match-1',
    now: 1000,
  });
  state = drawingGuessReducer(state, {
    type: 'select-prompt',
    actorId: 'p1',
    prompt: getPromptById('apple')!,
    now: 2000,
  });

  return state;
};

describe('Drawing Guess transport messages', () => {
  it('creates outbound envelopes with protocol metadata', () => {
    const message = createControlMessage({
      ...baseMessageInput,
      payload: {
        type: 'start-match-applied',
        matchId: 'match-2',
        now: 2000,
      },
    });

    expect(message).toMatchObject({
      protocolVersion: DRAWING_GUESS_PROTOCOL_VERSION,
      topic: DRAWING_GUESS_TOPICS.control,
      matchId: 'match-1',
      messageId: 'message-1',
      senderId: 'p1',
      clientTime: 1000,
      sequence: 7,
    });
  });

  it('ignores malformed or unsupported inbound messages', () => {
    expect(validateDrawingGuessMessage({})).toBeUndefined();
    expect(
      validateDrawingGuessMessage({
        ...createControlMessage({
          ...baseMessageInput,
          payload: { type: 'start-match-request' },
        }),
        protocolVersion: 999,
      }),
    ).toBeUndefined();
    expect(
      mapInboundMessageToReducerEvent({
        ...createControlMessage({
          ...baseMessageInput,
          payload: { type: 'start-match-request' },
        }),
        receivedAt: 1001,
      }),
    ).toBeUndefined();
  });

  it('validates preview messages and rejects malformed preview points', () => {
    const validPreview = createStrokePreviewMessage({
      ...baseMessageInput,
      payload: {
        type: 'stroke-preview',
        strokeId: 'stroke-1',
        authorId: 'p1',
        tool: 'brush',
        color: '#111827',
        width: 8,
        revision: 1,
        points: [{ x: 0.2, y: 0.3 }],
        status: 'begin',
      },
    });
    const malformedPreview = createStrokePreviewMessage({
      ...baseMessageInput,
      payload: {
        type: 'stroke-preview',
        strokeId: 'stroke-1',
        authorId: 'p1',
        tool: 'brush',
        color: '#111827',
        width: 8,
        revision: 1,
        points: [{ x: 1.2, y: 0.3 }],
        status: 'begin',
      },
    });

    expect(validateDrawingGuessMessage(validPreview)).toBeDefined();
    expect(getStrokePreviewFromMessage({ ...validPreview, receivedAt: 1001 })?.strokeId).toBe('stroke-1');
    expect(validateTopicCompatibleDrawingGuessMessage(malformedPreview)).toBeUndefined();
    expect(mapInboundMessageToReducerEvent({ ...validPreview, receivedAt: 1001 })).toBeUndefined();
  });

  it('maps control messages to reducer events', () => {
    const event = mapInboundMessageToReducerEvent({
      ...createControlMessage({
        ...baseMessageInput,
        payload: {
          type: 'start-match-applied',
          matchId: 'match-2',
          now: 2000,
        },
      }),
      receivedAt: 2001,
    });

    expect(event).toEqual({
      type: 'start-match',
      actorId: 'p1',
      matchId: 'match-2',
      now: 2000,
    });
  });

  it('keeps non-host start requests from mutating authoritative state', () => {
    const state = createLobbyState();
    const requestEvent = mapInboundMessageToReducerEvent({
      ...createControlMessage({
        ...baseMessageInput,
        senderId: 'p2',
        payload: { type: 'start-match-request' },
      }),
      receivedAt: 2001,
    });
    const nonHostAppliedEvent = mapInboundMessageToReducerEvent({
      ...createControlMessage({
        ...baseMessageInput,
        senderId: 'p2',
        payload: {
          type: 'start-match-applied',
          matchId: 'match-2',
          now: 2000,
        },
      }),
      receivedAt: 2001,
    });

    expect(requestEvent).toBeUndefined();
    expect(nonHostAppliedEvent).toBeDefined();
    expect(drawingGuessReducer(state, nonHostAppliedEvent!).phase).toBe('lobby');
  });

  it('accepts valid guess intents and scores through reducer mapping', () => {
    const state = createDrawingState();
    const event = mapInboundMessageToReducerEvent({
      ...createGuessMessage({
        ...baseMessageInput,
        senderId: 'p2',
        clientTime: 3000,
        payload: {
          type: 'guess-submitted',
          guessId: 'guess-1',
          text: 'apple',
        },
      }),
      receivedAt: 3001,
    });
    const nextState = drawingGuessReducer(state, event!);

    expect(nextState.guesses[0].isCorrect).toBe(true);
    expect(nextState.scores.p2).toBeGreaterThan(0);
  });

  it('delivers committed strokes through mock transport', async () => {
    const transport = new MockDrawingGuessTransport();
    const p1 = await transport.connect({ roomId: 'room-1', playerId: 'p1', displayName: 'P1' });
    const p2 = await transport.connect({ roomId: 'room-1', playerId: 'p2', displayName: 'P2' });
    const receivedStrokes: DrawingStroke[] = [];
    const stroke: DrawingStroke = {
      id: 'stroke-1',
      authorId: 'p1',
      tool: 'brush',
      color: '#111827',
      width: 8,
      points: [{ x: 0.2, y: 0.2 }],
      createdAt: 2000,
      revision: 1,
    };

    p2.onMessage((message) => {
      const event = mapInboundMessageToReducerEvent(message);

      if (event?.type === 'commit-stroke') {
        receivedStrokes.push(event.stroke);
      }
    });

    await p1.publish(
      createStrokeCommitMessage({
        ...baseMessageInput,
        payload: {
          type: 'stroke-committed',
          stroke,
        },
      }),
    );

    expect(receivedStrokes).toEqual([stroke]);
  });

  it('wraps snapshot chunks in transport messages and applies reassembled snapshots', () => {
    const snapshot: DrawingGuessSnapshot = {
      schemaVersion: 1,
      state: createDrawingState(),
      createdAt: 4000,
    };
    const chunks = chunkSnapshot('snapshot-1', snapshot, 120);
    const reassembler = new DrawingGuessSnapshotReassembler();
    let appliedSnapshot: DrawingGuessSnapshot | undefined;

    chunks
      .map((chunk, index) => ({
        ...createSnapshotChunkMessage({
          ...baseMessageInput,
          messageId: `snapshot-message-${index}`,
          payload: {
            type: 'snapshot-chunk' as const,
            chunk,
          },
        }),
        receivedAt: 5000 + index,
      }))
      .reverse()
      .forEach((message) => {
        const chunk = getSnapshotChunkFromMessage(message);

        if (chunk) {
          appliedSnapshot = reassembler.pushChunk(chunk, message.receivedAt);
        }
      });

    expect(appliedSnapshot?.state.phase).toBe('drawing');
  });

  it('blocks drawing and guessing while recovering a snapshot', () => {
    const state = createDrawingState();
    const drawerViewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'room-1',
      localPlayerId: 'p1',
      now: 3000,
      isRecoveringSnapshot: true,
    });
    const guesserViewModel = createDrawingGuessViewModel({
      state,
      roomCode: 'room-1',
      localPlayerId: 'p2',
      now: 3000,
      isRecoveringSnapshot: true,
    });

    expect(drawerViewModel.canDraw).toBe(false);
    expect(guesserViewModel.canGuess).toBe(false);
    expect(drawerViewModel.connectionLabel).toBe('Recovering local room');
  });
});
