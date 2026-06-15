export type VoiceRoomType = 'voice' | 'game';

export type VoiceRoomMember = {
  id: string;
  displayName: string;
  avatarLabel: string;
};

export type VoiceRoom = {
  id: string;
  title: string;
  hostId: string;
  type: VoiceRoomType;
  participantCount: number;
  speakers: VoiceRoomMember[];
  listeners: VoiceRoomMember[];
  currentGameId?: string;
};
