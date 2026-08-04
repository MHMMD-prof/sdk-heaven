import type { AvatarFrameProjection } from '../cosmetics/avatarFrameProjection';
import { readProjectedAvatarFrame } from '../cosmetics/avatarFrameProjection';

export const ROOM_SCHEMA_VERSION = 2 as const;
export const MAX_SUPPORTED_ROOM_SCHEMA_VERSION = ROOM_SCHEMA_VERSION;
export const ROOM_SEAT_COUNTS = [5, 10, 15, 20] as const;
export const MAX_ROOM_SEATS = 20;

export type SupportedRoomSchemaVersion = 1 | typeof ROOM_SCHEMA_VERSION;
export type RoomAuthorityRole = 'owner' | 'moderator' | 'member';
export type RoomSeatMode = 'open' | 'request' | 'invite' | 'locked';
export type RoomAvailability = 'active' | 'suspended' | 'removed';
export type RoomThemeId = import('./roomThemeContract').RoomThemeId;
export type RoomChatMode = 'everyone' | 'followers' | 'off';
export type RoomHistoryVisibility = 'everyone' | 'after-join' | 'hidden';
export type RoomKeywordFilterMode = 'off' | 'standard' | 'strict';
export type RoomEffectsPolicy = 'full' | 'reduced' | 'off';
export type RoomImageReviewStatus = 'none' | 'pending' | 'approved' | 'rejected' | 'removed';
export type RoomSeatState = 'open' | 'locked' | 'occupied' | 'reconnecting' | 'retiring';
export type RoomMessageKind = 'chat' | 'system' | 'gift' | 'game' | 'entry' | 'moderation';
export type RoomMessageStatus = 'active' | 'deleted';

export type RoomMemberPrivileges = {
  canManageMusic: boolean;
};

export type RoomSeatDocument = {
  schemaVersion: typeof ROOM_SCHEMA_VERSION;
  seatNumber: number;
  state: RoomSeatState;
  occupantUid?: string;
  occupancyState?: 'occupied' | 'reconnecting';
  retired?: boolean;
  manuallyLocked?: boolean;
  reservationExpiresAtMs?: number;
  sessionId?: string;
  revision: number;
  updatedAtMs?: number;
};

export type RoomMessageDocument = {
  id: string;
  schemaVersion: typeof ROOM_SCHEMA_VERSION;
  roomId: string;
  senderUid: string;
  senderDisplayName: string;
  senderAvatarLabel: string;
  senderAvatarFrame?: AvatarFrameProjection;
  kind: RoomMessageKind;
  text: string;
  replyToMessageId?: string;
  status: RoomMessageStatus;
  revision: number;
  createdAtMs?: number;
  updatedAtMs?: number;
};

export function isSupportedSeatCount(value: unknown): value is (typeof ROOM_SEAT_COUNTS)[number] {
  return ROOM_SEAT_COUNTS.includes(value as (typeof ROOM_SEAT_COUNTS)[number]);
}

export function isRoomAuthorityRole(value: unknown): value is RoomAuthorityRole {
  return value === 'owner' || value === 'moderator' || value === 'member';
}

export function isRoomSeatMode(value: unknown): value is RoomSeatMode {
  return value === 'open' || value === 'request' || value === 'invite' || value === 'locked';
}

export function isRoomAvailability(value: unknown): value is RoomAvailability {
  return value === 'active' || value === 'suspended' || value === 'removed';
}

export function isRoomThemeId(value: unknown): value is RoomThemeId {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{2,63}$/.test(value);
}

export function isRoomChatMode(value: unknown): value is RoomChatMode {
  return value === 'everyone' || value === 'followers' || value === 'off';
}

export function isRoomHistoryVisibility(value: unknown): value is RoomHistoryVisibility {
  return value === 'everyone' || value === 'after-join' || value === 'hidden';
}

export function isRoomKeywordFilterMode(value: unknown): value is RoomKeywordFilterMode {
  return value === 'off' || value === 'standard' || value === 'strict';
}

export function isRoomEffectsPolicy(value: unknown): value is RoomEffectsPolicy {
  return value === 'full' || value === 'reduced' || value === 'off';
}

export function isRoomSlowModeSeconds(value: unknown): value is 0 | 5 | 10 | 30 | 60 {
  return value === 0 || value === 5 || value === 10 || value === 30 || value === 60;
}

export function isRoomImageReviewStatus(value: unknown): value is RoomImageReviewStatus {
  return value === 'none'
    || value === 'pending'
    || value === 'approved'
    || value === 'rejected'
    || value === 'removed';
}

export function roomSeatDocumentId(seatNumber: number) {
  if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > MAX_ROOM_SEATS) {
    throw new RangeError(`Seat number must be between 1 and ${MAX_ROOM_SEATS}.`);
  }

  return String(seatNumber).padStart(2, '0');
}

export function createVacantRoomSeatDocument(seatNumber: number, locked = false): RoomSeatDocument {
  roomSeatDocumentId(seatNumber);

  return {
    schemaVersion: ROOM_SCHEMA_VERSION,
    seatNumber,
    state: locked ? 'locked' : 'open',
    revision: 1,
  };
}

export function mapRoomSeatDocument(data: unknown, id?: string): RoomSeatDocument | null {
  if (!isRecord(data)) return null;

  const seatNumber = data.seatNumber;
  const expectedId = typeof seatNumber === 'number' && Number.isInteger(seatNumber)
    ? String(seatNumber).padStart(2, '0')
    : '';
  const state = data.state;
  const occupantRequired = state === 'occupied' || state === 'reconnecting' || state === 'retiring';

  if (
    data.schemaVersion !== ROOM_SCHEMA_VERSION ||
    typeof seatNumber !== 'number' ||
    !Number.isInteger(seatNumber) ||
    seatNumber < 1 ||
    seatNumber > MAX_ROOM_SEATS ||
    (id !== undefined && id !== expectedId) ||
    (state !== 'open' && state !== 'locked' && state !== 'occupied' && state !== 'reconnecting' && state !== 'retiring') ||
    !isPositiveInteger(data.revision) ||
    (occupantRequired ? !isNonEmptyString(data.occupantUid) : data.occupantUid !== undefined && data.occupantUid !== null)
  ) {
    return null;
  }

  return {
    schemaVersion: ROOM_SCHEMA_VERSION,
    seatNumber,
    state,
    ...(typeof data.occupantUid === 'string' ? { occupantUid: data.occupantUid } : {}),
    ...(data.occupancyState === 'occupied' || data.occupancyState === 'reconnecting'
      ? { occupancyState: data.occupancyState }
      : {}),
    ...(typeof data.retired === 'boolean' ? { retired: data.retired } : {}),
    ...(typeof data.manuallyLocked === 'boolean' ? { manuallyLocked: data.manuallyLocked } : {}),
    ...(typeof data.sessionId === 'string' ? { sessionId: data.sessionId } : {}),
    reservationExpiresAtMs: timestampToMillis(data.reservationExpiresAt),
    revision: data.revision,
    updatedAtMs: timestampToMillis(data.updatedAtMs ?? data.updatedAt),
  };
}

export function mapRoomMessageDocument(data: unknown, id?: string): RoomMessageDocument | null {
  if (!isRecord(data)) return null;

  const messageId = typeof data.id === 'string' ? data.id : id;
  if (
    !isNonEmptyString(messageId) ||
    data.schemaVersion !== ROOM_SCHEMA_VERSION ||
    !isNonEmptyString(data.roomId) ||
    !isNonEmptyString(data.senderUid) ||
    !isRoomMessageKind(data.kind) ||
    typeof data.text !== 'string' ||
    (data.status === 'active' && data.text.trim().length < 1) ||
    data.text.length > 500 ||
    (data.status !== 'active' && data.status !== 'deleted') ||
    !isPositiveInteger(data.revision)
  ) {
    return null;
  }

  return {
    id: messageId,
    schemaVersion: ROOM_SCHEMA_VERSION,
    roomId: data.roomId,
    senderUid: data.senderUid,
    senderDisplayName: typeof data.senderDisplayName === 'string' ? data.senderDisplayName : '',
    senderAvatarLabel: typeof data.senderAvatarLabel === 'string' ? data.senderAvatarLabel : '',
    ...(readProjectedAvatarFrame(data.senderAvatarFrame)
      ? { senderAvatarFrame: readProjectedAvatarFrame(data.senderAvatarFrame) }
      : {}),
    kind: data.kind,
    text: data.text,
    ...(isNonEmptyString(data.replyToMessageId) ? { replyToMessageId: data.replyToMessageId } : {}),
    status: data.status,
    revision: data.revision,
    createdAtMs: timestampToMillis(data.createdAtMs ?? data.createdAt),
    updatedAtMs: timestampToMillis(data.updatedAtMs ?? data.updatedAt),
  };
}

function isRoomMessageKind(value: unknown): value is RoomMessageKind {
  return value === 'chat'
    || value === 'system'
    || value === 'gift'
    || value === 'game'
    || value === 'entry'
    || value === 'moderation';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function timestampToMillis(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!isRecord(value)) return undefined;
  if (typeof value.toMillis === 'function') {
    const millis = value.toMillis.call(value);
    return typeof millis === 'number' && Number.isFinite(millis) ? millis : undefined;
  }
  if (typeof value.seconds !== 'number' || !Number.isFinite(value.seconds)) return undefined;
  const nanoseconds = typeof value.nanoseconds === 'number' && Number.isFinite(value.nanoseconds)
    ? value.nanoseconds
    : 0;
  return value.seconds * 1_000 + Math.floor(nanoseconds / 1_000_000);
}
