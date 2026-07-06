import { VoiceRoom, VoiceRoomMember, VoiceRoomType } from '../types/voice';

type CreateMockVoiceRoomDraftInput = {
  type: VoiceRoomType;
  host?: VoiceRoomMember;
  id?: string;
  title?: string;
};

const localHost = {
  id: 'local-host',
  displayName: 'أنت',
  avatarLabel: 'أ',
};

export function createMockVoiceRoomDraft({
  host = localHost,
  id,
  title,
  type,
}: CreateMockVoiceRoomDraftInput): VoiceRoom {
  return {
    id: id ?? `draft-${type}`,
    title: title ?? getDefaultDraftRoomTitle(type),
    hostId: host.id,
    type,
    participantCount: 1,
    currentGameId: type === 'game' ? 'carrom-royal' : undefined,
    speakers: [host],
    listeners: [],
  };
}

export function getDefaultDraftRoomTitle(type: VoiceRoomType) {
  return type === 'game' ? 'مجموعة لعبة تجريبية' : 'مجموعة صوت تجريبية';
}
