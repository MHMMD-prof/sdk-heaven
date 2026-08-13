import { DRAWING_GUESS_TOPICS } from './constants';

export type DrawingGuessTopic =
  (typeof DRAWING_GUESS_TOPICS)[keyof typeof DRAWING_GUESS_TOPICS];

export type DrawingGuessPhase =
  | 'idle'
  | 'lobby'
  | 'prompt-select'
  | 'drawing'
  | 'round-results'
  | 'match-results'
  | 'disconnected';

export type DrawingGuessConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected';

export type DrawingGuessRoundEndReason = 'timer' | 'all-guessed' | 'manual';

export type DrawingGuessPromptCategory =
  | 'objects'
  | 'food'
  | 'places'
  | 'actions'
  | 'animals'
  | 'household';

export type DrawingGuessPrompt = {
  id: string;
  text: string;
  category: DrawingGuessPromptCategory;
  aliases: string[];
};

export type DrawingGuessPlayerRole = 'player' | 'spectator';

export type DrawingGuessPlayer = {
  id: string;
  displayName: string;
  avatarLabel: string;
  role: DrawingGuessPlayerRole;
  joinedAt: number;
  joinOrder: number;
  isConnected: boolean;
};

export type DrawingPoint = {
  x: number;
  y: number;
  t?: number;
};

export type DrawingStroke = {
  id: string;
  authorId: string;
  tool: 'brush' | 'eraser';
  color: string;
  width: number;
  points: DrawingPoint[];
  createdAt: number;
  revision: number;
};

export type DrawingGuessGuess = {
  id: string;
  playerId: string;
  originalText: string;
  normalizedText: string;
  createdAt: number;
  isCorrect: boolean;
};

export type DrawingGuessScore = {
  playerId: string;
  points: number;
};

export type DrawingGuessState = {
  roomId: string;
  matchId: string;
  phase: DrawingGuessPhase;
  players: DrawingGuessPlayer[];
  hostId?: string;
  drawerId?: string;
  turnOrder: string[];
  roundNumber: number;
  promptOptions: DrawingGuessPrompt[];
  promptCommitment?: string;
  privatePrompt?: DrawingGuessPrompt;
  revealedPrompt?: DrawingGuessPrompt;
  roundStartedAt?: number;
  roundEndsAt?: number;
  canvasRevision: number;
  strokeIndex: Record<string, true>;
  strokes: DrawingStroke[];
  guesses: DrawingGuessGuess[];
  scores: Record<string, number>;
  roundScoreDeltas: Record<string, number>;
  eligibleGuesserIds: string[];
  correctGuessPlayerIds: string[];
  roundEndReason?: DrawingGuessRoundEndReason;
  connectionStatus: DrawingGuessConnectionStatus;
};

export type DrawingGuessEvent =
  | {
      type: 'player-joined';
      player: Omit<DrawingGuessPlayer, 'joinOrder' | 'isConnected'> & {
        isConnected?: boolean;
      };
    }
  | {
      type: 'player-left';
      playerId: string;
    }
  | {
      type: 'connection-status-changed';
      status: DrawingGuessConnectionStatus;
    }
  | {
      type: 'start-match';
      actorId: string;
      now: number;
      matchId?: string;
    }
  | {
      type: 'select-prompt';
      actorId: string;
      prompt: DrawingGuessPrompt;
      now: number;
    }
  | {
      type: 'submit-guess';
      actorId: string;
      guessId: string;
      text: string;
      now: number;
    }
  | {
      type: 'commit-stroke';
      actorId: string;
      stroke: DrawingStroke;
    }
  | {
      type: 'clear-canvas';
      actorId: string;
    }
  | {
      type: 'undo-latest-stroke';
      actorId: string;
    }
  | {
      type: 'end-round';
      actorId: string;
      now: number;
      reason?: DrawingGuessRoundEndReason;
      revealedPrompt?: DrawingGuessPrompt;
    }
  | {
      type: 'apply-scored-guess';
      guessId: string;
      playerId: string;
      text: string;
      now: number;
      isCorrect: boolean;
      pointsAwarded: number;
    }
  | {
      type: 'finish-match';
      actorId: string;
    }
  | {
      type: 'host-yielded';
      hostId: string;
      matchId?: string;
    }
  | {
      type: 'apply-snapshot';
      state: DrawingGuessState;
    };

export type DrawingGuessPresenceSyncResult = {
  previousHostId?: string;
  state: DrawingGuessState;
  becameHost: boolean;
};

export type DrawingGuessSnapshot = {
  schemaVersion: 1;
  state: DrawingGuessState;
  createdAt: number;
};

export type DrawingGuessSnapshotChunk = {
  snapshotId: string;
  chunkIndex: number;
  chunkCount: number;
  checksum: string;
  createdAt: number;
  payload: string;
};
