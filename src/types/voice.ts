export type VoiceRoomType = 'voice' | 'game';
export type RoomCountryCode =
  | 'IQ'
  | 'SA'
  | 'SY'
  | 'LB'
  | 'YE'
  | 'DZ'
  | 'EG'
  | 'JO'
  | 'PS'
  | 'AE'
  | 'KW'
  | 'QA'
  | 'BH'
  | 'OM'
  | 'MA'
  | 'TN'
  | 'LY'
  | 'SD'
  | 'SO'
  | 'DJ'
  | 'MR'
  | 'KM';
export type VoiceRoomStatus = 'active' | 'closed';
export type VoiceRoomVisibility = 'public' | 'private';
export type VoiceRoomMemberRole = 'host' | 'speaker' | 'listener';
export type VoiceRoomMemberStatus = 'active' | 'removed';

export type VoiceRoomMember = {
  id: string;
  displayName: string;
  avatarLabel: string;
  role?: VoiceRoomMemberRole;
  status?: VoiceRoomMemberStatus;
  canPublishAudio?: boolean;
  authorityRole?: 'owner' | 'moderator' | 'member';
  representativeBadgeActive?: boolean;
  seatId?: string | null;
  privileges?: {
    canManageMusic: boolean;
  };
};

export type VoiceRoom = {
  id: string;
  title: string;
  hostId: string;
  ownerUid?: string;
  type: VoiceRoomType;
  countryCode?: RoomCountryCode;
  status?: VoiceRoomStatus;
  visibility?: VoiceRoomVisibility;
  inviteCode?: string;
  participantCount: number;
  speakerCount?: number;
  speakers: VoiceRoomMember[];
  listeners: VoiceRoomMember[];
  localMember?: VoiceRoomMember;
  currentGameId?: string;
  schemaVersion?: 1 | 2;
  revision?: number;
  ownershipRevision?: number;
  moderatorCount?: number;
  audioLockdown?: boolean;
  seatTargetCount?: 5 | 10 | 15 | 20;
  seatMode?: 'open' | 'request' | 'invite' | 'locked';
  announcement?: string;
  welcomeMessage?: string;
  themeId?: import('../voice/roomV2Contract').RoomThemeId;
  chatMode?: import('../voice/roomV2Contract').RoomChatMode;
  slowModeSeconds?: 0 | 5 | 10 | 30 | 60;
  historyVisibility?: import('../voice/roomV2Contract').RoomHistoryVisibility;
  keywordFilterMode?: import('../voice/roomV2Contract').RoomKeywordFilterMode;
  effectsPolicy?: import('../voice/roomV2Contract').RoomEffectsPolicy;
  roomImageReviewStatus?: import('../voice/roomV2Contract').RoomImageReviewStatus;
  roomCustomizationSuspended?: boolean;
  activeRoomImageId?: string;
  activeRoomImagePath?: string;
  pendingRoomImageId?: string;
  pendingRoomImagePath?: string;
  seats?: import('../voice/roomV2Contract').RoomSeatDocument[];
  createdAtMs?: number;
  updatedAtMs?: number;
};
