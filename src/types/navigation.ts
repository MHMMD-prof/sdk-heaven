import { MiniGameModeId } from './miniGame';

export type MainTabKey = 'home' | 'rooms' | 'chats' | 'games' | 'me';

/** Always includes chats — Wave 10 keeps the tab visible when DMs are dark. */
export const MAIN_SHELL_TAB_KEYS: readonly MainTabKey[] = ['home', 'rooms', 'chats', 'games', 'me'];


export type RootStackParamList = {
  Login: undefined;
  ProfileSetup: undefined;
  DeletionStatus: undefined;
  AccountSettings: undefined;
  CosmeticsLab: undefined;
  MeProfile: undefined;
  Friends: undefined;
  Following: { tab?: 'following' | 'followers'; uid?: string } | undefined;
  BlockedUsers: undefined;
  Couples: undefined;
  Families: undefined;
  NotificationSettings: undefined;
  Gifts: { targetUid?: string };
  WalletStore: undefined;
  Store: undefined;
  MyItems: undefined;
  Leaderboards: undefined;
  RepresentativeTransfer: undefined;
  Main: undefined;
  DirectChat: {
    source?: 'deep-link' | 'inbox' | 'notification' | 'profile' | 'room';
    targetUid: string;
  };
  UserProfile: {
    uid: string;
  };
  UsersDiscovery: undefined;
  MiniGame: {
    displayName?: string;
    hostUid?: string;
    initialMode?: MiniGameModeId;
    mode?: 'online' | 'local';
    playerId?: string;
    roomId?: string;
    sessionId?: string;
    source?: 'games' | 'voice-room';
  };
  Carrom: {
    roomId?: string;
    sessionId?: string;
    source?: 'games' | 'voice-room';
  };
  DrawingGuess: {
    displayName?: string;
    hostUid?: string;
    playerId?: string;
    roomId?: string;
    sessionId?: string;
    source?: 'games' | 'voice-room';
    mode?: 'online' | 'local-simulated';
  };
  VoiceRoom: {
    roomId: string;
  };
};
