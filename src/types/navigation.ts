import { MiniGameModeId } from './miniGame';

export type MainTabKey = 'home' | 'rooms' | 'chats' | 'games' | 'me';

export type RootStackParamList = {
  Login: undefined;
  ProfileSetup: undefined;
  AccountSettings: undefined;
  CosmeticsLab: undefined;
  MeProfile: undefined;
  Friends: undefined;
  Couples: undefined;
  NotificationSettings: undefined;
  Gifts: { targetUid?: string };
  WalletStore: undefined;
  Store: undefined;
  MyItems: undefined;
  RepresentativeTransfer: undefined;
  Main: undefined;
  DirectChat: {
    source?: 'deep-link' | 'inbox' | 'profile' | 'room';
    targetUid: string;
  };
  UserProfile: {
    uid: string;
  };
  UsersDiscovery: undefined;
  MiniGame: {
    initialMode?: MiniGameModeId;
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
