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

export const resolveOnlineBootstrapMatchId = ({
  createMatchId,
  hostUid,
  localPlayerId,
  roomCode,
  sessionId,
}: {
  createMatchId: () => string;
  hostUid?: string;
  localPlayerId: string;
  roomCode: string;
  sessionId?: string;
}) => {
  const resolvedHostId = hostUid?.trim() || localPlayerId;
  if (resolvedHostId === localPlayerId) {
    return createMatchId();
  }

  const pendingKey = sessionId?.trim() || roomCode.trim() || 'online';
  return `pending-${pendingKey}`;
};

export const createOnlineDrawingGuessState = ({
  displayName = 'You',
  hostId,
  localPlayerId,
  matchId,
  now,
  roomCode,
}: {
  displayName?: string;
  hostId?: string;
  roomCode: string;
  localPlayerId: string;
  matchId: string;
  now: number;
}) => {
  const resolvedDisplayName = displayName.trim() || 'You';
  const resolvedHostId = hostId?.trim() || localPlayerId;
  let state: DrawingGuessState = {
    ...createInitialDrawingGuessState({ roomId: roomCode, matchId }),
    hostId: resolvedHostId,
  };

  state = drawingGuessReducer(state, {
    type: 'player-joined',
    player: {
      id: localPlayerId,
      displayName: resolvedDisplayName,
      avatarLabel: resolvedDisplayName.charAt(0).toUpperCase() || 'Y',
      role: 'player',
      joinedAt: now,
    },
  });

  return drawingGuessReducer(
    {
      ...state,
      hostId: resolvedHostId,
    },
    {
      type: 'connection-status-changed',
      status: 'connecting',
    },
  );
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
  const isVoiceRoomSession = launchSource === 'voice-room';
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
  const canStart =
    isHost &&
    state.phase === 'lobby' &&
    connectedPlayerCount >= DRAWING_GUESS_RULES.minPlayers;
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
    canStart,
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
    isVoiceRoomSession,
    showOnlineControls: !isShowcaseMode && !isVoiceRoomSession,
    showRoomResetControls: !isVoiceRoomSession,
    canUseSimulatedGuessControls: !isShowcaseMode && transportMode === 'mock',
    eligibleGuesserIds: state.eligibleGuesserIds,
    roundScoreDeltas: state.roundScoreDeltas,
    hasLocalPlayerGuessedCorrectly,
    roundEndReason: state.roundEndReason,
    onlineStatusLabel: isVoiceRoomSession
      ? 'Voice room match'
      : transportMode === 'livekit'
        ? 'Online LiveKit room'
        : 'Local game',
    lobbyStatusLabel: getLobbyStatusLabel({
      canStart,
      connectedPlayerCount,
      isHost,
      isRecoveringSnapshot,
      isShowcaseMode,
      isVoiceRoomSession,
      lastTransportError,
      transportMode,
    }),
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

const getLobbyStatusLabel = ({
  canStart,
  connectedPlayerCount,
  isHost,
  isRecoveringSnapshot,
  isShowcaseMode,
  isVoiceRoomSession,
  lastTransportError,
  transportMode,
}: {
  canStart: boolean;
  connectedPlayerCount: number;
  isHost: boolean;
  isRecoveringSnapshot: boolean;
  isShowcaseMode: boolean;
  isVoiceRoomSession: boolean;
  lastTransportError?: string;
  transportMode: DrawingGuessViewModel['transportMode'];
}) => {
  if (lastTransportError) {
    return isVoiceRoomSession
      ? 'Fix the connection issue above, then reopen the game from the voice room invite.'
      : 'Fix the connection issue above, then create or join the room again.';
  }

  if (isRecoveringSnapshot) {
    return isVoiceRoomSession
      ? 'Joining the shared voice-room match…'
      : 'Recovering the online room…';
  }

  if (isVoiceRoomSession) {
    if (!isHost) {
      return 'You joined from the voice room. Wait for the host to start the match.';
    }
    if (!canStart) {
      return connectedPlayerCount < 2
        ? 'Waiting for another player to join from the voice room invite.'
        : 'Waiting for enough ready players.';
    }
    return 'Players are ready. Start the match when you want to begin.';
  }

  if (transportMode === 'livekit' && !canStart) {
    return 'Waiting for at least two connected players before the host can start.';
  }

  if (transportMode === 'livekit') {
    return 'Online room uses LiveKit data packets for preview strokes, committed strokes, guesses, and snapshots.';
  }

  if (isShowcaseMode) {
    return 'Draw the secret prompt, race the guesses, and climb the final scoreboard.';
  }

  return 'Draw the secret prompt, race the guesses, and climb the final scoreboard.';
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
