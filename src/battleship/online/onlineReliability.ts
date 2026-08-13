import { BattleshipPresencePlayer } from '../transport/types';
import { BattleshipResolvedShot, BattleshipShotResult } from './onlineBattleCore';
import { BattleshipFleetReadySeal, fleetSealLooksSafe } from './fleetSeal';
import {
  BattleshipOnlinePhase,
  BattleshipOnlinePlayer,
  BattleshipOnlineState,
} from './onlineSessionModel';

export type BattleshipOpenShot = {
  attackerId: string;
  cellId: string;
  shotId: string;
};

export type BattleshipPublicSnapshot = {
  currentTurnPlayerId?: string;
  firstPlayerId?: string;
  hostId: string;
  matchId: string;
  openShot?: BattleshipOpenShot;
  phase: BattleshipOnlinePhase;
  players: Array<{
    displayName: string;
    id: string;
    isConnected: boolean;
    joinedAt: number;
  }>;
  readySeals: Record<string, BattleshipFleetReadySeal>;
  resolvedShots: BattleshipResolvedShot[];
  winnerId?: string;
};

export const createPublicBattleshipSnapshot = (
  state: BattleshipOnlineState,
): BattleshipPublicSnapshot => {
  const snapshot: BattleshipPublicSnapshot = {
    hostId: state.hostId,
    matchId: state.matchId,
    phase: state.phase,
    players: state.players.map((player) => ({
      id: player.id,
      displayName: player.displayName,
      joinedAt: player.joinedAt,
      isConnected: player.isConnected,
    })),
    readySeals: { ...state.readySeals },
    resolvedShots: state.resolvedShots.map((shot) => ({ ...shot })),
    ...(state.currentTurnPlayerId ? { currentTurnPlayerId: state.currentTurnPlayerId } : {}),
    ...(state.firstPlayerId ? { firstPlayerId: state.firstPlayerId } : {}),
    ...(state.winnerId ? { winnerId: state.winnerId } : {}),
    ...(state.openShot ? { openShot: { ...state.openShot } } : {}),
  };

  // Defense in depth: never allow private fleet material onto the wire.
  const serialized = JSON.stringify(snapshot);
  if (
    serialized.includes('"cells"')
    || serialized.includes('"fleet"')
    || serialized.includes('"board"')
    || serialized.includes('"localFleet"')
  ) {
    throw new Error('Public Naval Duel snapshot attempted to include private board data.');
  }

  return snapshot;
};

export const rebuildShotMapsForViewer = ({
  localPlayerId,
  resolvedShots,
}: {
  localPlayerId: string;
  resolvedShots: BattleshipResolvedShot[];
}) => {
  const outgoingResults: Record<string, BattleshipShotResult> = {};
  const incomingResults: Record<string, BattleshipShotResult> = {};

  resolvedShots.forEach((shot) => {
    if (shot.attackerId === localPlayerId) {
      outgoingResults[shot.cellId] = shot.result;
    } else {
      incomingResults[shot.cellId] = shot.result;
    }
  });

  return { incomingResults, outgoingResults };
};

export const applyPublicBattleshipSnapshot = ({
  localDisplayName,
  localPlayerId,
  previous,
  snapshot,
}: {
  localDisplayName: string;
  localPlayerId: string;
  previous: BattleshipOnlineState;
  snapshot: BattleshipPublicSnapshot;
}): BattleshipOnlineState => {
  const { incomingResults, outgoingResults } = rebuildShotMapsForViewer({
    localPlayerId,
    resolvedShots: snapshot.resolvedShots,
  });
  const lastShot = snapshot.resolvedShots.length
    ? {
        attackerId: snapshot.resolvedShots[snapshot.resolvedShots.length - 1].attackerId,
        cellId: snapshot.resolvedShots[snapshot.resolvedShots.length - 1].cellId,
        result: snapshot.resolvedShots[snapshot.resolvedShots.length - 1].result,
      }
    : undefined;

  const players = mergeSnapshotPlayers({
    hostId: snapshot.hostId,
    localDisplayName,
    localPlayerId,
    previous: previous.players,
    snapshotPlayers: snapshot.players,
  });

  const opponentConnected = players.some(
    (player) => player.id !== localPlayerId && player.isConnected,
  );

  // Never regress a live match to a different/empty identity.
  if (
    (previous.phase === 'battle' || previous.phase === 'placement')
    && !previous.matchId.startsWith('pending-')
    && snapshot.matchId !== previous.matchId
  ) {
    return {
      ...previous,
      opponentConnected:
        previous.opponentConnected
        || opponentConnected,
      players: previous.players.length ? previous.players : players,
    };
  }

  // Never regress placement/battle back to lobby (including zero-shot battles).
  if (
    (previous.phase === 'battle' || previous.phase === 'placement')
    && snapshot.phase === 'lobby'
  ) {
    return {
      ...previous,
      opponentConnected:
        previous.opponentConnected
        || opponentConnected,
    };
  }

  // Never accept a same-match snapshot that shrinks or forks known fog history.
  if (
    snapshot.matchId === previous.matchId
    && !isResolvedShotHistoryPrefix(previous.resolvedShots, snapshot.resolvedShots)
  ) {
    return {
      ...previous,
      opponentConnected:
        previous.opponentConnected
        || opponentConnected,
    };
  }

  return {
    ...previous,
    connectionStatus: previous.connectionStatus === 'error' ? previous.connectionStatus : 'connected',
    currentTurnPlayerId: snapshot.currentTurnPlayerId,
    firstPlayerId: snapshot.firstPlayerId,
    hostId: snapshot.hostId,
    incomingResults,
    isRecoveringSnapshot: false,
    lastShot,
    // Private fleet never travels in snapshots; keep whatever this device already sealed.
    localFleet: previous.localFleet,
    localReady:
      previous.localReady
      || Boolean(snapshot.readySeals[localPlayerId])
      || Boolean(previous.localFleet),
    matchId: snapshot.matchId,
    openShot: snapshot.openShot,
    opponentConnected,
    outgoingResults,
    pendingShotId:
      snapshot.openShot?.attackerId === localPlayerId ? snapshot.openShot.shotId : undefined,
    phase: snapshot.phase,
    players,
    readySeals: { ...snapshot.readySeals },
    resolvedShots: snapshot.resolvedShots.map((shot) => ({ ...shot })),
    winnerId: snapshot.winnerId,
  };
};

/** True when previous shots are a prefix of snapshot shots (by shotId). */
export const isResolvedShotHistoryPrefix = (
  previousShots: BattleshipResolvedShot[],
  snapshotShots: BattleshipResolvedShot[],
) => {
  if (previousShots.length === 0) {
    return true;
  }
  if (snapshotShots.length < previousShots.length) {
    return false;
  }
  return previousShots.every(
    (shot, index) => snapshotShots[index]?.shotId === shot.shotId,
  );
};

/** Stable fallback host: earliest connected joinedAt, then id. */
export const electConnectedHostId = (
  players: Array<{ id: string; isConnected: boolean; joinedAt: number }>,
  fallbackId: string,
) => {
  const connected = players
    .filter((player) => player.isConnected)
    .sort((left, right) => left.joinedAt - right.joinedAt || left.id.localeCompare(right.id));
  return connected[0]?.id || fallbackId;
};

/** True once placement/battle identity should not be clobbered by empty remounters. */
export const hasOnlineMatchProgress = (state: BattleshipOnlineState) =>
  state.phase !== 'lobby'
  || Boolean(state.localFleet)
  || state.localReady
  || Boolean(state.battleStartedAt)
  || state.resolvedShots.length > 0
  || Object.keys(state.readySeals).length > 0;

/**
 * After an authority probe timeout, claim only when still local host with no progress
 * and no connected peer for enough consecutive absent intervals (presence-flap grace).
 */
export const PEER_ABSENT_INTERVALS_BEFORE_CLAIM = 2;

export type AuthorityClaimGrace = {
  consecutivePeerAbsentIntervals: number;
  sawPeerWhileUnclaimed: boolean;
};

export const createAuthorityClaimGrace = (): AuthorityClaimGrace => ({
  consecutivePeerAbsentIntervals: 0,
  sawPeerWhileUnclaimed: false,
});

/** Presence/probe observer: a connected peer resets the absent streak. */
export const observePeersForAuthorityClaimGrace = (
  grace: AuthorityClaimGrace,
  peersConnected: boolean,
): AuthorityClaimGrace => {
  if (!peersConnected) {
    return grace;
  }
  return {
    consecutivePeerAbsentIntervals: 0,
    sawPeerWhileUnclaimed: true,
  };
};

/** Probe-timeout tick while alone: advance the consecutive-absent counter. */
export const tickAuthorityClaimGraceOnProbe = (
  grace: AuthorityClaimGrace,
  peersConnected: boolean,
): AuthorityClaimGrace => {
  const observed = observePeersForAuthorityClaimGrace(grace, peersConnected);
  if (peersConnected) {
    return observed;
  }
  return {
    ...observed,
    consecutivePeerAbsentIntervals: observed.consecutivePeerAbsentIntervals + 1,
  };
};

/**
 * After we have already seen a peer, one empty presence tick must not instant-claim.
 * Schedule probe grace instead.
 */
export const shouldDeferInstantHostClaimOnPresenceFlap = ({
  hasClaimedLobby,
  hasMatchProgress,
  peersConnected,
  sawPeerWhileUnclaimed,
}: {
  hasClaimedLobby: boolean;
  hasMatchProgress: boolean;
  peersConnected: boolean;
  sawPeerWhileUnclaimed: boolean;
}) =>
  !peersConnected
  && sawPeerWhileUnclaimed
  && !hasClaimedLobby
  && !hasMatchProgress;

export const shouldClaimHostAfterAuthorityProbe = ({
  hasClaimedLobby,
  hasMatchProgress,
  isLocalHost,
  peersConnected,
  consecutivePeerAbsentIntervals = 0,
  requiredAbsentIntervals = PEER_ABSENT_INTERVALS_BEFORE_CLAIM,
}: {
  consecutivePeerAbsentIntervals?: number;
  hasClaimedLobby: boolean;
  hasMatchProgress: boolean;
  isLocalHost: boolean;
  peersConnected: boolean;
  requiredAbsentIntervals?: number;
}) =>
  isLocalHost
  && !hasClaimedLobby
  && !hasMatchProgress
  && !peersConnected
  && consecutivePeerAbsentIntervals >= requiredAbsentIntervals;
export const syncPresenceWithHostTransfer = ({
  localDisplayName,
  localPlayerId,
  players,
  state,
}: {
  localDisplayName: string;
  localPlayerId: string;
  players: BattleshipPresencePlayer[];
  state: BattleshipOnlineState;
}) => {
  const previousHostId = state.hostId;
  const presentIds = new Set(players.map((player) => player.id));
  const previousById = new Map(state.players.map((player) => [player.id, player]));

  let nextPlayers: BattleshipOnlinePlayer[] = players.map((player, index) => {
    const prior = previousById.get(player.id);
    return {
      id: player.id,
      displayName:
        player.id === localPlayerId
          ? localDisplayName
          : player.displayName || prior?.displayName || player.id,
      joinedAt: prior?.joinedAt ?? player.joinedAt ?? Date.now() + index,
      isConnected: player.isConnected !== false,
      isHost: false,
    };
  });

  state.players.forEach((player) => {
    if (!presentIds.has(player.id) && player.id !== localPlayerId) {
      nextPlayers.push({
        ...player,
        isConnected: false,
        isHost: false,
      });
    }
  });

  if (!nextPlayers.some((player) => player.id === localPlayerId)) {
    nextPlayers.push({
      id: localPlayerId,
      displayName: localDisplayName,
      joinedAt: previousById.get(localPlayerId)?.joinedAt ?? Date.now(),
      isConnected: true,
      isHost: false,
    });
  }

  const hostStillConnected = nextPlayers.some(
    (player) => player.isConnected && player.id === previousHostId,
  );
  const nextHostId = hostStillConnected
    ? previousHostId
    : electConnectedHostId(nextPlayers, localPlayerId);

  nextPlayers = nextPlayers
    .map((player) => ({
      ...player,
      isHost: player.id === nextHostId,
    }))
    .sort((left, right) => left.joinedAt - right.joinedAt || left.id.localeCompare(right.id));

  const opponentConnected = nextPlayers.some(
    (player) => player.id !== localPlayerId && player.isConnected,
  );

  return {
    becameHost: previousHostId !== nextHostId && nextHostId === localPlayerId,
    opponentConnected,
    previousHostId,
    state: {
      ...state,
      hostId: nextHostId,
      opponentConnected,
      players: nextPlayers,
    },
  };
};

export const publicSnapshotLooksSafe = (value: unknown): value is BattleshipPublicSnapshot => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const snapshot = value as Record<string, unknown>;
  if (
    'cells' in snapshot
    || 'targets' in snapshot
    || 'fleet' in snapshot
    || 'board' in snapshot
    || 'localFleet' in snapshot
  ) {
    return false;
  }

  if (
    typeof snapshot.matchId !== 'string'
    || !snapshot.matchId
    || typeof snapshot.hostId !== 'string'
    || !snapshot.hostId
    || (snapshot.phase !== 'lobby'
      && snapshot.phase !== 'placement'
      && snapshot.phase !== 'battle')
    || !snapshot.readySeals
    || typeof snapshot.readySeals !== 'object'
    || !Array.isArray(snapshot.resolvedShots)
    || !Array.isArray(snapshot.players)
  ) {
    return false;
  }

  const seals = Object.values(snapshot.readySeals as Record<string, unknown>);
  if (!seals.every((seal) => fleetSealLooksSafe(seal))) {
    return false;
  }

  return snapshot.resolvedShots.every((shot) => {
    if (!shot || typeof shot !== 'object') {
      return false;
    }
    const next = shot as Record<string, unknown>;
    return (
      typeof next.shotId === 'string'
      && typeof next.cellId === 'string'
      && typeof next.attackerId === 'string'
      && (next.result === 'hit' || next.result === 'miss')
      && typeof next.nextTurnPlayerId === 'string'
      && !('cells' in next)
      && !('fleet' in next)
    );
  });
};

const mergeSnapshotPlayers = ({
  hostId,
  localDisplayName,
  localPlayerId,
  previous,
  snapshotPlayers,
}: {
  hostId: string;
  localDisplayName: string;
  localPlayerId: string;
  previous: BattleshipOnlinePlayer[];
  snapshotPlayers: BattleshipPublicSnapshot['players'];
}): BattleshipOnlinePlayer[] => {
  const previousById = new Map(previous.map((player) => [player.id, player]));
  const merged = snapshotPlayers.map((player) => ({
    id: player.id,
    displayName:
      player.id === localPlayerId
        ? localDisplayName
        : player.displayName || previousById.get(player.id)?.displayName || player.id,
    joinedAt: previousById.get(player.id)?.joinedAt ?? player.joinedAt,
    isConnected: player.isConnected,
    isHost: player.id === hostId,
  }));

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
