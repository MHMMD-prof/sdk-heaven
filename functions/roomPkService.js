'use strict';

const { mapGrowthFeatures } = require('./growthRolloutCore');
const { resolveSlidingWindowRateLimit } = require('./voiceRoomRateLimitCore');
const { executeCrossRoomPkCommand } = require('./crossRoomPkService');
const {
  COOLDOWN_MS,
  MAX_CONCURRENT_PER_ROOM,
  PK_COMMAND_RETENTION_MS,
  PK_SESSION_RETENTION_MS,
  ROOM_PK_RATE_LIMIT,
  ROOM_PK_RATE_WINDOW_MS,
  ROOM_PK_TEAMS,
  applyPkGiftScore,
  buildFinalizePatch,
  buildRoomPkFingerprint,
  buildStartRoomPkSession,
  canManageRoomPk,
  canStartRoomPk,
  clampPkDurationMs,
  createRoomPkSessionId,
  isActiveMembership,
  isActiveRoom,
  isCrossRoomRequest,
  isPkSessionActive,
  mapRoomPkSession,
  normalizeRoomPkBody,
  resolveTeamForUid,
  roomPkError,
  timestampToMillis,
  validateRoomPkRequest,
} = require('./roomPkCore');

const systemClock = {
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => {
    const { Timestamp } = require('firebase-admin/firestore');
    return Timestamp.fromMillis(value);
  },
};

async function readGrowthFeatureFlags(db, transaction) {
  const ref = db.doc('appConfig/growthFeatures');
  const snapshot = transaction
    ? await transaction.get(ref)
    : await ref.get();
  return mapGrowthFeatures(snapshot.exists ? snapshot.data() : {});
}

async function executeRoomPkCommand({
  body,
  clock = systemClock,
  db,
  decodedToken,
  documentIdField = '__name__',
  fieldValue,
}) {
  const validation = validateRoomPkRequest(normalizeRoomPkBody(body));
  if (!validation.ok) return validation;
  const command = validation.value;
  const fingerprint = buildRoomPkFingerprint(decodedToken.uid, command);

  if (isCrossRoomRequest(command)) {
    return executeCrossRoomPkCommand({ body, clock, db, decodedToken, documentIdField, fieldValue });
  }

  return db.runTransaction(async (transaction) => {
    const roomRef = db.doc(`rooms/${command.roomId}`);
    const requestRef = roomRef.collection('pkCommandRequests').doc(command.requestId);
    const rateLimitRef = db.doc(`roomPkRateLimits/${decodedToken.uid}`);
    const memberRef = roomRef.collection('members').doc(decodedToken.uid);
    const growthRef = db.doc('appConfig/growthFeatures');

    const [
      requestSnapshot,
      growthSnapshot,
      roomSnapshot,
      memberSnapshot,
      rateLimitSnapshot,
    ] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(growthRef),
      transaction.get(roomRef),
      transaction.get(memberRef),
      transaction.get(rateLimitRef),
    ]);

    if (requestSnapshot.exists) {
      const previous = requestSnapshot.data();
      if (previous.actorUid !== decodedToken.uid || previous.fingerprint !== fingerprint) {
        return roomPkError('REQUEST_ID_CONFLICT', 409, 'This request ID belongs to another command.');
      }
      return { ...previous.response, replayed: true };
    }

    const growthFeatures = mapGrowthFeatures(growthSnapshot.exists ? growthSnapshot.data() : {});
    const roomData = roomSnapshot.exists ? { id: command.roomId, ...roomSnapshot.data() } : undefined;
    const membership = memberSnapshot.exists ? memberSnapshot.data() : undefined;
    const nowMs = clock.nowMillis();
    const timestamp = fieldValue.serverTimestamp();
    const purgeAfter = clock.timestampFromMillis(nowMs + PK_COMMAND_RETENTION_MS);

    const rateLimit = resolveSlidingWindowRateLimit({
      limit: ROOM_PK_RATE_LIMIT,
      nowMs,
      rate: rateLimitSnapshot.exists ? rateLimitSnapshot.data() : undefined,
      windowMs: ROOM_PK_RATE_WINDOW_MS,
    });
    if (!rateLimit.ok) {
      return roomPkError(
        rateLimit.code || 'RATE_LIMITED',
        rateLimit.status || 429,
        typeof rateLimit.error === 'string'
          ? rateLimit.error
          : 'Too many room PK commands were sent.',
        rateLimit.details,
      );
    }

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

    const persistRequest = (response, extra = {}) => {
      transaction.create(requestRef, {
        action: command.action,
        actorUid: decodedToken.uid,
        createdAt: timestamp,
        fingerprint,
        purgeAfter,
        requestId: command.requestId,
        response,
        roomId: command.roomId,
        ...extra,
      });
      writeRateLimit();
      return response;
    };

    const activePkId = typeof roomData?.activePkSessionId === 'string'
      ? roomData.activePkSessionId.trim()
      : '';
    let activeSession = null;
    let activeSessionRef = null;
    if (activePkId) {
      activeSessionRef = db.doc(`roomPkSessions/${activePkId}`);
      const activeSnapshot = await transaction.get(activeSessionRef);
      if (activeSnapshot.exists) {
        activeSession = mapRoomPkSession({ pkId: activePkId, ...activeSnapshot.data() });
      }
    }

    // Auto-finalize expired active sessions before handling most commands.
    if (activeSession?.mode !== 'cross-room'
      && activeSession && activeSession.status === 'active' && !isPkSessionActive(activeSession, nowMs)) {
      const patch = buildFinalizePatch({ nowMs, session: activeSession, status: 'ended' });
      transaction.update(activeSessionRef, {
        endedAt: clock.timestampFromMillis(patch.endedAtMs),
        purgeAfter: clock.timestampFromMillis(nowMs + PK_SESSION_RETENTION_MS),
        status: patch.status,
        updatedAt: timestamp,
        winner: patch.winner,
        winnerReason: patch.winnerReason,
      });
      transaction.update(roomRef, {
        activePkSessionId: null,
        lastPkEndedAtMs: nowMs,
        updatedAt: timestamp,
      });
      activeSession = {
        ...activeSession,
        ...patch,
        endsAtMs: activeSession.endsAtMs,
      };
      if (roomData) {
        roomData.activePkSessionId = null;
        roomData.lastPkEndedAtMs = nowMs;
      }
    }

    if (command.action === 'get-room-pk-status') {
      if (!roomSnapshot.exists || !isActiveRoom(roomData)) {
        return deny(roomPkError('ROOM_NOT_ACTIVE', 409, 'The room is not available for PK.'));
      }
      if (!isActiveMembership(membership, decodedToken.uid)) {
        return deny(roomPkError('MEMBERSHIP_REQUIRED', 403, 'Active room membership is required.'));
      }
      const liveSession = activeSession?.mode === 'cross-room'
        ? activeSession
        : (activeSession && isPkSessionActive(activeSession, nowMs) ? activeSession : null);
      const response = {
        ok: true,
        result: {
          action: command.action,
          pkId: liveSession?.pkId || null,
          requestId: command.requestId,
          roomId: command.roomId,
          session: liveSession,
        },
      };
      return persistRequest(response, liveSession?.pkId ? { pkId: liveSession.pkId } : {});
    }

    if (command.action === 'start-room-pk') {
      if (growthFeatures.roomPk !== true) {
        return deny(roomPkError('FEATURE_DISABLED', 503, 'Room PK is not enabled.', { feature: 'roomPk' }));
      }
      if (!roomSnapshot.exists || !isActiveRoom(roomData)) {
        return deny(roomPkError('ROOM_NOT_ACTIVE', 409, 'The room is not available for PK.'));
      }
      if (!isActiveMembership(membership, decodedToken.uid)) {
        return deny(roomPkError('MEMBERSHIP_REQUIRED', 403, 'Active room membership is required.'));
      }
      const authority = canStartRoomPk({
        membership,
        room: roomData,
        uid: decodedToken.uid,
      });
      if (!authority.ok) {
        return deny(roomPkError('FORBIDDEN', 403, 'Only the host or owner can start PK.'));
      }
      if (typeof roomData?.pendingPkChallengeId === 'string' && roomData.pendingPkChallengeId.trim()) {
        return deny(roomPkError(
          'ROOM_ALREADY_RESERVED',
          409,
          'The room has a pending cross-room PK challenge.',
        ));
      }
      if (
        activeSession
        && isPkSessionActive(activeSession, nowMs)
        && MAX_CONCURRENT_PER_ROOM <= 1
      ) {
        return deny(roomPkError('SESSION_ALREADY_ACTIVE', 409, 'Only one PK session is allowed per room.'));
      }
      const lastEndedAtMs = Number(roomData?.lastPkEndedAtMs) || 0;
      if (lastEndedAtMs > 0 && nowMs - lastEndedAtMs < COOLDOWN_MS) {
        return deny(roomPkError(
          'COOLDOWN_ACTIVE',
          409,
          'A PK cooldown is still active for this room.',
          { retryAfterMs: COOLDOWN_MS - (nowMs - lastEndedAtMs) },
        ));
      }

      const pkId = createRoomPkSessionId(command.requestId, command.roomId);
      const session = buildStartRoomPkSession({
        durationMs: clampPkDurationMs(command.durationMs),
        hostUid: decodedToken.uid,
        nowMs,
        pkId,
        roomId: command.roomId,
      });
      const sessionRef = db.doc(`roomPkSessions/${pkId}`);
      transaction.create(sessionRef, {
        distinctGifters: session.distinctGifters,
        durationMs: session.durationMs,
        endsAt: clock.timestampFromMillis(session.endsAtMs),
        endsAtMs: session.endsAtMs,
        giftEventIds: session.giftEventIds,
        hostUid: session.hostUid,
        mode: session.mode,
        pkId,
        purgeAfter: clock.timestampFromMillis(session.endsAtMs + PK_SESSION_RETENTION_MS),
        roomId: command.roomId,
        schemaVersion: session.schemaVersion,
        startedAt: clock.timestampFromMillis(session.startedAtMs),
        startedAtMs: session.startedAtMs,
        status: session.status,
        teams: session.teams,
        updatedAt: timestamp,
        winner: null,
        winnerReason: '',
        createdAt: timestamp,
      });
      transaction.update(roomRef, {
        activePkSessionId: pkId,
        updatedAt: timestamp,
      });

      const response = {
        ok: true,
        result: {
          action: command.action,
          authority: authority.authority,
          pkId,
          requestId: command.requestId,
          roomId: command.roomId,
          session: mapRoomPkSession(session),
        },
      };
      return persistRequest(response, { pkId });
    }

    if (command.action === 'join-room-pk-team') {
      if (growthFeatures.roomPk !== true) {
        return deny(roomPkError('FEATURE_DISABLED', 503, 'Room PK is not enabled.', { feature: 'roomPk' }));
      }
      if (!roomSnapshot.exists || !isActiveRoom(roomData)) {
        return deny(roomPkError('ROOM_NOT_ACTIVE', 409, 'The room is not available for PK.'));
      }
      if (!isActiveMembership(membership, decodedToken.uid)) {
        return deny(roomPkError('MEMBERSHIP_REQUIRED', 403, 'Active room membership is required.'));
      }
      if (!activeSession || !activeSessionRef || !isPkSessionActive(activeSession, nowMs)) {
        return deny(roomPkError('SESSION_NOT_ACTIVE', 409, 'There is no active PK session to join.'));
      }
      if (activeSession.mode === 'cross-room') {
        return deny(roomPkError('INVALID_REQUEST', 400, 'Cross-room PK assigns sides by room.'));
      }
      if (!ROOM_PK_TEAMS.includes(command.team)) {
        return deny(roomPkError('INVALID_REQUEST', 400, 'A valid PK team (red or blue) is required.'));
      }

      const currentTeam = resolveTeamForUid(activeSession, decodedToken.uid);
      if (currentTeam && currentTeam !== command.team) {
        return deny(roomPkError('ALREADY_ON_OTHER_TEAM', 409, 'You are already on the other PK team.'));
      }
      if (currentTeam === command.team) {
        const response = {
          ok: true,
          result: {
            action: command.action,
            alreadyJoined: true,
            pkId: activeSession.pkId,
            requestId: command.requestId,
            roomId: command.roomId,
            session: activeSession,
            team: command.team,
          },
        };
        return persistRequest(response, { pkId: activeSession.pkId });
      }

      const nextTeams = {
        blue: {
          ...activeSession.teams.blue,
          memberUids: [...activeSession.teams.blue.memberUids],
        },
        red: {
          ...activeSession.teams.red,
          memberUids: [...activeSession.teams.red.memberUids],
        },
      };
      nextTeams[command.team].memberUids = [
        ...nextTeams[command.team].memberUids,
        decodedToken.uid,
      ];
      transaction.update(activeSessionRef, {
        teams: nextTeams,
        updatedAt: timestamp,
      });
      activeSession = {
        ...activeSession,
        teams: nextTeams,
      };

      const response = {
        ok: true,
        result: {
          action: command.action,
          alreadyJoined: false,
          pkId: activeSession.pkId,
          requestId: command.requestId,
          roomId: command.roomId,
          session: activeSession,
          team: command.team,
        },
      };
      return persistRequest(response, { pkId: activeSession.pkId });
    }

    if (command.action === 'end-room-pk') {
      if (!roomSnapshot.exists || !isActiveRoom(roomData)) {
        return deny(roomPkError('ROOM_NOT_ACTIVE', 409, 'The room is not available for PK.'));
      }
      if (!activeSession || !activeSessionRef) {
        return deny(roomPkError('SESSION_NOT_FOUND', 404, 'No PK session was found for this room.'));
      }
      if (activeSession.mode === 'cross-room') {
        return deny(roomPkError('INVALID_REQUEST', 400, 'Use surrender for an active cross-room PK.'));
      }
      if (!['active', 'lobby'].includes(activeSession.status) && activeSession.winner != null) {
        const response = {
          ok: true,
          result: {
            action: command.action,
            alreadyEnded: true,
            pkId: activeSession.pkId,
            requestId: command.requestId,
            roomId: command.roomId,
            session: activeSession,
          },
        };
        return persistRequest(response, { pkId: activeSession.pkId });
      }

      const expired = !isPkSessionActive(activeSession, nowMs);
      const authority = canManageRoomPk({
        membership,
        room: roomData,
        uid: decodedToken.uid,
      });
      const isHost = activeSession.hostUid === decodedToken.uid
        || canStartRoomPk({ membership, room: roomData, uid: decodedToken.uid }).ok;
      if (!expired && !authority.ok && !isHost) {
        return deny(roomPkError(
          'FORBIDDEN',
          403,
          'Only the host, owner, or moderator can end an active PK session.',
        ));
      }

      // Ending is allowed when the feature flag is off so in-flight sessions can clear.
      const patch = buildFinalizePatch({
        nowMs,
        session: activeSession,
        status: 'ended',
      });
      transaction.update(activeSessionRef, {
        endedAt: clock.timestampFromMillis(patch.endedAtMs),
        endedBy: decodedToken.uid,
        endReason: expired ? 'expired' : 'ended',
        purgeAfter: clock.timestampFromMillis(nowMs + PK_SESSION_RETENTION_MS),
        status: patch.status,
        updatedAt: timestamp,
        winner: patch.winner,
        winnerReason: patch.winnerReason,
      });
      transaction.update(roomRef, {
        activePkSessionId: null,
        lastPkEndedAtMs: nowMs,
        updatedAt: timestamp,
      });
      const finalized = {
        ...activeSession,
        ...patch,
      };
      const response = {
        ok: true,
        result: {
          action: command.action,
          alreadyEnded: false,
          pkId: activeSession.pkId,
          requestId: command.requestId,
          roomId: command.roomId,
          session: mapRoomPkSession(finalized),
        },
      };
      return persistRequest(response, { pkId: activeSession.pkId });
    }

    return deny(roomPkError('INVALID_REQUEST', 400, 'A valid room PK command is required.'));
  });
}

async function applyRoomPkGiftContribution({
  clock = systemClock,
  db,
  fieldValue,
  contribution,
}) {
  const roomId = typeof contribution?.roomId === 'string' ? contribution.roomId.trim() : '';
  const eventId = typeof contribution?.eventId === 'string' ? contribution.eventId.trim() : '';
  const senderUid = typeof contribution?.senderUid === 'string' ? contribution.senderUid.trim() : '';
  const recipientUid = typeof contribution?.recipientUid === 'string'
    ? contribution.recipientUid.trim()
    : '';
  const priceCoins = Number(contribution?.priceCoins);
  const nowMs = Number.isFinite(Number(contribution?.nowMs))
    ? Number(contribution.nowMs)
    : clock.nowMillis();

  if (!roomId || !eventId || !senderUid || !Number.isFinite(priceCoins) || priceCoins <= 0) {
    return { ok: true, skipped: true, reason: 'invalid_contribution' };
  }

  const growthFeatures = await readGrowthFeatureFlags(db);
  if (growthFeatures.roomPk !== true) {
    return { ok: true, skipped: true, reason: 'feature_disabled' };
  }

  return db.runTransaction(async (transaction) => {
    const roomRef = db.doc(`rooms/${roomId}`);
    const factRef = db.doc(`roomPkGiftFacts/${eventId}`);
    const [roomSnapshot, factSnapshot] = await Promise.all([
      transaction.get(roomRef),
      transaction.get(factRef),
    ]);

    if (factSnapshot.exists) {
      return { ok: true, duplicate: true, skipped: false };
    }

    if (!roomSnapshot.exists) {
      return { ok: true, skipped: true, reason: 'room_missing' };
    }
    const roomData = roomSnapshot.data();
    const activePkId = typeof roomData?.activePkSessionId === 'string'
      ? roomData.activePkSessionId.trim()
      : '';
    if (!activePkId) {
      return { ok: true, skipped: true, reason: 'no_active_pk' };
    }

    const sessionRef = db.doc(`roomPkSessions/${activePkId}`);
    const sessionSnapshot = await transaction.get(sessionRef);
    if (!sessionSnapshot.exists) {
      return { ok: true, skipped: true, reason: 'session_missing' };
    }
    const session = mapRoomPkSession({ pkId: activePkId, ...sessionSnapshot.data() });
    if (!session || session.mode === 'cross-room') {
      return { ok: true, skipped: true, reason: 'cross_room_uses_durable_projection' };
    }
    if (!isPkSessionActive(session, nowMs)) {
      return { ok: true, skipped: true, reason: 'session_inactive' };
    }

    const team = resolveTeamForUid(session, senderUid);
    if (!team) {
      // Prefer skip scoring for unteamed senders (do not auto-assign).
      return {
        ok: true,
        skipped: true,
        reason: 'sender_not_on_team',
        recipientUid,
      };
    }

    const scored = applyPkGiftScore({
      eventId,
      nowMs,
      priceCoins,
      session,
      team,
      uid: senderUid,
    });
    if (!scored.ok) {
      return scored;
    }
    if (scored.duplicate) {
      return { ok: true, duplicate: true, skipped: false };
    }

    const timestamp = fieldValue.serverTimestamp();
    transaction.set(factRef, {
      createdAt: timestamp,
      eventId,
      pkId: activePkId,
      priceCoins: Math.floor(priceCoins),
      purgeAfter: clock.timestampFromMillis(nowMs + PK_SESSION_RETENTION_MS),
      recipientUid,
      roomId,
      senderUid,
      team,
    });
    transaction.update(sessionRef, {
      distinctGifters: scored.session.distinctGifters,
      giftEventIds: scored.session.giftEventIds,
      teams: scored.session.teams,
      updatedAt: timestamp,
    });

    return {
      ok: true,
      duplicate: false,
      pkId: activePkId,
      skipped: false,
      team,
      session: mapRoomPkSession({
        ...session,
        ...scored.session,
      }),
    };
  });
}

async function finalizeExpiredRoomPkSessions({
  clock = systemClock,
  db,
  fieldValue,
  limit = 100,
}) {
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);
  const snapshot = await db.collection('roomPkSessions')
    .where('status', '==', 'active')
    .where('endsAt', '<=', now)
    .orderBy('endsAt', 'asc')
    .limit(limit)
    .get();

  let finalized = 0;
  for (const candidate of snapshot.docs) {
    const changed = await db.runTransaction(async (transaction) => {
      const sessionRef = candidate.ref;
      const sessionSnapshot = await transaction.get(sessionRef);
      if (!sessionSnapshot.exists) return false;
      const session = mapRoomPkSession({ pkId: sessionRef.id, ...sessionSnapshot.data() });
      if (!session || session.mode === 'cross-room' || session.status !== 'active') return false;
      const endsAtMs = session.endsAtMs || timestampToMillis(sessionSnapshot.data()?.endsAt);
      if (endsAtMs > nowMs) return false;

      const roomRef = db.doc(`rooms/${session.roomId}`);
      const roomSnapshot = await transaction.get(roomRef);
      const patch = buildFinalizePatch({ nowMs, session, status: 'ended' });
      const timestamp = fieldValue?.serverTimestamp?.() || clock.timestampFromMillis(nowMs);
      transaction.update(sessionRef, {
        endedAt: clock.timestampFromMillis(patch.endedAtMs),
        endedBy: 'system',
        endReason: 'expired',
        purgeAfter: clock.timestampFromMillis(nowMs + PK_SESSION_RETENTION_MS),
        status: patch.status,
        updatedAt: timestamp,
        winner: patch.winner,
        winnerReason: patch.winnerReason,
      });
      if (roomSnapshot.exists && roomSnapshot.data()?.activePkSessionId === sessionRef.id) {
        transaction.update(roomRef, {
          activePkSessionId: null,
          lastPkEndedAtMs: nowMs,
          updatedAt: timestamp,
        });
      }
      return true;
    });
    if (changed) finalized += 1;
  }
  return { finalized, scanned: snapshot.size };
}

async function forceFinalizeRoomPkOnFlagOff({
  clock = systemClock,
  db,
  fieldValue,
  limit = 100,
  roomId = '',
}) {
  const growthFeatures = await readGrowthFeatureFlags(db);
  if (growthFeatures.roomPk === true) {
    return { finalized: 0, scanned: 0, skipped: true, reason: 'flag_still_on' };
  }

  const nowMs = clock.nowMillis();
  let query = db.collection('roomPkSessions').where('status', '==', 'active');
  if (roomId) {
    query = query.where('roomId', '==', roomId);
  }
  const snapshot = await query.limit(limit).get();
  let finalized = 0;
  for (const candidate of snapshot.docs) {
    const changed = await db.runTransaction(async (transaction) => {
      const sessionRef = candidate.ref;
      const sessionSnapshot = await transaction.get(sessionRef);
      if (!sessionSnapshot.exists) return false;
      const session = mapRoomPkSession({ pkId: sessionRef.id, ...sessionSnapshot.data() });
      if (!session || session.mode === 'cross-room' || session.status !== 'active') return false;

      const roomRef = db.doc(`rooms/${session.roomId}`);
      const roomSnapshot = await transaction.get(roomRef);
      const patch = buildFinalizePatch({ nowMs, session, status: 'forfeited' });
      const timestamp = fieldValue?.serverTimestamp?.() || clock.timestampFromMillis(nowMs);
      transaction.update(sessionRef, {
        endedAt: clock.timestampFromMillis(patch.endedAtMs),
        endedBy: 'system',
        endReason: 'feature_flag_off',
        purgeAfter: clock.timestampFromMillis(nowMs + PK_SESSION_RETENTION_MS),
        status: patch.status === 'void' ? 'void' : 'forfeited',
        updatedAt: timestamp,
        winner: patch.winner,
        winnerReason: patch.winnerReason || 'feature_flag_off',
      });
      if (roomSnapshot.exists && roomSnapshot.data()?.activePkSessionId === sessionRef.id) {
        transaction.update(roomRef, {
          activePkSessionId: null,
          lastPkEndedAtMs: nowMs,
          updatedAt: timestamp,
        });
      }
      return true;
    });
    if (changed) finalized += 1;
  }
  return { finalized, scanned: snapshot.size, skipped: false };
}

module.exports = {
  applyRoomPkGiftContribution,
  executeRoomPkCommand,
  finalizeExpiredRoomPkSessions,
  forceFinalizeRoomPkOnFlagOff,
};
