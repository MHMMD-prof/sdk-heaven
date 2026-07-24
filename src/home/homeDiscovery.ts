import type { RoomCountryCode, VoiceRoom } from '../types/voice';
import type { VisitedRoomSummary } from '../voice/visitedRooms';

export type HomeMode = 'activity' | 'popular' | 'visited';
export type HomeQuickFilter = 'all' | 'popular' | 'voice' | 'game';
export type HomeCountryFilter = 'all' | RoomCountryCode;

export type HomeDiscoveryOptions = {
  mode: HomeMode;
  quickFilter: HomeQuickFilter;
  country: HomeCountryFilter;
  searchQuery: string;
  visitedRooms?: readonly VisitedRoomSummary[];
};

export function getCreateRoomDefaultCountry(country: HomeCountryFilter): RoomCountryCode {
  return country === 'all' ? 'IQ' : country;
}

export function toggleHomeQuickFilter(
  currentFilter: HomeQuickFilter,
  selectedFilter: Exclude<HomeQuickFilter, 'all'>,
): HomeQuickFilter {
  return currentFilter === selectedFilter ? 'all' : selectedFilter;
}

const ARABIC_DIACRITICS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g;
const TATWEEL = /\u0640/g;
const WHITESPACE = /\s+/g;

/**
 * Produces a forgiving search key while retaining non-Arabic letters and digits.
 * Arabic presentation differences that users rarely type consistently are folded
 * into the same representation.
 */
export function normalizeArabicSearchText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(ARABIC_DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(WHITESPACE, ' ')
    .trim();
}

export function getVoiceRoomHostName(room: VoiceRoom) {
  const members = [...room.speakers, ...room.listeners];
  return members.find((member) => member.id === room.hostId)?.displayName ?? room.speakers[0]?.displayName ?? '';
}

export function mapVisitedRoomToVoiceRoom(room: VisitedRoomSummary): VoiceRoom {
  return {
    id: room.id,
    title: room.title,
    hostId: room.hostId,
    type: room.type,
    countryCode: room.countryCode,
    status: 'active',
    visibility: room.visibility,
    participantCount: room.participantCount,
    speakers: [
      {
        id: room.hostId,
        displayName: room.hostDisplayName,
        avatarLabel: room.hostAvatarLabel,
        role: 'host',
      },
    ],
    listeners: [],
  };
}

export function sortRoomsByActivity(rooms: readonly VoiceRoom[]) {
  return [...rooms].sort(compareByActivity);
}

export function sortRoomsByPopularity(rooms: readonly VoiceRoom[]) {
  return [...rooms].sort((left, right) => {
    return right.participantCount - left.participantCount || compareByActivity(left, right);
  });
}

export function sortRoomsByRecentVisit(
  rooms: readonly VoiceRoom[],
  visitedRooms: readonly VisitedRoomSummary[],
) {
  const lastVisitedAtById = new Map(visitedRooms.map((room) => [room.id, room.lastVisitedAt]));

  return [...rooms].sort((left, right) => {
    return (
      (lastVisitedAtById.get(right.id) ?? 0) - (lastVisitedAtById.get(left.id) ?? 0) ||
      compareByActivity(left, right)
    );
  });
}

/**
 * Applies all discovery controls in one pass. Public tabs never reveal private
 * rooms; the visited tab may include an active private room already known to the
 * signed-in user.
 */
export function selectHomeDiscoveryRooms(
  rooms: readonly VoiceRoom[],
  options: HomeDiscoveryOptions,
) {
  const visitedRooms = options.visitedRooms ?? [];
  const visitById = new Map(visitedRooms.map((room) => [room.id, room]));
  const visitedIds = new Set(visitById.keys());
  const normalizedQuery = normalizeArabicSearchText(options.searchQuery);
  const currentRoomById = new Map(rooms.map((room) => [room.id, room]));
  const sourceRooms =
    options.mode === 'visited'
      ? [...visitById.values()].map((room) => currentRoomById.get(room.id) ?? mapVisitedRoomToVoiceRoom(room))
      : rooms;

  const filteredRooms = sourceRooms.filter((room) => {
    if (room.status === 'closed') {
      return false;
    }

    if (options.mode === 'visited') {
      if (!visitedIds.has(room.id)) {
        return false;
      }
    } else if (room.visibility === 'private') {
      return false;
    }

    if (options.country !== 'all' && room.countryCode !== options.country) {
      return false;
    }

    if (options.quickFilter === 'voice' && room.type !== 'voice') {
      return false;
    }

    if (options.quickFilter === 'game' && room.type !== 'game') {
      return false;
    }

    if (normalizedQuery) {
      const visit = visitById.get(room.id);
      const normalizedTitle = normalizeArabicSearchText(room.title);
      const normalizedHost = normalizeArabicSearchText(getVoiceRoomHostName(room) || visit?.hostDisplayName || '');

      if (!normalizedTitle.includes(normalizedQuery) && !normalizedHost.includes(normalizedQuery)) {
        return false;
      }
    }

    return true;
  });

  if (options.mode === 'visited') {
    return sortRoomsByRecentVisit(filteredRooms, visitedRooms);
  }

  if (options.mode === 'popular' || options.quickFilter === 'popular') {
    return sortRoomsByPopularity(filteredRooms);
  }

  return sortRoomsByActivity(filteredRooms);
}

export function getRoomArtVariant(roomId: string, variantCount = 4) {
  if (!Number.isInteger(variantCount) || variantCount <= 0) {
    throw new RangeError('variantCount must be a positive integer.');
  }

  let hash = 2166136261;

  for (let index = 0; index < roomId.length; index += 1) {
    hash ^= roomId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) % variantCount;
}

function compareByActivity(left: VoiceRoom, right: VoiceRoom) {
  return (
    getActivityTimestamp(right) - getActivityTimestamp(left) ||
    right.participantCount - left.participantCount ||
    left.id.localeCompare(right.id)
  );
}

function getActivityTimestamp(room: VoiceRoom) {
  return room.updatedAtMs ?? room.createdAtMs ?? 0;
}
