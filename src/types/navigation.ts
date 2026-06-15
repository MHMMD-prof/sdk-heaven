import { MiniGameModeId } from './miniGame';

export type MainTabKey = 'home' | 'games' | 'groups';

export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  MiniGame: {
    initialMode?: MiniGameModeId;
  };
  Carrom: undefined;
  VoiceRoom: {
    roomId: string;
  };
};
