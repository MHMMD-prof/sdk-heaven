import { DrawingGuessState } from './types';

/** True once lobby identity should not be clobbered by an empty remounter. */
export const hasOnlineMatchProgress = (state: DrawingGuessState) =>
  (state.phase !== 'lobby' && state.phase !== 'idle')
  || Boolean(state.drawerId)
  || Boolean(state.privatePrompt)
  || Boolean(state.revealedPrompt)
  || state.strokes.length > 0
  || state.guesses.length > 0
  || state.roundNumber > 0
  || Object.keys(state.scores).some((playerId) => (state.scores[playerId] ?? 0) > 0);
