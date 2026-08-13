const { createHash } = require('node:crypto');

const ROOM_GAME_ACTIONS = Object.freeze([
  'list-room-games',
  'create-room-game-invite',
  'join-room-game',
  'leave-room-game',
  'end-room-game',
]);

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const FIRESTORE_ID_PATTERN = /^[^/]{1,128}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const CLIENT_VERSION_PATTERN = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(?:[-+][A-Za-z0-9.-]{1,24})?$/;

const LOBBY_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 60 * 60 * 1000;
const MAX_REWARD_CREDIT = 5_000;
const ROOM_GAME_ALLOWED_ENTRY_FEES = Object.freeze([0, 10, 25, 50]);
const ROOM_GAME_MAX_ENTRY_FEE = 50;
const ROOM_GAME_ECONOMY_SETTLEMENT_MODE = 'entertainment-raffle-v1';
const GAME_COMMAND_RETENTION_MS = 24 * 60 * 60 * 1000;
const GAME_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const CLOSED_LOOP_REWARD_POLICY = Object.freeze({
  cashRedemption: false,
  currency: 'gameRewards',
  mixWithGiftEarnings: false,
  policyId: 'closed-loop-v1',
  version: 1,
});

const ROOM_GAME_REGISTRY = Object.freeze({
  'drawing-guess': Object.freeze({
    capabilities: Object.freeze(['lobby', 'realtime', 'voice-compatible', 'draw', 'coin-entry']),
    clientRoute: 'DrawingGuess',
    displayName: Object.freeze({ ar: 'خمن الرسم', en: 'Drawing Guess' }),
    gameId: 'drawing-guess',
    maxPlayers: 8,
    minPlayers: 2,
    minimumClientVersion: '1.0.0',
    regions: Object.freeze(['*']),
    rewardsEnabled: false,
    rewardPolicyId: CLOSED_LOOP_REWARD_POLICY.policyId,
    sessionMode: 'multiplayer',
    supportsCoinEntry: true,
  }),
  'carrom-royal': Object.freeze({
    capabilities: Object.freeze(['host-local', 'local-table', 'voice-compatible']),
    clientRoute: 'Carrom',
    displayName: Object.freeze({ ar: 'كاروم رويال', en: 'Carrom Royal' }),
    gameId: 'carrom-royal',
    maxPlayers: 1,
    minPlayers: 1,
    minimumClientVersion: '1.0.0',
    regions: Object.freeze(['*']),
    rewardsEnabled: false,
    rewardPolicyId: CLOSED_LOOP_REWARD_POLICY.policyId,
    sessionMode: 'host-local',
  }),
  'royal-majlis': Object.freeze({
    capabilities: Object.freeze(['host-local', 'naval', 'farm', 'voice-compatible']),
    clientRoute: 'MiniGame',
    displayName: Object.freeze({ ar: 'مجلس الملوك', en: 'Royal Majlis' }),
    gameId: 'royal-majlis',
    maxPlayers: 1,
    minPlayers: 1,
    minimumClientVersion: '1.0.0',
    regions: Object.freeze(['*']),
    rewardsEnabled: false,
    rewardPolicyId: CLOSED_LOOP_REWARD_POLICY.policyId,
    sessionMode: 'host-local',
  }),
  'naval-duel': Object.freeze({
    capabilities: Object.freeze(['lobby', 'realtime', 'voice-compatible', 'naval', 'fog-of-war']),
    clientRoute: 'MiniGame',
    displayName: Object.freeze({ ar: 'مبارزة البحر', en: 'Naval Duel' }),
    gameId: 'naval-duel',
    maxPlayers: 2,
    minPlayers: 2,
    minimumClientVersion: '1.0.0',
    regions: Object.freeze(['*']),
    rewardsEnabled: false,
    rewardPolicyId: CLOSED_LOOP_REWARD_POLICY.policyId,
    sessionMode: 'multiplayer',
  }),
});

function normalizeRoomGameBody(body = {}) {
  return {
    action: typeof body.action === 'string' ? body.action.trim() : '',
    amount: Number.isInteger(body.amount) && body.amount >= 1 ? body.amount : 0,
    clientVersion: typeof body.clientVersion === 'string' ? body.clientVersion.trim() : '',
    gameId: typeof body.gameId === 'string' ? body.gameId.trim() : '',
    regionCode: typeof body.regionCode === 'string' ? body.regionCode.trim().toUpperCase() : '',
    requestId: typeof body.requestId === 'string' ? body.requestId.trim() : '',
    roomId: typeof body.roomId === 'string' ? body.roomId.trim() : '',
    sessionId: typeof body.sessionId === 'string' ? body.sessionId.trim() : '',
    targetUid: typeof body.targetUid === 'string' ? body.targetUid.trim() : '',
  };
}

function validateRoomGameRequest(command) {
  if (
    !ROOM_GAME_ACTIONS.includes(command.action)
    || !FIRESTORE_ID_PATTERN.test(command.roomId)
    || !CLIENT_VERSION_PATTERN.test(command.clientVersion)
  ) {
    return roomGameError('INVALID_REQUEST', 400, 'A valid room game command is required.');
  }
  if (!REQUEST_ID_PATTERN.test(command.requestId)) {
    return roomGameError('INVALID_REQUEST', 400, 'A valid request ID is required.');
  }
  if (command.action === 'list-room-games') {
    return { ok: true, value: command };
  }
  if (command.action === 'create-room-game-invite') {
    if (!ROOM_GAME_REGISTRY[command.gameId]) {
      return roomGameError('GAME_UNKNOWN', 404, 'The requested room game is not registered.');
    }
    return { ok: true, value: command };
  }
  if (!SESSION_ID_PATTERN.test(command.sessionId)) {
    return roomGameError('INVALID_REQUEST', 400, 'A valid game session ID is required.');
  }
  return { ok: true, value: command };
}

function listRoomGames({ featureFlags, regionCode = '' }) {
  if (featureFlags?.voice_room_games !== true) {
    return roomGameError('FEATURE_DISABLED', 503, 'Room-linked games are not enabled.');
  }
  const games = Object.values(ROOM_GAME_REGISTRY)
    .filter((game) => isGameAvailableInRegion(game, regionCode))
    .map((game) => ({
      ...game,
      entryFeeOptions: game.supportsCoinEntry === true ? [...ROOM_GAME_ALLOWED_ENTRY_FEES] : [0],
      rewardPolicy: snapshotRewardPolicy(game.rewardPolicyId),
    }));
  return {
    ok: true,
    value: {
      games,
      rewardPolicy: { ...CLOSED_LOOP_REWARD_POLICY },
    },
  };
}

function resolveCreateRoomGameInvite({
  actorMembership,
  command,
  featureFlags,
  growthFeatures,
  nowMs,
  publicProfile,
  room,
  senderUid,
  sessionId,
}) {
  if (featureFlags?.voice_room_games !== true) {
    return roomGameError('FEATURE_DISABLED', 503, 'Room-linked games are not enabled.');
  }
  if (room?.gamesPaused === true || (room?.staffLockdown && typeof room.staffLockdown === 'object')) {
    return roomGameError('GAMES_PAUSED', 409, 'Room games are paused by staff lockdown.');
  }
  if (!isActiveRoom(room)) {
    return roomGameError('ROOM_NOT_ACTIVE', 409, 'The room is not available for games.');
  }
  if (!isEligiblePublicProfile(publicProfile, senderUid)) {
    return roomGameError('ACCOUNT_RESTRICTED', 403, 'A complete active profile is required.');
  }
  if (!isActiveMembership(actorMembership, senderUid)) {
    return roomGameError('MEMBERSHIP_REQUIRED', 403, 'Active room membership is required.');
  }
  const game = ROOM_GAME_REGISTRY[command.gameId];
  if (!game) {
    return roomGameError('GAME_UNKNOWN', 404, 'The requested room game is not registered.');
  }
  if (compareClientVersions(command.clientVersion, game.minimumClientVersion) < 0) {
    return roomGameError('CLIENT_UPDATE_REQUIRED', 426, 'Update the app before starting this room game.');
  }
  if (!isGameAvailableInRegion(game, room.countryCode || command.regionCode)) {
    return roomGameError('GAME_REGION_BLOCKED', 403, 'This game is not available in the room region.');
  }
  const rewardPolicy = snapshotRewardPolicy(game.rewardPolicyId);
  if (!rewardPolicy || rewardPolicy.currency !== 'gameRewards' || rewardPolicy.cashRedemption) {
    return roomGameError('REWARD_POLICY_INVALID', 503, 'Closed-loop game reward policy is misconfigured.');
  }
  const entryFee = resolveRoomGameEntryFee({
    amount: command.amount,
    game,
    growthFeatures,
  });
  if (!entryFee.ok) return entryFee;
  const fee = entryFee.value;
  return {
    ok: true,
    value: {
      entryDebit: fee > 0
        ? { amount: fee, currency: 'coins', uid: senderUid }
        : null,
      session: {
        clientRoute: game.clientRoute,
        createdAtMs: nowMs,
        economy: buildSessionEconomy({ entryFeeCoins: fee, hostUid: senderUid }),
        expiresAtMs: nowMs + (game.minPlayers <= 1 ? SESSION_TTL_MS : LOBBY_TTL_MS),
        gameId: game.gameId,
        hostUid: senderUid,
        maxPlayers: game.maxPlayers,
        minPlayers: game.minPlayers,
        playerCount: 1,
        playerUids: [senderUid],
        rewardPolicy,
        rewardsEnabled: game.rewardsEnabled === true,
        roomId: command.roomId,
        sessionId,
        sessionMode: game.sessionMode,
        status: game.minPlayers <= 1 ? 'active' : 'lobby',
        updatedAtMs: nowMs,
      },
    },
  };
}

function resolveJoinRoomGame({
  actorMembership,
  featureFlags,
  nowMs,
  publicProfile,
  room,
  senderUid,
  session,
}) {
  if (featureFlags?.voice_room_games !== true) {
    return roomGameError('FEATURE_DISABLED', 503, 'Room-linked games are not enabled.');
  }
  if (room?.gamesPaused === true || (room?.staffLockdown && typeof room.staffLockdown === 'object')) {
    return roomGameError('GAMES_PAUSED', 409, 'Room games are paused by staff lockdown.');
  }
  if (!isActiveRoom(room)) {
    return roomGameError('ROOM_NOT_ACTIVE', 409, 'The room is not available for games.');
  }
  if (!isEligiblePublicProfile(publicProfile, senderUid)) {
    return roomGameError('ACCOUNT_RESTRICTED', 403, 'A complete active profile is required.');
  }
  if (!isActiveMembership(actorMembership, senderUid)) {
    return roomGameError('MEMBERSHIP_REQUIRED', 403, 'Active room membership is required.');
  }
  if (!session) {
    return roomGameError('SESSION_NOT_FOUND', 404, 'Game session was not found.');
  }
  if (session.sessionMode !== 'multiplayer') {
    return roomGameError('SESSION_NOT_JOINABLE', 409, 'This room activity is controlled on the host device.');
  }
  if (session.roomId && room?.id && session.roomId !== room.id) {
    return roomGameError('SESSION_ROOM_MISMATCH', 409, 'Game session does not belong to this room.');
  }
  if (!isOpenGameSession(session, nowMs)) {
    return roomGameError('SESSION_NOT_JOINABLE', 409, 'This game session cannot be joined.');
  }
  const playerUids = Array.isArray(session.playerUids) ? session.playerUids.filter((uid) => typeof uid === 'string') : [];
  if (playerUids.includes(senderUid)) {
    return {
      ok: true,
      value: {
        alreadyJoined: true,
        session: mapSessionPublic(session),
      },
    };
  }
  if (playerUids.length >= Number(session.maxPlayers || 0)) {
    return roomGameError('SESSION_FULL', 409, 'This game session is full.');
  }
  const nextPlayers = [...playerUids, senderUid];
  const entryFeeCoins = Number(session.economy?.entryFeeCoins) || 0;
  const entryDebit = entryFeeCoins > 0
    ? { amount: entryFeeCoins, currency: 'coins', uid: senderUid }
    : null;
  const paidEntries = {
    ...(session.economy?.paidEntries && typeof session.economy.paidEntries === 'object'
      ? session.economy.paidEntries
      : {}),
  };
  if (entryDebit) paidEntries[senderUid] = entryFeeCoins;
  const poolCoins = (Number(session.economy?.poolCoins) || 0) + (entryDebit ? entryFeeCoins : 0);
  return {
    ok: true,
    value: {
      alreadyJoined: false,
      entryDebit,
      sessionPatch: {
        ...(entryDebit
          ? {
              economy: {
                ...(session.economy || {}),
                currency: 'coins',
                entryFeeCoins,
                paidEntries,
                poolCoins,
                settled: session.economy?.settled === true,
                settlementMode: session.economy?.settlementMode || ROOM_GAME_ECONOMY_SETTLEMENT_MODE,
              },
            }
          : {}),
        playerCount: nextPlayers.length,
        playerUids: nextPlayers,
        status: nextPlayers.length >= Number(session.minPlayers || 2) ? 'active' : session.status,
        updatedAtMs: nowMs,
        ...(session.status === 'lobby' && nextPlayers.length >= Number(session.minPlayers || 2)
          ? { expiresAtMs: nowMs + SESSION_TTL_MS }
          : {}),
      },
    },
  };
}

function resolveLeaveRoomGame({
  nowMs,
  senderUid,
  session,
}) {
  if (!session || !['lobby', 'active'].includes(session.status)) {
    return roomGameError('SESSION_NOT_ACTIVE', 409, 'There is no active game session to leave.');
  }
  const playerUids = Array.isArray(session.playerUids) ? session.playerUids.filter((uid) => typeof uid === 'string') : [];
  if (!playerUids.includes(senderUid)) {
    return {
      ok: true,
      value: {
        alreadyLeft: true,
        clearActiveSession: false,
        sessionPatch: null,
      },
    };
  }
  const nextPlayers = playerUids.filter((uid) => uid !== senderUid);
  const leaveSettlement = resolveLeaveEconomySettlement({ senderUid, session });
  if (nextPlayers.length === 0) {
    const abandonSettlement = resolveAbandonEconomySettlement({
      leaveSettlement,
      nowMs,
      senderUid,
      session,
    });
    return {
      ok: true,
      value: {
        alreadyLeft: false,
        clearActiveSession: true,
        economyCredits: abandonSettlement.credits,
        sessionPatch: {
          ...(abandonSettlement.economy ? { economy: abandonSettlement.economy } : {}),
          endedAtMs: nowMs,
          endedBy: senderUid,
          endReason: 'abandoned',
          playerCount: 0,
          playerUids: [],
          status: 'abandoned',
          updatedAtMs: nowMs,
        },
      },
    };
  }
  const nextHostUid = session.hostUid === senderUid ? nextPlayers[0] : session.hostUid;
  const belowMinimum = nextPlayers.length < Number(session.minPlayers || 2);
  return {
    ok: true,
    value: {
      alreadyLeft: false,
      clearActiveSession: false,
      economyCredits: leaveSettlement.credits,
      sessionPatch: {
        ...(leaveSettlement.economy ? { economy: leaveSettlement.economy } : {}),
        hostUid: nextHostUid,
        playerCount: nextPlayers.length,
        playerUids: nextPlayers,
        ...(belowMinimum
          ? {
              expiresAtMs: nowMs + LOBBY_TTL_MS,
              status: 'lobby',
            }
          : {}),
        updatedAtMs: nowMs,
      },
    },
  };
}

function resolveEndRoomGame({
  actorMembership,
  decodedToken,
  nowMs,
  operatorProfile,
  room,
  senderUid,
  session,
}) {
  if (!session || !['lobby', 'active'].includes(session.status)) {
    return roomGameError('SESSION_NOT_ACTIVE', 409, 'There is no active game session to end.');
  }
  const authority = canManageRoomGameSession({
    actorMembership,
    decodedToken,
    operatorProfile,
    room,
    senderUid,
    session,
  });
  if (authority.denied) {
    return roomGameError('REGION_SCOPE_DENIED', 403, authority.error);
  }
  if (!authority.ok) {
    return roomGameError('FORBIDDEN', 403, 'Only the host, room staff, or platform staff can end this session.');
  }
  const prize = resolveEndEconomySettlement({ nowMs, session });
  if (prize && prize.ok === false) return prize;
  return {
    ok: true,
    value: {
      authority: authority.authority,
      clearActiveSession: true,
      economyCredits: prize.credits,
      sessionPatch: {
        ...(prize.economy ? { economy: prize.economy } : {}),
        endedAtMs: nowMs,
        endedBy: senderUid,
        endReason: 'ended',
        status: 'ended',
        updatedAtMs: nowMs,
      },
    },
  };
}

function canManageRoomGameSession({
  actorMembership,
  decodedToken,
  operatorProfile,
  room,
  senderUid,
  session,
}) {
  const staff = resolveStaffRoomAuthority({ decodedToken, operatorProfile, room });
  if (staff.denied) return { ok: false, denied: true, error: staff.error };
  if (staff.authority) return { ok: true, authority: staff.authority };
  const memberAuthority = isActiveMembership(actorMembership, senderUid)
    ? resolveMemberAuthority(actorMembership, senderUid, room)
    : null;
  if (memberAuthority === 'owner' || memberAuthority === 'moderator') {
    return { ok: true, authority: memberAuthority };
  }
  if (session?.hostUid === senderUid) return { ok: true, authority: 'host' };
  return { ok: false };
}

function resolveCreditGameReward() {
  return roomGameError(
    'REWARD_SETTLEMENT_UNAVAILABLE',
    503,
    'Game rewards require a server-authoritative result and are not enabled for client commands.',
  );
}

function shouldAbandonExpiredSession(session, nowMs, activeGameSessionId) {
  if (!session || !activeGameSessionId || session.sessionId !== activeGameSessionId) return false;
  if (!['lobby', 'active'].includes(session.status)) return false;
  const expiresAtMs = timestampToMillis(session.expiresAt) || Number(session.expiresAtMs) || 0;
  return expiresAtMs > 0 && expiresAtMs <= nowMs;
}

function createRoomGameSessionId(roomId, requestId) {
  return `rgs_${createHash('sha256').update(`${roomId}|${requestId}`).digest('hex').slice(0, 24)}`;
}

function createRoomGameRewardId(sessionId, targetUid) {
  return `rgr_${createHash('sha256').update(`${sessionId}|${targetUid}`).digest('hex').slice(0, 24)}`;
}

function buildRoomGameFingerprint(uid, command) {
  return createHash('sha256')
    .update([
      uid,
      command.action,
      command.roomId,
      command.gameId || '',
      command.sessionId || '',
      command.targetUid || '',
      String(command.amount || 0),
      command.requestId,
    ].join('|'))
    .digest('hex');
}

function snapshotRewardPolicy(policyId) {
  if (policyId !== CLOSED_LOOP_REWARD_POLICY.policyId) return undefined;
  return { ...CLOSED_LOOP_REWARD_POLICY };
}

function isGameAvailableInRegion(game, regionCode) {
  if (!game?.regions?.length) return false;
  if (game.regions.includes('*')) return true;
  if (!regionCode) return false;
  return game.regions.includes(regionCode);
}

function isOpenGameSession(session, nowMs) {
  if (!session || !['lobby', 'active'].includes(session.status)) return false;
  const expiresAtMs = timestampToMillis(session.expiresAt) || Number(session.expiresAtMs) || 0;
  if (expiresAtMs > 0 && expiresAtMs <= nowMs) return false;
  return true;
}

function resolveRoomGameEntryFee({ amount, game, growthFeatures }) {
  const fee = Number.isInteger(amount) && amount >= 0 ? amount : 0;
  if (fee === 0) return { ok: true, value: 0 };
  if (growthFeatures?.roomGameEconomy !== true) {
    return roomGameError('ECONOMY_DISABLED', 503, 'Room game coin entry is not enabled.');
  }
  if (!ROOM_GAME_ALLOWED_ENTRY_FEES.includes(fee) || fee > ROOM_GAME_MAX_ENTRY_FEE) {
    return roomGameError('INVALID_ENTRY_FEE', 400, 'Entry fee must be 0, 10, 25, or 50 coins.');
  }
  if (!game || game.sessionMode !== 'multiplayer' || game.supportsCoinEntry !== true) {
    return roomGameError('ENTRY_FEE_UNSUPPORTED', 400, 'Coin entry is only available for Drawing Guess tables.');
  }
  return { ok: true, value: fee };
}

function buildSessionEconomy({ entryFeeCoins, hostUid }) {
  const fee = Number(entryFeeCoins) || 0;
  return {
    currency: 'coins',
    entryFeeCoins: fee,
    paidEntries: fee > 0 ? { [hostUid]: fee } : {},
    poolCoins: fee,
    settled: false,
    settlementMode: ROOM_GAME_ECONOMY_SETTLEMENT_MODE,
  };
}

function resolveLeaveEconomySettlement({ senderUid, session }) {
  const economy = session?.economy && typeof session.economy === 'object' ? session.economy : null;
  if (!economy || economy.settled === true) return { credits: [], economy: null };
  const paid = Number(economy.paidEntries?.[senderUid]) || 0;
  if (paid < 1) return { credits: [], economy: null };
  const paidEntries = { ...economy.paidEntries };
  delete paidEntries[senderUid];
  // Lobby leavers get a refund. Active leavers forfeit their buy-in to the pool.
  if (session.status === 'lobby') {
    const poolCoins = Math.max(0, (Number(economy.poolCoins) || 0) - paid);
    return {
      credits: [{ amount: paid, currency: 'coins', kind: 'refund', uid: senderUid }],
      economy: {
        ...economy,
        paidEntries,
        poolCoins,
      },
    };
  }
  return {
    credits: [],
    economy: {
      ...economy,
      paidEntries,
    },
  };
}

function resolveAbandonEconomySettlement({ leaveSettlement, nowMs, senderUid, session }) {
  const economy = leaveSettlement.economy || session?.economy;
  if (!economy || economy.settled === true) {
    return { credits: leaveSettlement.credits || [], economy: leaveSettlement.economy };
  }
  const poolCoins = Number(economy.poolCoins) || 0;
  if (poolCoins < 1) {
    return {
      credits: leaveSettlement.credits || [],
      economy: { ...economy, settled: true, settledAtMs: nowMs },
    };
  }
  // Last player out: return remaining pool to them so the ledger stays balanced.
  return {
    credits: [
      ...(leaveSettlement.credits || []),
      { amount: poolCoins, currency: 'coins', kind: 'refund', uid: senderUid },
    ],
    economy: {
      ...economy,
      poolCoins: 0,
      prizeUid: senderUid,
      settled: true,
      settledAtMs: nowMs,
      settlementKind: 'abandon-refund',
    },
  };
}

function resolveEndEconomySettlement({ nowMs, session }) {
  const economy = session?.economy && typeof session.economy === 'object' ? session.economy : null;
  if (!economy || economy.settled === true) return { credits: [], economy: null };
  const poolCoins = Number(economy.poolCoins) || 0;
  if (poolCoins < 1) {
    return {
      credits: [],
      economy: { ...economy, settled: true, settledAtMs: nowMs, settlementKind: 'empty' },
    };
  }
  if (session.status === 'lobby') {
    const credits = Object.entries(economy.paidEntries || {})
      .filter(([, amount]) => Number(amount) >= 1)
      .map(([uid, amount]) => ({
        amount: Number(amount),
        currency: 'coins',
        kind: 'refund',
        uid,
      }));
    return {
      credits,
      economy: {
        ...economy,
        poolCoins: 0,
        settled: true,
        settledAtMs: nowMs,
        settlementKind: 'lobby-refund',
      },
    };
  }
  const players = Array.isArray(session.playerUids)
    ? session.playerUids.filter((uid) => typeof uid === 'string' && uid)
    : [];
  if (!players.length) {
    return {
      credits: [],
      economy: { ...economy, settled: true, settledAtMs: nowMs, settlementKind: 'void-empty' },
    };
  }
  if (poolCoins > MAX_REWARD_CREDIT) {
    return roomGameError('POOL_CAP_EXCEEDED', 503, 'Game prize pool exceeds the safety cap.');
  }
  const prizeUid = pickEntertainmentPrizeUid({ nowMs, playerUids: players, sessionId: session.sessionId });
  return {
    credits: [{ amount: poolCoins, currency: 'coins', kind: 'prize', uid: prizeUid }],
    economy: {
      ...economy,
      poolCoins: 0,
      prizeUid,
      settled: true,
      settledAtMs: nowMs,
      settlementKind: ROOM_GAME_ECONOMY_SETTLEMENT_MODE,
      settlementNote: 'Entertainment raffle among remaining players. Not a skill wager.',
    },
  };
}

function pickEntertainmentPrizeUid({ nowMs, playerUids, sessionId }) {
  const digest = createHash('sha256')
    .update(`${sessionId}|${nowMs}|${ROOM_GAME_ECONOMY_SETTLEMENT_MODE}`)
    .digest('hex');
  const index = Number.parseInt(digest.slice(0, 8), 16) % playerUids.length;
  return playerUids[index];
}

function createRoomGameLedgerId({ kind, requestId, sessionId, uid }) {
  return `rge_${createHash('sha256').update(`${kind}|${sessionId}|${uid}|${requestId}`).digest('hex').slice(0, 28)}`;
}

function mapSessionPublic(session) {
  if (!session) return null;
  const economy = session.economy && typeof session.economy === 'object'
    ? {
        currency: session.economy.currency === 'diamonds' ? 'diamonds' : 'coins',
        entryFeeCoins: Number(session.economy.entryFeeCoins) || 0,
        poolCoins: Number(session.economy.poolCoins) || 0,
        prizeUid: typeof session.economy.prizeUid === 'string' ? session.economy.prizeUid : null,
        settled: session.economy.settled === true,
        settlementKind: typeof session.economy.settlementKind === 'string'
          ? session.economy.settlementKind
          : null,
        settlementMode: typeof session.economy.settlementMode === 'string'
          ? session.economy.settlementMode
          : ROOM_GAME_ECONOMY_SETTLEMENT_MODE,
      }
    : null;
  return {
    clientRoute: session.clientRoute,
    ...(economy ? { economy } : {}),
    expiresAtMs: timestampToMillis(session.expiresAt) || Number(session.expiresAtMs) || 0,
    gameId: session.gameId,
    hostUid: session.hostUid,
    maxPlayers: session.maxPlayers,
    minPlayers: session.minPlayers,
    playerCount: session.playerCount,
    playerUids: Array.isArray(session.playerUids) ? [...session.playerUids] : [],
    rewardPolicy: session.rewardPolicy || null,
    rewardsEnabled: session.rewardsEnabled === true,
    roomId: session.roomId,
    sessionId: session.sessionId,
    sessionMode: session.sessionMode || 'multiplayer',
    status: session.status,
  };
}

function isActiveRoom(room) {
  return Boolean(
    room
    && room.status === 'active'
    && (room.availability === undefined || room.availability === 'active'),
  );
}

function isActiveMembership(membership, uid) {
  return Boolean(membership && membership.uid === uid && membership.status === 'active');
}

function isEligiblePublicProfile(profile, uid) {
  return Boolean(
    profile
    && profile.uid === uid
    && profile.moderationStatus === 'active'
    && typeof profile.displayName === 'string'
    && profile.displayName.length >= 2,
  );
}

function resolveMemberAuthority(membership, uid, room = {}) {
  const ownerUid = room.ownerUid || room.hostId || '';
  if (uid && uid === ownerUid) return 'owner';
  if (membership?.authorityRole === 'moderator') return 'moderator';
  return 'member';
}

function resolveStaffRoomAuthority({ decodedToken = {}, operatorProfile, room }) {
  if (decodedToken.admin !== true) return { authority: null };
  if (decodedToken.adminRole === 'owner' || !decodedToken.adminRole) {
    return { authority: 'platform-owner' };
  }
  if (decodedToken.adminRole !== 'super-moderator') return { authority: null };
  const countryCode = room?.countryCode;
  if (!countryCode) {
    return { denied: true, error: 'Room region is missing or unsupported.' };
  }
  if (
    !operatorProfile
    || operatorProfile.uid !== decodedToken.uid
    || operatorProfile.role !== 'super-moderator'
    || operatorProfile.status !== 'active'
    || !Array.isArray(operatorProfile.regionCodes)
    || !operatorProfile.regionCodes.includes(countryCode)
  ) {
    return { denied: true, error: 'This room is outside the operator region scope.' };
  }
  return { authority: 'super-moderator', regionCode: countryCode };
}

function roomGameError(code, status, error, details) {
  return {
    ok: false,
    code,
    status,
    error,
    ...(details ? { details } : {}),
  };
}

function timestampToMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function compareClientVersions(left, right) {
  const parse = (value) => String(value).split(/[+-]/, 1)[0].split('.').map((part) => Number(part));
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

module.exports = {
  CLOSED_LOOP_REWARD_POLICY,
  GAME_COMMAND_RETENTION_MS,
  GAME_SESSION_RETENTION_MS,
  LOBBY_TTL_MS,
  MAX_REWARD_CREDIT,
  ROOM_GAME_ACTIONS,
  ROOM_GAME_ALLOWED_ENTRY_FEES,
  ROOM_GAME_ECONOMY_SETTLEMENT_MODE,
  ROOM_GAME_MAX_ENTRY_FEE,
  ROOM_GAME_REGISTRY,
  SESSION_TTL_MS,
  buildRoomGameFingerprint,
  buildSessionEconomy,
  canManageRoomGameSession,
  compareClientVersions,
  createRoomGameLedgerId,
  createRoomGameRewardId,
  createRoomGameSessionId,
  isGameAvailableInRegion,
  listRoomGames,
  mapSessionPublic,
  normalizeRoomGameBody,
  pickEntertainmentPrizeUid,
  resolveCreditGameReward,
  resolveCreateRoomGameInvite,
  resolveEndRoomGame,
  resolveJoinRoomGame,
  resolveLeaveRoomGame,
  resolveRoomGameEntryFee,
  roomGameError,
  shouldAbandonExpiredSession,
  snapshotRewardPolicy,
  timestampToMillis,
  validateRoomGameRequest,
};
