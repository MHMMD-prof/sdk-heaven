import { describe, expect, it } from 'vitest';

import type { VoiceRoom } from '../../types/voice';
import type { VisitedRoomSummary } from '../../voice/visitedRooms';
import {
  getCreateRoomDefaultCountry,
  getRoomArtVariant,
  mapVisitedRoomToVoiceRoom,
  normalizeArabicSearchText,
  selectHomeDiscoveryRooms,
  sortRoomsByActivity,
  sortRoomsByPopularity,
  sortRoomsByRecentVisit,
  toggleHomeQuickFilter,
} from '../homeDiscovery';

function createRoom(
  id: string,
  overrides: Partial<VoiceRoom> = {},
): VoiceRoom {
  const hostId = overrides.hostId ?? `host-${id}`;

  return {
    id,
    title: `غرفة ${id}`,
    hostId,
    type: 'voice',
    status: 'active',
    visibility: 'public',
    participantCount: 1,
    speakers: [{ id: hostId, displayName: `مضيف ${id}`, avatarLabel: id.slice(0, 1) }],
    listeners: [],
    ...overrides,
  };
}

function createVisit(
  room: VoiceRoom,
  lastVisitedAt: number,
): VisitedRoomSummary {
  return {
    id: room.id,
    title: room.title,
    hostId: room.hostId,
    hostDisplayName: room.speakers[0]?.displayName ?? '',
    hostAvatarLabel: room.speakers[0]?.avatarLabel ?? '',
    type: room.type,
    countryCode: room.countryCode,
    visibility: room.visibility ?? 'public',
    participantCount: room.participantCount,
    lastVisitedAt,
  };
}

const defaultOptions = {
  mode: 'activity' as const,
  quickFilter: 'all' as const,
  country: 'all' as const,
  searchQuery: '',
  visitedRooms: [] as VisitedRoomSummary[],
};

describe('home discovery', () => {
  it('resolves creation defaults and toggles quick filters without stale state', () => {
    expect(getCreateRoomDefaultCountry('all')).toBe('IQ');
    expect(getCreateRoomDefaultCountry('SA')).toBe('SA');
    expect(toggleHomeQuickFilter('all', 'popular')).toBe('popular');
    expect(toggleHomeQuickFilter('popular', 'popular')).toBe('all');
    expect(toggleHomeQuickFilter('popular', 'voice')).toBe('voice');
  });

  it('normalizes Arabic diacritics, elongation, alef variants, and whitespace for search', () => {
    expect(normalizeArabicSearchText('  مَــجْلِسُ   الإِخْوَة  ')).toBe('مجلس الاخوه');
    expect(normalizeArabicSearchText('فتى رؤيا بيئة')).toBe('فتي رويا بييه');
  });

  it('searches normalized Arabic room titles and host names', () => {
    const titleMatch = createRoom('title', { title: 'سَهرةُ الأصدقاء' });
    const hostMatch = createRoom('host', {
      title: 'حديث المساء',
      speakers: [{ id: 'host-host', displayName: 'إيـمَان', avatarLabel: 'إ' }],
    });
    const miss = createRoom('miss', { title: 'مسابقة اليوم' });

    expect(
      selectHomeDiscoveryRooms([titleMatch, hostMatch, miss], {
        ...defaultOptions,
        searchQuery: 'سهره',
      }).map((room) => room.id),
    ).toEqual(['title']);
    expect(
      selectHomeDiscoveryRooms([titleMatch, hostMatch, miss], {
        ...defaultOptions,
        searchQuery: 'ايمان',
      }).map((room) => room.id),
    ).toEqual(['host']);
  });

  it('composes active, country, type, and visibility filters', () => {
    const iraqVoice = createRoom('iraq-voice', { countryCode: 'IQ' });
    const iraqGame = createRoom('iraq-game', { countryCode: 'IQ', type: 'game' });
    const saudiGame = createRoom('saudi-game', { countryCode: 'SA', type: 'game' });
    const closedGame = createRoom('closed-game', { countryCode: 'IQ', status: 'closed', type: 'game' });
    const privateGame = createRoom('private-game', { countryCode: 'IQ', visibility: 'private', type: 'game' });
    const legacyGame = createRoom('legacy-game', { type: 'game' });

    const rooms = [iraqVoice, iraqGame, saudiGame, closedGame, privateGame, legacyGame];

    expect(
      selectHomeDiscoveryRooms(rooms, {
        ...defaultOptions,
        country: 'IQ',
        quickFilter: 'game',
      }).map((room) => room.id),
    ).toEqual(['iraq-game']);
    expect(
      selectHomeDiscoveryRooms(rooms, {
        ...defaultOptions,
        quickFilter: 'game',
      }).map((room) => room.id),
    ).toEqual(['iraq-game', 'legacy-game', 'saudi-game']);
  });

  it('orders activity by update time and popularity by participants with stable tie-breaks', () => {
    const olderPopular = createRoom('c', { participantCount: 12, updatedAtMs: 100 });
    const newerQuiet = createRoom('b', { participantCount: 2, updatedAtMs: 300 });
    const newerPopular = createRoom('a', { participantCount: 12, updatedAtMs: 200 });

    expect(sortRoomsByActivity([olderPopular, newerQuiet, newerPopular]).map((room) => room.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
    expect(sortRoomsByPopularity([olderPopular, newerQuiet, newerPopular]).map((room) => room.id)).toEqual([
      'a',
      'c',
      'b',
    ]);
    expect(
      selectHomeDiscoveryRooms([olderPopular, newerQuiet, newerPopular], {
        ...defaultOptions,
        quickFilter: 'popular',
      }).map((room) => room.id),
    ).toEqual(['a', 'c', 'b']);
  });

  it('shows visited rooms in recent order, including private and locally cached rooms', () => {
    const first = createRoom('first', { updatedAtMs: 300 });
    const second = createRoom('second', { updatedAtMs: 100, visibility: 'private' });
    const neverVisited = createRoom('never');
    const cached = createRoom('cached', { countryCode: 'DZ', visibility: 'private' });
    const cachedVisit = createVisit(cached, 700);
    const visits = [createVisit(first, 100), createVisit(second, 500), cachedVisit];

    expect(sortRoomsByRecentVisit([first, second], visits).map((room) => room.id)).toEqual(['second', 'first']);
    expect(
      selectHomeDiscoveryRooms([first, second, neverVisited], {
        ...defaultOptions,
        mode: 'visited',
        visitedRooms: visits,
      }).map((room) => room.id),
    ).toEqual(['cached', 'second', 'first']);
    expect(mapVisitedRoomToVoiceRoom(cachedVisit)).toMatchObject({
      id: 'cached',
      countryCode: 'DZ',
      visibility: 'private',
      speakers: [{ id: cached.hostId, displayName: cached.speakers[0].displayName }],
    });
  });

  it('returns an empty result when no room satisfies all filters', () => {
    const room = createRoom('only', { countryCode: 'YE', type: 'voice' });

    expect(
      selectHomeDiscoveryRooms([room], {
        ...defaultOptions,
        country: 'DZ',
        quickFilter: 'game',
        searchQuery: 'غير موجود',
      }),
    ).toEqual([]);
  });

  it('assigns deterministic, bounded art variants and rejects invalid variant counts', () => {
    const first = getRoomArtVariant('room-alpha', 6);

    expect(getRoomArtVariant('room-alpha', 6)).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(6);
    expect(() => getRoomArtVariant('room-alpha', 0)).toThrow(RangeError);
  });
});
