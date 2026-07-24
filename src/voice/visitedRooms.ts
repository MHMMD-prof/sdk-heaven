import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  RoomCountryCode,
  VoiceRoom,
  VoiceRoomType,
  VoiceRoomVisibility,
} from '../types/voice';
import { isRoomCountryCode } from './roomProfile';

export const VISITED_ROOMS_LIMIT = 24;

export type VisitedRoomSummary = {
  id: string;
  title: string;
  hostId: string;
  hostDisplayName: string;
  hostAvatarLabel: string;
  type: VoiceRoomType;
  countryCode?: RoomCountryCode;
  visibility: VoiceRoomVisibility;
  participantCount: number;
  lastVisitedAt: number;
};

type VisitedRoomsEnvelope = {
  rooms: VisitedRoomSummary[];
  version: 1;
};

export function getVisitedRoomsStorageKey(userId: string) {
  return `sdk-heaven:voice-room-visits:v1:${userId}`;
}

export function shouldApplyVisitedRoomsForUser(
  capturedUserId: string | undefined,
  currentUserId: string | undefined,
) {
  return Boolean(capturedUserId && capturedUserId === currentUserId);
}

export function createVisitedRoomSummary(room: VoiceRoom, lastVisitedAt = Date.now()): VisitedRoomSummary {
  const host = room.speakers.find((member) => member.id === room.hostId) ?? room.speakers[0];

  return {
    id: room.id,
    title: room.title,
    hostId: room.hostId,
    hostDisplayName: host?.displayName || room.hostId,
    hostAvatarLabel: host?.avatarLabel || room.hostId.slice(0, 1).toUpperCase(),
    type: room.type,
    countryCode: room.countryCode,
    visibility: room.visibility ?? 'public',
    participantCount: Math.max(0, room.participantCount),
    lastVisitedAt,
  };
}

export function upsertVisitedRoom(
  rooms: VisitedRoomSummary[],
  room: VisitedRoomSummary,
  limit = VISITED_ROOMS_LIMIT,
) {
  return normalizeVisitedRooms([room, ...rooms], limit);
}

export function removeVisitedRoom(rooms: VisitedRoomSummary[], roomId: string) {
  return rooms.filter((room) => room.id !== roomId);
}

export function normalizeVisitedRooms(value: unknown, limit = VISITED_ROOMS_LIMIT): VisitedRoomSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueRooms = new Map<string, VisitedRoomSummary>();

  value.forEach((entry) => {
    const room = mapVisitedRoomSummary(entry);

    if (!room) {
      return;
    }

    const current = uniqueRooms.get(room.id);

    if (!current || room.lastVisitedAt > current.lastVisitedAt) {
      uniqueRooms.set(room.id, room);
    }
  });

  return [...uniqueRooms.values()]
    .sort((left, right) => right.lastVisitedAt - left.lastVisitedAt)
    .slice(0, Math.max(0, limit));
}

export function encodeVisitedRooms(rooms: VisitedRoomSummary[]) {
  return JSON.stringify({ rooms: normalizeVisitedRooms(rooms), version: 1 } satisfies VisitedRoomsEnvelope);
}

export function decodeVisitedRooms(rawValue: string | null): VisitedRoomSummary[] | undefined {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<VisitedRoomsEnvelope>;

    if (parsed.version !== 1 || !Array.isArray(parsed.rooms)) {
      return undefined;
    }

    return normalizeVisitedRooms(parsed.rooms);
  } catch {
    return undefined;
  }
}

export async function loadVisitedRooms(userId: string) {
  try {
    const storageKey = getVisitedRoomsStorageKey(userId);
    const rawValue = await AsyncStorage.getItem(storageKey);
    const rooms = decodeVisitedRooms(rawValue);

    if (rawValue && !rooms) {
      await AsyncStorage.removeItem(storageKey);
    }

    return rooms ?? [];
  } catch {
    return [];
  }
}

export async function saveVisitedRooms(userId: string, rooms: VisitedRoomSummary[]) {
  try {
    await AsyncStorage.setItem(getVisitedRoomsStorageKey(userId), encodeVisitedRooms(rooms));
    return true;
  } catch {
    return false;
  }
}

function mapVisitedRoomSummary(value: unknown): VisitedRoomSummary | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<VisitedRoomSummary>;

  if (
    typeof candidate.id !== 'string' ||
    !candidate.id ||
    typeof candidate.title !== 'string' ||
    !candidate.title ||
    typeof candidate.hostId !== 'string' ||
    !candidate.hostId ||
    typeof candidate.hostDisplayName !== 'string' ||
    !candidate.hostDisplayName ||
    typeof candidate.hostAvatarLabel !== 'string' ||
    !candidate.hostAvatarLabel ||
    (candidate.type !== 'voice' && candidate.type !== 'game') ||
    (candidate.visibility !== 'public' && candidate.visibility !== 'private') ||
    typeof candidate.participantCount !== 'number' ||
    !Number.isFinite(candidate.participantCount) ||
    typeof candidate.lastVisitedAt !== 'number' ||
    !Number.isFinite(candidate.lastVisitedAt) ||
    candidate.lastVisitedAt < 0
  ) {
    return null;
  }

  return {
    id: candidate.id,
    title: candidate.title,
    hostId: candidate.hostId,
    hostDisplayName: candidate.hostDisplayName,
    hostAvatarLabel: candidate.hostAvatarLabel,
    type: candidate.type,
    countryCode: isRoomCountryCode(candidate.countryCode) ? candidate.countryCode : undefined,
    visibility: candidate.visibility,
    participantCount: Math.max(0, candidate.participantCount),
    lastVisitedAt: candidate.lastVisitedAt,
  };
}
