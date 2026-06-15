import { describe, expect, it } from 'vitest';

import { VoiceRoom } from '../../types/voice';
import { mapVoiceRoomToMockParticipants } from '../mapVoiceRoomToMockParticipants';

const room: VoiceRoom = {
  id: 'room-1',
  title: 'Test Room',
  hostId: 'host-1',
  type: 'voice',
  participantCount: 3,
  speakers: [
    { id: 'host-1', displayName: 'Host', avatarLabel: 'H' },
    { id: 'speaker-1', displayName: 'Speaker', avatarLabel: 'S' },
  ],
  listeners: [{ id: 'listener-1', displayName: 'Listener', avatarLabel: 'L' }],
};

describe('mapVoiceRoomToMockParticipants', () => {
  it('maps room members to voice participant roles', () => {
    const participants = mapVoiceRoomToMockParticipants(room);

    expect(participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'host-1', role: 'host', isSpeaking: true }),
        expect.objectContaining({ id: 'speaker-1', role: 'speaker', isSpeaking: false }),
        expect.objectContaining({ id: 'listener-1', role: 'listener', isMuted: true }),
      ]),
    );
  });

  it('appends the local user as a listener', () => {
    const participants = mapVoiceRoomToMockParticipants(room);

    expect(participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'local-user', role: 'listener', isMuted: false }),
      ]),
    );
  });

  it('does not duplicate the local user when already present', () => {
    const roomWithLocalUser: VoiceRoom = {
      ...room,
      listeners: [
        ...room.listeners,
        { id: 'local-user', displayName: 'Local', avatarLabel: 'L' },
      ],
    };
    const participants = mapVoiceRoomToMockParticipants(roomWithLocalUser);

    expect(participants.filter((item) => item.id === 'local-user')).toHaveLength(1);
  });

  it('falls back to only the local user without a room snapshot', () => {
    expect(mapVoiceRoomToMockParticipants()).toEqual([
      expect.objectContaining({ id: 'local-user', role: 'listener' }),
    ]);
  });
});
