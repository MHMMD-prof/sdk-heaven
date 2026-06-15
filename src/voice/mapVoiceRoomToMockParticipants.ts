import { VoiceRoom, VoiceRoomMember } from '../types/voice';
import { VoiceParticipant, VoiceParticipantRole } from './types';

const localUser: VoiceParticipant = {
  id: 'local-user',
  displayName: 'أنت',
  role: 'listener',
  isMuted: false,
  isSpeaking: false,
  avatarLabel: 'أ',
};

export function mapVoiceRoomToMockParticipants(room?: VoiceRoom): VoiceParticipant[] {
  if (!room) {
    return [localUser];
  }

  const roomParticipants = [
    ...room.speakers.map((member) => mapMemberToParticipant(member, getSpeakerRole(room, member))),
    ...room.listeners.map((member) => mapMemberToParticipant(member, 'listener')),
  ];
  const hasLocalUser = roomParticipants.some((participant) => participant.id === localUser.id);

  return hasLocalUser ? roomParticipants : [...roomParticipants, localUser];
}

function getSpeakerRole(room: VoiceRoom, member: VoiceRoomMember): VoiceParticipantRole {
  return member.id === room.hostId ? 'host' : 'speaker';
}

function mapMemberToParticipant(
  member: VoiceRoomMember,
  role: VoiceParticipantRole,
): VoiceParticipant {
  return {
    id: member.id,
    displayName: member.displayName,
    role,
    isMuted: role === 'listener',
    isSpeaking: role === 'host',
    avatarLabel: member.avatarLabel,
  };
}
