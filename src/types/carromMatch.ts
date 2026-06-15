import { CarromDisc, CarromGameState, CarromPlayer } from './carrom';

export type MatchCurrency = 'token';
export type MatchTableId = 'bronze' | 'gold' | 'royal';
export type MatchPlayerId = 'local-player-1' | 'local-player-2';
export type MatchStatus = 'ready' | 'countdown' | 'live' | 'settled' | 'cancelled';
export type MatchEventKind =
  | 'match_created'
  | 'round_reset'
  | 'player_ready'
  | 'countdown_started'
  | 'match_started'
  | 'shot_submitted'
  | 'shot_resolved'
  | 'match_settled'
  | 'match_cancelled';

export type MatchStake = {
  currency: MatchCurrency;
  entryFee: number;
  prizePool: number;
  rake: number;
  isRealMoney: boolean;
};

export type MatchTable = {
  id: MatchTableId;
  title: string;
  stake: MatchStake;
  stakeLabel: string;
  prizeLabel: string;
  speedLabel: string;
  accentColor: string;
};

export type MatchPlayer = {
  id: MatchPlayerId;
  seat: CarromPlayer;
  displayName: string;
  ready: boolean;
};

export type MatchSession = {
  id: string;
  roundId: string;
  table: MatchTable;
  players: MatchPlayer[];
  status: MatchStatus;
  countdownSeconds: number;
  pendingShot?: PendingShot;
  createdAt: number;
  updatedAt: number;
  events: MatchEvent[];
  settlement?: SettlementPreview;
};

export type PendingShot = {
  inputId: string;
  playerId: MatchPlayerId;
  player: CarromPlayer;
  submittedAt: number;
};

export type ShotInput = {
  id: string;
  matchId: string;
  roundId: string;
  playerId: MatchPlayerId;
  player: CarromPlayer;
  striker: {
    x: number;
    y: number;
  };
  velocity: {
    vx: number;
    vy: number;
  };
  submittedAt: number;
};

export type ShotResult = {
  id: string;
  inputId: string;
  matchId: string;
  roundId: string;
  playerId: MatchPlayerId;
  player: CarromPlayer;
  beforeStateHash: string;
  afterStateHash: string;
  pocketed: Array<Pick<CarromDisc, 'id' | 'kind' | 'owner'>>;
  message: string;
  nextPlayer: CarromPlayer;
  status: CarromGameState['status'];
  winner?: CarromPlayer;
  resolvedAt: number;
};

export type MatchEvent = {
  id: string;
  kind: MatchEventKind;
  matchId: string;
  roundId: string;
  createdAt: number;
  playerId?: MatchPlayerId;
  payload?: Record<string, unknown>;
};

export type SettlementPreview = {
  winnerId: MatchPlayerId;
  winner: CarromPlayer;
  prizePool: number;
  rake: number;
  currency: MatchCurrency;
  isRealMoney: boolean;
};
