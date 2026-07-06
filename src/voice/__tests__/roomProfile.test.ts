import { describe, expect, it } from 'vitest';

import {
  canJoinRoomWithInvite,
  createRoomDocument,
  createRoomMemberDocument,
  isValidInviteCode,
  mapRoomDocument,
  mapRoomDocumentToVoiceRoom,
  mapRoomMemberDocument,
  normalizeInviteCode,
  normalizeRoomTitle,
} from '../roomProfile';

const authUser = {
  avatarLabel: 'S',
  displayName: 'Salem',
  email: 'salem@example.com',
  emailVerified: true,
  uid: 'uid-1',
};

describe('roomProfile', () => {
  it('creates room and host membership payloads from trusted auth profile data', () => {
    const room = createRoomDocument('room-1', { type: 'game', title: '  Carrom  ' }, authUser);
    const member = createRoomMemberDocument(authUser, 'host');

    expect(room).toMatchObject({
      id: 'room-1',
      title: 'Carrom',
      type: 'game',
      hostId: 'uid-1',
      hostDisplayName: 'Salem',
      hostAvatarLabel: 'S',
      status: 'active',
      visibility: 'public',
      participantCount: 1,
      currentGameId: 'carrom-royal',
    });
    expect(member).toEqual({
      uid: 'uid-1',
      displayName: 'Salem',
      avatarLabel: 'S',
      role: 'host',
      canPublishAudio: true,
      status: 'active',
    });
  });

  it('creates private room payloads with normalized invite codes', () => {
    const room = createRoomDocument(
      'room-private',
      { type: 'voice', title: 'Hidden', visibility: 'private', inviteCode: ' ab-c123 ' },
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
    expect(member).not.toBeNull();
    expect(mapRoomDocumentToVoiceRoom(room!, [member!])).toMatchObject({
      id: 'room-1',
      hostId: 'uid-1',
      visibility: 'private',
      inviteCode: 'ROOM123',
      participantCount: 2,
      speakers: [{ id: 'uid-1', displayName: 'Salem', avatarLabel: 'S', role: 'host' }],
      listeners: [{ id: 'uid-2', displayName: 'Dana', avatarLabel: 'D', role: 'listener' }],
    });
  });

  it('requires matching invite codes for new private room joins', () => {
    const room = createRoomDocument(
      'room-private',
      { type: 'voice', title: 'Hidden', visibility: 'private', inviteCode: 'ABC123' },
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
});
