import { DrawingGuessEvent, DrawingGuessState } from './types';

export type DrawingGuessAuthority = {
  canStartRound(playerId: string): boolean;
  canChoosePrompt(playerId: string): boolean;
  canCommitStroke(playerId: string): boolean;
  canScoreGuess(playerId: string): boolean;
  reduceAuthoritativeEvent(event: DrawingGuessEvent): DrawingGuessEvent[];
};

export const createClientHostAuthority = (state: DrawingGuessState): DrawingGuessAuthority => ({
  canStartRound: (playerId) => state.hostId === playerId,
  canChoosePrompt: (playerId) => state.drawerId === playerId,
  canCommitStroke: (playerId) => state.drawerId === playerId,
  canScoreGuess: (playerId) => state.hostId === playerId,
  reduceAuthoritativeEvent: (event) => [event],
});
