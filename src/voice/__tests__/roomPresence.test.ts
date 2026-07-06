import { describe, expect, it } from 'vitest';

import { VoiceRoom } from '../../types/voice';
import { applyRoomPresence, isRoomPresenceFresh, mapRoomPresenceDocument } from '../roomPresence';

const room: VoiceRoom = {
  id: 'room-1',
  title: 'Room',
  hostId: 'uid-host',
  type: 'voice',
  status: 'active',
  participantCount: 2,
  speakers: [
    {
      id: 'uid-host',
      displayName: 'Host',
      avatarLabel: 'H',
      role: 'host',
      canPublishAudio: true,
    },
  ],
  listeners: [
    {
      id: 'uid-old',
      displayName: 'Old listener',
      avatarLabel: 'O',
      role: 'listener',
      canPublishAudio: false,
    },
  ],
};

describe('roomPresence', () => {
  it('maps Firestore presence documents with timestamp-like values', () => {
    const presence = mapRoomPresenceDocument({
      uid: 'uid-1',
      displayName: 'Dana',
      avatarLabel: 'D',
      role: 'speaker',
      status: 'online',
      canPublishAudio: true,
      lastSeenAt: { toMillis: () => 1_000 },
    });

    expect(presence).toEqual({
      uid: 'uid-1',
      displayName: 'Dana',
      avatarLabel: 'D',
      role: 'speaker',
      status: 'online',
      canPublishAudio: true,
      lastSeenAtMs: 1_000,
    });
  });

  it('rejects stale or malformed presence as fresh', () => {
    const online = mapRoomPresenceDocument({
      uid: 'uid-1',
      displayName: 'Dana',
      avatarLabel: 'D',
      role: 'listener',
      status: 'online',
      canPublishAudio: false,
      lastSeenAt: 1_000,
    });
    const stale = mapRoomPresenceDocument({
      uid: 'uid-1',
      displayName: 'Dana',
      avatarLabel: 'D',
      role: 'listener',
      status: 'stale',
      canPublishAudio: false,
      lastSeenAt: 1_000,
    });

    expect(online).not.toBeNull();
    expect(isRoomPresenceFresh(online!, 40_000)).toBe(true);
    expect(isRoomPresenceFresh(online!, 60_000)).toBe(false);
    expect(stale).not.toBeNull();
    expect(isRoomPresenceFresh(stale!, 2_000)).toBe(false);
    expect(mapRoomPresenceDocument({ uid: 'uid-1', status: 'online' })).toBeNull();
  });

  it('derives speakers, listeners, and counts from fresh presence', () => {
    const updatedRoom = applyRoomPresence(
      room,
      [
        {
          uid: 'uid-host',
          displayName: 'Host',
          avatarLabel: 'H',
          role: 'host',
          status: 'online',
          canPublishAudio: true,
          lastSeenAtMs: 10_000,
        },
        {
          uid: 'uid-2',
          displayName: 'Nora',
          avatarLabel: 'N',
          role: 'listener',
          status: 'online',
          canPublishAudio: false,
          lastSeenAtMs: 10_000,
        },
        {
          uid: 'uid-stale',
          displayName: 'Gone',
          avatarLabel: 'G',
          role: 'speaker',
          status: 'online',
          canPublishAudio: true,
          lastSeenAtMs: -30_000,
        },
      ],
      20_000,
    );

    expect(updatedRoom.participantCount).toBe(2);
    expect(updatedRoom.speakers).toEqual([
      {
        id: 'uid-host',
        displayName: 'Host',
        avatarLabel: 'H',
        role: 'host',
        status: 'active',
        canPublishAudio: true,
      },
    ]);
    expect(updatedRoom.listeners).toEqual([
      {
        id: 'uid-2',
        displayName: 'Nora',
        avatarLabel: 'N',
        role: 'listener',
        status: 'active',
        canPublishAudio: false,
      },
    ]);
  });

  it('falls back to room membership data when no fresh presence exists', () => {
    expect(applyRoomPresence(room, [], 20_000)).toBe(room);
  });
});
