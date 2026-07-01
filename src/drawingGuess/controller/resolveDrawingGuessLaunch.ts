import { createDrawingGuessRoomCode } from './createDrawingGuessRoomCode';
import {
  DrawingGuessRouteMode,
  DrawingGuessRouteParams,
  DrawingGuessRouteSource,
} from './drawingGuessControllerTypes';

export type ResolvedDrawingGuessLaunch = {
  roomCode: string;
  mode: DrawingGuessRouteMode;
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

  if (source === 'voice-room') {
    return {
      roomCode,
      mode,
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
    mode,
    source,
    title: mode === 'online' ? `Online room ${roomCode}` : 'Drawing Guess',
    subtitle:
      mode === 'online'
        ? 'Online room for private Drawing Guess play with committed strokes, guesses, and snapshots.'
        : 'Draw the prompt, race the guesses, and climb the scoreboard.',
  };
};
