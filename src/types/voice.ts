export type VoiceRoomType = 'voice' | 'game';
export type VoiceRoomStatus = 'active' | 'closed';
export type VoiceRoomMemberRole = 'host' | 'speaker' | 'listener';
export type VoiceRoomMemberStatus = 'active' | 'removed';

export type VoiceRoomMember = {
  id: string;
  displayName: string;
  avatarLabel: string;
  role?: VoiceRoomMemberRole;
  status?: VoiceRoomMemberStatus;
  canPublishAudio?: boolean;
};

export type VoiceRoom = {
  id: string;
  title: string;
  hostId: string;
  type: VoiceRoomType;
  status?: VoiceRoomStatus;
  participantCount: number;
  speakers: VoiceRoomMember[];
  listeners: VoiceRoomMember[];
  localMember?: VoiceRoomMember;
  currentGameId?: string;
};
