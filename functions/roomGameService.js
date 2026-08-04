const {
  buildRoomGameFingerprint,
  createRoomGameSessionId,
  GAME_COMMAND_RETENTION_MS,
  GAME_SESSION_RETENTION_MS,
  listRoomGames,
  mapSessionPublic,
  normalizeRoomGameBody,
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
    const memberRef = roomRef.collection('members').doc(decodedToken.uid);
    const publicRef = db.doc(`publicProfiles/${decodedToken.uid}`);
    const adminRef = db.doc(`adminProfiles/${decodedToken.uid}`);

    const [
      requestSnapshot,
      featureSnapshot,
      roomSnapshot,
      memberSnapshot,
      publicSnapshot,
      adminSnapshot,
      rateLimitSnapshot,
    ] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(featureRef),
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
        nowMs,
        publicProfile,
        room: roomData,
        senderUid: decodedToken.uid,
        sessionId,
      });
      if (!resolution.ok) return deny(resolution);
      const session = resolution.value.session;
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
      if (!resolution.value.alreadyJoined && resolution.value.sessionPatch) {
        const patch = resolution.value.sessionPatch;
        transaction.update(sessionRef, {
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
      if (!resolution.value.alreadyLeft && resolution.value.sessionPatch) {
        const patch = resolution.value.sessionPatch;
        transaction.update(sessionRef, {
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
      const patch = resolution.value.sessionPatch;
      transaction.update(sessionRef, {
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
      transaction.update(sessionRef, {
        endedAt: timestamp,
        endedBy: 'system',
        endReason: 'expired',
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
