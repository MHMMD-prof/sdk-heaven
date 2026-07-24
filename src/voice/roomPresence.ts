import { VoiceRoom, VoiceRoomMember, VoiceRoomMemberRole } from '../types/voice';

export type RoomPresenceStatus = 'online' | 'reconnecting' | 'stale';

export type RoomPresenceDocument = {
  uid: string;
  displayName: string;
  avatarLabel: string;
  role: VoiceRoomMemberRole;
  status: RoomPresenceStatus;
  canPublishAudio: boolean;
  lastSeenAtMs: number;
  leaseExpiresAtMs?: number;
  sessionId?: string;
};

export const ROOM_PRESENCE_FRESH_MS = 45_000;

type TimestampLike = {
  toMillis: () => number;
};

export function mapRoomPresenceDocument(data: unknown): RoomPresenceDocument | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const candidate = data as Record<string, unknown>;
  const lastSeenAtMs = readTimestampMs(candidate.lastSeenAt);

  if (
    typeof candidate.uid !== 'string' ||
    typeof candidate.displayName !== 'string' ||
    typeof candidate.avatarLabel !== 'string' ||
    (candidate.role !== 'host' && candidate.role !== 'speaker' && candidate.role !== 'listener') ||
    (candidate.status !== 'online' && candidate.status !== 'reconnecting' && candidate.status !== 'stale') ||
    typeof candidate.canPublishAudio !== 'boolean' ||
    lastSeenAtMs === null
  ) {
    return null;
  }

  const leaseExpiresAtMs = readTimestampMs(candidate.leaseExpiresAt);
  return {
    uid: candidate.uid,
    displayName: candidate.displayName,
    avatarLabel: candidate.avatarLabel,
    role: candidate.role,
    status: candidate.status,
    canPublishAudio: candidate.canPublishAudio,
    lastSeenAtMs,
    ...(leaseExpiresAtMs !== null ? { leaseExpiresAtMs } : {}),
    ...(typeof candidate.sessionId === 'string' ? { sessionId: candidate.sessionId } : {}),
  };
}

export function isRoomPresenceFresh(
  presence: RoomPresenceDocument,
  nowMs = Date.now(),
  freshMs = ROOM_PRESENCE_FRESH_MS,
) {
  return presence.status === 'online'
    && nowMs - presence.lastSeenAtMs <= freshMs
    && (presence.leaseExpiresAtMs === undefined || presence.leaseExpiresAtMs > nowMs);
}

export function applyRoomPresence(
  room: VoiceRoom,
  presenceDocuments: RoomPresenceDocument[],
  nowMs = Date.now(),
): VoiceRoom {
  const freshMembers = presenceDocuments
    .filter((presence) => isRoomPresenceFresh(presence, nowMs))
    .map(mapPresenceToVoiceRoomMember);

  if (freshMembers.length === 0) {
    return room;
  }

  const uniqueMembers = freshMembers.filter(
    (member, index, allMembers) => allMembers.findIndex((candidate) => candidate.id === member.id) === index,
  );
  const speakers = uniqueMembers.filter((member) => member.role === 'host' || member.role === 'speaker');
  const listeners = uniqueMembers.filter((member) => member.role === 'listener');

  return {
    ...room,
    participantCount: uniqueMembers.length,
    speakers,
    listeners,
  };
}

function mapPresenceToVoiceRoomMember(presence: RoomPresenceDocument): VoiceRoomMember {
  return {
    id: presence.uid,
    displayName: presence.displayName,
    avatarLabel: presence.avatarLabel,
    role: presence.role,
    status: 'active',
    canPublishAudio: presence.canPublishAudio,
  };
}

function readTimestampMs(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (isTimestampLike(value)) {
    return value.toMillis();
  }

  return null;
}

function isTimestampLike(value: unknown): value is TimestampLike {
  return (
    !!value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as TimestampLike).toMillis === 'function'
  );
}
