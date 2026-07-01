import {
  DRAWING_GUESS_PROTOCOL_VERSION,
  DRAWING_GUESS_TOPICS,
} from '../model/constants';
import { isNormalizedPoint } from '../model/strokeUtils';
import { DrawingGuessTopic } from '../model/types';
import { DrawingGuessMessageEnvelope } from './types';

const topics = new Set<string>(Object.values(DRAWING_GUESS_TOPICS));

export const isSupportedDrawingGuessTopic = (topic: unknown): topic is DrawingGuessTopic =>
  typeof topic === 'string' && topics.has(topic);

export const isDrawingGuessMessageEnvelope = (
  value: unknown,
): value is DrawingGuessMessageEnvelope => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const message = value as Partial<DrawingGuessMessageEnvelope>;

  return (
    message.protocolVersion === DRAWING_GUESS_PROTOCOL_VERSION &&
    typeof message.matchId === 'string' &&
    message.matchId.length > 0 &&
    typeof message.messageId === 'string' &&
    message.messageId.length > 0 &&
    typeof message.senderId === 'string' &&
    message.senderId.length > 0 &&
    typeof message.clientTime === 'number' &&
    Number.isFinite(message.clientTime) &&
    typeof message.sequence === 'number' &&
    Number.isFinite(message.sequence) &&
    isSupportedDrawingGuessTopic(message.topic)
  );
};

export const validateDrawingGuessMessage = (value: unknown) =>
  isDrawingGuessMessageEnvelope(value) ? value : undefined;

export const isTopicCompatiblePayload = (message: DrawingGuessMessageEnvelope) => {
  if (message.topic === DRAWING_GUESS_TOPICS.strokeCommit) {
    const payload = message.payload as { stroke?: unknown };

    return Boolean(payload && typeof payload === 'object' && payload.stroke);
  }

  if (message.topic === DRAWING_GUESS_TOPICS.strokePreview) {
    const payload = message.payload as {
      authorId?: unknown;
      color?: unknown;
      points?: unknown;
      revision?: unknown;
      status?: unknown;
      strokeId?: unknown;
      tool?: unknown;
      type?: unknown;
      width?: unknown;
    };

    return (
      Boolean(payload && typeof payload === 'object') &&
      payload.type === 'stroke-preview' &&
      typeof payload.strokeId === 'string' &&
      typeof payload.authorId === 'string' &&
      (payload.tool === 'brush' || payload.tool === 'eraser') &&
      typeof payload.color === 'string' &&
      typeof payload.width === 'number' &&
      payload.width > 0 &&
      typeof payload.revision === 'number' &&
      Number.isFinite(payload.revision) &&
      (payload.status === 'begin' || payload.status === 'update' || payload.status === 'cancel') &&
      Array.isArray(payload.points) &&
      payload.points.length > 0 &&
      payload.points.every(isNormalizedPoint)
    );
  }

  if (message.topic === DRAWING_GUESS_TOPICS.chat) {
    const payload = message.payload as { text?: unknown };

    return Boolean(payload && typeof payload === 'object') && typeof payload.text === 'string';
  }

  if (message.topic === DRAWING_GUESS_TOPICS.control) {
    const payload = message.payload as { type?: unknown };

    return Boolean(payload && typeof payload === 'object') && typeof payload.type === 'string';
  }

  if (message.topic === DRAWING_GUESS_TOPICS.snapshot) {
    const payload = message.payload as { chunk?: unknown };

    return Boolean(payload && typeof payload === 'object') && Boolean(payload.chunk);
  }

  return false;
};

export const validateTopicCompatibleDrawingGuessMessage = (value: unknown) => {
  const message = validateDrawingGuessMessage(value);

  if (!message || !isTopicCompatiblePayload(message)) {
    return undefined;
  }

  return message;
};
