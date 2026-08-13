'use strict';

const { createHash } = require('node:crypto');
const { mapGrowthFeatures } = require('./growthRolloutCore');
const { resolveSlidingWindowRateLimit } = require('./voiceRoomRateLimitCore');
const {
  COOLDOWN_MS,
  PK_COMMAND_RETENTION_MS,
  ROOM_PK_RATE_LIMIT,
  ROOM_PK_RATE_WINDOW_MS,
  buildCrossRoomPkChallenge,
  buildCrossRoomPkScoreShards,
  buildCrossRoomPkSession,
  buildRoomPkFingerprint,
  canStartRoomPk,
  isActiveMembership,
  isCrossRoomPkEligibleRoom,
  isCrossRoomPkPairInRollout,
  mapCrossRoomPkChallenge,
  mapCrossRoomPkRolloutPolicy,
  mapRoomPkSession,
  normalizeRoomPkBody,
  resolveRoomPkAuthorityUid,
  roomPkError,
  timestampToMillis,
  validateRoomPkRequest,
} = require('./roomPkCore');
const {
  CROSS_ROOM_PK_LIMITS,
  CROSS_ROOM_PK_RETENTION_MS,
  CROSS_ROOM_PK_TIMING_MS,
  canTransitionCrossRoomPkChallenge,
  getCrossRoomPkErrorContract,
} = require('./crossRoomPkContract');

const systemClock = {
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => {
    const { Timestamp } = require('firebase-admin/firestore');
    return Timestamp.fromMillis(value);
  },
};

async function executeCrossRoomPkCommand({
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
  if (!decodedToken?.uid) return crossRoomPkError('FORBIDDEN');

  if (command.action === 'list-cross-room-pk-opponents') {
    return listCrossRoomPkOpponents({ clock, command, db, documentIdField, uid: decodedToken.uid });
  }

  return db.runTransaction(async (transaction) => executeCrossRoomPkTransaction({
    clock,
    command,
    db,
    fieldValue,
    transaction,
    uid: decodedToken.uid,
  }));
}

async function executeCrossRoomPkTransaction({ clock, command, db, fieldValue, transaction, uid }) {
  const nowMs = clock.nowMillis();
  const timestamp = fieldValue.serverTimestamp();
  const requestRef = db.doc(`rooms/${command.roomId}/pkCommandRequests/${command.requestId}`);
  const userRateRef = db.doc(`roomPkRateLimits/${uid}`);
  const growthRef = db.doc('appConfig/growthFeatures');
  const voiceRef = db.doc('appConfig/voiceRoomFeatures');
  const rolloutRef = db.doc('appRuntime/crossRoomPkRollout');
  const actorRoomRef = db.doc(`rooms/${command.roomId}`);
  const actorMembershipRef = db.doc(`rooms/${command.roomId}/members/${uid}`);
  const [requestSnapshot, userRateSnapshot, growthSnapshot, voiceSnapshot, rolloutSnapshot,
    actorRoomSnapshot, actorMembershipSnapshot] = await Promise.all([
    transaction.get(requestRef),
    transaction.get(userRateRef),
    transaction.get(growthRef),
    transaction.get(voiceRef),
    transaction.get(rolloutRef),
    transaction.get(actorRoomRef),
    transaction.get(actorMembershipRef),
  ]);

  const fingerprint = buildRoomPkFingerprint(uid, command);
  if (requestSnapshot.exists) {
    const previous = requestSnapshot.data();
    if (previous.actorUid !== uid || previous.fingerprint !== fingerprint) {
      return crossRoomPkError('REQUEST_ID_CONFLICT');
    }
    return { ...previous.response, replayed: true };
  }

  const purgeAfter = clock.timestampFromMillis(nowMs + PK_COMMAND_RETENTION_MS);
  const rateLimit = resolveSlidingWindowRateLimit({
    limit: ROOM_PK_RATE_LIMIT,
    nowMs,
    rate: userRateSnapshot.exists ? userRateSnapshot.data() : undefined,
    windowMs: ROOM_PK_RATE_WINDOW_MS,
  });
  let rateLimitWritten = false;
  const writeUserRateLimit = () => {
    if (rateLimitWritten || !rateLimit.ok) return;
    rateLimitWritten = true;
    transaction.set(userRateRef, {
      attemptsMs: rateLimit.value.attemptsMs,
      count: rateLimit.value.count,
      purgeAfter,
      roomId: command.roomId,
      uid,
      updatedAt: timestamp,
      windowStartedAt: clock.timestampFromMillis(rateLimit.value.windowStartedAtMs),
    }, { merge: true });
  };
  const persistRequest = (response, extra = {}) => {
    transaction.create(requestRef, {
      action: command.action,
      actorUid: uid,
      createdAt: timestamp,
      fingerprint,
      mode: 'cross-room',
      purgeAfter,
      requestId: command.requestId,
      response,
      roomId: command.roomId,
      ...extra,
    });
    writeUserRateLimit();
    return response;
  };
  const deny = (code, details) => persistRequest(crossRoomPkError(code, details));

  if (!rateLimit.ok) return crossRoomPkError('RATE_LIMITED', rateLimit.details);
  const growth = mapGrowthFeatures(growthSnapshot.exists ? growthSnapshot.data() : {});
  if (growth.roomPk !== true || growth.crossRoomPk !== true
    || voiceSnapshot.data()?.voice_room_gifts !== true) {
    return deny('FEATURE_DISABLED', { feature: 'crossRoomPk' });
  }

  const actorRoom = actorRoomSnapshot.exists
    ? { id: command.roomId, ...actorRoomSnapshot.data() }
    : undefined;
  const actorMembership = actorMembershipSnapshot.exists ? actorMembershipSnapshot.data() : undefined;
  if (!actorRoomSnapshot.exists || !isCrossRoomPkEligibleRoom(actorRoom)) return deny('ROOM_NOT_ELIGIBLE');
  if (!isActiveMembership(actorMembership, uid)) return deny('MEMBERSHIP_REQUIRED');

  if (command.action === 'get-room-pk-challenge-status') {
    return getChallengeStatus({
      actorRoom,
      actorRoomRef,
      clock,
      command,
      db,
      deny,
      nowMs,
      persistRequest,
      timestamp,
      transaction,
    });
  }

  if (command.action === 'challenge-cross-room-pk') {
    return createChallenge({
      actorMembership,
      actorRoom,
      actorRoomRef,
      clock,
      command,
      db,
      deny,
      nowMs,
      persistRequest,
      rollout: mapCrossRoomPkRolloutPolicy(rolloutSnapshot.exists ? rolloutSnapshot.data() : {}),
      timestamp,
      transaction,
      uid,
    });
  }

  if (command.action === 'surrender-cross-room-pk') {
    return surrenderCrossRoomPk({
      actorMembership,
      actorRoom,
      clock,
      command,
      db,
      deny,
      nowMs,
      persistRequest,
      timestamp,
      transaction,
      uid,
    });
  }

  if (['accept-cross-room-pk', 'decline-cross-room-pk', 'cancel-cross-room-pk'].includes(command.action)) {
    return resolveChallenge({
      actorMembership,
      actorRoom,
      actorRoomRef,
      clock,
      command,
      db,
      deny,
      nowMs,
      persistRequest,
      rollout: mapCrossRoomPkRolloutPolicy(rolloutSnapshot.exists ? rolloutSnapshot.data() : {}),
      timestamp,
      transaction,
      uid,
    });
  }

  return deny('INVALID_REQUEST');
}

async function surrenderCrossRoomPk({ actorMembership, actorRoom, clock, command, db, deny,
  nowMs, persistRequest, timestamp, transaction, uid }) {
  const authority = canStartRoomPk({ membership: actorMembership, room: actorRoom, uid });
  if (!authority.ok || resolveRoomPkAuthorityUid(actorRoom) !== uid) return deny('FORBIDDEN');
  if (actorRoom.activePkSessionId !== command.pkId) return deny('SESSION_NOT_ACTIVE');
  const sessionRef = db.doc(`roomPkSessions/${command.pkId}`);
  const jobRef = db.doc(`roomPkReconciliations/${command.pkId}`);
  const [sessionSnapshot, jobSnapshot] = await Promise.all([
    transaction.get(sessionRef), transaction.get(jobRef),
  ]);
  const session = sessionSnapshot.exists
    ? mapRoomPkSession({ pkId: command.pkId, ...sessionSnapshot.data() }) : null;
  if (!session || session.mode !== 'cross-room' || !session.roomIds.includes(command.roomId)) {
    return deny('SESSION_NOT_ACTIVE');
  }
  if (session.status !== 'active') return deny('SESSION_NOT_ACTIVE');
  const forfeitSide = command.roomId === session.redRoomId ? 'red' : 'blue';
  const { createCrossRoomPkReconciliation } = require('./crossRoomPkSettlementCore');
  const job = createCrossRoomPkReconciliation({ nowMs, session });
  const scoringEndsAtMs = Math.min(nowMs, session.endsAtMs);
  const settleAfterMs = scoringEndsAtMs + CROSS_ROOM_PK_TIMING_MS.ingestionGrace;
  transaction.update(sessionRef, {
    endedBy: uid,
    endReason: 'surrender',
    forfeitSide,
    scoringEndsAt: clock.timestampFromMillis(scoringEndsAtMs),
    scoringEndsAtMs,
    settleAfter: clock.timestampFromMillis(settleAfterMs),
    settleAfterMs,
    status: 'settling',
    updatedAt: timestamp,
  });
  if (!jobSnapshot.exists) transaction.create(jobRef, {
    ...job,
    leaseExpiresAt: null,
    purgeAfter: clock.timestampFromMillis(job.purgeAfterMs),
    red: { ...job.red, cursorCreatedAt: null },
    blue: { ...job.blue, cursorCreatedAt: null },
    updatedAt: timestamp,
  });
  writeAudit({ clock, command, db, nowMs, outcome: 'settling_surrender', timestamp, transaction, uid,
    challengeId: session.challengeId, pkId: session.pkId,
    redRoomId: session.redRoomId, blueRoomId: session.blueRoomId });
  return persistRequest({
    ok: true,
    result: {
      action: command.action,
      pkId: session.pkId,
      requestId: command.requestId,
      roomId: command.roomId,
      session: {
        ...session, endedBy: uid, endReason: 'surrender', forfeitSide,
        scoringEndsAtMs, settleAfterMs, status: 'settling',
      },
    },
  }, { pkId: session.pkId });
}

async function createChallenge({ actorMembership, actorRoom, actorRoomRef, clock, command, db, deny,
  nowMs, persistRequest, rollout, timestamp, transaction, uid }) {
  const authority = canStartRoomPk({ membership: actorMembership, room: actorRoom, uid });
  if (!authority.ok) return deny('FORBIDDEN');

  const opponentRoomRef = db.doc(`rooms/${command.opponentRoomId}`);
  const roomRateRef = db.doc(`crossRoomPkRoomRateLimits/${command.roomId}`);
  const pairRef = db.doc(`crossRoomPkPairCooldowns/${createPairId(command.roomId, command.opponentRoomId)}`);
  const [opponentRoomSnapshot, roomRateSnapshot, pairSnapshot] = await Promise.all([
    transaction.get(opponentRoomRef),
    transaction.get(roomRateRef),
    transaction.get(pairRef),
  ]);
  const opponentRoom = opponentRoomSnapshot.exists
    ? { id: command.opponentRoomId, ...opponentRoomSnapshot.data() }
    : undefined;
  if (!isCrossRoomPkEligibleRoom(opponentRoom)) return deny('ROOM_NOT_ELIGIBLE');

  const roomRate = resolveSlidingWindowRateLimit({
    limit: CROSS_ROOM_PK_LIMITS.outgoingChallengesPerRoom,
    nowMs,
    rate: roomRateSnapshot.exists ? roomRateSnapshot.data() : undefined,
    windowMs: CROSS_ROOM_PK_LIMITS.outgoingChallengesWindowMs,
  });
  const writeRoomRate = () => {
    if (!roomRate.ok) return;
    transaction.set(roomRateRef, {
      attemptsMs: roomRate.value.attemptsMs,
      count: roomRate.value.count,
      purgeAfter: clock.timestampFromMillis(nowMs + CROSS_ROOM_PK_LIMITS.outgoingChallengesWindowMs),
      roomId: command.roomId,
      updatedAt: timestamp,
      windowStartedAt: clock.timestampFromMillis(roomRate.value.windowStartedAtMs),
    }, { merge: true });
  };
  const denyCreate = (code, details) => {
    writeRoomRate();
    return deny(code, details);
  };
  if (!roomRate.ok) return deny('RATE_LIMITED', roomRate.details);

  const redAuthorityUid = resolveRoomPkAuthorityUid(actorRoom);
  const blueAuthorityUid = resolveRoomPkAuthorityUid(opponentRoom);
  if (!redAuthorityUid || !blueAuthorityUid || redAuthorityUid !== uid) return denyCreate('FORBIDDEN');
  const [redProfile, blueProfile, redAuthorityMembership, blueAuthorityMembership,
    redBlocksBlue, blueBlocksRed] = await Promise.all([
    transaction.get(db.doc(`publicProfiles/${redAuthorityUid}`)),
    transaction.get(db.doc(`publicProfiles/${blueAuthorityUid}`)),
    transaction.get(db.doc(`rooms/${actorRoom.id}/members/${redAuthorityUid}`)),
    transaction.get(db.doc(`rooms/${opponentRoom.id}/members/${blueAuthorityUid}`)),
    transaction.get(db.doc(`blocks/${redAuthorityUid}/blocked/${blueAuthorityUid}`)),
    transaction.get(db.doc(`blocks/${blueAuthorityUid}/blocked/${redAuthorityUid}`)),
  ]);
  if (!isActiveAuthority(redProfile, redAuthorityMembership, redAuthorityUid)
    || !isActiveAuthority(blueProfile, blueAuthorityMembership, blueAuthorityUid)) {
    return denyCreate('ROOM_NOT_ELIGIBLE');
  }
  if (redBlocksBlue.exists || blueBlocksRed.exists) return denyCreate('BLOCKED_RELATIONSHIP');
  if (!isCrossRoomPkPairInRollout({
    challengerAuthorityUid: redAuthorityUid,
    challengerRoom: actorRoom,
    opponentAuthorityUid: blueAuthorityUid,
    opponentRoom,
    policy: rollout,
  })) return denyCreate('FEATURE_DISABLED', { feature: 'crossRoomPkRollout' });

  const cooldownUntilMs = timestampToMillis(pairSnapshot.data()?.cooldownUntil)
    || Number(pairSnapshot.data()?.cooldownUntilMs) || 0;
  if (cooldownUntilMs > nowMs) return denyCreate('COOLDOWN_ACTIVE', { retryAfterMs: cooldownUntilMs - nowMs });

  const pointerState = await readRoomPointerState({ db, rooms: [actorRoom, opponentRoom], transaction });
  if (pointerState.active) return denyCreate('SESSION_ALREADY_ACTIVE');
  if (pointerState.pending) return denyCreate('ROOM_ALREADY_RESERVED');
  const lastEndedAtMs = Math.max(Number(actorRoom.lastPkEndedAtMs) || 0, Number(opponentRoom.lastPkEndedAtMs) || 0);
  if (lastEndedAtMs > 0 && nowMs - lastEndedAtMs < COOLDOWN_MS) {
    return denyCreate('COOLDOWN_ACTIVE', { retryAfterMs: COOLDOWN_MS - (nowMs - lastEndedAtMs) });
  }

  const challenge = buildCrossRoomPkChallenge({
    challengerAuthorityUid: uid,
    challengerRoom: actorRoom,
    durationMs: command.durationMs,
    nowMs,
    opponentRoom,
    requestId: command.requestId,
  });
  const mappedChallenge = mapCrossRoomPkChallenge(challenge);
  if (!mappedChallenge) return denyCreate('ROOM_NOT_ELIGIBLE');
  const challengeRef = db.doc(`roomPkChallenges/${challenge.challengeId}`);
  transaction.create(challengeRef, serializeChallenge(challenge, clock, timestamp));
  const roomPointerPatch = { pendingPkChallengeId: challenge.challengeId, updatedAt: timestamp };
  transaction.update(actorRoomRef, roomPointerPatch);
  transaction.update(opponentRoomRef, roomPointerPatch);
  writeRoomRate();
  writeAudit({ clock, command, db, nowMs, outcome: 'pending', timestamp, transaction, uid,
    challengeId: challenge.challengeId, redRoomId: actorRoom.id, blueRoomId: opponentRoom.id });

  const response = {
    ok: true,
    result: {
      action: command.action,
      authority: authority.authority,
      challenge: mappedChallenge,
      challengeId: challenge.challengeId,
      requestId: command.requestId,
      roomId: command.roomId,
    },
  };
  return persistRequest(response, { challengeId: challenge.challengeId });
}

async function resolveChallenge({ actorMembership, actorRoom, actorRoomRef, clock, command, db, deny,
  nowMs, persistRequest, rollout, timestamp, transaction, uid }) {
  const challengeRef = db.doc(`roomPkChallenges/${command.challengeId}`);
  const challengeSnapshot = await transaction.get(challengeRef);
  if (!challengeSnapshot.exists) return deny('CHALLENGE_NOT_FOUND');
  const challenge = mapCrossRoomPkChallenge({ challengeId: command.challengeId, ...challengeSnapshot.data() });
  if (!challenge || ![challenge.challengerRoomId, challenge.opponentRoomId].includes(command.roomId)) {
    return deny('CHALLENGE_NOT_FOUND');
  }
  const redRoomRef = db.doc(`rooms/${challenge.challengerRoomId}`);
  const blueRoomRef = db.doc(`rooms/${challenge.opponentRoomId}`);
  const [redRoomSnapshot, blueRoomSnapshot] = await Promise.all([
    command.roomId === challenge.challengerRoomId ? Promise.resolve({ exists: true, data: () => actorRoom }) : transaction.get(redRoomRef),
    command.roomId === challenge.opponentRoomId ? Promise.resolve({ exists: true, data: () => actorRoom }) : transaction.get(blueRoomRef),
  ]);
  const redRoom = redRoomSnapshot.exists ? { id: challenge.challengerRoomId, ...redRoomSnapshot.data() } : undefined;
  const blueRoom = blueRoomSnapshot.exists ? { id: challenge.opponentRoomId, ...blueRoomSnapshot.data() } : undefined;
  if (!redRoom || !blueRoom) return deny('ROOM_NOT_ACTIVE');

  if (challenge.status !== 'pending') return deny('CHALLENGE_NOT_PENDING');
  if (challenge.expiresAtMs <= nowMs) {
    expireChallenge({ challenge, challengeRef, redRoom, redRoomRef, blueRoom, blueRoomRef, timestamp, transaction });
    return persistRequest(crossRoomPkError('CHALLENGE_EXPIRED'), { challengeId: challenge.challengeId });
  }
  if (redRoom.pendingPkChallengeId !== challenge.challengeId
    || blueRoom.pendingPkChallengeId !== challenge.challengeId) return deny('CHALLENGE_NOT_PENDING');

  const expectedRoomId = command.action === 'cancel-cross-room-pk'
    ? challenge.challengerRoomId
    : challenge.opponentRoomId;
  if (command.roomId !== expectedRoomId) return deny('FORBIDDEN');
  const authority = canStartRoomPk({ membership: actorMembership, room: actorRoom, uid });
  if (!authority.ok || resolveRoomPkAuthorityUid(actorRoom) !== uid) return deny('FORBIDDEN');

  if (command.action === 'decline-cross-room-pk' || command.action === 'cancel-cross-room-pk') {
    const status = command.action === 'decline-cross-room-pk' ? 'declined' : 'cancelled';
    if (!canTransitionCrossRoomPkChallenge('pending', status)) return deny('CHALLENGE_NOT_PENDING');
    transaction.update(challengeRef, {
      resolutionReason: status,
      resolvedAt: timestamp,
      status,
    });
    clearMatchingChallengePointers({ challenge, redRoom, redRoomRef, blueRoom, blueRoomRef, timestamp, transaction });
    const pairRef = db.doc(`crossRoomPkPairCooldowns/${createPairId(redRoom.id, blueRoom.id)}`);
    const pairPurgeAfterMs = nowMs + CROSS_ROOM_PK_TIMING_MS.repeatOpponentCooldown
      + CROSS_ROOM_PK_RETENTION_MS.command;
    transaction.set(pairRef, {
      blueRoomId: blueRoom.id,
      cooldownUntil: clock.timestampFromMillis(nowMs + CROSS_ROOM_PK_TIMING_MS.repeatOpponentCooldown),
      cooldownUntilMs: nowMs + CROSS_ROOM_PK_TIMING_MS.repeatOpponentCooldown,
      purgeAfter: clock.timestampFromMillis(pairPurgeAfterMs),
      redRoomId: redRoom.id,
      updatedAt: timestamp,
    }, { merge: true });
    writeAudit({ clock, command, db, nowMs, outcome: status, timestamp, transaction, uid,
      challengeId: challenge.challengeId, redRoomId: redRoom.id, blueRoomId: blueRoom.id });
    return persistRequest({
      ok: true,
      result: {
        action: command.action,
        challenge: mapCrossRoomPkChallenge({ ...challenge, resolutionReason: status,
          resolvedAtMs: nowMs, status }),
        challengeId: challenge.challengeId,
        requestId: command.requestId,
        roomId: command.roomId,
      },
    }, { challengeId: challenge.challengeId });
  }

  if (!isCrossRoomPkEligibleRoom(redRoom) || !isCrossRoomPkEligibleRoom(blueRoom)) return deny('ROOM_NOT_ELIGIBLE');
  if (redRoom.activePkSessionId || blueRoom.activePkSessionId) return deny('SESSION_ALREADY_ACTIVE');
  const redAuthorityUid = resolveRoomPkAuthorityUid(redRoom);
  const blueAuthorityUid = resolveRoomPkAuthorityUid(blueRoom);
  const [redProfile, blueProfile, redAuthorityMembership, blueAuthorityMembership,
    redBlocksBlue, blueBlocksRed] = await Promise.all([
    transaction.get(db.doc(`publicProfiles/${redAuthorityUid}`)),
    transaction.get(db.doc(`publicProfiles/${blueAuthorityUid}`)),
    transaction.get(db.doc(`rooms/${redRoom.id}/members/${redAuthorityUid}`)),
    transaction.get(db.doc(`rooms/${blueRoom.id}/members/${blueAuthorityUid}`)),
    transaction.get(db.doc(`blocks/${redAuthorityUid}/blocked/${blueAuthorityUid}`)),
    transaction.get(db.doc(`blocks/${blueAuthorityUid}/blocked/${redAuthorityUid}`)),
  ]);
  if (!isActiveAuthority(redProfile, redAuthorityMembership, redAuthorityUid)
    || !isActiveAuthority(blueProfile, blueAuthorityMembership, blueAuthorityUid)) return deny('ROOM_NOT_ELIGIBLE');
  if (redBlocksBlue.exists || blueBlocksRed.exists) return deny('BLOCKED_RELATIONSHIP');
  if (!isCrossRoomPkPairInRollout({
    challengerAuthorityUid: redAuthorityUid,
    challengerRoom: redRoom,
    opponentAuthorityUid: blueAuthorityUid,
    opponentRoom: blueRoom,
    policy: rollout,
  })) return deny('FEATURE_DISABLED', { feature: 'crossRoomPkRollout' });

  const session = buildCrossRoomPkSession({
    acceptedByUid: uid,
    blueAuthorityUid,
    challenge,
    nowMs,
    redAuthorityUid,
  });
  const mappedSession = mapRoomPkSession(session);
  if (!mappedSession) return deny('INVALID_REQUEST');
  const sessionRef = db.doc(`roomPkSessions/${session.pkId}`);
  transaction.create(sessionRef, serializeSession(session, clock, timestamp));
  for (const shard of buildCrossRoomPkScoreShards(session)) {
    transaction.create(
      db.doc(`roomPkSessions/${session.pkId}/scoreShards/${shard.shardId}`),
      {
        ...shard,
        purgeAfter: clock.timestampFromMillis(shard.purgeAfterMs),
        updatedAt: timestamp,
      },
    );
  }
  transaction.update(challengeRef, {
    acceptedByUid: uid,
    resolvedAt: timestamp,
    sessionId: session.pkId,
    status: 'accepted',
  });
  const activePatch = {
    activePkSessionId: session.pkId,
    pendingPkChallengeId: null,
    recentPkExpiresAt: null,
    recentPkSessionId: null,
    updatedAt: timestamp,
  };
  transaction.update(redRoomRef, activePatch);
  transaction.update(blueRoomRef, activePatch);
  writeAudit({ clock, command, db, nowMs, outcome: 'accepted', timestamp, transaction, uid,
    challengeId: challenge.challengeId, pkId: session.pkId,
    redRoomId: redRoom.id, blueRoomId: blueRoom.id });
  return persistRequest({
    ok: true,
    result: {
      action: command.action,
      challengeId: challenge.challengeId,
      pkId: session.pkId,
      requestId: command.requestId,
      roomId: command.roomId,
      session: mappedSession,
    },
  }, { challengeId: challenge.challengeId, pkId: session.pkId });
}

async function getChallengeStatus({ actorRoom, actorRoomRef, clock, command, db, deny, nowMs,
  persistRequest, timestamp, transaction }) {
  const challengeId = command.challengeId || cleanId(actorRoom.pendingPkChallengeId);
  if (!challengeId) {
    return persistRequest({ ok: true, result: {
      action: command.action, challenge: null, challengeId: null,
      requestId: command.requestId, roomId: command.roomId,
    } });
  }
  const challengeRef = db.doc(`roomPkChallenges/${challengeId}`);
  const challengeSnapshot = await transaction.get(challengeRef);
  if (!challengeSnapshot.exists) {
    if (!command.challengeId && actorRoom.pendingPkChallengeId === challengeId) {
      transaction.update(actorRoomRef, { pendingPkChallengeId: null, updatedAt: timestamp });
      return persistRequest({ ok: true, result: {
        action: command.action, challenge: null, challengeId: null,
        requestId: command.requestId, roomId: command.roomId,
      } });
    }
    return deny('CHALLENGE_NOT_FOUND');
  }
  const challenge = mapCrossRoomPkChallenge({ challengeId, ...challengeSnapshot.data() });
  if (!challenge || ![challenge.challengerRoomId, challenge.opponentRoomId].includes(command.roomId)) {
    return deny('CHALLENGE_NOT_FOUND');
  }
  if (challenge.status === 'pending' && challenge.expiresAtMs <= nowMs) {
    const otherRoomId = command.roomId === challenge.challengerRoomId
      ? challenge.opponentRoomId : challenge.challengerRoomId;
    const otherRoomRef = db.doc(`rooms/${otherRoomId}`);
    const otherRoomSnapshot = await transaction.get(otherRoomRef);
    const redRoom = command.roomId === challenge.challengerRoomId
      ? actorRoom : { id: challenge.challengerRoomId, ...(otherRoomSnapshot.data() || {}) };
    const blueRoom = command.roomId === challenge.opponentRoomId
      ? actorRoom : { id: challenge.opponentRoomId, ...(otherRoomSnapshot.data() || {}) };
    expireChallenge({ challenge, challengeRef, redRoom,
      redRoomRef: command.roomId === challenge.challengerRoomId ? actorRoomRef : otherRoomRef,
      blueRoom,
      blueRoomRef: command.roomId === challenge.opponentRoomId ? actorRoomRef : otherRoomRef,
      timestamp, transaction });
    return persistRequest({ ok: true, result: {
      action: command.action,
      challenge: mapCrossRoomPkChallenge({ ...challenge, resolutionReason: 'expired', resolvedAtMs: nowMs, status: 'expired' }),
      challengeId,
      requestId: command.requestId,
      roomId: command.roomId,
    } }, { challengeId });
  }
  return persistRequest({ ok: true, result: {
    action: command.action,
    challenge,
    challengeId,
    requestId: command.requestId,
    roomId: command.roomId,
  } }, { challengeId });
}

async function listCrossRoomPkOpponents({ command, db, documentIdField = '__name__', uid }) {
  const [growthSnapshot, voiceSnapshot, rolloutSnapshot, roomSnapshot, memberSnapshot,
    actorProfileSnapshot] = await Promise.all([
    db.doc('appConfig/growthFeatures').get(),
    db.doc('appConfig/voiceRoomFeatures').get(),
    db.doc('appRuntime/crossRoomPkRollout').get(),
    db.doc(`rooms/${command.roomId}`).get(),
    db.doc(`rooms/${command.roomId}/members/${uid}`).get(),
    db.doc(`publicProfiles/${uid}`).get(),
  ]);
  const growth = mapGrowthFeatures(growthSnapshot.exists ? growthSnapshot.data() : {});
  if (growth.roomPk !== true || growth.crossRoomPk !== true
    || voiceSnapshot.data()?.voice_room_gifts !== true) return crossRoomPkError('FEATURE_DISABLED');
  const room = roomSnapshot.exists ? { id: command.roomId, ...roomSnapshot.data() } : undefined;
  const membership = memberSnapshot.exists ? memberSnapshot.data() : undefined;
  if (!isCrossRoomPkEligibleRoom(room)) return crossRoomPkError('ROOM_NOT_ELIGIBLE');
  if (!isActiveMembership(membership, uid)) return crossRoomPkError('MEMBERSHIP_REQUIRED');
  if (!actorProfileSnapshot.exists || actorProfileSnapshot.data()?.uid !== uid
    || actorProfileSnapshot.data()?.moderationStatus !== 'active') {
    return crossRoomPkError('ROOM_NOT_ELIGIBLE');
  }
  if (!canStartRoomPk({ membership, room, uid }).ok || resolveRoomPkAuthorityUid(room) !== uid) {
    return crossRoomPkError('FORBIDDEN');
  }
  if (room.pendingPkChallengeId) return crossRoomPkError('ROOM_ALREADY_RESERVED');
  if (room.activePkSessionId) return crossRoomPkError('SESSION_ALREADY_ACTIVE');

  const rollout = mapCrossRoomPkRolloutPolicy(rolloutSnapshot.exists ? rolloutSnapshot.data() : {});
  let roomQuery = db.collection('rooms')
    .where('status', '==', 'active')
    .where('visibility', '==', 'public')
    .orderBy(documentIdField)
    .limit(60);
  if (command.cursor) roomQuery = roomQuery.startAfter(command.cursor);
  const query = await roomQuery.get();
  const candidates = [];
  const redAuthorityUid = resolveRoomPkAuthorityUid(room);
  for (const document of query.docs) {
    if (candidates.length >= CROSS_ROOM_PK_LIMITS.maxOpponentResults) break;
    const opponent = { id: document.id, ...document.data() };
    if (opponent.id === room.id || !isCrossRoomPkEligibleRoom(opponent)
      || opponent.pendingPkChallengeId || opponent.activePkSessionId) continue;
    const blueAuthorityUid = resolveRoomPkAuthorityUid(opponent);
    if (!blueAuthorityUid || !isCrossRoomPkPairInRollout({
      challengerAuthorityUid: redAuthorityUid,
      challengerRoom: room,
      opponentAuthorityUid: blueAuthorityUid,
      opponentRoom: opponent,
      policy: rollout,
    })) continue;
    const [redBlock, blueBlock, blueProfile, blueMember] = await Promise.all([
      db.doc(`blocks/${redAuthorityUid}/blocked/${blueAuthorityUid}`).get(),
      db.doc(`blocks/${blueAuthorityUid}/blocked/${redAuthorityUid}`).get(),
      db.doc(`publicProfiles/${blueAuthorityUid}`).get(),
      db.doc(`rooms/${opponent.id}/members/${blueAuthorityUid}`).get(),
    ]);
    if (redBlock.exists || blueBlock.exists || !isActiveAuthority(blueProfile, blueMember, blueAuthorityUid)) continue;
    candidates.push({
      authorityDisplayName: cleanText(opponent.hostDisplayName || opponent.ownerDisplayName, 80),
      countryCode: cleanText(opponent.countryCode, 2),
      participantCount: Math.max(0, Math.floor(Number(opponent.participantCount) || 0)),
      roomId: opponent.id,
      roomImageUrl: opponent.roomImageReviewStatus === 'approved'
        ? cleanText(opponent.roomImageUrl, 2_048) : '',
      roomTitle: cleanText(opponent.title, 120),
    });
  }
  const nextCursor = query.size === 60 ? query.docs.at(-1)?.id || null : null;
  return { ok: true, result: {
    action: command.action,
    nextCursor,
    opponents: candidates,
    requestId: command.requestId,
    roomId: command.roomId,
  } };
}

async function readRoomPointerState({ db, rooms, transaction }) {
  let active = false;
  let pending = false;
  for (const room of rooms) {
    const challengeId = cleanId(room.pendingPkChallengeId);
    if (challengeId) {
      const snapshot = await transaction.get(db.doc(`roomPkChallenges/${challengeId}`));
      if (snapshot.exists && snapshot.data()?.status === 'pending') pending = true;
      else room.pendingPkChallengeId = null;
    }
    const pkId = cleanId(room.activePkSessionId);
    if (pkId) {
      const snapshot = await transaction.get(db.doc(`roomPkSessions/${pkId}`));
      if (snapshot.exists && ['active', 'settling'].includes(snapshot.data()?.status)) active = true;
      else {
        room.activePkSessionId = null;
        transaction.update(db.doc(`rooms/${room.id}`), { activePkSessionId: null });
      }
    }
  }
  return { active, pending };
}

function serializeChallenge(challenge, clock, timestamp) {
  return {
    ...challenge,
    createdAt: timestamp,
    expiresAt: clock.timestampFromMillis(challenge.expiresAtMs),
    purgeAfter: clock.timestampFromMillis(challenge.purgeAfterMs),
  };
}

function serializeSession(session, clock, timestamp) {
  return {
    ...session,
    createdAt: timestamp,
    endsAt: clock.timestampFromMillis(session.endsAtMs),
    purgeAfter: clock.timestampFromMillis(session.purgeAfterMs),
    settleAfter: clock.timestampFromMillis(session.settleAfterMs),
    startedAt: clock.timestampFromMillis(session.startedAtMs),
    updatedAt: timestamp,
  };
}

function expireChallenge({ challenge, challengeRef, redRoom, redRoomRef, blueRoom, blueRoomRef,
  timestamp, transaction }) {
  transaction.update(challengeRef, {
    resolutionReason: 'expired',
    resolvedAt: timestamp,
    status: 'expired',
  });
  clearMatchingChallengePointers({ challenge, redRoom, redRoomRef, blueRoom, blueRoomRef, timestamp, transaction });
}

function clearMatchingChallengePointers({ challenge, redRoom, redRoomRef, blueRoom, blueRoomRef,
  timestamp, transaction }) {
  if (redRoom.pendingPkChallengeId === challenge.challengeId) {
    transaction.update(redRoomRef, { pendingPkChallengeId: null, updatedAt: timestamp });
  }
  if (blueRoom.pendingPkChallengeId === challenge.challengeId) {
    transaction.update(blueRoomRef, { pendingPkChallengeId: null, updatedAt: timestamp });
  }
}

function writeAudit({ blueRoomId, challengeId, clock, command, db, nowMs, outcome, pkId = '', redRoomId,
  timestamp, transaction, uid }) {
  const auditId = createHash('sha256').update(`${uid}|${command.requestId}`).digest('hex').slice(0, 32);
  transaction.create(db.doc(`roomPkAuditEvents/${auditId}`), {
    action: command.action,
    actorUid: uid,
    blueRoomId,
    challengeId,
    createdAt: timestamp,
    mode: 'cross-room',
    outcome,
    pkId,
    purgeAfter: clock.timestampFromMillis(nowMs + CROSS_ROOM_PK_RETENTION_MS.session),
    redRoomId,
    requestId: command.requestId,
  });
}

function isActiveAuthority(profileSnapshot, membershipSnapshot, uid) {
  return Boolean(
    uid
    && profileSnapshot.exists
    && profileSnapshot.data()?.uid === uid
    && profileSnapshot.data()?.moderationStatus === 'active'
    && membershipSnapshot.exists
    && isActiveMembership(membershipSnapshot.data(), uid),
  );
}

function createPairId(redRoomId, blueRoomId) {
  return `crpkp_${createHash('sha256').update([redRoomId, blueRoomId].sort().join('|')).digest('hex').slice(0, 24)}`;
}

function crossRoomPkError(code, details) {
  const contract = getCrossRoomPkErrorContract(code);
  return roomPkError(code, contract.status, contract.message, details);
}

function cleanId(value) {
  return typeof value === 'string' && value && !value.includes('/') ? value.trim().slice(0, 128) : '';
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

module.exports = {
  executeCrossRoomPkCommand,
  listCrossRoomPkOpponents,
};
