import {
  DRAWING_GUESS_PROTOCOL_VERSION,
  DRAWING_GUESS_TOPICS,
} from '../model/constants';
import {
  DrawingGuessEvent,
  DrawingPoint,
  DrawingGuessPrompt,
  DrawingGuessRoundEndReason,
  DrawingGuessSnapshotChunk,
  DrawingGuessState,
  DrawingStroke,
} from '../model/types';
import { DrawingGuessInboundMessage, DrawingGuessMessageEnvelope } from './types';

export type DrawingGuessControlPayload =
  | {
      type: 'player-joined';
    }
  | {
      type: 'player-left';
      playerId: string;
    }
  | {
      type: 'start-match-request';
    }
  | {
      type: 'start-match-applied';
      matchId: string;
      now: number;
    }
  | {
      type: 'prompt-selected';
      prompt: DrawingGuessPrompt;
      now: number;
    }
  | {
      type: 'guess-scored';
      guessId: string;
      playerId: string;
      text: string;
      now: number;
      isCorrect: boolean;
      pointsAwarded: number;
    }
  | {
      type: 'canvas-cleared';
    }
  | {
      type: 'stroke-undone';
    }
  | {
      type: 'round-ended';
      now: number;
      reason?: DrawingGuessRoundEndReason;
      revealedPrompt?: DrawingGuessPrompt;
    }
  | {
      type: 'round-advanced';
      state: DrawingGuessState;
    }
  | {
      type: 'match-finished';
    }
  | {
      type: 'snapshot-request';
      snapshotId: string;
    };

export type DrawingGuessChatPayload = {
  type: 'guess-submitted';
  guessId: string;
  text: string;
};

export type DrawingGuessStrokeCommitPayload = {
  type: 'stroke-committed';
  stroke: DrawingStroke;
};

export type DrawingGuessStrokePreviewPayload = {
  type: 'stroke-preview';
  strokeId: string;
  authorId: string;
  tool: DrawingStroke['tool'];
  color: string;
  width: number;
  revision: number;
  points: DrawingPoint[];
  status: 'begin' | 'update' | 'cancel';
};

export type DrawingGuessSnapshotPayload = {
  type: 'snapshot-chunk';
  chunk: DrawingGuessSnapshotChunk;
};

export type DrawingGuessMessagePayload =
  | DrawingGuessControlPayload
  | DrawingGuessChatPayload
  | DrawingGuessStrokeCommitPayload
  | DrawingGuessStrokePreviewPayload
  | DrawingGuessSnapshotPayload;

type CreateMessageInput<TPayload> = {
  matchId: string;
  messageId: string;
  senderId: string;
  clientTime: number;
  sequence: number;
  topic: DrawingGuessMessageEnvelope<TPayload>['topic'];
  payload: TPayload;
};

export const createDrawingGuessMessage = <TPayload>({
  clientTime,
  matchId,
  messageId,
  payload,
  senderId,
  sequence,
  topic,
}: CreateMessageInput<TPayload>): DrawingGuessMessageEnvelope<TPayload> => ({
  protocolVersion: DRAWING_GUESS_PROTOCOL_VERSION,
  matchId,
  messageId,
  senderId,
  clientTime,
  sequence,
  topic,
  payload,
});

export const createControlMessage = (
  input: Omit<CreateMessageInput<DrawingGuessControlPayload>, 'topic'>,
) =>
  createDrawingGuessMessage({
    ...input,
    topic: DRAWING_GUESS_TOPICS.control,
  });

export const createGuessMessage = (
  input: Omit<CreateMessageInput<DrawingGuessChatPayload>, 'topic'>,
) =>
  createDrawingGuessMessage({
    ...input,
    topic: DRAWING_GUESS_TOPICS.chat,
  });

export const createStrokeCommitMessage = (
  input: Omit<CreateMessageInput<DrawingGuessStrokeCommitPayload>, 'topic'>,
) =>
  createDrawingGuessMessage({
    ...input,
    topic: DRAWING_GUESS_TOPICS.strokeCommit,
  });

export const createStrokePreviewMessage = (
  input: Omit<CreateMessageInput<DrawingGuessStrokePreviewPayload>, 'topic'>,
) =>
  createDrawingGuessMessage({
    ...input,
    topic: DRAWING_GUESS_TOPICS.strokePreview,
  });

export const createSnapshotChunkMessage = (
  input: Omit<CreateMessageInput<DrawingGuessSnapshotPayload>, 'topic'>,
) =>
  createDrawingGuessMessage({
    ...input,
    topic: DRAWING_GUESS_TOPICS.snapshot,
  });

export const mapInboundMessageToReducerEvent = (
  message: DrawingGuessInboundMessage,
): DrawingGuessEvent | undefined => {
  if (message.topic === DRAWING_GUESS_TOPICS.strokeCommit) {
    const payload = message.payload as Partial<DrawingGuessStrokeCommitPayload>;

    if (payload.type !== 'stroke-committed' || !payload.stroke) {
      return undefined;
    }

    return {
      type: 'commit-stroke',
      actorId: message.senderId,
      stroke: payload.stroke,
    };
  }

  if (message.topic === DRAWING_GUESS_TOPICS.chat) {
    const payload = message.payload as Partial<DrawingGuessChatPayload>;

    if (payload.type !== 'guess-submitted' || !payload.guessId || typeof payload.text !== 'string') {
      return undefined;
    }

    return {
      type: 'submit-guess',
      actorId: message.senderId,
      guessId: payload.guessId,
      text: payload.text,
      now: message.clientTime,
    };
  }

  if (message.topic !== DRAWING_GUESS_TOPICS.control) {
    return undefined;
  }

  const payload = message.payload as Partial<DrawingGuessControlPayload>;

  if (payload.type === 'start-match-applied' && payload.matchId && payload.now) {
    return {
      type: 'start-match',
      actorId: message.senderId,
      matchId: payload.matchId,
      now: payload.now,
    };
  }

  if (payload.type === 'prompt-selected' && payload.prompt && payload.now) {
    return {
      type: 'select-prompt',
      actorId: message.senderId,
      prompt: payload.prompt,
      now: payload.now,
    };
  }

  if (
    payload.type === 'guess-scored' &&
    payload.guessId &&
    payload.playerId &&
    typeof payload.text === 'string' &&
    typeof payload.now === 'number' &&
    typeof payload.isCorrect === 'boolean' &&
    typeof payload.pointsAwarded === 'number'
  ) {
    return {
      type: 'apply-scored-guess',
      guessId: payload.guessId,
      playerId: payload.playerId,
      text: payload.text,
      now: payload.now,
      isCorrect: payload.isCorrect,
      pointsAwarded: payload.pointsAwarded,
    };
  }

  if (payload.type === 'canvas-cleared') {
    return {
      type: 'clear-canvas',
      actorId: message.senderId,
    };
  }

  if (payload.type === 'stroke-undone') {
    return {
      type: 'undo-latest-stroke',
      actorId: message.senderId,
    };
  }

  if (payload.type === 'round-ended' && payload.now) {
    return {
      type: 'end-round',
      actorId: message.senderId,
      now: payload.now,
      reason: payload.reason,
      revealedPrompt: payload.revealedPrompt,
    };
  }

  if (payload.type === 'round-advanced' && payload.state) {
    return {
      type: 'apply-snapshot',
      state: payload.state,
    };
  }

  if (payload.type === 'match-finished') {
    return {
      type: 'finish-match',
      actorId: message.senderId,
    };
  }

  return undefined;
};

export const getSnapshotChunkFromMessage = (message: DrawingGuessInboundMessage) => {
  if (message.topic !== DRAWING_GUESS_TOPICS.snapshot) {
    return undefined;
  }

  const payload = message.payload as Partial<DrawingGuessSnapshotPayload>;

  return payload.type === 'snapshot-chunk' ? payload.chunk : undefined;
};

export const getStrokePreviewFromMessage = (message: DrawingGuessInboundMessage) => {
  if (message.topic !== DRAWING_GUESS_TOPICS.strokePreview) {
    return undefined;
  }

  const payload = message.payload as Partial<DrawingGuessStrokePreviewPayload>;

  return payload.type === 'stroke-preview' ? (payload as DrawingGuessStrokePreviewPayload) : undefined;
};
