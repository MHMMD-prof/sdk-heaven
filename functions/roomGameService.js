const {
  buildRoomGameFingerprint,
  createRoomGameLedgerId,
  createRoomGameSessionId,
  GAME_COMMAND_RETENTION_MS,
  GAME_SESSION_RETENTION_MS,
  listRoomGames,
  mapSessionPublic,
  normalizeRoomGameBody,
  pickEntertainmentPrizeUid,
  resolveCreateRoomGameInvite,
  resolveEndRoomGame,
  resolveJoinRoomGame,
  resolveLeaveRoomGame,
  roomGameError,
  shouldAbandonExpiredSession,
  timestampToMillis,
  validateRoomGameRequest,
} = require('./roomGameCore');
const {
  applyWalletMutation,
  buildWalletDocument,
  buildWalletTransaction,
  mapWalletSummary,
} = require('./socialWalletCore');
const {
  ROOM_GAME_RATE_LIMIT,
  ROOM_GAME_RATE_WINDOW_MS,
  resolveSlidingWindowRateLimit,
} = require('./voiceRoomRateLimitCore');

const systemClock = {
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => {
    const { Timestamp } = require('firebase-admin/firestore');
    return Timestamp.fromMillis(value);
  },
};

async function executeRoomGameCommand({
  body,
  clock = systemClock,
  db,
  decodedToken,
  fieldValue,
}) {
  const validation = validateRoomGameRequest(normalizeRoomGameBody(body));
  if (!validation.ok) return validation;
  const command = validation.value;
  const fingerprint = buildRoomGameFingerprint(decodedToken.uid, command);

  return db.runTransaction(async (transaction) => {
    const roomRef = db.doc(`rooms/${command.roomId}`);
    const requestRef = roomRef.collection('gameCommandRequests').doc(command.requestId);
    const rateLimitRef = db.doc(`roomGameRateLimits/${decodedToken.uid}`);
    const featureRef = db.doc('appConfig/voiceRoomFeatures');
    const growthRef = db.doc('appConfig/growthFeatures');
    const memberRef = roomRef.collection('members').doc(decodedToken.uid);
    const publicRef = db.doc(`publicProfiles/${decodedToken.uid}`);
    const adminRef = db.doc(`adminProfiles/${decodedToken.uid}`);

    const [
      requestSnapshot,
      featureSnapshot,
      growthSnapshot,
      roomSnapshot,
      memberSnapshot,
      publicSnapshot,
      adminSnapshot,
      rateLimitSnapshot,
    ] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(featureRef),
      transaction.get(growthRef),
      transaction.get(roomRef),
      transaction.get(memberRef),
      transaction.get(publicRef),
      transaction.get(adminRef),
      transaction.get(rateLimitRef),
    ]);

    if (requestSnapshot.exists) {
      const previous = requestSnapshot.data();
      if (previous.actorUid !== decodedToken.uid || previous.fingerprint !== fingerprint) {
        return roomGameError('REQUEST_ID_CONFLICT', 409, 'This request ID belongs to another command.');
      }
      return { ...previous.response, replayed: true };
    }

    const featureFlags = featureSnapshot.exists ? featureSnapshot.data() : undefined;
    const growthFeatures = growthSnapshot.exists ? growthSnapshot.data() : undefined;
    const roomData = roomSnapshot.exists ? { id: command.roomId, ...roomSnapshot.data() } : undefined;
    const membership = memberSnapshot.exists ? memberSnapshot.data() : undefined;
    const publicProfile = publicSnapshot.exists ? publicSnapshot.data() : undefined;
    const operatorProfile = adminSnapshot.exists ? adminSnapshot.data() : undefined;
    const nowMs = clock.nowMillis();
    const timestamp = fieldValue.serverTimestamp();
    const purgeAfter = clock.timestampFromMillis(nowMs + GAME_COMMAND_RETENTION_MS);
    const rateLimit = resolveSlidingWindowRateLimit({
      limit: ROOM_GAME_RATE_LIMIT,
      nowMs,
      rate: rateLimitSnapshot.exists ? rateLimitSnapshot.data() : undefined,
      windowMs: ROOM_GAME_RATE_WINDOW_MS,
    });
    if (!rateLimit.ok) return rateLimit;
    let rateLimitWritten = false;
    const writeRateLimit = () => {
      if (rateLimitWritten) return;
      rateLimitWritten = true;
      transaction.set(rateLimitRef, {
        attemptsMs: rateLimit.value.attemptsMs,
        count: rateLimit.value.count,
        purgeAfter,
        roomId: command.roomId,
        uid: decodedToken.uid,
        updatedAt: timestamp,
        windowStartedAt: clock.timestampFromMillis(rateLimit.value.windowStartedAtMs),
      }, { merge: true });
    };
    const deny = (error) => {
      writeRateLimit();
      return error;
    };

    if (command.action === 'list-room-games') {
      if (!roomSnapshot.exists || roomData?.status !== 'active') {
        return deny(roomGameError('ROOM_NOT_ACTIVE', 409, 'The room is not available for games.'));
      }
      if (!membership || membership.uid !== decodedToken.uid || membership.status !== 'active') {
        return deny(roomGameError('MEMBERSHIP_REQUIRED', 403, 'Active room membership is required.'));
      }
      if (
        !publicProfile
        || publicProfile.uid !== decodedToken.uid
        || publicProfile.moderationStatus !== 'active'
      ) {
        return deny(roomGameError('ACCOUNT_RESTRICTED', 403, 'A complete active profile is required.'));
      }
      const listed = listRoomGames({
        featureFlags,
        regionCode: roomData?.countryCode || command.regionCode,
      });
      if (!listed.ok) return deny(listed);
      const response = {
        ok: true,
        result: {
          action: command.action,
          games: listed.value.games,
          requestId: command.requestId,
          rewardPolicy: listed.value.rewardPolicy,
          roomId: command.roomId,
        },
      };
      transaction.create(requestRef, {
        action: command.action,
        actorUid: decodedToken.uid,
        createdAt: timestamp,
        fingerprint,
        purgeAfter,
        requestId: command.requestId,
        response,
      });
      writeRateLimit();
      return response;
    }

    const activeSessionId = typeof roomData?.activeGameSessionId === 'string'
      ? roomData.activeGameSessionId.trim()
      : '';
    let activeSessionSnapshot;
    if (activeSessionId) {
      activeSessionSnapshot = await transaction.get(roomRef.collection('gameSessions').doc(activeSessionId));
    }
    const activeSession = activeSessionSnapshot?.exists
      ? { sessionId: activeSessionId, ...activeSessionSnapshot.data() }
      : undefined;

    if (shouldAbandonExpiredSession(activeSession, nowMs, activeSessionId)) {
      const expiredRef = roomRef.collection('gameSessions').doc(activeSessionId);
      transaction.update(expiredRef, {
        endedAt: clock.timestampFromMillis(nowMs),
        endedBy: 'system',
        endReason: 'expired',
        purgeAfter: clock.timestampFromMillis(nowMs + GAME_SESSION_RETENTION_MS),
        status: 'abandoned',
        updatedAt: timestamp,
      });
      transaction.update(roomRef, {
        activeGameSessionId: null,
        currentGameId: null,
        updatedAt: timestamp,
      });
      if (command.action !== 'create-room-game-invite') {
        return deny(roomGameError('SESSION_EXPIRED', 409, 'The previous game session expired.'));
      }
      roomData.activeGameSessionId = null;
      roomData.currentGameId = null;
    }

    if (command.action === 'create-room-game-invite') {
      const currentActiveId = typeof roomData?.activeGameSessionId === 'string'
        ? roomData.activeGameSessionId.trim()
        : '';
      if (currentActiveId && !(shouldAbandonExpiredSession(activeSession, nowMs, currentActiveId))) {
        if (activeSession && ['lobby', 'active'].includes(activeSession.status)) {
          return deny(roomGameError('SESSION_ALREADY_ACTIVE', 409, 'Only one room-linked game session is allowed at a time.'));
        }
      }
      const sessionId = createRoomGameSessionId(command.roomId, command.requestId);
      const resolution = resolveCreateRoomGameInvite({
        actorMembership: membership,
        command,
        featureFlags,
        growthFeatures,
        nowMs,
        publicProfile,
        room: roomData,
        senderUid: decodedToken.uid,
        sessionId,
      });
      if (!resolution.ok) return deny(resolution);
      const session = resolution.value.session;
      const entryApplied = await applyRoomGameWalletDebit({
        clock,
        debit: resolution.value.entryDebit,
        deny,
        fieldValue,
        nowMs,
        requestId: command.requestId,
        sessionId,
        timestamp,
        transaction,
        db,
      });
      if (entryApplied && entryApplied.ok === false) return entryApplied;
      const sessionRef = roomRef.collection('gameSessions').doc(sessionId);
      const response = {
        ok: true,
        result: {
          action: command.action,
          requestId: command.requestId,
          roomId: command.roomId,
          session: mapSessionPublic(session),
          sessionId,
        },
      };
      transaction.create(sessionRef, {
        clientRoute: session.clientRoute,
        createdAt: timestamp,
        ...(session.economy ? { economy: session.economy } : {}),
        expiresAt: clock.timestampFromMillis(session.expiresAtMs),
        gameId: session.gameId,
        hostUid: session.hostUid,
        maxPlayers: session.maxPlayers,
        minPlayers: session.minPlayers,
        playerCount: session.playerCount,
        playerUids: session.playerUids,
        rewardPolicy: session.rewardPolicy,
        rewardsEnabled: session.rewardsEnabled,
        roomId: command.roomId,
        sessionId,
        sessionMode: session.sessionMode,
        status: session.status,
        updatedAt: timestamp,
        purgeAfter: clock.timestampFromMillis(session.expiresAtMs + GAME_SESSION_RETENTION_MS),
      });
      transaction.update(roomRef, {
        activeGameSessionId: sessionId,
        currentGameId: session.gameId,
        updatedAt: timestamp,
      });
      transaction.create(requestRef, {
        action: command.action,
        actorUid: decodedToken.uid,
        createdAt: timestamp,
        fingerprint,
        purgeAfter,
        requestId: command.requestId,
        response,
        sessionId,
      });
      writeRateLimit();
      return response;
    }

    const sessionRef = roomRef.collection('gameSessions').doc(command.sessionId);
    const sessionSnapshot = await transaction.get(sessionRef);
    if (!sessionSnapshot.exists) {
      return deny(roomGameError('SESSION_NOT_FOUND', 404, 'Game session was not found.'));
    }
    const session = { sessionId: command.sessionId, ...sessionSnapshot.data() };
    if (
      command.action === 'join-room-game'
      && roomData?.activeGameSessionId !== command.sessionId
    ) {
      return deny(roomGameError('SESSION_NOT_ACTIVE', 409, 'This session is not the room active game session.'));
    }
    if (
      ['leave-room-game', 'end-room-game'].includes(command.action)
      && roomData?.activeGameSessionId
      && roomData.activeGameSessionId !== command.sessionId
    ) {
      return deny(roomGameError('SESSION_NOT_ACTIVE', 409, 'This session is not the room active game session.'));
    }

    if (command.action === 'join-room-game') {
      const resolution = resolveJoinRoomGame({
        actorMembership: membership,
        featureFlags,
        nowMs,
        publicProfile,
        room: roomData,
        senderUid: decodedToken.uid,
        session,
      });
      if (!resolution.ok) return deny(resolution);
      if (!resolution.value.alreadyJoined && resolution.value.entryDebit) {
        const entryApplied = await applyRoomGameWalletDebit({
          clock,
          debit: resolution.value.entryDebit,
          deny,
          fieldValue,
          nowMs,
          requestId: command.requestId,
          sessionId: command.sessionId,
          timestamp,
          transaction,
          db,
        });
        if (entryApplied && entryApplied.ok === false) return entryApplied;
      }
      if (!resolution.value.alreadyJoined && resolution.value.sessionPatch) {
        const patch = resolution.value.sessionPatch;
        transaction.update(sessionRef, {
          ...(patch.economy ? { economy: patch.economy } : {}),
          playerCount: patch.playerCount,
          playerUids: patch.playerUids,
          status: patch.status,
          updatedAt: timestamp,
          ...(patch.expiresAtMs
            ? {
                expiresAt: clock.timestampFromMillis(patch.expiresAtMs),
                purgeAfter: clock.timestampFromMillis(patch.expiresAtMs + GAME_SESSION_RETENTION_MS),
              }
            : {}),
        });
        Object.assign(session, patch);
      }
      const response = {
        ok: true,
        result: {
          action: command.action,
          alreadyJoined: resolution.value.alreadyJoined === true,
          requestId: command.requestId,
          roomId: command.roomId,
          session: mapSessionPublic(session),
          sessionId: command.sessionId,
        },
      };
      transaction.create(requestRef, {
        action: command.action,
        actorUid: decodedToken.uid,
        createdAt: timestamp,
        fingerprint,
        purgeAfter,
        requestId: command.requestId,
        response,
        sessionId: command.sessionId,
      });
      writeRateLimit();
      return response;
    }

    if (command.action === 'leave-room-game') {
      const resolution = resolveLeaveRoomGame({
        featureFlags,
        nowMs,
        senderUid: decodedToken.uid,
        session,
      });
      if (!resolution.ok) return deny(resolution);
      if (Array.isArray(resolution.value.economyCredits) && resolution.value.economyCredits.length) {
        const credited = await applyRoomGameWalletCredits({
          clock,
          credits: resolution.value.economyCredits,
          deny,
          fieldValue,
          nowMs,
          requestId: command.requestId,
          sessionId: command.sessionId,
          timestamp,
          transaction,
          db,
        });
        if (credited && credited.ok === false) return credited;
      }
      if (!resolution.value.alreadyLeft && resolution.value.sessionPatch) {
        const patch = resolution.value.sessionPatch;
        transaction.update(sessionRef, {
          ...(patch.economy ? { economy: patch.economy } : {}),
          ...(patch.hostUid ? { hostUid: patch.hostUid } : {}),
          ...(patch.endedAtMs ? { endedAt: clock.timestampFromMillis(patch.endedAtMs) } : {}),
          ...(patch.endedBy ? { endedBy: patch.endedBy } : {}),
          ...(patch.endReason ? { endReason: patch.endReason } : {}),
          ...(patch.expiresAtMs
            ? {
                expiresAt: clock.timestampFromMillis(patch.expiresAtMs),
                purgeAfter: clock.timestampFromMillis(patch.expiresAtMs + GAME_SESSION_RETENTION_MS),
              }
            : {}),
          ...(patch.status === 'abandoned'
            ? { purgeAfter: clock.timestampFromMillis(nowMs + GAME_SESSION_RETENTION_MS) }
            : {}),
          playerCount: patch.playerCount,
          playerUids: patch.playerUids,
          status: patch.status || session.status,
          updatedAt: timestamp,
        });
        Object.assign(session, patch);
      }
      if (resolution.value.clearActiveSession) {
        transaction.update(roomRef, {
          activeGameSessionId: null,
          currentGameId: null,
          updatedAt: timestamp,
        });
      }
      const response = {
        ok: true,
        result: {
          action: command.action,
          alreadyLeft: resolution.value.alreadyLeft === true,
          requestId: command.requestId,
          roomId: command.roomId,
          session: mapSessionPublic(session),
          sessionId: command.sessionId,
        },
      };
      transaction.create(requestRef, {
        action: command.action,
        actorUid: decodedToken.uid,
        createdAt: timestamp,
        fingerprint,
        purgeAfter,
        requestId: command.requestId,
        response,
        sessionId: command.sessionId,
      });
      writeRateLimit();
      return response;
    }

    if (command.action === 'end-room-game') {
      const resolution = resolveEndRoomGame({
        actorMembership: membership,
        decodedToken,
        featureFlags,
        nowMs,
        operatorProfile,
        room: roomData,
        senderUid: decodedToken.uid,
        session,
      });
      if (!resolution.ok) return deny(resolution);
      if (Array.isArray(resolution.value.economyCredits) && resolution.value.economyCredits.length) {
        const credited = await applyRoomGameWalletCredits({
          clock,
          credits: resolution.value.economyCredits,
          deny,
          fieldValue,
          nowMs,
          requestId: command.requestId,
          sessionId: command.sessionId,
          timestamp,
          transaction,
          db,
        });
        if (credited && credited.ok === false) return credited;
      }
      const patch = resolution.value.sessionPatch;
      transaction.update(sessionRef, {
        ...(patch.economy ? { economy: patch.economy } : {}),
        endedAt: clock.timestampFromMillis(patch.endedAtMs),
        endedBy: patch.endedBy,
        endReason: patch.endReason,
        status: patch.status,
        updatedAt: timestamp,
        purgeAfter: clock.timestampFromMillis(nowMs + GAME_SESSION_RETENTION_MS),
      });
      if (resolution.value.clearActiveSession) {
        transaction.update(roomRef, {
          activeGameSessionId: null,
          currentGameId: null,
          updatedAt: timestamp,
        });
      }
      Object.assign(session, patch);
      if (resolution.value.authority === 'platform-owner' || resolution.value.authority === 'super-moderator') {
        const moderationRef = roomRef.collection('moderationEvents').doc(`game_${command.requestId}`);
        transaction.create(moderationRef, {
          action: 'end-room-game',
          actorUid: decodedToken.uid,
          authority: resolution.value.authority,
          createdAt: timestamp,
          reason: 'Platform staff ended a room game session.',
          roomId: command.roomId,
          sessionId: command.sessionId,
          targetUid: '',
        });
      }
      const response = {
        ok: true,
        result: {
          action: command.action,
          ...(session.economy?.prizeUid ? { prizeUid: session.economy.prizeUid } : {}),
          requestId: command.requestId,
          roomId: command.roomId,
          session: mapSessionPublic(session),
          sessionId: command.sessionId,
        },
      };
      transaction.create(requestRef, {
        action: command.action,
        actorUid: decodedToken.uid,
        createdAt: timestamp,
        fingerprint,
        purgeAfter,
        requestId: command.requestId,
        response,
        sessionId: command.sessionId,
      });
      writeRateLimit();
      return response;
    }

    return deny(roomGameError('INVALID_REQUEST', 400, 'A valid room game command is required.'));
  });
}

async function expireRoomGameSessions({
  clock = systemClock,
  db,
  limit = 100,
}) {
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);
  const snapshot = await db.collectionGroup('gameSessions')
    .where('expiresAt', '<=', now)
    .orderBy('expiresAt', 'asc')
    .limit(limit)
    .get();
  let expired = 0;
  for (const candidate of snapshot.docs) {
    const changed = await db.runTransaction(async (transaction) => {
      const sessionRef = candidate.ref;
      const roomRef = sessionRef.parent?.parent;
      if (!roomRef) return false;
      const [sessionSnapshot, roomSnapshot] = await Promise.all([
        transaction.get(sessionRef),
        transaction.get(roomRef),
      ]);
      if (!sessionSnapshot.exists) return false;
      const session = sessionSnapshot.data();
      if (
        !['lobby', 'active'].includes(session.status)
        || timestampToMillis(session.expiresAt) > nowMs
      ) {
        return false;
      }
      const timestamp = clock.timestampFromMillis(nowMs);
      const economy = session.economy && typeof session.economy === 'object' ? session.economy : null;
      let refundCredits = [];
      let nextEconomy = null;
      if (economy && economy.settled !== true) {
        const poolCoins = Number(economy.poolCoins) || 0;
        if (session.status === 'lobby') {
          refundCredits = Object.entries(economy.paidEntries || {})
            .filter(([, amount]) => Number(amount) >= 1)
            .map(([uid, amount]) => ({
              amount: Number(amount),
              currency: 'coins',
              kind: 'refund',
              uid,
            }));
          nextEconomy = {
            ...economy,
            poolCoins: 0,
            settled: true,
            settledAtMs: nowMs,
            settlementKind: 'expire-lobby-refund',
          };
        } else if (poolCoins >= 1) {
          const players = Array.isArray(session.playerUids)
            ? session.playerUids.filter((uid) => typeof uid === 'string' && uid)
            : [];
          if (players.length) {
            const prizeUid = pickEntertainmentPrizeUid({
              nowMs,
              playerUids: players,
              sessionId: sessionRef.id,
            });
            refundCredits = [{ amount: poolCoins, currency: 'coins', kind: 'prize', uid: prizeUid }];
            nextEconomy = {
              ...economy,
              poolCoins: 0,
              prizeUid,
              settled: true,
              settledAtMs: nowMs,
              settlementKind: 'expire-raffle',
            };
          }
        } else {
          nextEconomy = {
            ...economy,
            settled: true,
            settledAtMs: nowMs,
            settlementKind: 'expire-empty',
          };
        }
      }
      if (refundCredits.length) {
        const credited = await applyRoomGameWalletCredits({
          clock,
          credits: refundCredits,
          deny: (error) => error,
          fieldValue: { serverTimestamp: () => timestamp },
          nowMs,
          requestId: `expire_${sessionRef.id}`,
          sessionId: sessionRef.id,
          timestamp,
          transaction,
          db,
        });
        if (credited && credited.ok === false) return false;
      }
      transaction.update(sessionRef, {
        endedAt: timestamp,
        endedBy: 'system',
        endReason: 'expired',
        ...(nextEconomy ? { economy: nextEconomy } : {}),
        purgeAfter: clock.timestampFromMillis(nowMs + GAME_SESSION_RETENTION_MS),
        status: 'abandoned',
        updatedAt: timestamp,
      });
      if (roomSnapshot.exists && roomSnapshot.data()?.activeGameSessionId === sessionRef.id) {
        transaction.update(roomRef, {
          activeGameSessionId: null,
          currentGameId: null,
          updatedAt: timestamp,
        });
      }
      return true;
    });
    if (changed) expired += 1;
  }
  return { expired, scanned: snapshot.size };
}

async function applyRoomGameWalletDebit({
  clock,
  debit,
  deny,
  fieldValue,
  nowMs,
  requestId,
  sessionId,
  timestamp,
  transaction,
  db,
}) {
  if (!debit || !debit.amount) return { ok: true };
  const walletRef = db.doc(`walletSummaries/${debit.uid}`);
  const ledgerId = createRoomGameLedgerId({
    kind: 'entry',
    requestId,
    sessionId,
    uid: debit.uid,
  });
  const ledgerRef = db.doc(`walletTransactions/${ledgerId}`);
  const [walletSnapshot, ledgerSnapshot] = await Promise.all([
    transaction.get(walletRef),
    transaction.get(ledgerRef),
  ]);
  if (ledgerSnapshot.exists) return { ok: true, replayed: true };
  if (!walletSnapshot.exists) {
    return deny(roomGameError('INSUFFICIENT_FUNDS', 409, 'Wallet funds are insufficient for this entry fee.'));
  }
  const wallet = mapWalletSummary(walletSnapshot.data(), debit.uid);
  const mutated = applyWalletMutation(wallet, {
    amount: debit.amount,
    currency: debit.currency || 'coins',
    type: 'debit',
  });
  if (!mutated.ok) {
    return deny(roomGameError(
      mutated.code === 'INSUFFICIENT_FUNDS' ? 'INSUFFICIENT_FUNDS' : 'WALLET_CONFLICT',
      409,
      mutated.code === 'INSUFFICIENT_FUNDS'
        ? 'Wallet funds are insufficient for this entry fee.'
        : 'Wallet could not be updated for this game entry.',
    ));
  }
  const createdAt = clock.timestampFromMillis(nowMs);
  const ledger = buildWalletTransaction({
    actorUid: debit.uid,
    amount: debit.amount,
    balanceAfter: mutated.value.balanceAfter,
    createdAt,
    currency: debit.currency || 'coins',
    note: 'Room game entry fee',
    referenceId: sessionId,
    source: 'room-game-entry',
    type: 'debit',
    uid: debit.uid,
  });
  if (!ledger) {
    return deny(roomGameError('WALLET_CONFLICT', 409, 'Wallet ledger could not be built for this game entry.'));
  }
  transaction.set(walletRef, buildWalletDocument(mutated.value.wallet, {
    createdAt: walletSnapshot.data()?.createdAt || createdAt,
    updatedAt: timestamp || fieldValue.serverTimestamp(),
  }), { merge: true });
  transaction.create(ledgerRef, ledger);
  return { ok: true };
}

async function applyRoomGameWalletCredits({
  clock,
  credits,
  deny,
  fieldValue,
  nowMs,
  requestId,
  sessionId,
  timestamp,
  transaction,
  db,
}) {
  if (!Array.isArray(credits) || !credits.length) return { ok: true };
  const uniqueUids = [...new Set(credits.map((credit) => credit.uid).filter(Boolean))];
  const walletRefs = Object.fromEntries(uniqueUids.map((uid) => [uid, db.doc(`walletSummaries/${uid}`)]));
  const ledgerPlans = credits.map((credit) => ({
    credit,
    ledgerId: createRoomGameLedgerId({
      kind: credit.kind || 'prize',
      requestId,
      sessionId,
      uid: credit.uid,
    }),
  }));
  const ledgerRefs = Object.fromEntries(
    ledgerPlans.map((plan) => [plan.ledgerId, db.doc(`walletTransactions/${plan.ledgerId}`)]),
  );
  const snapshots = await Promise.all([
    ...uniqueUids.map((uid) => transaction.get(walletRefs[uid])),
    ...ledgerPlans.map((plan) => transaction.get(ledgerRefs[plan.ledgerId])),
  ]);
  const walletSnapshots = Object.fromEntries(
    uniqueUids.map((uid, index) => [uid, snapshots[index]]),
  );
  const ledgerSnapshots = Object.fromEntries(
    ledgerPlans.map((plan, index) => [plan.ledgerId, snapshots[uniqueUids.length + index]]),
  );
  const wallets = {};
  for (const uid of uniqueUids) {
    const snapshot = walletSnapshots[uid];
    wallets[uid] = snapshot.exists
      ? mapWalletSummary(snapshot.data(), uid)
      : mapWalletSummary(undefined, uid);
  }
  const createdAt = clock.timestampFromMillis(nowMs);
  for (const plan of ledgerPlans) {
    if (ledgerSnapshots[plan.ledgerId]?.exists) continue;
    const mutated = applyWalletMutation(wallets[plan.credit.uid], {
      amount: plan.credit.amount,
      currency: plan.credit.currency || 'coins',
      type: 'credit',
    });
    if (!mutated.ok) {
      return deny(roomGameError('WALLET_CONFLICT', 409, 'Wallet could not be credited for game settlement.'));
    }
    wallets[plan.credit.uid] = mutated.value.wallet;
    const ledger = buildWalletTransaction({
      actorUid: plan.credit.uid,
      amount: plan.credit.amount,
      balanceAfter: mutated.value.balanceAfter,
      createdAt,
      currency: plan.credit.currency || 'coins',
      note: plan.credit.kind === 'refund' ? 'Room game entry refund' : 'Room game entertainment prize',
      referenceId: sessionId,
      source: plan.credit.kind === 'refund' ? 'room-game-refund' : 'room-game-prize',
      type: 'credit',
      uid: plan.credit.uid,
    });
    if (!ledger) {
      return deny(roomGameError('WALLET_CONFLICT', 409, 'Wallet ledger could not be built for game settlement.'));
    }
    const walletSnapshot = walletSnapshots[plan.credit.uid];
    transaction.set(walletRefs[plan.credit.uid], buildWalletDocument(mutated.value.wallet, {
      createdAt: walletSnapshot.exists ? walletSnapshot.data()?.createdAt || createdAt : createdAt,
      updatedAt: timestamp || fieldValue.serverTimestamp(),
    }), { merge: true });
    transaction.create(ledgerRefs[plan.ledgerId], ledger);
  }
  return { ok: true };
}

async function cleanupExpiredRoomGameRecords({
  clock = systemClock,
  db,
  limit = 300,
}) {
  const now = clock.timestampFromMillis(clock.nowMillis());
  const documents = [];
  for (const collectionGroup of ['gameCommandRequests', 'roomGameRateLimits']) {
    const remaining = Math.max(0, limit - documents.length);
    if (!remaining) break;
    const snapshot = await db.collectionGroup(collectionGroup)
      .where('purgeAfter', '<=', now)
      .orderBy('purgeAfter', 'asc')
      .limit(remaining)
      .get();
    documents.push(...snapshot.docs);
  }
  const remaining = Math.max(0, limit - documents.length);
  if (remaining) {
    const sessions = await db.collectionGroup('gameSessions')
      .where('purgeAfter', '<=', now)
      .orderBy('purgeAfter', 'asc')
      .limit(remaining)
      .get();
    documents.push(...sessions.docs.filter((document) => (
      ['ended', 'abandoned'].includes(document.data()?.status)
    )));
  }
  if (!documents.length) return { deleted: 0, scanned: 0 };
  const batch = db.batch();
  for (const document of documents) batch.delete(document.ref);
  await batch.commit();
  return { deleted: documents.length, scanned: documents.length };
}

module.exports = {
  cleanupExpiredRoomGameRecords,
  executeRoomGameCommand,
  expireRoomGameSessions,
  timestampToMillis,
};
