import { CarromGameState, CarromPlayer } from '../types/carrom';
import {
  MatchEvent,
  MatchPlayer,
  MatchPlayerId,
  MatchSession,
  MatchStatus,
  MatchTable,
  MatchTableId,
  SettlementPreview,
  ShotInput,
  ShotResult,
} from '../types/carromMatch';

export class CarromMatchCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CarromMatchCommandError';
  }
}

const LOCAL_PLAYERS: MatchPlayer[] = [
  {
    id: 'local-player-1',
    seat: 1,
    displayName: 'أنت',
    ready: false,
  },
  {
    id: 'local-player-2',
    seat: 2,
    displayName: 'الخصم',
    ready: false,
  },
];

export const CARROM_MATCH_TABLES: MatchTable[] = [
  {
    id: 'bronze',
    title: 'طاولة البداية',
    stake: {
      currency: 'token',
      entryFee: 100,
      prizePool: 180,
      rake: 20,
      isRealMoney: false,
    },
    stakeLabel: '100 رمز',
    prizeLabel: 'الفائز يأخذ 180',
    speedLabel: 'هادئة',
    accentColor: '#63F4C4',
  },
  {
    id: 'gold',
    title: 'طاولة الذهب',
    stake: {
      currency: 'token',
      entryFee: 500,
      prizePool: 900,
      rake: 100,
      isRealMoney: false,
    },
    stakeLabel: '500 رمز',
    prizeLabel: 'الفائز يأخذ 900',
    speedLabel: 'تنافسية',
    accentColor: '#F6D991',
  },
  {
    id: 'royal',
    title: 'طاولة الملوك',
    stake: {
      currency: 'token',
      entryFee: 2000,
      prizePool: 3600,
      rake: 400,
      isRealMoney: false,
    },
    stakeLabel: '2,000 رمز',
    prizeLabel: 'الفائز يأخذ 3,600',
    speedLabel: 'عالية',
    accentColor: '#FF8E9F',
  },
];

export const localCarromMatchController = {
  createMatch(tableId: MatchTableId, countdownSeconds: number): MatchSession {
    const table = getMatchTable(tableId);
    const now = Date.now();
    const matchId = createId('match');
    const roundId = createId('round');

    return appendEvent(
      {
        id: matchId,
        roundId,
        table,
        players: LOCAL_PLAYERS.map((player) => ({ ...player, ready: false })),
        status: 'ready',
        countdownSeconds,
        createdAt: now,
        updatedAt: now,
        events: [],
      },
      'match_created',
      {
        tableId: table.id,
        stake: table.stake,
      },
    );
  },

  resetRound(session: MatchSession): MatchSession {
    assertStatus(session, ['settled', 'cancelled'], 'reset round');

    return appendEvent(
      {
        ...session,
        roundId: createId('round'),
        players: session.players.map((player) => ({ ...player, ready: false })),
        status: 'ready',
        pendingShot: undefined,
        settlement: undefined,
        updatedAt: Date.now(),
      },
      'round_reset',
    );
  },

  setReady(session: MatchSession, playerId: MatchPlayerId, ready: boolean): MatchSession {
    assertStatus(session, ['ready'], 'change ready state');
    assertPlayerExists(session, playerId);

    const currentPlayer = session.players.find((player) => player.id === playerId);

    if (currentPlayer?.ready === ready) {
      return session;
    }

    const next = {
      ...session,
      players: session.players.map((player) =>
        player.id === playerId ? { ...player, ready } : player,
      ),
      status: 'ready' as const,
      updatedAt: Date.now(),
    };

    return appendEvent(next, 'player_ready', { ready }, playerId);
  },

  startCountdown(session: MatchSession): MatchSession {
    assertStatus(session, ['ready'], 'start countdown');

    if (!session.players.every((player) => player.ready)) {
      throw new CarromMatchCommandError('Cannot start countdown before all players are ready.');
    }

    return appendEvent(
      {
        ...session,
        status: 'countdown',
        updatedAt: Date.now(),
      },
      'countdown_started',
      { countdownSeconds: session.countdownSeconds },
    );
  },

  startMatch(session: MatchSession): MatchSession {
    assertStatus(session, ['countdown'], 'start match');

    return appendEvent(
      {
        ...session,
        status: 'live',
        updatedAt: Date.now(),
      },
      'match_started',
    );
  },

  cancelMatch(session: MatchSession): MatchSession {
    assertStatus(session, ['ready', 'countdown', 'live'], 'cancel match');

    return appendEvent(
      {
        ...session,
        status: 'cancelled',
        pendingShot: undefined,
        updatedAt: Date.now(),
      },
      'match_cancelled',
    );
  },

  createShotInput(params: {
    match: MatchSession;
    player: CarromPlayer;
    striker: { x: number; y: number };
    velocity: { vx: number; vy: number };
  }): ShotInput {
    assertStatus(params.match, ['live'], 'create shot input');
    assertNoPendingShot(params.match);

    return {
      id: createId('shot'),
      matchId: params.match.id,
      roundId: params.match.roundId,
      playerId: getPlayerIdForSeat(params.match, params.player),
      player: params.player,
      striker: params.striker,
      velocity: params.velocity,
      submittedAt: Date.now(),
    };
  },

  recordShotSubmitted(session: MatchSession, input: ShotInput): MatchSession {
    assertStatus(session, ['live'], 'submit shot');
    assertNoPendingShot(session);
    assertShotInputBelongsToSession(session, input);

    return appendEvent(
      {
        ...session,
        pendingShot: {
          inputId: input.id,
          playerId: input.playerId,
          player: input.player,
          submittedAt: input.submittedAt,
        },
        updatedAt: Date.now(),
      },
      'shot_submitted',
      {
        shotId: input.id,
        player: input.player,
        striker: input.striker,
        velocity: input.velocity,
      },
      input.playerId,
    );
  },

  createShotResult(params: {
    input: ShotInput;
    beforeState: CarromGameState;
    afterState: CarromGameState;
  }): ShotResult {
    if (params.beforeState.currentPlayer !== params.input.player) {
      throw new CarromMatchCommandError('Cannot resolve a shot for a player who did not shoot.');
    }

    return {
      id: createId('result'),
      inputId: params.input.id,
      matchId: params.input.matchId,
      roundId: params.input.roundId,
      playerId: params.input.playerId,
      player: params.input.player,
      beforeStateHash: hashGameState(params.beforeState),
      afterStateHash: hashGameState(params.afterState),
      pocketed: params.afterState.pocketedThisTurn.map((disc) => ({
        id: disc.id,
        kind: disc.kind,
        owner: disc.owner,
      })),
      message: params.afterState.message,
      nextPlayer: params.afterState.currentPlayer,
      status: params.afterState.status,
      winner: params.afterState.winner,
      resolvedAt: Date.now(),
    };
  },

  recordShotResolved(session: MatchSession, result: ShotResult): MatchSession {
    assertStatus(session, ['live'], 'resolve shot');
    assertShotResultBelongsToSession(session, result);

    return appendEvent(
      {
        ...session,
        pendingShot: undefined,
        updatedAt: Date.now(),
      },
      'shot_resolved',
      {
        resultId: result.id,
        inputId: result.inputId,
        beforeStateHash: result.beforeStateHash,
        afterStateHash: result.afterStateHash,
        pocketed: result.pocketed,
        message: result.message,
        nextPlayer: result.nextPlayer,
        winner: result.winner,
      },
      result.playerId,
    );
  },

  settleMatch(session: MatchSession, winner: CarromPlayer): MatchSession {
    assertStatus(session, ['live'], 'settle match');

    if (session.pendingShot) {
      throw new CarromMatchCommandError('Cannot settle a match while a shot is unresolved.');
    }

    assertLastResolvedShotDeclaredWinner(session, winner);

    const settlement = createSettlement(session, winner);

    return appendEvent(
      {
        ...session,
        status: 'settled',
        settlement,
        updatedAt: Date.now(),
      },
      'match_settled',
      { settlement },
      settlement.winnerId,
    );
  },

  getEvents(session: MatchSession): MatchEvent[] {
    return session.events.map((event) => ({ ...event, payload: event.payload ? { ...event.payload } : undefined }));
  },
};

const assertStatus = (session: MatchSession, allowed: MatchStatus[], action: string) => {
  if (!allowed.includes(session.status)) {
    throw new CarromMatchCommandError(
      `Cannot ${action} while match is ${session.status}. Expected: ${allowed.join(', ')}.`,
    );
  }
};

const assertPlayerExists = (session: MatchSession, playerId: MatchPlayerId) => {
  if (!session.players.some((player) => player.id === playerId)) {
    throw new CarromMatchCommandError(`Unknown match player: ${playerId}`);
  }
};

const assertNoPendingShot = (session: MatchSession) => {
  if (session.pendingShot) {
    throw new CarromMatchCommandError('Cannot submit a new shot while another shot is unresolved.');
  }
};

const assertShotInputBelongsToSession = (session: MatchSession, input: ShotInput) => {
  if (input.matchId !== session.id || input.roundId !== session.roundId) {
    throw new CarromMatchCommandError('Shot input does not belong to this match round.');
  }

  if (getPlayerIdForSeat(session, input.player) !== input.playerId) {
    throw new CarromMatchCommandError('Shot input player does not match the assigned seat.');
  }
};

const assertShotResultBelongsToSession = (session: MatchSession, result: ShotResult) => {
  if (!session.pendingShot) {
    throw new CarromMatchCommandError('Cannot resolve a shot before one has been submitted.');
  }

  if (result.matchId !== session.id || result.roundId !== session.roundId) {
    throw new CarromMatchCommandError('Shot result does not belong to this match round.');
  }

  if (result.inputId !== session.pendingShot.inputId || result.playerId !== session.pendingShot.playerId) {
    throw new CarromMatchCommandError('Shot result does not match the pending shot.');
  }
};

const assertLastResolvedShotDeclaredWinner = (session: MatchSession, winner: CarromPlayer) => {
  const lastShotResolved = [...session.events].reverse().find((event) => event.kind === 'shot_resolved');
  const declaredWinner = lastShotResolved?.payload?.winner;

  if (declaredWinner !== winner) {
    throw new CarromMatchCommandError('Cannot settle a match without a resolved winning shot.');
  }
};

const getMatchTable = (tableId: MatchTableId) => {
  const table = CARROM_MATCH_TABLES.find((candidate) => candidate.id === tableId);

  if (!table) {
    throw new Error(`Unknown Carrom match table: ${tableId}`);
  }

  return table;
};

const getPlayerIdForSeat = (session: MatchSession, seat: CarromPlayer) => {
  const player = session.players.find((candidate) => candidate.seat === seat);

  if (!player) {
    throw new Error(`No match player for Carrom seat ${seat}`);
  }

  return player.id;
};

const createSettlement = (session: MatchSession, winner: CarromPlayer): SettlementPreview => {
  const winnerId = getPlayerIdForSeat(session, winner);

  return {
    winnerId,
    winner,
    prizePool: session.table.stake.prizePool,
    rake: session.table.stake.rake,
    currency: session.table.stake.currency,
    isRealMoney: session.table.stake.isRealMoney,
  };
};

const appendEvent = (
  session: MatchSession,
  kind: MatchEvent['kind'],
  payload?: MatchEvent['payload'],
  playerId?: MatchPlayerId,
): MatchSession => {
  const now = Date.now();
  const event: MatchEvent = {
    id: createId('event'),
    kind,
    matchId: session.id,
    roundId: session.roundId,
    createdAt: now,
    playerId,
    payload,
  };

  return {
    ...session,
    updatedAt: now,
    events: [...session.events, event],
  };
};

const hashGameState = (state: CarromGameState) =>
  hashString(
    JSON.stringify({
      currentPlayer: state.currentPlayer,
      discs: state.discs.map((disc) => ({
        id: disc.id,
        kind: disc.kind,
        owner: disc.owner,
        pocketed: Boolean(disc.pocketed),
        x: roundForHash(disc.x),
        y: roundForHash(disc.y),
        vx: roundForHash(disc.vx),
        vy: roundForHash(disc.vy),
      })),
      queen: state.queen,
      scores: state.scores,
      status: state.status,
      winner: state.winner,
    }),
  );

const roundForHash = (value: number) => Math.round(value * 1000) / 1000;

const hashString = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const createId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
