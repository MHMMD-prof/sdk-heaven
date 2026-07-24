import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = new Map<string, string>();

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(storage.get(key) ?? null)),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
      return Promise.resolve();
    }),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    }),
  },
}));

import { VoiceRoom } from '../../types/voice';
import {
  createVisitedRoomSummary,
  decodeVisitedRooms,
  encodeVisitedRooms,
  getVisitedRoomsStorageKey,
  loadVisitedRooms,
  removeVisitedRoom,
  saveVisitedRooms,
  shouldApplyVisitedRoomsForUser,
  upsertVisitedRoom,
} from '../visitedRooms';

const room: VoiceRoom = {
  id: 'room-1',
  title: 'Room',
  hostId: 'host-1',
  type: 'voice',
  countryCode: 'IQ',
  visibility: 'private',
  inviteCode: 'SECRET1',
  participantCount: 2,
  speakers: [{ id: 'host-1', displayName: 'Salem', avatarLabel: 'S' }],
  listeners: [],
};

describe('visitedRooms', () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
  });

  it('creates sanitized summaries without persisting private invite codes', () => {
    const summary = createVisitedRoomSummary(room, 100);
    const encoded = encodeVisitedRooms([summary]);

    expect(summary).toMatchObject({
      id: 'room-1',
      hostDisplayName: 'Salem',
      countryCode: 'IQ',
      visibility: 'private',
      lastVisitedAt: 100,
    });
    expect(encoded).not.toContain('SECRET1');
  });

  it('deduplicates, sorts, caps, and removes visit history', () => {
    const firstVisit = createVisitedRoomSummary(room, 100);
    const secondVisit = createVisitedRoomSummary({ ...room, title: 'Updated' }, 200);
    const otherVisit = createVisitedRoomSummary({ ...room, id: 'room-2' }, 150);
    const visits = upsertVisitedRoom([firstVisit, otherVisit], secondVisit, 2);

    expect(visits.map((visit) => [visit.id, visit.title])).toEqual([
      ['room-1', 'Updated'],
      ['room-2', 'Room'],
    ]);
    expect(removeVisitedRoom(visits, 'room-1').map((visit) => visit.id)).toEqual(['room-2']);
  });

  it('keeps storage isolated per user and round-trips valid summaries', async () => {
    const summary = createVisitedRoomSummary(room, 100);

    await expect(saveVisitedRooms('uid-1', [summary])).resolves.toBe(true);
    await expect(loadVisitedRooms('uid-1')).resolves.toEqual([summary]);
    await expect(loadVisitedRooms('uid-2')).resolves.toEqual([]);
    expect(getVisitedRoomsStorageKey('uid-1')).not.toBe(getVisitedRoomsStorageKey('uid-2'));
  });

  it('rejects stale visit completions after an account switch', () => {
    expect(shouldApplyVisitedRoomsForUser('uid-a', 'uid-a')).toBe(true);
    expect(shouldApplyVisitedRoomsForUser('uid-a', 'uid-b')).toBe(false);
    expect(shouldApplyVisitedRoomsForUser('uid-a', undefined)).toBe(false);
  });

  it('drops malformed entries and clears corrupt storage envelopes', async () => {
    const summary = createVisitedRoomSummary(room, 100);
    const mixed = JSON.stringify({ version: 1, rooms: [summary, { id: 'bad' }] });

    expect(decodeVisitedRooms(mixed)).toEqual([summary]);
    expect(decodeVisitedRooms('{bad')).toBeUndefined();

    const key = getVisitedRoomsStorageKey('uid-1');
    storage.set(key, '{bad');
    await expect(loadVisitedRooms('uid-1')).resolves.toEqual([]);
    expect(storage.has(key)).toBe(false);
  });
});
