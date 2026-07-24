import { describe, expect, it } from 'vitest';

import {
  canJoinRoomWithInvite,
  createRoomDocument,
  createRoomMemberDocument,
  isValidInviteCode,
  mapRoomDocument,
  mapRoomDocumentResult,
  mapRoomDocumentToVoiceRoom,
  mapRoomMemberDocument,
  normalizeInviteCode,
  normalizeRoomTitle,
  selectMostRecentRoomDocument,
  timestampToMillis,
} from '../roomProfile';

const authUser = {
  avatarLabel: 'S',
  displayName: 'Salem',
  email: 'salem@example.com',
  uid: 'uid-1',
};

describe('roomProfile', () => {
  it('creates room and host membership payloads from trusted auth profile data', () => {
    const room = createRoomDocument(
      'room-1',
      { type: 'game', title: '  Carrom  ', countryCode: 'IQ' },
      authUser,
    );
    const member = createRoomMemberDocument(authUser, 'host');

    expect(room).toMatchObject({
      schemaVersion: 2,
      id: 'room-1',
      title: 'Carrom',
      type: 'game',
      countryCode: 'IQ',
      hostId: 'uid-1',
      ownerUid: 'uid-1',
      hostDisplayName: 'Salem',
      hostAvatarLabel: 'S',
      status: 'active',
      visibility: 'public',
      participantCount: 1,
      revision: 1,
      availability: 'active',
      seatTargetCount: 10,
      seatMode: 'open',
      currentGameId: 'carrom-royal',
    });
    expect(member).toEqual({
      schemaVersion: 2,
      uid: 'uid-1',
      displayName: 'Salem',
      avatarLabel: 'S',
      role: 'host',
      canPublishAudio: true,
      status: 'active',
      authorityRole: 'owner',
      seatId: null,
      privileges: { canManageMusic: false },
    });
  });

  it('creates private room payloads with normalized invite codes', () => {
    const room = createRoomDocument(
      'room-private',
      { type: 'voice', title: 'Hidden', countryCode: 'SA', visibility: 'private', inviteCode: ' ab-c123 ' },
      authUser,
    );
    const member = createRoomMemberDocument(authUser, 'listener', ' ab-c123 ');

    expect(room).toMatchObject({
      id: 'room-private',
      title: 'Hidden',
      visibility: 'private',
      inviteCode: 'ABC123',
    });
    expect(member).toMatchObject({
      role: 'listener',
      inviteCodeUsed: 'ABC123',
    });
    expect(normalizeInviteCode(' room-42! ')).toBe('ROOM42');
    expect(isValidInviteCode('ABC123')).toBe(true);
    expect(isValidInviteCode('ABC')).toBe(false);
  });

  it('maps Firestore room documents into the existing voice room shape', () => {
    const room = mapRoomDocument(
      {
        title: 'Room',
        type: 'voice',
        countryCode: 'DZ',
        hostId: 'uid-1',
        hostDisplayName: 'Salem',
        hostAvatarLabel: 'S',
        status: 'active',
        visibility: 'private',
        inviteCode: 'ROOM123',
        participantCount: 2,
      },
      'room-1',
    );
    const member = mapRoomMemberDocument({
      uid: 'uid-2',
      displayName: 'Dana',
      avatarLabel: 'D',
      role: 'listener',
      status: 'active',
      canPublishAudio: false,
    });

    expect(room).not.toBeNull();
    expect(room).toMatchObject({
      schemaVersion: 1,
      ownerUid: 'uid-1',
      revision: 1,
      availability: 'active',
      seatTargetCount: 10,
      seatMode: 'open',
    });
    expect(member).not.toBeNull();
    expect(mapRoomDocumentToVoiceRoom(room!, [member!])).toMatchObject({
      id: 'room-1',
      hostId: 'uid-1',
      visibility: 'private',
      countryCode: 'DZ',
      inviteCode: 'ROOM123',
      participantCount: 2,
      speakers: [{ id: 'uid-1', displayName: 'Salem', avatarLabel: 'S', role: 'host' }],
      listeners: [{ id: 'uid-2', displayName: 'Dana', avatarLabel: 'D', role: 'listener' }],
    });
  });

  it('requires matching invite codes for new private room joins', () => {
    const room = createRoomDocument(
      'room-private',
      { type: 'voice', title: 'Hidden', countryCode: 'YE', visibility: 'private', inviteCode: 'ABC123' },
      authUser,
    );

    expect(canJoinRoomWithInvite(room, 'abc-123')).toBe(true);
    expect(canJoinRoomWithInvite(room, 'WRONG1')).toBe(false);
    expect(canJoinRoomWithInvite(room, undefined, true)).toBe(true);
    expect(canJoinRoomWithInvite({ ...room, visibility: 'public', inviteCode: undefined }, undefined)).toBe(true);
  });

  it('maps closed rooms and filters removed members from the UI room lists', () => {
    const room = mapRoomDocument(
      {
        id: 'room-1',
        title: 'Room',
        type: 'voice',
        hostId: 'uid-1',
        hostDisplayName: 'Salem',
        hostAvatarLabel: 'S',
        status: 'closed',
        participantCount: 2,
      },
      'room-1',
    );
    const member = mapRoomMemberDocument({
      uid: 'uid-2',
      displayName: 'Dana',
      avatarLabel: 'D',
      role: 'listener',
      status: 'removed',
      canPublishAudio: false,
    });

    expect(room?.status).toBe('closed');
    expect(mapRoomDocumentToVoiceRoom(room!, [member!]).listeners).toEqual([]);
  });

  it('maps Firestore timestamps and tolerates legacy or unsupported country values', () => {
    const baseRoom = {
      id: 'room-1',
      title: 'Room',
      type: 'voice',
      hostId: 'uid-1',
      hostDisplayName: 'Salem',
      hostAvatarLabel: 'S',
      status: 'active',
      participantCount: 1,
      createdAt: { toMillis: () => 1_234 },
      updatedAt: { seconds: 2, nanoseconds: 500_000_000 },
    } as const;

    expect(mapRoomDocument({ ...baseRoom, countryCode: 'IQ' })).toMatchObject({
      countryCode: 'IQ',
      createdAtMs: 1_234,
      updatedAtMs: 2_500,
    });
    expect(mapRoomDocument({ ...baseRoom, countryCode: 'SY' })?.countryCode).toBe('SY');
    expect(mapRoomDocument({ ...baseRoom, countryCode: 'LB' })?.countryCode).toBe('LB');
    expect(mapRoomDocument(baseRoom)?.countryCode).toBeUndefined();
    expect(mapRoomDocument({ ...baseRoom, countryCode: 'US' })?.countryCode).toBeUndefined();
    expect(timestampToMillis(Number.NaN)).toBeUndefined();
  });

  it('selects the most recently created hosted room without mutating the source list', () => {
    const olderRoom = createRoomDocument(
      'room-older',
      { type: 'voice', title: 'Older', countryCode: 'IQ' },
      authUser,
    );
    const newerRoom = createRoomDocument(
      'room-newer',
      { type: 'voice', title: 'Newer', countryCode: 'SA' },
      authUser,
    );
    const rooms = [
      { ...olderRoom, createdAtMs: 100 },
      { ...newerRoom, createdAtMs: 200 },
    ];

    expect(selectMostRecentRoomDocument(rooms)?.id).toBe('room-newer');
    expect(rooms.map((room) => room.id)).toEqual(['room-older', 'room-newer']);
    expect(selectMostRecentRoomDocument([])).toBeUndefined();
  });

  it('rejects incomplete room documents and bounds generated titles', () => {
    expect(mapRoomDocument({ id: 'room-1', status: 'active' })).toBeNull();
    expect(
      mapRoomDocument({
        id: 'room-1',
        title: 'Private',
        type: 'voice',
        hostId: 'uid-1',
        hostDisplayName: 'Salem',
        hostAvatarLabel: 'S',
        status: 'active',
        visibility: 'private',
        participantCount: 1,
      }),
    ).toBeNull();
    expect(mapRoomMemberDocument({ uid: 'uid-1', role: 'owner' })).toBeNull();
    expect(normalizeRoomTitle('voice', 'x'.repeat(60))).toHaveLength(48);
  });

  it('strictly maps v2 rooms and explicitly identifies newer schemas', () => {
    const v2Room = createRoomDocument(
      'room-v2',
      { type: 'voice', title: 'V2 room', countryCode: 'IQ' },
      authUser,
    );

    expect(mapRoomDocumentResult(v2Room)).toMatchObject({
      status: 'ready',
      room: { schemaVersion: 2, ownerUid: 'uid-1' },
    });
    expect(mapRoomDocumentResult({ ...v2Room, schemaVersion: 3 })).toEqual({
      status: 'unsupported',
      schemaVersion: 3,
    });
    expect(mapRoomDocumentResult({ ...v2Room, ownerUid: 'forged' })).toEqual({ status: 'invalid' });
  });

  it('preserves server authority and audio state when refreshing an existing membership', () => {
    const refreshed = createRoomMemberDocument(authUser, 'speaker', undefined, {
      schemaVersion: 2,
      uid: 'uid-1',
      displayName: 'Salem',
      avatarLabel: 'S',
      role: 'speaker',
      status: 'active',
      canPublishAudio: false,
      authorityRole: 'moderator',
      seatId: '03',
      privileges: { canManageMusic: true },
      forceMuted: true,
    });

    expect(refreshed).toMatchObject({
      role: 'speaker',
      canPublishAudio: false,
      authorityRole: 'moderator',
      seatId: '03',
      privileges: { canManageMusic: true },
    });
  });
});
