import { describe, expect, it } from 'vitest';

import {
  createRoomDocument,
  createRoomMemberDocument,
  mapRoomDocument,
  mapRoomDocumentToVoiceRoom,
  mapRoomMemberDocument,
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

  it('maps Firestore room documents into the existing voice room shape', () => {
    const room = mapRoomDocument(
      {
        title: 'Room',
        type: 'voice',
        hostId: 'uid-1',
        hostDisplayName: 'Salem',
        hostAvatarLabel: 'S',
        status: 'active',
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
      participantCount: 2,
      speakers: [{ id: 'uid-1', displayName: 'Salem', avatarLabel: 'S', role: 'host' }],
      listeners: [{ id: 'uid-2', displayName: 'Dana', avatarLabel: 'D', role: 'listener' }],
    });
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
    expect(mapRoomMemberDocument({ uid: 'uid-1', role: 'owner' })).toBeNull();
    expect(normalizeRoomTitle('voice', 'x'.repeat(60))).toHaveLength(48);
  });
});
