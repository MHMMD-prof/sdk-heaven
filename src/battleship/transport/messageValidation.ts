import { BATTLESHIP_PROTOCOL_VERSION, BATTLESHIP_TOPICS } from './constants';
import {
  getBattlePayload,
  getControlPayload,
  getPlacementPayload,
  getSnapshotPayload,
} from './battleshipMessages';
import { BattleshipMessageEnvelope, BattleshipTopic } from './types';

const topics = new Set<string>(Object.values(BATTLESHIP_TOPICS));

export const isSupportedBattleshipTopic = (topic: unknown): topic is BattleshipTopic =>
  typeof topic === 'string' && topics.has(topic);

export const isBattleshipMessageEnvelope = (
  value: unknown,
): value is BattleshipMessageEnvelope => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const message = value as Partial<BattleshipMessageEnvelope>;

  return (
    message.protocolVersion === BATTLESHIP_PROTOCOL_VERSION
    && typeof message.matchId === 'string'
    && message.matchId.length > 0
    && typeof message.messageId === 'string'
    && message.messageId.length > 0
    && typeof message.senderId === 'string'
    && message.senderId.length > 0
    && typeof message.clientTime === 'number'
    && Number.isFinite(message.clientTime)
    && typeof message.sequence === 'number'
    && Number.isFinite(message.sequence)
    && isSupportedBattleshipTopic(message.topic)
  );
};

export const validateBattleshipMessage = (value: unknown) =>
  isBattleshipMessageEnvelope(value) ? value : undefined;

export const validateTopicCompatibleBattleshipMessage = (value: unknown) => {
  const message = validateBattleshipMessage(value);
  if (!message) {
    return undefined;
  }

  if (message.topic === BATTLESHIP_TOPICS.control) {
    return getControlPayload({ ...message, receivedAt: 0 }) ? message : undefined;
  }

  if (message.topic === BATTLESHIP_TOPICS.placement) {
    return getPlacementPayload({ ...message, receivedAt: 0 }) ? message : undefined;
  }

  if (message.topic === BATTLESHIP_TOPICS.battle) {
    return getBattlePayload({ ...message, receivedAt: 0 }) ? message : undefined;
  }

  if (message.topic === BATTLESHIP_TOPICS.snapshot) {
    return getSnapshotPayload({ ...message, receivedAt: 0 }) ? message : undefined;
  }

  return undefined;
};
