import { MiniGameModeId } from './miniGame';

export type MainTabKey = 'home' | 'games' | 'groups';

export type RootStackParamList = {
  Login: undefined;
  EmailVerification: undefined;
  ProfileSetup: undefined;
  Main: undefined;
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
