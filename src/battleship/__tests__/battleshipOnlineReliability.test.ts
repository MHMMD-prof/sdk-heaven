import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_algorithm: string, value: string) =>
    createHash('sha256').update(value).digest('hex'),
}));

import { MiniGameTarget } from '../../types/miniGame';
import { createFleetReadySeal } from '../online/fleetCommitment';
import {
  applyPublicBattleshipSnapshot,
  createAuthorityClaimGrace,
  createPublicBattleshipSnapshot,
  hasOnlineMatchProgress,
  observePeersForAuthorityClaimGrace,
  publicSnapshotLooksSafe,
  shouldClaimHostAfterAuthorityProbe,
  syncPresenceWithHostTransfer,
  tickAuthorityClaimGraceOnProbe,
} from '../online/onlineReliability';
import {
  battleshipOnlineReducer,
  canStartOnlinePlacement,
  createBattleshipOnlineState,
} from '../online/onlineSessionModel';

const fleet = (): MiniGameTarget[] => [
  {
    id: 'ship-a',
    name: 'A',
    shortLabel: 'A',
    footprint: { columns: 2, rows: 1 },
    cells: ['0-0', '0-1'],
    isPlaced: true,
  },
];

describe('naval-duel Wave 5 reliability', () => {
  it('creates fog-safe public snapshots that preserve private fleets on apply', async () => {
    const seal = await createFleetReadySeal(fleet());
    let state = createBattleshipOnlineState({
      displayName: 'Ali',
      hostId: 'host-1',
      localPlayerId: 'host-1',
      matchId: 'nd_match',
      roomId: 'room-1',
      sessionId: 'rgs_1',
    });
    state = battleshipOnlineReducer(state, {
      type: 'battle-started',
      firstPlayerId: 'host-1',
      matchId: 'nd_match',
      now: 1,
    });
    state = {
      ...state,
      localFleet: fleet(),
      readySeals: {
        'host-1': seal,
        'joiner-2': {
          commitment: 'b'.repeat(64),
          fleetCellCount: 2,
          targetCount: 1,
        },
      },
      resolvedShots: [
        {
          attackerId: 'host-1',
          cellId: '3-3',
          nextTurnPlayerId: 'joiner-2',
          result: 'miss',
          shotId: 'shot-1',
        },
      ],
      outgoingResults: { '3-3': 'miss' },
    };

    const snapshot = createPublicBattleshipSnapshot(state);
    expect(publicSnapshotLooksSafe(snapshot)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/0-0|localFleet|"cells"/);

    const guestPrevious = createBattleshipOnlineState({
      displayName: 'Sara',
      hostId: 'host-1',
      localPlayerId: 'joiner-2',
      matchId: 'pending-rgs_1',
      roomId: 'room-1',
      sessionId: 'rgs_1',
    });
    const restored = applyPublicBattleshipSnapshot({
      localDisplayName: 'Sara',
      localPlayerId: 'joiner-2',
      previous: {
        ...guestPrevious,
        localFleet: fleet(),
      },
      snapshot,
    });

    expect(restored.matchId).toBe('nd_match');
    expect(restored.phase).toBe('battle');
    expect(restored.incomingResults['3-3']).toBe('miss');
    expect(restored.localFleet?.[0]?.cells).toEqual(['0-0', '0-1']);
  });

  it('never force-claims host authority while a peer is still connected', () => {
    expect(
      shouldClaimHostAfterAuthorityProbe({
        consecutivePeerAbsentIntervals: 5,
        hasClaimedLobby: false,
        hasMatchProgress: false,
        isLocalHost: true,
        peersConnected: true,
      }),
    ).toBe(false);

    expect(
      shouldClaimHostAfterAuthorityProbe({
        consecutivePeerAbsentIntervals: 1,
        hasClaimedLobby: false,
        hasMatchProgress: false,
        isLocalHost: true,
        peersConnected: false,
      }),
    ).toBe(false);

    expect(
      shouldClaimHostAfterAuthorityProbe({
        consecutivePeerAbsentIntervals: 2,
        hasClaimedLobby: false,
        hasMatchProgress: false,
        isLocalHost: true,
        peersConnected: false,
      }),
    ).toBe(true);

    expect(
      shouldClaimHostAfterAuthorityProbe({
        consecutivePeerAbsentIntervals: 2,
        hasClaimedLobby: false,
        hasMatchProgress: true,
        isLocalHost: true,
        peersConnected: false,
      }),
    ).toBe(false);
  });

  it('resets claim grace when a peer reappears between absent intervals', () => {
    let grace = createAuthorityClaimGrace();
    grace = observePeersForAuthorityClaimGrace(grace, true);
    grace = tickAuthorityClaimGraceOnProbe(grace, false);
    expect(grace.consecutivePeerAbsentIntervals).toBe(1);
    expect(
      shouldClaimHostAfterAuthorityProbe({
        consecutivePeerAbsentIntervals: grace.consecutivePeerAbsentIntervals,
        hasClaimedLobby: false,
        hasMatchProgress: false,
        isLocalHost: true,
        peersConnected: false,
      }),
    ).toBe(false);

    grace = observePeersForAuthorityClaimGrace(grace, true);
    expect(grace.consecutivePeerAbsentIntervals).toBe(0);
    expect(
      shouldClaimHostAfterAuthorityProbe({
        consecutivePeerAbsentIntervals: grace.consecutivePeerAbsentIntervals,
        hasClaimedLobby: false,
        hasMatchProgress: false,
        isLocalHost: true,
        peersConnected: false,
      }),
    ).toBe(false);
  });

  it('transfers host when the previous host drops from presence', () => {
    const state = createBattleshipOnlineState({
      displayName: 'Sara',
      hostId: 'host-1',
      localPlayerId: 'joiner-2',
      matchId: 'nd_match',
      roomId: 'room-1',
      sessionId: 'rgs_1',
    });
    const withPeer = {
      ...state,
      players: [
        {
          id: 'host-1',
          displayName: 'Ali',
          joinedAt: 1,
          isConnected: true,
          isHost: true,
        },
        {
          id: 'joiner-2',
          displayName: 'Sara',
          joinedAt: 2,
          isConnected: true,
          isHost: false,
        },
      ],
    };

    const synced = syncPresenceWithHostTransfer({
      localDisplayName: 'Sara',
      localPlayerId: 'joiner-2',
      players: [
        { id: 'joiner-2', displayName: 'Sara', joinedAt: 2, isConnected: true },
      ],
      state: withPeer,
    });

    expect(synced.becameHost).toBe(true);
    expect(synced.state.hostId).toBe('joiner-2');
    expect(synced.opponentConnected).toBe(false);
    expect(synced.state.players.find((player) => player.id === 'host-1')?.isConnected).toBe(false);
  });

  it('keeps sticky host when the original host reconnects during a live match', () => {
    const joinerAsHost = {
      ...createBattleshipOnlineState({
        displayName: 'Sara',
        hostId: 'joiner-2',
        localPlayerId: 'joiner-2',
        matchId: 'nd_match',
        roomId: 'room-1',
        sessionId: 'rgs_1',
      }),
      hostId: 'joiner-2',
      phase: 'battle' as const,
      battleStartedAt: 10,
      resolvedShots: [
        {
          attackerId: 'joiner-2',
          cellId: '1-1',
          nextTurnPlayerId: 'host-1',
          result: 'miss' as const,
          shotId: 's1',
        },
      ],
      players: [
        {
          id: 'host-1',
          displayName: 'Ali',
          joinedAt: 1,
          isConnected: false,
          isHost: false,
        },
        {
          id: 'joiner-2',
          displayName: 'Sara',
          joinedAt: 2,
          isConnected: true,
          isHost: true,
        },
      ],
    };

    const synced = syncPresenceWithHostTransfer({
      localDisplayName: 'Sara',
      localPlayerId: 'joiner-2',
      players: [
        { id: 'host-1', displayName: 'Ali', joinedAt: 99, isConnected: true },
        { id: 'joiner-2', displayName: 'Sara', joinedAt: 2, isConnected: true },
      ],
      state: joinerAsHost,
    });

    expect(synced.state.hostId).toBe('joiner-2');
    expect(synced.becameHost).toBe(false);
  });

  it('rejects remounter lobby announce that would clobber a live battle matchId', () => {
    const survivor = {
      ...createBattleshipOnlineState({
        displayName: 'Sara',
        hostId: 'joiner-2',
        localPlayerId: 'joiner-2',
        matchId: 'nd_live_match',
        now: 2,
        roomId: 'room-1',
        sessionId: 'rgs_1',
      }),
      hostId: 'joiner-2',
      phase: 'battle' as const,
      battleStartedAt: 10,
      resolvedShots: [
        {
          attackerId: 'joiner-2',
          cellId: '1-1',
          nextTurnPlayerId: 'host-1',
          result: 'miss' as const,
          shotId: 's1',
        },
      ],
      players: [
        {
          id: 'host-1',
          displayName: 'Ali',
          joinedAt: 1,
          isConnected: true,
          isHost: false,
        },
        {
          id: 'joiner-2',
          displayName: 'Sara',
          joinedAt: 2,
          isConnected: true,
          isHost: true,
        },
      ],
    };

    const ignored = battleshipOnlineReducer(survivor, {
      type: 'apply-lobby-announce',
      hostId: 'host-1',
      matchId: 'nd_fresh_empty',
      players: [
        { id: 'host-1', displayName: 'Ali', joinedAt: 1, isConnected: true },
        { id: 'joiner-2', displayName: 'Sara', joinedAt: 2, isConnected: true },
      ],
    });

    expect(ignored.matchId).toBe('nd_live_match');
    expect(ignored.hostId).toBe('joiner-2');
    expect(ignored.resolvedShots).toHaveLength(1);
  });

  it('rejects empty lobby snapshots that would wipe battle history', () => {
    const previous = {
      ...createBattleshipOnlineState({
        displayName: 'Sara',
        hostId: 'joiner-2',
        localPlayerId: 'joiner-2',
        matchId: 'nd_live_match',
        roomId: 'room-1',
        sessionId: 'rgs_1',
      }),
      hostId: 'joiner-2',
      phase: 'battle' as const,
      resolvedShots: [
        {
          attackerId: 'joiner-2',
          cellId: '1-1',
          nextTurnPlayerId: 'host-1',
          result: 'miss' as const,
          shotId: 's1',
        },
      ],
      outgoingResults: { '1-1': 'miss' as const },
    };

    const emptySnapshot = createPublicBattleshipSnapshot({
      ...createBattleshipOnlineState({
        displayName: 'Ali',
        hostId: 'host-1',
        localPlayerId: 'host-1',
        matchId: 'nd_fresh_empty',
        roomId: 'room-1',
        sessionId: 'rgs_1',
      }),
      hostId: 'host-1',
      phase: 'lobby',
      players: [
        {
          id: 'host-1',
          displayName: 'Ali',
          joinedAt: 1,
          isConnected: true,
          isHost: true,
        },
        {
          id: 'joiner-2',
          displayName: 'Sara',
          joinedAt: 2,
          isConnected: true,
          isHost: false,
        },
      ],
    });

    const kept = applyPublicBattleshipSnapshot({
      localDisplayName: 'Sara',
      localPlayerId: 'joiner-2',
      previous,
      snapshot: emptySnapshot,
    });

    expect(kept.phase).toBe('battle');
    expect(kept.matchId).toBe('nd_live_match');
    expect(kept.resolvedShots).toHaveLength(1);
  });

  it('rejects same-matchId lobby snapshots that would regress a zero-shot battle', () => {
    const previous = {
      ...createBattleshipOnlineState({
        displayName: 'Sara',
        hostId: 'joiner-2',
        localPlayerId: 'joiner-2',
        matchId: 'nd_live_match',
        roomId: 'room-1',
        sessionId: 'rgs_1',
      }),
      hostId: 'joiner-2',
      phase: 'battle' as const,
      battleStartedAt: 10,
      resolvedShots: [] as [],
    };

    const lobbySnap = createPublicBattleshipSnapshot({
      ...createBattleshipOnlineState({
        displayName: 'Ali',
        hostId: 'host-1',
        localPlayerId: 'host-1',
        matchId: 'nd_live_match',
        roomId: 'room-1',
        sessionId: 'rgs_1',
      }),
      hostId: 'host-1',
      phase: 'lobby',
      players: [
        {
          id: 'host-1',
          displayName: 'Ali',
          joinedAt: 1,
          isConnected: true,
          isHost: true,
        },
        {
          id: 'joiner-2',
          displayName: 'Sara',
          joinedAt: 2,
          isConnected: true,
          isHost: false,
        },
      ],
    });

    const kept = applyPublicBattleshipSnapshot({
      localDisplayName: 'Sara',
      localPlayerId: 'joiner-2',
      previous,
      snapshot: lobbySnap,
    });

    expect(kept.phase).toBe('battle');
    expect(kept.battleStartedAt).toBe(10);
  });

  it('keeps remounter without progress eligible to adopt survivor battle snapshot', () => {
    const remounter = {
      ...createBattleshipOnlineState({
        displayName: 'Ali',
        hostId: 'host-1',
        localPlayerId: 'host-1',
        matchId: 'nd_fresh_empty',
        roomId: 'room-1',
        sessionId: 'rgs_1',
      }),
      connectionStatus: 'connected' as const,
      opponentConnected: true,
      players: [
        {
          id: 'host-1',
          displayName: 'Ali',
          joinedAt: 10,
          isConnected: true,
          isHost: true,
        },
        {
          id: 'joiner-2',
          displayName: 'Sara',
          joinedAt: 2,
          isConnected: true,
          isHost: false,
        },
      ],
    };

    expect(hasOnlineMatchProgress(remounter)).toBe(false);
    // Presence must probe instead of placement-start while this is true.
    expect(canStartOnlinePlacement(remounter)).toBe(true);

    const survivorSnapshot = createPublicBattleshipSnapshot({
      ...createBattleshipOnlineState({
        displayName: 'Sara',
        hostId: 'joiner-2',
        localPlayerId: 'joiner-2',
        matchId: 'nd_live_match',
        roomId: 'room-1',
        sessionId: 'rgs_1',
      }),
      hostId: 'joiner-2',
      phase: 'battle',
      currentTurnPlayerId: 'joiner-2',
      firstPlayerId: 'joiner-2',
      resolvedShots: [
        {
          attackerId: 'joiner-2',
          cellId: '1-1',
          nextTurnPlayerId: 'host-1',
          result: 'miss',
          shotId: 's1',
        },
      ],
      players: [
        {
          id: 'host-1',
          displayName: 'Ali',
          joinedAt: 1,
          isConnected: true,
          isHost: false,
        },
        {
          id: 'joiner-2',
          displayName: 'Sara',
          joinedAt: 2,
          isConnected: true,
          isHost: true,
        },
      ],
    });

    const yielded = battleshipOnlineReducer(remounter, {
      type: 'host-yielded',
      hostId: 'joiner-2',
      matchId: 'nd_live_match',
    });
    const adopted = applyPublicBattleshipSnapshot({
      localDisplayName: 'Ali',
      localPlayerId: 'host-1',
      previous: yielded,
      snapshot: survivorSnapshot,
    });

    expect(adopted.phase).toBe('battle');
    expect(adopted.matchId).toBe('nd_live_match');
    expect(adopted.hostId).toBe('joiner-2');
    expect(adopted.resolvedShots).toHaveLength(1);
  });

  it('preserves local joinedAt across ensure-local-player', () => {
    let state = createBattleshipOnlineState({
      displayName: 'Sara',
      hostId: 'joiner-2',
      localPlayerId: 'joiner-2',
      matchId: 'nd_match',
      now: 2,
      roomId: 'room-1',
      sessionId: 'rgs_1',
    });
    state = battleshipOnlineReducer(state, {
      type: 'ensure-local-player',
      displayName: 'Sara',
    });
    expect(state.players.find((player) => player.id === 'joiner-2')?.joinedAt).toBe(2);
  });

  it('keeps opponentConnected true when applying a connected battle snapshot', () => {
    const previous = createBattleshipOnlineState({
      displayName: 'Sara',
      hostId: 'host-1',
      localPlayerId: 'joiner-2',
      matchId: 'pending-rgs_1',
      roomId: 'room-1',
      sessionId: 'rgs_1',
    });
    expect(previous.opponentConnected).toBe(false);

    const snapshot = createPublicBattleshipSnapshot({
      ...createBattleshipOnlineState({
        displayName: 'Ali',
        hostId: 'host-1',
        localPlayerId: 'host-1',
        matchId: 'nd_match',
        roomId: 'room-1',
        sessionId: 'rgs_1',
      }),
      opponentConnected: true,
      phase: 'battle',
      currentTurnPlayerId: 'host-1',
      firstPlayerId: 'host-1',
      players: [
        {
          id: 'host-1',
          displayName: 'Ali',
          joinedAt: 1,
          isConnected: true,
          isHost: true,
        },
        {
          id: 'joiner-2',
          displayName: 'Sara',
          joinedAt: 2,
          isConnected: true,
          isHost: false,
        },
      ],
    });

    const applied = applyPublicBattleshipSnapshot({
      localDisplayName: 'Sara',
      localPlayerId: 'joiner-2',
      previous,
      snapshot,
    });

    expect(applied.opponentConnected).toBe(true);
    expect(applied.phase).toBe('battle');
  });

  it('does not wipe shot maps when battle-started is replayed', () => {
    let state = createBattleshipOnlineState({
      displayName: 'Ali',
      hostId: 'host-1',
      localPlayerId: 'host-1',
      matchId: 'nd_match',
      roomId: 'room-1',
      sessionId: 'rgs_1',
    });
    state = battleshipOnlineReducer(state, {
      type: 'battle-started',
      firstPlayerId: 'host-1',
      matchId: 'nd_match',
      now: 1,
    });
    state = battleshipOnlineReducer(state, {
      type: 'apply-shot-resolved',
      shot: {
        attackerId: 'host-1',
        cellId: '1-1',
        nextTurnPlayerId: 'host-1',
        result: 'hit',
        shotId: 's1',
      },
    });
    state = battleshipOnlineReducer(state, {
      type: 'battle-started',
      firstPlayerId: 'host-1',
      matchId: 'nd_match',
      now: 2,
    });

    expect(state.phase).toBe('battle');
    expect(state.outgoingResults['1-1']).toBe('hit');
    expect(state.resolvedShots).toHaveLength(1);
  });

  it('accepts lobby announce onto pending bootstrap state', () => {
    const pending = createBattleshipOnlineState({
      displayName: 'Sara',
      hostId: 'host-1',
      localPlayerId: 'joiner-2',
      matchId: 'pending-rgs_1',
      roomId: 'room-1',
      sessionId: 'rgs_1',
    });

    const accepted = battleshipOnlineReducer(pending, {
      type: 'apply-lobby-announce',
      hostId: 'host-1',
      matchId: 'nd_match',
      players: [
        { id: 'host-1', displayName: 'Ali', joinedAt: 1, isConnected: true },
        { id: 'joiner-2', displayName: 'Sara', joinedAt: 2, isConnected: true },
      ],
    });

    expect(accepted.hostId).toBe('host-1');
    expect(accepted.matchId).toBe('nd_match');
    expect(accepted.opponentConnected).toBe(true);
  });

  it('lets empty remounter yield via host-yielded then adopt peer match', () => {
    let remounter = createBattleshipOnlineState({
      displayName: 'Ali',
      hostId: 'host-1',
      localPlayerId: 'host-1',
      matchId: 'nd_fresh_empty',
      roomId: 'room-1',
      sessionId: 'rgs_1',
    });

    remounter = battleshipOnlineReducer(remounter, {
      type: 'host-yielded',
      hostId: 'joiner-2',
      matchId: 'nd_live_match',
    });
    remounter = battleshipOnlineReducer(remounter, {
      type: 'apply-lobby-announce',
      hostId: 'joiner-2',
      matchId: 'nd_live_match',
      players: [
        { id: 'host-1', displayName: 'Ali', joinedAt: 10, isConnected: true },
        { id: 'joiner-2', displayName: 'Sara', joinedAt: 2, isConnected: true },
      ],
    });

    expect(remounter.hostId).toBe('joiner-2');
    expect(remounter.matchId).toBe('nd_live_match');
  });

  it('rejects same-matchId stale snapshots that shrink resolved shot history', () => {
    const previous = {
      ...createBattleshipOnlineState({
        displayName: 'Sara',
        hostId: 'joiner-2',
        localPlayerId: 'joiner-2',
        matchId: 'nd_live_match',
        roomId: 'room-1',
        sessionId: 'rgs_1',
      }),
      hostId: 'joiner-2',
      phase: 'battle' as const,
      resolvedShots: [
        {
          attackerId: 'joiner-2',
          cellId: '1-1',
          nextTurnPlayerId: 'host-1',
          result: 'miss' as const,
          shotId: 's1',
        },
        {
          attackerId: 'host-1',
          cellId: '2-2',
          nextTurnPlayerId: 'joiner-2',
          result: 'miss' as const,
          shotId: 's2',
        },
      ],
      outgoingResults: { '1-1': 'miss' as const },
      incomingResults: { '2-2': 'miss' as const },
    };

    const stale = createPublicBattleshipSnapshot({
      ...previous,
      resolvedShots: [previous.resolvedShots[0]],
      hostId: 'joiner-2',
      phase: 'battle',
    });

    const kept = applyPublicBattleshipSnapshot({
      localDisplayName: 'Sara',
      localPlayerId: 'joiner-2',
      previous,
      snapshot: stale,
    });

    expect(kept.resolvedShots).toHaveLength(2);
    expect(kept.incomingResults['2-2']).toBe('miss');
  });

  it('rejects equal-length divergent shot histories that are not a prefix', () => {
    const previous = {
      ...createBattleshipOnlineState({
        displayName: 'Sara',
        hostId: 'joiner-2',
        localPlayerId: 'joiner-2',
        matchId: 'nd_live_match',
        roomId: 'room-1',
        sessionId: 'rgs_1',
      }),
      hostId: 'joiner-2',
      phase: 'battle' as const,
      resolvedShots: [
        {
          attackerId: 'joiner-2',
          cellId: '1-1',
          nextTurnPlayerId: 'host-1',
          result: 'miss' as const,
          shotId: 's1',
        },
      ],
      outgoingResults: { '1-1': 'miss' as const },
    };

    const divergent = createPublicBattleshipSnapshot({
      ...previous,
      resolvedShots: [
        {
          attackerId: 'host-1',
          cellId: '9-9',
          nextTurnPlayerId: 'joiner-2',
          result: 'hit' as const,
          shotId: 'evil',
        },
      ],
    });

    const kept = applyPublicBattleshipSnapshot({
      localDisplayName: 'Sara',
      localPlayerId: 'joiner-2',
      previous,
      snapshot: divergent,
    });

    expect(kept.resolvedShots[0]?.shotId).toBe('s1');
    expect(kept.outgoingResults['1-1']).toBe('miss');
  });

  it('accepts same-match snapshots that extend prior shot history', () => {
    const previous = {
      ...createBattleshipOnlineState({
        displayName: 'Sara',
        hostId: 'joiner-2',
        localPlayerId: 'joiner-2',
        matchId: 'nd_live_match',
        roomId: 'room-1',
        sessionId: 'rgs_1',
      }),
      hostId: 'joiner-2',
      phase: 'battle' as const,
      resolvedShots: [
        {
          attackerId: 'joiner-2',
          cellId: '1-1',
          nextTurnPlayerId: 'host-1',
          result: 'miss' as const,
          shotId: 's1',
        },
      ],
      outgoingResults: { '1-1': 'miss' as const },
    };

    const extended = createPublicBattleshipSnapshot({
      ...previous,
      resolvedShots: [
        previous.resolvedShots[0],
        {
          attackerId: 'host-1',
          cellId: '2-2',
          nextTurnPlayerId: 'joiner-2',
          result: 'miss' as const,
          shotId: 's2',
        },
      ],
    });

    const applied = applyPublicBattleshipSnapshot({
      localDisplayName: 'Sara',
      localPlayerId: 'joiner-2',
      previous,
      snapshot: extended,
    });

    expect(applied.resolvedShots).toHaveLength(2);
    expect(applied.incomingResults['2-2']).toBe('miss');
  });

  it('ignores foreign host announce while local linked host has no pending match', () => {
    const state = {
      ...createBattleshipOnlineState({
        displayName: 'Sara',
        hostId: 'joiner-2',
        localPlayerId: 'joiner-2',
        matchId: 'nd_match',
        now: 2,
        roomId: 'room-1',
        sessionId: 'rgs_1',
      }),
      hostId: 'joiner-2',
    };

    const ignored = battleshipOnlineReducer(state, {
      type: 'apply-lobby-announce',
      hostId: 'host-1',
      matchId: 'nd_spoof',
      players: [
        { id: 'host-1', displayName: 'Ali', joinedAt: 10, isConnected: true },
        { id: 'joiner-2', displayName: 'Sara', joinedAt: 2, isConnected: true },
      ],
    });

    expect(ignored.matchId).toBe('nd_match');
    expect(ignored.hostId).toBe('joiner-2');
  });
});
