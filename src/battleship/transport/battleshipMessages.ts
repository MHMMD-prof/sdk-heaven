import { BattleshipFleetReadySeal, fleetSealLooksSafe } from '../online/fleetSeal';
import {
  BattleshipPublicSnapshot,
  publicSnapshotLooksSafe,
} from '../online/onlineReliability';
import { BATTLESHIP_PROTOCOL_VERSION, BATTLESHIP_TOPICS } from './constants';
import { BattleshipInboundMessage, BattleshipMessageEnvelope, BattleshipTopic } from './types';

export type BattleshipLobbyPlayerSnapshot = {
  id: string;
  displayName: string;
  joinedAt: number;
  isConnected: boolean;
};

export type BattleshipControlPayload =
  | {
      type: 'lobby-announce';
      matchId: string;
      hostId: string;
      players: BattleshipLobbyPlayerSnapshot[];
    }
  | {
      type: 'lobby-request';
    };

export type BattleshipPlacementPayload =
  | {
      type: 'placement-start';
      matchId: string;
      now: number;
    }
  | {
      type: 'fleet-ready';
      seal: BattleshipFleetReadySeal;
    }
  | {
      type: 'battle-start';
      matchId: string;
      firstPlayerId: string;
      now: number;
    };

export type BattleshipBattlePayload =
  | {
      type: 'shot-fired';
      shotId: string;
      cellId: string;
    }
  | {
      type: 'shot-resolved';
      shotId: string;
      cellId: string;
      attackerId: string;
      result: 'hit' | 'miss';
      nextTurnPlayerId: string;
      sunkTargetId?: string;
      winnerId?: string;
    };

export type BattleshipSnapshotPayload =
  | {
      type: 'snapshot-request';
    }
  | {
      type: 'public-snapshot';
      snapshot: BattleshipPublicSnapshot;
    };

export type BattleshipMessagePayload =
  | BattleshipControlPayload
  | BattleshipPlacementPayload
  | BattleshipBattlePayload
  | BattleshipSnapshotPayload;

type CreateMessageInput<TPayload> = {
  matchId: string;
  messageId: string;
  senderId: string;
  clientTime: number;
  sequence: number;
  topic: BattleshipTopic;
  payload: TPayload;
};

export const createBattleshipMessage = <TPayload>({
  clientTime,
  matchId,
  messageId,
  payload,
  senderId,
  sequence,
  topic,
}: CreateMessageInput<TPayload>): BattleshipMessageEnvelope<TPayload> => ({
  protocolVersion: BATTLESHIP_PROTOCOL_VERSION,
  matchId,
  messageId,
  senderId,
  clientTime,
  sequence,
  topic,
  payload,
});

export const createControlMessage = (
  input: Omit<CreateMessageInput<BattleshipControlPayload>, 'topic'>,
) =>
  createBattleshipMessage({
    ...input,
    topic: BATTLESHIP_TOPICS.control,
  });

export const createPlacementMessage = (
  input: Omit<CreateMessageInput<BattleshipPlacementPayload>, 'topic'>,
) =>
  createBattleshipMessage({
    ...input,
    topic: BATTLESHIP_TOPICS.placement,
  });

export const createBattleMessage = (
  input: Omit<CreateMessageInput<BattleshipBattlePayload>, 'topic'>,
) =>
  createBattleshipMessage({
    ...input,
    topic: BATTLESHIP_TOPICS.battle,
  });

export const createSnapshotMessage = (
  input: Omit<CreateMessageInput<BattleshipSnapshotPayload>, 'topic'>,
) =>
  createBattleshipMessage({
    ...input,
    topic: BATTLESHIP_TOPICS.snapshot,
  });

export const getControlPayload = (
  message: BattleshipInboundMessage,
): BattleshipControlPayload | undefined => {
  if (message.topic !== BATTLESHIP_TOPICS.control) {
    return undefined;
  }

  const payload = message.payload as Partial<BattleshipControlPayload>;
  if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') {
    return undefined;
  }

  if (payload.type === 'lobby-request') {
    return { type: 'lobby-request' };
  }

  if (payload.type === 'lobby-announce') {
    const announce = payload as Partial<Extract<BattleshipControlPayload, { type: 'lobby-announce' }>>;
    if (
      typeof announce.matchId !== 'string'
      || !announce.matchId
      || typeof announce.hostId !== 'string'
      || !announce.hostId
      || !Array.isArray(announce.players)
    ) {
      return undefined;
    }

    const players = announce.players
      .map((player) => {
        if (!player || typeof player !== 'object') {
          return undefined;
        }
        const next = player as Partial<BattleshipLobbyPlayerSnapshot>;
        if (typeof next.id !== 'string' || !next.id || typeof next.displayName !== 'string') {
          return undefined;
        }
        return {
          id: next.id,
          displayName: next.displayName.trim() || next.id,
          joinedAt: typeof next.joinedAt === 'number' && Number.isFinite(next.joinedAt)
            ? next.joinedAt
            : Date.now(),
          isConnected: next.isConnected !== false,
        };
      })
      .filter((player): player is BattleshipLobbyPlayerSnapshot => Boolean(player));

    return {
      type: 'lobby-announce',
      matchId: announce.matchId,
      hostId: announce.hostId,
      players,
    };
  }

  return undefined;
};

export const getPlacementPayload = (
  message: BattleshipInboundMessage,
): BattleshipPlacementPayload | undefined => {
  if (message.topic !== BATTLESHIP_TOPICS.placement) {
    return undefined;
  }

  const payload = message.payload as Partial<BattleshipPlacementPayload> & Record<string, unknown>;
  if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') {
    return undefined;
  }

  // Hard reject any accidental board leak on the placement channel.
  if ('cells' in payload || 'targets' in payload || 'fleet' in payload || 'board' in payload) {
    return undefined;
  }

  if (payload.type === 'placement-start') {
    const next = payload as Partial<Extract<BattleshipPlacementPayload, { type: 'placement-start' }>>;
    if (
      typeof next.matchId !== 'string'
      || !next.matchId
      || typeof next.now !== 'number'
      || !Number.isFinite(next.now)
    ) {
      return undefined;
    }
    return { type: 'placement-start', matchId: next.matchId, now: next.now };
  }

  if (payload.type === 'fleet-ready') {
    const next = payload as Partial<Extract<BattleshipPlacementPayload, { type: 'fleet-ready' }>>;
    if (!fleetSealLooksSafe(next.seal)) {
      return undefined;
    }
    return { type: 'fleet-ready', seal: next.seal };
  }

  if (payload.type === 'battle-start') {
    const next = payload as Partial<Extract<BattleshipPlacementPayload, { type: 'battle-start' }>>;
    if (
      typeof next.matchId !== 'string'
      || !next.matchId
      || typeof next.firstPlayerId !== 'string'
      || !next.firstPlayerId
      || typeof next.now !== 'number'
      || !Number.isFinite(next.now)
    ) {
      return undefined;
    }
    return {
      type: 'battle-start',
      matchId: next.matchId,
      firstPlayerId: next.firstPlayerId,
      now: next.now,
    };
  }

  return undefined;
};

const isBoardCellId = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+-\d+$/.test(value);

export const getBattlePayload = (
  message: BattleshipInboundMessage,
): BattleshipBattlePayload | undefined => {
  if (message.topic !== BATTLESHIP_TOPICS.battle) {
    return undefined;
  }

  const payload = message.payload as Partial<BattleshipBattlePayload> & Record<string, unknown>;
  if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') {
    return undefined;
  }

  // Hard reject any accidental board leak on the battle channel.
  if ('cells' in payload || 'targets' in payload || 'fleet' in payload || 'board' in payload) {
    return undefined;
  }

  if (payload.type === 'shot-fired') {
    const next = payload as Partial<Extract<BattleshipBattlePayload, { type: 'shot-fired' }>>;
    if (
      typeof next.shotId !== 'string'
      || !next.shotId
      || !isBoardCellId(next.cellId)
    ) {
      return undefined;
    }
    return {
      type: 'shot-fired',
      shotId: next.shotId,
      cellId: next.cellId,
    };
  }

  if (payload.type === 'shot-resolved') {
    const next = payload as Partial<Extract<BattleshipBattlePayload, { type: 'shot-resolved' }>>;
    if (
      typeof next.shotId !== 'string'
      || !next.shotId
      || !isBoardCellId(next.cellId)
      || typeof next.attackerId !== 'string'
      || !next.attackerId
      || (next.result !== 'hit' && next.result !== 'miss')
      || typeof next.nextTurnPlayerId !== 'string'
      || !next.nextTurnPlayerId
    ) {
      return undefined;
    }

    return {
      type: 'shot-resolved',
      shotId: next.shotId,
      cellId: next.cellId,
      attackerId: next.attackerId,
      result: next.result,
      nextTurnPlayerId: next.nextTurnPlayerId,
      ...(typeof next.sunkTargetId === 'string' && next.sunkTargetId
        ? { sunkTargetId: next.sunkTargetId }
        : {}),
      ...(typeof next.winnerId === 'string' && next.winnerId
        ? { winnerId: next.winnerId }
        : {}),
    };
  }

  return undefined;
};

export const getSnapshotPayload = (
  message: BattleshipInboundMessage,
): BattleshipSnapshotPayload | undefined => {
  if (message.topic !== BATTLESHIP_TOPICS.snapshot) {
    return undefined;
  }

  const payload = message.payload as Partial<BattleshipSnapshotPayload> & Record<string, unknown>;
  if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') {
    return undefined;
  }

  if ('cells' in payload || 'targets' in payload || 'fleet' in payload || 'board' in payload) {
    return undefined;
  }

  if (payload.type === 'snapshot-request') {
    return { type: 'snapshot-request' };
  }

  if (payload.type === 'public-snapshot') {
    const next = payload as Partial<Extract<BattleshipSnapshotPayload, { type: 'public-snapshot' }>>;
    if (!publicSnapshotLooksSafe(next.snapshot)) {
      return undefined;
    }
    return {
      type: 'public-snapshot',
      snapshot: next.snapshot,
    };
  }

  return undefined;
};
