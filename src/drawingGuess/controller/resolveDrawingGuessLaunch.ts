import { createDrawingGuessRoomCode } from './createDrawingGuessRoomCode';
import { createDrawingGuessPlayerId } from './createDrawingGuessIds';
import {
  DrawingGuessRouteMode,
  DrawingGuessRouteParams,
  DrawingGuessRouteSource,
} from './drawingGuessControllerTypes';

export type ResolvedDrawingGuessLaunch = {
  displayName: string;
  roomCode: string;
  mode: DrawingGuessRouteMode;
  playerId: string;
  sessionId: string;
  source: DrawingGuessRouteSource;
  title: string;
  subtitle: string;
};

export const resolveDrawingGuessLaunch = (
  params: DrawingGuessRouteParams | undefined,
): ResolvedDrawingGuessLaunch => {
  const source = params?.source ?? 'games';
  const mode =
    params?.mode ?? (source === 'voice-room' && params?.roomId ? 'online' : 'local-simulated');
  const roomCode = params?.roomId ?? createDrawingGuessRoomCode();
  const playerId = params?.playerId?.trim() || createDrawingGuessPlayerId('local');
  const displayName = params?.displayName?.trim() || 'You';
  const sessionId = params?.sessionId?.trim() || '';

  if (source === 'voice-room') {
    return {
      roomCode,
      displayName,
      mode,
      playerId,
      sessionId,
      source,
      title: `Voice room ${roomCode}`,
      subtitle:
        mode === 'online'
          ? 'Using this voice room id for a separate Drawing Guess LiveKit game connection.'
          : 'Using this voice room id for a local Drawing Guess test room.',
    };
  }

  return {
    roomCode,
    displayName,
    mode,
    playerId,
    sessionId,
    source,
    title: mode === 'online' ? `Online room ${roomCode}` : 'Drawing Guess',
    subtitle:
      mode === 'online'
        ? 'Online room for private Drawing Guess play with committed strokes, guesses, and snapshots.'
        : 'Draw the prompt, race the guesses, and climb the scoreboard.',
  };
};
