import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  CLOSED_LOOP_REWARD_POLICY,
  ROOM_GAME_REGISTRY,
  createRoomGameRewardId,
  listRoomGames,
  normalizeRoomGameBody,
  resolveCreateRoomGameInvite,
  resolveCreditGameReward,
  resolveEndRoomGame,
  resolveJoinRoomGame,
  resolveLeaveRoomGame,
  validateRoomGameRequest,
} = require('./roomGameCore');

const nowMs = 2_000_000_000_000;
const requestId = 'roomgame_request_0001';
const roomId = 'room-1';
const sessionId = 'rgs_session_000000000001';

const baseMember = { status: 'active', uid: 'user-1' };
const baseProfile = {
  displayName: 'Ali',
  moderationStatus: 'active',
  uid: 'user-1',
};
const baseRoom = {
  availability: 'active',
  countryCode: 'IQ',
  id: roomId,
  ownerUid: 'owner-1',
  status: 'active',
};

describe('roomGameCore', () => {
  it('validates invite commands and rejects unknown games', () => {
    expect(validateRoomGameRequest(normalizeRoomGameBody({
      action: 'create-room-game-invite',
      clientVersion: '1.0.0',
      gameId: 'drawing-guess',
      requestId,
      roomId,
    })).ok).toBe(true);
    expect(validateRoomGameRequest(normalizeRoomGameBody({
      action: 'create-room-game-invite',
      clientVersion: '1.0.0',
      gameId: 'unknown-game',
      requestId,
      roomId,
    })).code).toBe('GAME_UNKNOWN');
  });

  it('registers every current room-launchable game with truthful session modes', () => {
    expect(ROOM_GAME_REGISTRY['drawing-guess']).toMatchObject({
      clientRoute: 'DrawingGuess',
      maxPlayers: 8,
      rewardPolicyId: CLOSED_LOOP_REWARD_POLICY.policyId,
    });
    expect(ROOM_GAME_REGISTRY['carrom-royal']).toMatchObject({
      clientRoute: 'Carrom',
      maxPlayers: 1,
      sessionMode: 'host-local',
      rewardPolicyId: CLOSED_LOOP_REWARD_POLICY.policyId,
    });
    expect(ROOM_GAME_REGISTRY['royal-majlis']).toMatchObject({
      clientRoute: 'MiniGame',
      maxPlayers: 1,
      sessionMode: 'host-local',
    });
    expect(ROOM_GAME_REGISTRY['naval-duel']).toMatchObject({
      clientRoute: 'MiniGame',
      maxPlayers: 2,
      minPlayers: 2,
      sessionMode: 'multiplayer',
      capabilities: expect.arrayContaining(['naval', 'fog-of-war', 'realtime']),
    });
    expect(CLOSED_LOOP_REWARD_POLICY).toMatchObject({
      cashRedemption: false,
      currency: 'gameRewards',
      mixWithGiftEarnings: false,
    });
  });

  it('fails closed when voice_room_games is not true', () => {
    expect(listRoomGames({ featureFlags: { voice_room_games: false } }).code).toBe('FEATURE_DISABLED');
    expect(resolveCreateRoomGameInvite({
      actorMembership: baseMember,
      command: { clientVersion: '1.0.0', gameId: 'drawing-guess', roomId },
      featureFlags: { voice_room_games: false },
      nowMs,
      publicProfile: baseProfile,
      room: baseRoom,
      senderUid: 'user-1',
      sessionId,
    }).code).toBe('FEATURE_DISABLED');
  });

  it('creates a lobby invite for any active member when no session conflict', () => {
    const created = resolveCreateRoomGameInvite({
      actorMembership: baseMember,
      command: { clientVersion: '1.0.0', gameId: 'drawing-guess', roomId },
      featureFlags: { voice_room_games: true },
      nowMs,
      publicProfile: baseProfile,
      room: baseRoom,
      senderUid: 'user-1',
      sessionId,
    });
    expect(created.ok).toBe(true);
    expect(created.value.session).toMatchObject({
      gameId: 'drawing-guess',
      hostUid: 'user-1',
      playerUids: ['user-1'],
      status: 'lobby',
    });
    expect(created.value.session.rewardPolicy.currency).toBe('gameRewards');
  });

  it('joins until full and leaves with abandon cleanup when empty', () => {
    const session = {
      expiresAtMs: nowMs + 60_000,
      hostUid: 'user-1',
      maxPlayers: 2,
      minPlayers: 2,
      playerCount: 1,
      playerUids: ['user-1'],
      roomId,
      sessionMode: 'multiplayer',
      sessionId,
      status: 'lobby',
    };
    const joined = resolveJoinRoomGame({
      actorMembership: { status: 'active', uid: 'user-2' },
      featureFlags: { voice_room_games: true },
      nowMs,
      publicProfile: { ...baseProfile, uid: 'user-2' },
      room: baseRoom,
      senderUid: 'user-2',
      session,
    });
    expect(joined.value.sessionPatch).toMatchObject({
      playerCount: 2,
      status: 'active',
    });

    const left = resolveLeaveRoomGame({
      featureFlags: { voice_room_games: true },
      nowMs,
      senderUid: 'user-1',
      session: {
        ...session,
        playerCount: 1,
        playerUids: ['user-1'],
        status: 'active',
      },
    });
    expect(left.value).toMatchObject({
      clearActiveSession: true,
      sessionPatch: { status: 'abandoned' },
    });
  });

  it('lets host or room staff end a session but rejects public reward settlement', () => {
    const session = {
      hostUid: 'user-1',
      playerUids: ['user-1', 'user-2'],
      rewardPolicy: { ...CLOSED_LOOP_REWARD_POLICY },
      sessionId,
      status: 'active',
    };
    expect(resolveEndRoomGame({
      actorMembership: baseMember,
      decodedToken: { uid: 'user-1' },
      nowMs,
      room: baseRoom,
      senderUid: 'user-1',
      session,
    }).value.sessionPatch.status).toBe('ended');

    const reward = resolveCreditGameReward({
      actorMembership: baseMember,
      amount: 50,
      decodedToken: { uid: 'user-1' },
      featureFlags: { voice_room_games: true },
      nowMs,
      room: baseRoom,
      senderUid: 'user-1',
      session,
      targetUid: 'user-2',
    });
    expect(reward.code).toBe('REWARD_SETTLEMENT_UNAVAILABLE');
    expect(resolveCreditGameReward({
      actorMembership: { status: 'active', uid: 'user-3' },
      amount: 50,
      decodedToken: { uid: 'user-3' },
      featureFlags: { voice_room_games: true },
      nowMs,
      room: baseRoom,
      senderUid: 'user-3',
      session,
      targetUid: 'user-2',
    }).code).toBe('REWARD_SETTLEMENT_UNAVAILABLE');
  });

  it('scopes reward claims to session+target so requestId cannot remint', () => {
    const first = createRoomGameRewardId(sessionId, 'user-2');
    const secondRequest = createRoomGameRewardId(sessionId, 'user-2');
    const otherTarget = createRoomGameRewardId(sessionId, 'user-3');
    const otherSession = createRoomGameRewardId('rgs_other_session_00000001', 'user-2');
    expect(first).toBe(secondRequest);
    expect(first).not.toBe(otherTarget);
    expect(first).not.toBe(otherSession);
    expect(first).toMatch(/^rgr_[a-f0-9]{24}$/);
  });

  it('gates coin entry behind roomGameEconomy and Drawing Guess only', () => {
    expect(resolveCreateRoomGameInvite({
      actorMembership: baseMember,
      command: { amount: 25, clientVersion: '1.0.0', gameId: 'drawing-guess', roomId },
      featureFlags: { voice_room_games: true },
      growthFeatures: {},
      nowMs,
      publicProfile: baseProfile,
      room: baseRoom,
      senderUid: 'user-1',
      sessionId,
    }).code).toBe('ECONOMY_DISABLED');

    const paid = resolveCreateRoomGameInvite({
      actorMembership: baseMember,
      command: { amount: 25, clientVersion: '1.0.0', gameId: 'drawing-guess', roomId },
      featureFlags: { voice_room_games: true },
      growthFeatures: { roomGameEconomy: true },
      nowMs,
      publicProfile: baseProfile,
      room: baseRoom,
      senderUid: 'user-1',
      sessionId,
    });
    expect(paid.ok).toBe(true);
    expect(paid.value.entryDebit).toEqual({ amount: 25, currency: 'coins', uid: 'user-1' });
    expect(paid.value.session.economy).toMatchObject({
      entryFeeCoins: 25,
      poolCoins: 25,
      settled: false,
    });

    expect(resolveCreateRoomGameInvite({
      actorMembership: baseMember,
      command: { amount: 25, clientVersion: '1.0.0', gameId: 'carrom-royal', roomId },
      featureFlags: { voice_room_games: true },
      growthFeatures: { roomGameEconomy: true },
      nowMs,
      publicProfile: baseProfile,
      room: baseRoom,
      senderUid: 'user-1',
      sessionId,
    }).code).toBe('ENTRY_FEE_UNSUPPORTED');
  });

  it('refunds lobby leavers and raffles prizes for active end', () => {
    const session = {
      economy: {
        currency: 'coins',
        entryFeeCoins: 10,
        paidEntries: { 'user-1': 10, 'user-2': 10 },
        poolCoins: 20,
        settled: false,
      },
      expiresAtMs: nowMs + 60_000,
      hostUid: 'user-1',
      maxPlayers: 8,
      minPlayers: 2,
      playerCount: 2,
      playerUids: ['user-1', 'user-2'],
      roomId,
      sessionId,
      sessionMode: 'multiplayer',
      status: 'lobby',
    };
    const left = resolveLeaveRoomGame({
      nowMs,
      senderUid: 'user-2',
      session,
    });
    expect(left.value.economyCredits).toEqual([
      { amount: 10, currency: 'coins', kind: 'refund', uid: 'user-2' },
    ]);
    expect(left.value.sessionPatch.economy.poolCoins).toBe(10);

    const active = {
      ...session,
      economy: {
        ...session.economy,
        paidEntries: { 'user-1': 10, 'user-2': 10 },
        poolCoins: 20,
      },
      status: 'active',
    };
    const ended = resolveEndRoomGame({
      actorMembership: { status: 'active', uid: 'user-1' },
      decodedToken: { uid: 'user-1' },
      nowMs,
      room: baseRoom,
      senderUid: 'user-1',
      session: active,
    });
    expect(ended.value.economyCredits).toHaveLength(1);
    expect(ended.value.economyCredits[0].amount).toBe(20);
    expect(ended.value.economyCredits[0].kind).toBe('prize');
    expect(['user-1', 'user-2']).toContain(ended.value.economyCredits[0].uid);
  });
});
