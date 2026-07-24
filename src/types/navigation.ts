import { MiniGameModeId } from './miniGame';

export type MainTabKey = 'home' | 'games' | 'groups' | 'me';

export type RootStackParamList = {
  Login: undefined;
  ProfileSetup: undefined;
  AccountSettings: undefined;
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
  UserProfile: {
    uid: string;
  };
  UsersDiscovery: undefined;
  MiniGame: {
    initialMode?: MiniGameModeId;
  };
  Carrom: undefined;
  DrawingGuess: {
    roomId?: string;
    source?: 'games' | 'voice-room';
    mode?: 'online' | 'local-simulated';
  };
  VoiceRoom: {
    roomId: string;
  };
};
