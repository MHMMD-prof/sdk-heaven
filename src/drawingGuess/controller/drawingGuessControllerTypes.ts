import {
  DrawingPoint,
  DrawingGuessGuess,
  DrawingGuessPhase,
  DrawingGuessPlayer,
  DrawingGuessRoundEndReason,
  DrawingStroke,
} from '../model/types';
import { DrawingTool } from '../rendering/drawingTools';

export type DrawingGuessRouteMode = 'online' | 'local-simulated';

export type DrawingGuessRouteSource = 'games' | 'voice-room';

export type DrawingGuessRouteParams = {
  displayName?: string;
  hostUid?: string;
  playerId?: string;
  roomId?: string;
  sessionId?: string;
  source?: DrawingGuessRouteSource;
  mode?: DrawingGuessRouteMode;
};

export type DrawingGuessPlayerViewModel = DrawingGuessPlayer & {
  points: number;
  isHost: boolean;
  isDrawer: boolean;
  hasGuessedCorrectly: boolean;
};

export type DrawingGuessRankingViewModel = {
  playerId: string;
  displayName: string;
  avatarLabel: string;
  points: number;
  rank: number;
  isLocalPlayer: boolean;
  isWinner?: boolean;
};

export type DrawingGuessGuessFeedItemViewModel = DrawingGuessGuess & {
  playerName: string;
  isLocalPlayer: boolean;
};

export type DrawingGuessViewModel = {
  phase: DrawingGuessPhase;
  roomCode: string;
  localPlayerId: string;
  isHost: boolean;
  isDrawer: boolean;
  promptTextForDrawer?: string;
  revealedPromptText?: string;
  timerLabel: string;
  timerUrgency: 'normal' | 'warning' | 'danger';
  roundProgress: number;
  isFinalRound: boolean;
  nextRoundLabel: 'Next round' | 'Final scores';
  localRoundStatusLabel: string;
  phaseLabel: string;
  drawerName?: string;
  connectedPlayerCount: number;
  players: DrawingGuessPlayerViewModel[];
  leaderboard: DrawingGuessRankingViewModel[];
  scores: Record<string, number>;
  canvasRevision: number;
  strokes: DrawingStroke[];
  previewStrokes: DrawingStroke[];
  activeStroke?: DrawingStroke;
  guesses: DrawingGuessGuess[];
  guessFeed: DrawingGuessGuessFeedItemViewModel[];
  selectedTool: DrawingTool;
  brushColor: string;
  brushWidth: number;
  eraserWidth: number;
  availableBrushColors: readonly string[];
  availableBrushWidths: readonly number[];
  promptOptions: {
    id: string;
    text: string;
    categoryLabel: string;
  }[];
  canStart: boolean;
  canChoosePrompt: boolean;
  canDraw: boolean;
  canGuess: boolean;
  canSubmitGuess: boolean;
  canAdvanceRound: boolean;
  isRecoveringSnapshot: boolean;
  transportMode: 'mock' | 'livekit';
  isOnlineRoom: boolean;
  isShowcaseMode: boolean;
  isVoiceRoomSession: boolean;
  showOnlineControls: boolean;
  showRoomResetControls: boolean;
  canUseSimulatedGuessControls: boolean;
  lobbyStatusLabel: string;
  canEndRound: boolean;
  eligibleGuesserIds: string[];
  roundScoreDeltas: Record<string, number>;
  hasLocalPlayerGuessedCorrectly: boolean;
  roundEndReason?: DrawingGuessRoundEndReason;
  onlineStatusLabel: string;
  launchTitle: string;
  launchSubtitle: string;
  launchSource: DrawingGuessRouteSource;
  finalRankings: DrawingGuessRankingViewModel[];
  lastTransportError?: string;
  connectionLabel: string;
};

export type DrawingGuessActions = {
  createLocalRoom: () => void;
  joinLocalRoom: (roomCode: string) => void;
  createOnlineRoom: () => void;
  joinOnlineRoom: (roomCode: string) => void;
  startMatch: () => void;
  choosePrompt: (promptId: string) => void;
  submitGuess: (text: string) => void;
  submitSimulatedCorrectGuess: () => void;
  addSampleStroke: () => void;
  addSampleEraserStroke: () => void;
  commitStrokePoints: (points: DrawingPoint[]) => void;
  previewStrokePoints: (points: DrawingPoint[]) => void;
  beginStroke: (point: DrawingPoint) => void;
  appendStrokePoint: (point: DrawingPoint) => void;
  commitActiveStroke: () => void;
  cancelActiveStroke: () => void;
  setBrushColor: (color: string) => void;
  setBrushWidth: (width: number) => void;
  setTool: (tool: DrawingTool) => void;
  undoLatestStroke: () => void;
  clearCanvas: () => void;
  endRound: () => void;
  advanceRound: () => void;
  finishMatch: () => void;
  leaveGame: () => void;
};

export type DrawingGuessController = {
  viewModel: DrawingGuessViewModel;
  actions: DrawingGuessActions;
};
