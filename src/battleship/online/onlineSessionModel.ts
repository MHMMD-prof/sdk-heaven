import { MiniGameTarget } from '../../types/miniGame';
import { BATTLESHIP_PROTOCOL_VERSION, BATTLESHIP_RULES } from '../transport/constants';
import { BattleshipPresencePlayer } from '../transport/types';
import { BattleshipLaunch } from '../resolveBattleshipLaunch';
import { BattleshipResolvedShot, BattleshipShotResult } from './onlineBattleCore';
import { BattleshipFleetReadySeal } from './fleetSeal';
import {
  BattleshipOpenShot,
  BattleshipPublicSnapshot,
  applyPublicBattleshipSnapshot,
  hasOnlineMatchProgress,
  syncPresenceWithHostTransfer,
} from './onlineReliability';

export { hasOnlineMatchProgress } from './onlineReliability';

export type BattleshipOnlineConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export type BattleshipOnlinePhase = 'lobby' | 'placement' | 'battle';

export type BattleshipOnlinePlayer = {
  id: string;
  displayName: string;
  joinedAt: number;
  isConnected: boolean;
  isHost: boolean;
};

export type BattleshipOnlineLastShot = {
  cellId: string;
  result: BattleshipShotResult;
  attackerId: string;
};

export type BattleshipOnlineState = {
  battleStartedAt?: number;
  connectionStatus: BattleshipOnlineConnectionStatus;
  currentTurnPlayerId?: string;
  firstPlayerId?: string;
  hostId: string;
  incomingResults: Record<string, BattleshipShotResult>;
  isRecoveringSnapshot: boolean;
  lastError?: string;
  lastShot?: BattleshipOnlineLastShot;
  localFleet?: MiniGameTarget[];
  localPlayerId: string;
  localReady: boolean;
  matchId: string;
  openShot?: BattleshipOpenShot;
  opponentConnected: boolean;
  outgoingResults: Record<string, BattleshipShotResult>;
  pendingShotId?: string;
  phase: BattleshipOnlinePhase;
  players: BattleshipOnlinePlayer[];
  protocolVersion: number;
  readySeals: Record<string, BattleshipFleetReadySeal>;
  resolvedShots: BattleshipResolvedShot[];
  roomId: string;
  sessionId: string;
  winnerId?: string;
};

export type BattleshipOnlineEvent =
  | {
      type: 'connection-status-changed';
      status: BattleshipOnlineConnectionStatus;
      error?: string;
    }
  | {
      type: 'apply-presence';
      displayName: string;
      players: BattleshipPresencePlayer[];
    }
  | {
      type: 'apply-lobby-announce';
      hostId: string;
      matchId: string;
      players: BattleshipPresencePlayer[];
    }
  | {
      type: 'ensure-local-player';
      displayName: string;
    }
  | {
      type: 'placement-started';
      matchId: string;
    }
  | {
      type: 'local-fleet-sealed';
      fleet: MiniGameTarget[];
      seal: BattleshipFleetReadySeal;
    }
  | {
      type: 'peer-fleet-ready';
      playerId: string;
      seal: BattleshipFleetReadySeal;
    }
  | {
      type: 'battle-started';
      firstPlayerId: string;
      matchId: string;
      now: number;
    }
  | {
      type: 'shot-fired-local';
      cellId: string;
      shotId: string;
    }
  | {
      type: 'note-open-shot';
      openShot: BattleshipOpenShot;
    }
  | {
      type: 'apply-shot-resolved';
      shot: BattleshipResolvedShot;
    }
  | {
      type: 'apply-public-snapshot';
      displayName: string;
      snapshot: BattleshipPublicSnapshot;
    }
  | {
      type: 'host-yielded';
      hostId: string;
      matchId?: string;
    }
  | {
      type: 'recovering-snapshot-changed';
      isRecoveringSnapshot: boolean;
    };

export const createBattleshipMatchId = () =>
  `nd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const createBattleshipMessageId = () =>
  `ndm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const resolveOnlineBootstrapMatchId = ({
  createMatchId = createBattleshipMatchId,
  hostUid,
  localPlayerId,
  roomId,
  sessionId,
}: {
  createMatchId?: () => string;
  hostUid?: string;
  localPlayerId: string;
  roomId: string;
  sessionId?: string;
}) => {
  const resolvedHostId = hostUid?.trim() || localPlayerId;
  if (resolvedHostId === localPlayerId) {
    return createMatchId();
  }

  const pendingKey = sessionId?.trim() || roomId.trim() || 'online';
  return `pending-${pendingKey}`;
};

export const createBattleshipOnlineState = ({
  displayName,
  hostId,
  localPlayerId,
  matchId,
  now = Date.now(),
  roomId,
  sessionId,
}: {
  displayName: string;
  hostId: string;
  localPlayerId: string;
  matchId: string;
  now?: number;
  roomId: string;
  sessionId: string;
}): BattleshipOnlineState => {
  const resolvedDisplayName = displayName.trim() || 'You';
  const resolvedHostId = hostId.trim() || localPlayerId;

  return {
    connectionStatus: 'idle',
    hostId: resolvedHostId,
    incomingResults: {},
    isRecoveringSnapshot: false,
    localPlayerId,
    localReady: false,
    matchId,
    opponentConnected: false,
    outgoingResults: {},
    phase: 'lobby',
    players: [
      {
        id: localPlayerId,
        displayName: resolvedDisplayName,
        joinedAt: now,
        isConnected: true,
        isHost: localPlayerId === resolvedHostId,
      },
    ],
    protocolVersion: BATTLESHIP_PROTOCOL_VERSION,
    readySeals: {},
    resolvedShots: [],
    roomId,
    sessionId,
  };
};

export const createBattleshipOnlineStateFromLaunch = (
  launch: BattleshipLaunch,
  createMatchId = createBattleshipMatchId,
): BattleshipOnlineState =>
  createBattleshipOnlineState({
    displayName: launch.displayName,
    hostId: launch.hostUid || launch.playerId,
    localPlayerId: launch.playerId,
    matchId: resolveOnlineBootstrapMatchId({
      createMatchId,
      hostUid: launch.hostUid,
      localPlayerId: launch.playerId,
      roomId: launch.roomId,
      sessionId: launch.sessionId,
    }),
    roomId: launch.roomId,
    sessionId: launch.sessionId,
  });

export const getConnectedPlayerIds = (state: BattleshipOnlineState) =>
  state.players.filter((player) => player.isConnected).map((player) => player.id);

export const canStartOnlinePlacement = (state: BattleshipOnlineState) =>
  state.connectionStatus === 'connected'
  && state.phase === 'lobby'
  && !state.matchId.startsWith('pending-')
  && getConnectedPlayerIds(state).length >= BATTLESHIP_RULES.minPlayers;

export const bothFleetsReady = (state: BattleshipOnlineState) => {
  const playerIds = getConnectedPlayerIds(state);
  if (playerIds.length < BATTLESHIP_RULES.minPlayers) {
    return false;
  }

  return playerIds.every((playerId) => Boolean(state.readySeals[playerId]));
};

export const battleshipOnlineReducer = (
  state: BattleshipOnlineState,
  event: BattleshipOnlineEvent,
): BattleshipOnlineState => {
  switch (event.type) {
    case 'connection-status-changed':
      return {
        ...state,
        connectionStatus: event.status,
        lastError: event.status === 'error' ? event.error || state.lastError : undefined,
      };
    case 'ensure-local-player': {
      const prior = state.players.find((player) => player.id === state.localPlayerId);
      return {
        ...state,
        players: upsertPlayer(state.players, {
          id: state.localPlayerId,
          displayName: event.displayName.trim() || 'You',
          joinedAt: prior?.joinedAt ?? Date.now(),
          isConnected: true,
          isHost: state.localPlayerId === state.hostId,
        }),
      };
    }
    case 'apply-presence': {
      const synced = syncPresenceWithHostTransfer({
        localDisplayName: event.displayName,
        localPlayerId: state.localPlayerId,
        players: event.players,
        state,
      });
      return synced.state;
    }
    case 'apply-lobby-announce': {
      const localDisplayName =
        state.players.find((player) => player.id === state.localPlayerId)?.displayName
        || 'You';

      // Live placement/battle identity must not be rewritten by a remounter's fresh match.
      if (
        (state.phase === 'battle' || state.phase === 'placement')
        && !state.matchId.startsWith('pending-')
        && event.matchId !== state.matchId
      ) {
        return state;
      }

      const players = mergePresencePlayers({
        hostId: event.hostId,
        localDisplayName,
        localPlayerId: state.localPlayerId,
        players: event.players,
        previous: state.players,
      });
      const announcerConnected = players.some(
        (player) => player.id === event.hostId && player.isConnected,
      );
      if (!announcerConnected) {
        return state;
      }

      const progress = hasOnlineMatchProgress(state);
      // Sticky authority: progressed or linked hosts ignore foreign host claims.
      if (
        state.localPlayerId === state.hostId
        && event.hostId !== state.localPlayerId
        && (progress || !state.matchId.startsWith('pending-'))
      ) {
        return state;
      }

      return {
        ...state,
        hostId: event.hostId,
        matchId: event.matchId,
        players: players.map((player) => ({
          ...player,
          isHost: player.id === event.hostId,
        })),
        opponentConnected: players.some(
          (player) => player.id !== state.localPlayerId && player.isConnected,
        ),
      };
    }
    case 'placement-started': {
      if (state.phase !== 'lobby' && state.phase !== 'placement') {
        return state;
      }

      return {
        ...state,
        matchId: event.matchId || state.matchId,
        phase: 'placement',
      };
    }
    case 'local-fleet-sealed': {
      if (state.phase !== 'placement' && state.phase !== 'battle') {
        return state;
      }

      return {
        ...state,
        localFleet: event.fleet.map(cloneTarget),
        localReady: true,
        readySeals: {
          ...state.readySeals,
          [state.localPlayerId]: event.seal,
        },
      };
    }
    case 'peer-fleet-ready': {
      if (event.playerId === state.localPlayerId) {
        return state;
      }

      return {
        ...state,
        readySeals: {
          ...state.readySeals,
          [event.playerId]: event.seal,
        },
      };
    }
    case 'battle-started': {
      // Idempotent: replayed battle-start must not wipe fog shot history.
      if (state.phase === 'battle') {
        return {
          ...state,
          matchId: event.matchId || state.matchId,
          firstPlayerId: state.firstPlayerId || event.firstPlayerId,
          currentTurnPlayerId: state.currentTurnPlayerId || event.firstPlayerId,
          battleStartedAt: state.battleStartedAt || event.now,
        };
      }

      return {
        ...state,
        battleStartedAt: event.now,
        currentTurnPlayerId: event.firstPlayerId,
        firstPlayerId: event.firstPlayerId,
        incomingResults: {},
        lastShot: undefined,
        matchId: event.matchId || state.matchId,
        openShot: undefined,
        outgoingResults: {},
        pendingShotId: undefined,
        phase: 'battle',
        resolvedShots: [],
        winnerId: undefined,
      };
    }
    case 'shot-fired-local': {
      if (state.phase !== 'battle' || state.winnerId) {
        return state;
      }
      if (state.currentTurnPlayerId !== state.localPlayerId) {
        return state;
      }
      if (state.pendingShotId || state.outgoingResults[event.cellId]) {
        return state;
      }

      return {
        ...state,
        openShot: {
          attackerId: state.localPlayerId,
          cellId: event.cellId,
          shotId: event.shotId,
        },
        pendingShotId: event.shotId,
      };
    }
    case 'note-open-shot': {
      if (state.phase !== 'battle' || state.winnerId) {
        return state;
      }
      if (state.openShot?.shotId === event.openShot.shotId) {
        return state;
      }

      return {
        ...state,
        openShot: event.openShot,
      };
    }
    case 'apply-shot-resolved': {
      if (state.phase !== 'battle') {
        return state;
      }

      const { shot } = event;
      const isLocalAttack = shot.attackerId === state.localPlayerId;
      const resultsKey = isLocalAttack ? 'outgoingResults' : 'incomingResults';
      if (state[resultsKey][shot.cellId]) {
        return {
          ...state,
          openShot: state.openShot?.shotId === shot.shotId ? undefined : state.openShot,
          pendingShotId:
            state.pendingShotId === shot.shotId ? undefined : state.pendingShotId,
        };
      }

      return {
        ...state,
        currentTurnPlayerId: shot.winnerId ? state.currentTurnPlayerId : shot.nextTurnPlayerId,
        lastShot: {
          attackerId: shot.attackerId,
          cellId: shot.cellId,
          result: shot.result,
        },
        openShot: state.openShot?.shotId === shot.shotId ? undefined : state.openShot,
        pendingShotId:
          state.pendingShotId === shot.shotId ? undefined : state.pendingShotId,
        [resultsKey]: {
          ...state[resultsKey],
          [shot.cellId]: shot.result,
        },
        resolvedShots: [...state.resolvedShots, shot],
        winnerId: shot.winnerId || state.winnerId,
      };
    }
    case 'apply-public-snapshot':
      return applyPublicBattleshipSnapshot({
        localDisplayName: event.displayName,
        localPlayerId: state.localPlayerId,
        previous: state,
        snapshot: event.snapshot,
      });
    case 'host-yielded': {
      if (hasOnlineMatchProgress(state) && event.hostId !== state.hostId) {
        return state;
      }
      return {
        ...state,
        hostId: event.hostId,
        matchId: event.matchId || state.matchId,
        players: state.players.map((player) => ({
          ...player,
          isHost: player.id === event.hostId,
        })),
      };
    }
    case 'recovering-snapshot-changed':
      return {
        ...state,
        isRecoveringSnapshot: event.isRecoveringSnapshot,
      };
    default:
      return state;
  }
};

export const createBattleshipTransportLobbyViewModel = ({
  firestorePlayerCount,
  firestoreMaxPlayers,
  firestoreStatus,
  launch,
  state,
}: {
  firestoreMaxPlayers?: number;
  firestorePlayerCount?: number;
  firestoreStatus?: string;
  launch: BattleshipLaunch;
  state: BattleshipOnlineState;
}) => {
  const transportPlayerCount = state.players.filter((player) => player.isConnected).length;
  const resolvedMaxPlayers =
    firestoreMaxPlayers && firestoreMaxPlayers > 0
      ? firestoreMaxPlayers
      : BATTLESHIP_RULES.maxPlayers;
  const resolvedPlayerCount = Math.max(
    transportPlayerCount,
    firestorePlayerCount ?? 0,
    launch.isHost ? 1 : 0,
  );
  const waitingForOpponent = resolvedPlayerCount < resolvedMaxPlayers;
  const readyCount = Object.keys(state.readySeals).length;
  const transportLabel =
    state.connectionStatus === 'connected'
      ? 'Transport connected'
      : state.connectionStatus === 'connecting'
        ? 'Connecting transport…'
        : state.connectionStatus === 'error'
          ? 'Transport error'
          : 'Transport idle';

  let body: string;
  let title = launch.isHost ? 'Host lobby' : 'Joined lobby';

  if (state.connectionStatus === 'error') {
    body = state.lastError || 'Could not connect the Naval Duel data room.';
  } else if (state.connectionStatus === 'connecting') {
    body = 'Connecting the shared Naval Duel data room…';
  } else if (state.isRecoveringSnapshot) {
    title = 'Reconnecting';
    body = 'Recovering the shared match snapshot…';
  } else if (!state.opponentConnected && state.phase !== 'lobby') {
    title = 'Opponent disconnected';
    body = 'Waiting for the other player to reconnect. Your private fleet stays on this device.';
  } else if (state.phase === 'battle') {
    title = state.winnerId ? 'Battle complete' : 'Naval duel';
    body = state.winnerId
      ? state.winnerId === state.localPlayerId
        ? 'You sank the enemy fleet.'
        : 'Your fleet was sunk.'
      : state.pendingShotId
        ? 'Shot in flight. Waiting for the defender to resolve hit or miss.'
        : state.currentTurnPlayerId === state.localPlayerId
          ? 'Your turn. Fire on enemy waters. Boards stay private.'
          : 'Opponent turn. Your fleet stays hidden on this device.';
  } else if (state.phase === 'placement') {
    title = state.localReady ? 'Fleet sealed' : 'Place your fleet';
    body = state.localReady
      ? `Waiting for opponent readiness (${readyCount}/${resolvedMaxPlayers}). Your board stays private.`
      : 'Place your ships privately. Only a sealed commitment is shared when you confirm.';
  } else if (waitingForOpponent) {
    body = launch.isHost
      ? 'Transport ready. Waiting for the second player to join from the voice room invite.'
      : 'Transport ready. Waiting for the host and shared lobby to fill.';
  } else {
    body = launch.isHost
      ? 'Both players are connected. Starting private ship placement…'
      : 'Both players are connected. Waiting for the host to open placement…';
  }

  return {
    eyebrow: 'Voice room duel',
    title,
    body,
    roleLabel: launch.isHost ? 'Host' : 'Guest',
    playerCountLabel: `${resolvedPlayerCount}/${resolvedMaxPlayers} players`,
    sessionStatusLabel: firestoreStatus === 'active' ? 'Active' : 'Lobby',
    transportStatusLabel: transportLabel,
    matchIdLabel: state.matchId.startsWith('pending-') ? 'Match pending' : 'Match linked',
    readyStatusLabel:
      state.phase === 'placement' || state.phase === 'battle'
        ? `${readyCount}/${resolvedMaxPlayers} ready`
        : undefined,
    showHandoffControls: false,
    canUseLocalPersistence: false,
    canStartLocalHotSeat: false,
    leaveLabel: 'Back to voice room',
  };
};

const cloneTarget = (target: MiniGameTarget): MiniGameTarget => ({
  ...target,
  cells: [...target.cells],
  footprint: { ...target.footprint },
});

const upsertPlayer = (
  players: BattleshipOnlinePlayer[],
  next: BattleshipOnlinePlayer,
) => {
  const without = players.filter((player) => player.id !== next.id);
  return [...without, next].sort((left, right) => left.joinedAt - right.joinedAt);
};

const mergePresencePlayers = ({
  hostId,
  localDisplayName,
  localPlayerId,
  players,
  previous,
}: {
  hostId: string;
  localDisplayName: string;
  localPlayerId: string;
  players: BattleshipPresencePlayer[];
  previous: BattleshipOnlinePlayer[];
}): BattleshipOnlinePlayer[] => {
  const previousById = new Map(previous.map((player) => [player.id, player]));
  const merged = players.map((player, index) => {
    const prior = previousById.get(player.id);
    const displayName =
      player.id === localPlayerId
        ? localDisplayName
        : player.displayName || prior?.displayName || player.id;

    return {
      id: player.id,
      displayName,
      joinedAt: prior?.joinedAt ?? player.joinedAt ?? Date.now() + index,
      isConnected: player.isConnected,
      isHost: player.id === hostId,
    };
  });

  if (!merged.some((player) => player.id === localPlayerId)) {
    merged.push({
      id: localPlayerId,
      displayName: localDisplayName,
      joinedAt: previousById.get(localPlayerId)?.joinedAt ?? Date.now(),
      isConnected: true,
      isHost: localPlayerId === hostId,
    });
  }

  return merged.sort((left, right) => left.joinedAt - right.joinedAt);
};
