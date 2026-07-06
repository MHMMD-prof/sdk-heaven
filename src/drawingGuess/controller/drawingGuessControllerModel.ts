import { DRAWING_GUESS_RULES } from '../model/constants';
import {
  createInitialDrawingGuessState,
  drawingGuessReducer,
} from '../model/drawingGuessReducer';
import { DrawingGuessState } from '../model/types';
import { drawingGuessPromptCategoryLabels } from '../model/wordBank';
import {
  drawingGuessBrushColors,
  drawingGuessBrushWidths,
  drawingGuessEraserWidth,
  DrawingToolState,
} from '../rendering/drawingTools';
import { DrawingGuessViewModel } from './drawingGuessControllerTypes';

export const simulatedDrawingGuessPlayers = [
  {
    id: 'dg-player-sim-1',
    displayName: 'Maha',
    avatarLabel: 'M',
    role: 'player' as const,
    joinedAt: 2,
  },
  {
    id: 'dg-player-sim-2',
    displayName: 'Omar',
    avatarLabel: 'O',
    role: 'player' as const,
    joinedAt: 3,
  },
];

export const createLocalSimulatedDrawingGuessState = ({
  localPlayerId,
  matchId,
  now,
  roomCode,
}: {
  roomCode: string;
  localPlayerId: string;
  matchId: string;
  now: number;
}) => {
  let state = createInitialDrawingGuessState({ roomId: roomCode, matchId });

  state = drawingGuessReducer(state, {
    type: 'player-joined',
    player: {
      id: localPlayerId,
      displayName: 'You',
      avatarLabel: 'Y',
      role: 'player',
      joinedAt: now,
    },
  });

  simulatedDrawingGuessPlayers.forEach((player) => {
    state = drawingGuessReducer(state, {
      type: 'player-joined',
      player,
    });
  });

  return drawingGuessReducer(state, {
    type: 'connection-status-changed',
    status: 'connected',
  });
};

export const createOnlineDrawingGuessState = ({
  localPlayerId,
  matchId,
  now,
  roomCode,
}: {
  roomCode: string;
  localPlayerId: string;
  matchId: string;
  now: number;
}) => {
  let state = createInitialDrawingGuessState({ roomId: roomCode, matchId });

  state = drawingGuessReducer(state, {
    type: 'player-joined',
    player: {
      id: localPlayerId,
      displayName: 'You',
      avatarLabel: 'Y',
      role: 'player',
      joinedAt: now,
    },
  });

  return drawingGuessReducer(state, {
    type: 'connection-status-changed',
    status: 'connecting',
  });
};

export const createDrawingGuessViewModel = ({
  activeStroke,
  isRecoveringSnapshot = false,
  lastTransportError,
  launchSource = 'games',
  launchSubtitle,
  launchTitle,
  localPlayerId,
  now,
  previewStrokes = [],
  transportMode = 'mock',
  roomCode,
  state,
  toolState = createDefaultDrawingToolState(),
}: {
  state: DrawingGuessState;
  roomCode: string;
  localPlayerId: string;
  now: number;
  activeStroke?: DrawingGuessViewModel['activeStroke'];
  isRecoveringSnapshot?: boolean;
  lastTransportError?: string;
  launchSource?: DrawingGuessViewModel['launchSource'];
  launchTitle?: string;
  launchSubtitle?: string;
  previewStrokes?: DrawingGuessViewModel['previewStrokes'];
  transportMode?: DrawingGuessViewModel['transportMode'];
  toolState?: DrawingToolState;
}): DrawingGuessViewModel => {
  const isHost = state.hostId === localPlayerId;
  const isDrawer = state.drawerId === localPlayerId;
  const isShowcaseMode = transportMode === 'mock' && launchSource === 'games';
  const connectedPlayerCount = state.players.filter(
    (player) => player.isConnected && player.role === 'player',
  ).length;
  const remainingMs = state.roundEndsAt ? Math.max(0, state.roundEndsAt - now) : 0;
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const roundDurationMs =
    state.roundStartedAt && state.roundEndsAt
      ? Math.max(1, state.roundEndsAt - state.roundStartedAt)
      : DRAWING_GUESS_RULES.roundDurationMs;
  const elapsedMs = state.roundStartedAt ? Math.max(0, now - state.roundStartedAt) : 0;
  const roundProgress = Math.min(1, Math.max(0, elapsedMs / roundDurationMs));
  const timerUrgency = getTimerUrgency(remainingSeconds, state.phase);
  const hasLocalPlayerGuessedCorrectly = state.correctGuessPlayerIds.includes(localPlayerId);
  const canSubmitGuess =
    !isRecoveringSnapshot &&
    !isDrawer &&
    state.phase === 'drawing' &&
    state.eligibleGuesserIds.includes(localPlayerId) &&
    !hasLocalPlayerGuessedCorrectly;
  const playerNameById = Object.fromEntries(
    state.players.map((player) => [player.id, player.displayName]),
  );
  const drawerName = state.players.find((player) => player.id === state.drawerId)?.displayName;
  const finalRankings = createFinalRankings({
    localPlayerId,
    players: state.players,
    scores: state.scores,
  });
  const isFinalRound = state.roundNumber >= state.turnOrder.length && state.turnOrder.length > 0;
  const hasCurrentRoundDrawing = state.strokes.some((stroke) => stroke.revision === state.canvasRevision);

  return {
    phase: state.phase,
    roomCode,
    localPlayerId,
    isHost,
    isDrawer,
    promptTextForDrawer: isDrawer ? state.privatePrompt?.text : undefined,
    revealedPromptText: state.revealedPrompt?.text,
    phaseLabel: getDrawingGuessPhaseLabel(state.phase),
    drawerName,
    connectedPlayerCount,
    timerUrgency,
    roundProgress,
    isFinalRound,
    nextRoundLabel: isFinalRound ? 'Final scores' : 'Next round',
    localRoundStatusLabel: getLocalRoundStatusLabel({
      hasCurrentRoundDrawing,
      hasLocalPlayerGuessedCorrectly,
      isDrawer,
      state,
    }),
    timerLabel:
      state.phase === 'drawing'
        ? `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`
        : '1:00',
    players: state.players.map((player) => ({
      ...player,
      points: state.scores[player.id] ?? 0,
      isHost: state.hostId === player.id,
      isDrawer: state.drawerId === player.id,
      hasGuessedCorrectly: state.correctGuessPlayerIds.includes(player.id),
    })),
    leaderboard: finalRankings,
    scores: state.scores,
    canvasRevision: state.canvasRevision,
    strokes: state.strokes,
    previewStrokes,
    activeStroke,
    guesses: state.guesses,
    guessFeed: state.guesses.map((guess) => ({
      ...guess,
      playerName: playerNameById[guess.playerId] ?? 'Player',
      isLocalPlayer: guess.playerId === localPlayerId,
    })),
    selectedTool: toolState.selectedTool,
    brushColor: toolState.brushColor,
    brushWidth: toolState.brushWidth,
    eraserWidth: toolState.eraserWidth,
    availableBrushColors: drawingGuessBrushColors,
    availableBrushWidths: drawingGuessBrushWidths,
    promptOptions: state.promptOptions.map((prompt) => ({
      id: prompt.id,
      text: prompt.text,
      categoryLabel: drawingGuessPromptCategoryLabels[prompt.category],
    })),
    canStart:
      isHost &&
      state.phase === 'lobby' &&
      connectedPlayerCount >= DRAWING_GUESS_RULES.minPlayers,
    canChoosePrompt: isDrawer && state.phase === 'prompt-select',
    canDraw: !isRecoveringSnapshot && isDrawer && state.phase === 'drawing',
    canGuess: canSubmitGuess,
    canSubmitGuess,
    canAdvanceRound: isHost && state.phase === 'round-results',
    canEndRound: isHost && state.phase === 'drawing',
    isRecoveringSnapshot,
    transportMode,
    isOnlineRoom: transportMode === 'livekit',
    isShowcaseMode,
    showOnlineControls: !isShowcaseMode,
    canUseSimulatedGuessControls: !isShowcaseMode && transportMode === 'mock',
    eligibleGuesserIds: state.eligibleGuesserIds,
    roundScoreDeltas: state.roundScoreDeltas,
    hasLocalPlayerGuessedCorrectly,
    roundEndReason: state.roundEndReason,
    onlineStatusLabel: transportMode === 'livekit' ? 'Online LiveKit room' : 'Local game',
    launchTitle:
      launchTitle ??
      (isShowcaseMode ? 'Drawing Guess' : `${transportMode === 'livekit' ? 'Online' : 'Local'} room ${roomCode}`),
    launchSubtitle:
      launchSubtitle ??
      (isShowcaseMode
        ? 'Draw the prompt, race the guesses, and climb the scoreboard.'
        : transportMode === 'livekit'
          ? 'Online room for private Drawing Guess play with committed strokes, guesses, and snapshots.'
          : 'Local Drawing Guess room for offline play.'),
    launchSource,
    finalRankings,
    lastTransportError,
    connectionLabel:
      lastTransportError
        ? lastTransportError
        : isRecoveringSnapshot
          ? `Recovering ${transportMode === 'livekit' ? 'online' : 'local'} room`
          : getDrawingGuessConnectionLabel(state.connectionStatus, transportMode),
  };
};

const getTimerUrgency = (
  remainingSeconds: number,
  phase: DrawingGuessState['phase'],
): DrawingGuessViewModel['timerUrgency'] => {
  if (phase !== 'drawing') {
    return 'normal';
  }

  if (remainingSeconds <= 5) {
    return 'danger';
  }

  if (remainingSeconds <= 15) {
    return 'warning';
  }

  return 'normal';
};

const getLocalRoundStatusLabel = ({
  hasCurrentRoundDrawing,
  hasLocalPlayerGuessedCorrectly,
  isDrawer,
  state,
}: {
  state: DrawingGuessState;
  isDrawer: boolean;
  hasLocalPlayerGuessedCorrectly: boolean;
  hasCurrentRoundDrawing: boolean;
}) => {
  if (state.phase === 'drawing' && hasLocalPlayerGuessedCorrectly) {
    return 'Correct! Wait for the round reveal.';
  }

  if (state.phase === 'drawing' && isDrawer && hasCurrentRoundDrawing) {
    return 'Waiting for guesses.';
  }

  if (state.phase === 'drawing' && !isDrawer && !hasCurrentRoundDrawing) {
    return 'Waiting for the drawer.';
  }

  if (state.phase === 'round-results') {
    return 'Round revealed.';
  }

  return '';
};

export const createFinalRankings = ({
  localPlayerId,
  players,
  scores,
}: {
  localPlayerId: string;
  players: DrawingGuessState['players'];
  scores: DrawingGuessState['scores'];
}) =>
  [...players]
    .map((player) => ({
      playerId: player.id,
      displayName: player.displayName,
      avatarLabel: player.avatarLabel,
      points: scores[player.id] ?? 0,
      isLocalPlayer: player.id === localPlayerId,
    }))
    .sort(
      (left, right) =>
        right.points - left.points ||
        left.displayName.localeCompare(right.displayName) ||
        left.playerId.localeCompare(right.playerId),
    )
    .map((player, index) => ({
      ...player,
      rank: index + 1,
      isWinner: index === 0,
    }));

const getDrawingGuessPhaseLabel = (phase: DrawingGuessState['phase']) => {
  if (phase === 'lobby') {
    return 'Game setup';
  }

  if (phase === 'prompt-select') {
    return 'Secret prompt';
  }

  if (phase === 'drawing') {
    return 'Drawing round';
  }

  if (phase === 'round-results') {
    return 'Round result';
  }

  if (phase === 'match-results') {
    return 'Final scores';
  }

  return 'Drawing Guess';
};

export const createDefaultDrawingToolState = (): DrawingToolState => ({
  selectedTool: 'brush',
  brushColor: drawingGuessBrushColors[0],
  brushWidth: drawingGuessBrushWidths[1],
  eraserWidth: drawingGuessEraserWidth,
});

const getDrawingGuessConnectionLabel = (
  connectionStatus: DrawingGuessState['connectionStatus'],
  transportMode: DrawingGuessViewModel['transportMode'],
) => {
  if (connectionStatus === 'connected') {
    return transportMode === 'livekit' ? 'Online room connected' : 'Local game ready';
  }

  if (connectionStatus === 'connecting') {
    return transportMode === 'livekit'
      ? 'Connecting to Drawing Guess online room'
      : 'Starting local game';
  }

  if (connectionStatus === 'reconnecting') {
    return 'Reconnecting to Drawing Guess room';
  }

  if (connectionStatus === 'disconnected') {
    return 'Drawing Guess room disconnected';
  }

  return 'Drawing Guess room idle';
};
