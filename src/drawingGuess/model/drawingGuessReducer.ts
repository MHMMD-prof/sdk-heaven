import { DRAWING_GUESS_RULES } from './constants';
import { createClientHostAuthority } from './authority';
import { isCorrectGuessForPrompt, normalizeGuess } from './guessNormalization';
import { hasOnlineMatchProgress } from './onlineMatchProgress';
import { calculateCorrectGuessScore, getDrawerCorrectRoundBonus } from './scoring';
import { canCommitStroke, simplifyStrokePoints } from './strokeUtils';
import {
  DrawingGuessEvent,
  DrawingGuessPlayer,
  DrawingGuessPrompt,
  DrawingGuessRoundEndReason,
  DrawingGuessState,
  DrawingStroke,
} from './types';
import { drawingGuessWordBank } from './wordBank';

type InitialStateInput = {
  roomId: string;
  matchId?: string;
};

export const createInitialDrawingGuessState = ({
  matchId = 'match-initial',
  roomId,
}: InitialStateInput): DrawingGuessState => ({
  roomId,
  matchId,
  phase: 'lobby',
  players: [],
  turnOrder: [],
  roundNumber: 0,
  promptOptions: [],
  canvasRevision: 0,
  strokeIndex: {},
  strokes: [],
  guesses: [],
  scores: {},
  roundScoreDeltas: {},
  eligibleGuesserIds: [],
  correctGuessPlayerIds: [],
  connectionStatus: 'idle',
});

export const drawingGuessReducer = (
  state: DrawingGuessState,
  event: DrawingGuessEvent,
): DrawingGuessState => {
  switch (event.type) {
    case 'player-joined':
      return joinPlayer(state, event.player);
    case 'player-left':
      return leavePlayer(state, event.playerId);
    case 'connection-status-changed':
      return { ...state, connectionStatus: event.status };
    case 'start-match':
      return startMatch(state, event.actorId, event.now, event.matchId);
    case 'select-prompt':
      return selectPrompt(state, event.actorId, event.prompt, event.now);
    case 'submit-guess':
      return submitGuess(state, event.actorId, event.guessId, event.text, event.now);
    case 'apply-scored-guess':
      return applyScoredGuess(
        state,
        event.playerId,
        event.guessId,
        event.text,
        event.now,
        event.isCorrect,
        event.pointsAwarded,
      );
    case 'commit-stroke':
      return commitStroke(state, event.actorId, event.stroke);
    case 'clear-canvas':
      return clearCanvas(state, event.actorId);
    case 'undo-latest-stroke':
      return undoLatestStroke(state, event.actorId);
    case 'end-round':
      return endRound(state, event.actorId, event.now, event.reason, event.revealedPrompt);
    case 'finish-match':
      return finishMatch(state, event.actorId);
    case 'host-yielded': {
      if (hasOnlineMatchProgress(state) && event.hostId !== state.hostId) {
        return state;
      }
      return {
        ...state,
        hostId: event.hostId,
        ...(event.matchId ? { matchId: event.matchId } : {}),
      };
    }
    case 'apply-snapshot':
      return event.state;
    default:
      return state;
  }
};

const joinPlayer = (
  state: DrawingGuessState,
  playerInput: Omit<DrawingGuessPlayer, 'joinOrder' | 'isConnected'> & {
    isConnected?: boolean;
  },
): DrawingGuessState => {
  const existingPlayer = state.players.find((player) => player.id === playerInput.id);

  if (existingPlayer) {
    const players = state.players.map((player) =>
      player.id === playerInput.id
        ? {
            ...player,
            ...playerInput,
            isConnected: playerInput.isConnected ?? true,
          }
        : player,
    );

    return {
      ...state,
      players,
      hostId: state.hostId ?? getNextHostId(players),
    };
  }

  const nextPlayer: DrawingGuessPlayer = {
    ...playerInput,
    joinOrder: getNextJoinOrder(state.players),
    isConnected: playerInput.isConnected ?? true,
  };
  const players = [...state.players, nextPlayer];

  return {
    ...state,
    players,
    hostId: state.hostId ?? nextPlayer.id,
    scores: {
      ...state.scores,
      [nextPlayer.id]: state.scores[nextPlayer.id] ?? 0,
    },
  };
};

const leavePlayer = (state: DrawingGuessState, playerId: string): DrawingGuessState => {
  const players = state.players.map((player) =>
    player.id === playerId ? { ...player, isConnected: false } : player,
  );
  const hostId = state.hostId === playerId ? getNextHostId(players) : state.hostId;

  return {
    ...state,
    players,
    hostId,
  };
};

const startMatch = (
  state: DrawingGuessState,
  actorId: string,
  now: number,
  matchId = state.matchId,
): DrawingGuessState => {
  const authority = createClientHostAuthority(state);

  if (!authority.canStartRound(actorId) || state.phase !== 'lobby') {
    return state;
  }

  const turnOrder = state.players
    .filter((player) => player.isConnected && player.role === 'player')
    .sort((left, right) => left.joinOrder - right.joinOrder)
    .slice(0, DRAWING_GUESS_RULES.maxPlayers)
    .map((player) => player.id);

  if (turnOrder.length < DRAWING_GUESS_RULES.minPlayers) {
    return state;
  }

  const drawerId = turnOrder[0];

  return {
    ...state,
    matchId,
    phase: 'prompt-select',
    turnOrder,
    drawerId,
    roundNumber: 1,
    promptOptions: selectPromptOptions(now),
    promptCommitment: undefined,
    privatePrompt: undefined,
    revealedPrompt: undefined,
    roundEndReason: undefined,
    roundStartedAt: undefined,
    roundEndsAt: undefined,
    canvasRevision: 0,
    strokeIndex: {},
    strokes: [],
    guesses: [],
    roundScoreDeltas: {},
    eligibleGuesserIds: [],
    correctGuessPlayerIds: [],
  };
};

const selectPrompt = (
  state: DrawingGuessState,
  actorId: string,
  prompt: DrawingGuessPrompt,
  now: number,
): DrawingGuessState => {
  const authority = createClientHostAuthority(state);

  if (!authority.canChoosePrompt(actorId) || state.phase !== 'prompt-select') {
    return state;
  }

  return {
    ...state,
    phase: 'drawing',
    promptCommitment: createPromptCommitment(prompt),
    privatePrompt: prompt,
    revealedPrompt: undefined,
    roundEndReason: undefined,
    roundStartedAt: now,
    roundEndsAt: now + DRAWING_GUESS_RULES.roundDurationMs,
    canvasRevision: state.canvasRevision + 1,
    strokeIndex: {},
    strokes: [],
    guesses: [],
    roundScoreDeltas: {},
    eligibleGuesserIds: getEligibleGuesserIds(state, actorId),
    correctGuessPlayerIds: [],
  };
};

const submitGuess = (
  state: DrawingGuessState,
  actorId: string,
  guessId: string,
  text: string,
  now: number,
): DrawingGuessState => {
  const authority = createClientHostAuthority(state);

  if (
    !authority.canScoreGuess(state.hostId ?? '') ||
    state.phase !== 'drawing' ||
    actorId === state.drawerId ||
    !state.eligibleGuesserIds.includes(actorId) ||
    state.correctGuessPlayerIds.includes(actorId)
  ) {
    return state;
  }

  if (!text.trim()) {
    return state;
  }

  const normalizedText = normalizeGuess(text);
  const isCorrect = state.privatePrompt
    ? isCorrectGuessForPrompt(normalizedText, state.privatePrompt)
    : false;
  const nextGuess = {
    id: guessId,
    playerId: actorId,
    originalText: text,
    normalizedText,
    createdAt: now,
    isCorrect,
  };

  if (!isCorrect || !state.roundStartedAt || !state.roundEndsAt) {
    return {
      ...state,
      guesses: [...state.guesses, nextGuess],
    };
  }

  const guessPoints = calculateCorrectGuessScore({
    guessedAt: now,
    roundStartedAt: state.roundStartedAt,
    roundEndsAt: state.roundEndsAt,
  });
  const scores = {
    ...state.scores,
    [actorId]: (state.scores[actorId] ?? 0) + guessPoints,
  };
  const nextCorrectGuessPlayerIds = [...state.correctGuessPlayerIds, actorId];
  const nextState: DrawingGuessState = {
    ...state,
    guesses: [...state.guesses, nextGuess],
    scores,
    roundScoreDeltas: {
      ...state.roundScoreDeltas,
      [actorId]: (state.roundScoreDeltas[actorId] ?? 0) + guessPoints,
    },
    correctGuessPlayerIds: nextCorrectGuessPlayerIds,
  };

  return shouldAutoEndRound(nextState, now).shouldEnd
    ? endRound(nextState, state.hostId ?? actorId, now, 'all-guessed')
    : nextState;
};

const applyScoredGuess = (
  state: DrawingGuessState,
  playerId: string,
  guessId: string,
  text: string,
  now: number,
  isCorrect: boolean,
  pointsAwarded: number,
): DrawingGuessState => {
  if (
    state.phase !== 'drawing' ||
    playerId === state.drawerId ||
    !state.eligibleGuesserIds.includes(playerId) ||
    state.correctGuessPlayerIds.includes(playerId) ||
    state.guesses.some((guess) => guess.id === guessId)
  ) {
    return state;
  }

  if (!text.trim()) {
    return state;
  }

  const nextGuess = {
    id: guessId,
    playerId,
    originalText: text,
    normalizedText: normalizeGuess(text),
    createdAt: now,
    isCorrect,
  };

  if (!isCorrect || pointsAwarded <= 0) {
    return {
      ...state,
      guesses: [...state.guesses, nextGuess],
    };
  }

  return {
    ...state,
    guesses: [...state.guesses, nextGuess],
    scores: {
      ...state.scores,
      [playerId]: (state.scores[playerId] ?? 0) + pointsAwarded,
    },
    roundScoreDeltas: {
      ...state.roundScoreDeltas,
      [playerId]: (state.roundScoreDeltas[playerId] ?? 0) + pointsAwarded,
    },
    correctGuessPlayerIds: [...state.correctGuessPlayerIds, playerId],
  };
};

const commitStroke = (
  state: DrawingGuessState,
  actorId: string,
  stroke: DrawingStroke,
): DrawingGuessState => {
  const authority = createClientHostAuthority(state);
  const nextStroke = {
    ...stroke,
    points: simplifyStrokePoints(stroke.points),
  };

  if (
    state.phase !== 'drawing' ||
    !authority.canCommitStroke(actorId) ||
    stroke.authorId !== actorId ||
    !canCommitStroke(nextStroke, state.strokeIndex, state.canvasRevision)
  ) {
    return state;
  }

  return {
    ...state,
    strokes: [...state.strokes, nextStroke],
    strokeIndex: {
      ...state.strokeIndex,
      [nextStroke.id]: true as const,
    },
  };
};

const clearCanvas = (state: DrawingGuessState, actorId: string): DrawingGuessState => {
  const authority = createClientHostAuthority(state);

  if (state.phase !== 'drawing' || !authority.canCommitStroke(actorId)) {
    return state;
  }

  return {
    ...state,
    canvasRevision: state.canvasRevision + 1,
    strokeIndex: {},
    strokes: [],
  };
};

const undoLatestStroke = (state: DrawingGuessState, actorId: string): DrawingGuessState => {
  const authority = createClientHostAuthority(state);

  if (state.phase !== 'drawing' || !authority.canCommitStroke(actorId)) {
    return state;
  }

  const latestStroke = [...state.strokes]
    .reverse()
    .find((stroke) => stroke.authorId === actorId && stroke.revision === state.canvasRevision);

  if (!latestStroke) {
    return state;
  }

  const { [latestStroke.id]: _removedStroke, ...strokeIndex } = state.strokeIndex;

  return {
    ...state,
    strokeIndex,
    strokes: state.strokes.filter((stroke) => stroke.id !== latestStroke.id),
  };
};

const endRound = (
  state: DrawingGuessState,
  actorId: string,
  now = Date.now(),
  reason: DrawingGuessRoundEndReason = 'manual',
  revealedPromptOverride?: DrawingGuessPrompt,
): DrawingGuessState => {
  const authority = createClientHostAuthority(state);

  if (state.phase === 'round-results' && revealedPromptOverride) {
    return {
      ...state,
      revealedPrompt: state.revealedPrompt ?? revealedPromptOverride,
    };
  }

  if (!authority.canStartRound(actorId) || state.phase !== 'drawing') {
    return state;
  }

  const drawerId = state.drawerId;
  const drawerBonus = getDrawerCorrectRoundBonus(state.correctGuessPlayerIds.length > 0);
  const scores =
    drawerId && drawerBonus
      ? {
          ...state.scores,
          [drawerId]: (state.scores[drawerId] ?? 0) + drawerBonus,
        }
      : state.scores;

  return {
    ...state,
    phase: 'round-results',
    revealedPrompt: revealedPromptOverride ?? state.privatePrompt,
    scores,
    roundScoreDeltas:
      drawerId && drawerBonus
        ? {
            ...state.roundScoreDeltas,
            [drawerId]: (state.roundScoreDeltas[drawerId] ?? 0) + drawerBonus,
          }
        : state.roundScoreDeltas,
    roundEndReason: reason,
  };
};

const finishMatch = (state: DrawingGuessState, actorId: string): DrawingGuessState => {
  const authority = createClientHostAuthority(state);

  if (!authority.canStartRound(actorId)) {
    return state;
  }

  return {
    ...state,
    phase: 'match-results',
  };
};

export const advanceToNextRound = (
  state: DrawingGuessState,
  actorId: string,
  now: number,
): DrawingGuessState => {
  const authority = createClientHostAuthority(state);

  if (!authority.canStartRound(actorId) || state.phase !== 'round-results') {
    return state;
  }

  const nextDrawerIndex = state.roundNumber;
  const nextDrawerId = state.turnOrder[nextDrawerIndex];

  if (!nextDrawerId) {
    return {
      ...state,
      phase: 'match-results',
    };
  }

  return {
    ...state,
    phase: 'prompt-select',
    drawerId: nextDrawerId,
    roundNumber: state.roundNumber + 1,
    promptOptions: selectPromptOptions(now),
    promptCommitment: undefined,
    privatePrompt: undefined,
    revealedPrompt: undefined,
    roundEndReason: undefined,
    roundStartedAt: undefined,
    roundEndsAt: undefined,
    canvasRevision: state.canvasRevision + 1,
    strokeIndex: {},
    strokes: [],
    guesses: [],
    roundScoreDeltas: {},
    eligibleGuesserIds: [],
    correctGuessPlayerIds: [],
  };
};

export const shouldAutoEndRound = (state: DrawingGuessState, now: number) => {
  if (state.phase !== 'drawing') {
    return { shouldEnd: false as const };
  }

  if (state.roundEndsAt && now >= state.roundEndsAt) {
    return { shouldEnd: true as const, reason: 'timer' as const };
  }

  if (
    state.eligibleGuesserIds.length > 0 &&
    state.eligibleGuesserIds.every((playerId) => state.correctGuessPlayerIds.includes(playerId))
  ) {
    return { shouldEnd: true as const, reason: 'all-guessed' as const };
  }

  return { shouldEnd: false as const };
};

const getNextJoinOrder = (players: DrawingGuessPlayer[]) =>
  players.reduce((maxJoinOrder, player) => Math.max(maxJoinOrder, player.joinOrder), -1) + 1;

const getNextHostId = (players: DrawingGuessPlayer[]) =>
  players
    .filter((player) => player.isConnected)
    .sort((left, right) => left.joinOrder - right.joinOrder)[0]?.id;

const selectPromptOptions = (seed: number) => {
  const offset = Math.abs(seed) % drawingGuessWordBank.length;

  return Array.from({ length: DRAWING_GUESS_RULES.promptOptionCount }, (_, index) => {
    const promptIndex = (offset + index) % drawingGuessWordBank.length;

    return drawingGuessWordBank[promptIndex];
  });
};

const createPromptCommitment = (prompt: DrawingGuessPrompt) => `prompt:${prompt.id}`;

const getEligibleGuesserIds = (state: DrawingGuessState, drawerId: string) =>
  state.players
    .filter((player) => player.isConnected && player.role === 'player' && player.id !== drawerId)
    .map((player) => player.id);
