import { VoiceRoom, VoiceRoomType } from '../types/voice';

type CreateMockVoiceRoomDraftInput = {
  type: VoiceRoomType;
  id?: string;
  title?: string;
};

const localHost = {
  id: 'local-host',
  displayName: 'أنت',
  avatarLabel: 'أ',
};

export function createMockVoiceRoomDraft({
  id,
  title,
  type,
}: CreateMockVoiceRoomDraftInput): VoiceRoom {
  return {
    id: id ?? `draft-${type}`,
    title: title ?? getDefaultDraftRoomTitle(type),
    hostId: localHost.id,
    type,
    participantCount: 1,
    currentGameId: type === 'game' ? 'carrom-royal' : undefined,
    speakers: [localHost],
    listeners: [],
  };
}

export function getDefaultDraftRoomTitle(type: VoiceRoomType) {
  return type === 'game' ? 'مجموعة لعبة تجريبية' : 'مجموعة صوت تجريبية';
}
