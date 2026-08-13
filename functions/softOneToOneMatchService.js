'use strict';

const { mapGrowthFeatures } = require('./growthRolloutCore');
const { incrementGrowthTelemetry } = require('./growthTelemetryCore');
const { resolveSlidingWindowRateLimit } = require('./voiceRoomRateLimitCore');
const {
  SOFT_MATCH_CANDIDATE_LIMIT,
  SOFT_MATCH_QUEUE_TTL_MS,
  SOFT_MATCH_RATE_LIMIT,
  SOFT_MATCH_RATE_WINDOW_MS,
  SOFT_MATCH_SESSION_TTL_MS,
  buildSoftMatchMemberDocument,
  buildSoftMatchRoomDocument,
  createSoftMatchRoomId,
  createSoftMatchSessionId,
  isActiveModeration,
  isSoftMatchQueueWaiting,
  mapLiveSoftMatchTicket,
  mapSoftMatchResult,
  normalizeGender,
  normalizeSoftMatchCancelInput,
  normalizeSoftMatchEnqueueInput,
  normalizeSoftMatchStatusInput,
  pickSoftMatchPeer,
} = require('./softOneToOneMatchCore');

async function readGrowthFeatureFlags(db) {
  const snapshot = await db.doc('appConfig/growthFeatures').get();
  return mapGrowthFeatures(snapshot.exists ? snapshot.data() : {});
}

async function softMatchEnqueue({ clock = Date, db, fieldValue, input, requestId, uid }) {
  const flags = await readGrowthFeatureFlags(db);
  if (flags.softOneToOneMatch !== true) return { errorCode: 'FEATURE_DISABLED' };

  const normalized = normalizeSoftMatchEnqueueInput(input);
  if (!normalized.ok) return { errorCode: normalized.code };

  const requestRef = db.doc(`softMatchRequests/${requestId}`);
  const existing = await requestRef.get();
  if (existing.exists) {
    const prior = mapSoftMatchResult(existing.data()?.result);
    if (prior) return { result: prior };
    return { errorCode: 'REQUEST_CONFLICT' };
  }

  const nowMs = typeof clock.now === 'function' ? clock.now() : Date.now();

  const profileSnap = await db.doc(`publicProfiles/${uid}`).get();
  const profile = profileSnap.exists ? profileSnap.data() : undefined;
  if (!isActiveModeration(profile)) return { errorCode: 'PERMISSION_DENIED' };

  const queueRef = db.doc(`softMatchQueue/${uid}`);
  const queueSnap = await queueRef.get();
  const existingTicket = queueSnap.exists ? queueSnap.data() : undefined;
  const liveExisting = mapLiveSoftMatchTicket(existingTicket, nowMs);
  if (liveExisting) {
    await persistSoftMatchRequest({
      db,
      fieldValue,
      requestId,
      requestRef,
      result: liveExisting,
      uid,
    });
    return { result: liveExisting };
  }

  const rateLimitRef = db.doc(`softMatchRateLimits/${uid}`);
  const rateSnapshot = await rateLimitRef.get();
  const rateLimit = resolveSlidingWindowRateLimit({
    limit: SOFT_MATCH_RATE_LIMIT,
    nowMs,
    rate: rateSnapshot.exists ? rateSnapshot.data() : undefined,
    windowMs: SOFT_MATCH_RATE_WINDOW_MS,
  });
  if (!rateLimit.ok) return { errorCode: 'RATE_LIMITED' };

  await incrementGrowthTelemetry({
    db,
    fieldValue,
    input: { key: 'softMatchAttempts', amount: 1 },
  });

  const actorGender = normalizeGender(profile.gender);
  const actorPreferGender = normalized.value.preferGender;
  const actorCountry = typeof profile.countryCode === 'string' ? profile.countryCode.trim().toUpperCase() : 'IQ';
  const actorDisplayName = typeof profile.displayName === 'string' ? profile.displayName : '';

  let waitingSnapshot;
  try {
    waitingSnapshot = await db.collection('softMatchQueue')
      .where('status', '==', 'waiting')
      .where('expiresAtMs', '>', nowMs)
      .orderBy('expiresAtMs', 'asc')
      .limit(SOFT_MATCH_CANDIDATE_LIMIT)
      .get();
  } catch (error) {
    console.error('[softMatch] queue query failed', error instanceof Error ? error.message : String(error));
    return { errorCode: 'INTERNAL' };
  }

  const candidates = waitingSnapshot.docs
    .map((document) => ({ id: document.id, ...document.data(), uid: document.id }))
    .filter((candidate) => candidate.uid !== uid);

  const blockedPeerUids = await loadBlockedPeerUids(db, uid, candidates.map((row) => row.uid));
  const peer = pickSoftMatchPeer(candidates, {
    actorGender,
    actorPreferGender,
    actorUid: uid,
    blockedPeerUids,
    nowMs,
  });

  if (!peer) {
    const waitingResult = {
      expiresAtMs: nowMs + SOFT_MATCH_QUEUE_TTL_MS,
      preferGender: actorPreferGender,
      status: 'waiting',
    };
    try {
      await db.runTransaction(async (transaction) => {
        await assertSoftMatchRequestFresh(transaction, requestRef, uid);
        const [rateFresh, actorFresh] = await Promise.all([
          transaction.get(rateLimitRef),
          transaction.get(queueRef),
        ]);
        const liveTicket = mapLiveSoftMatchTicket(actorFresh.exists ? actorFresh.data() : undefined, nowMs);
        if (liveTicket) {
          throw Object.assign(new Error('ALREADY_ACTIVE'), { code: 'ALREADY_ACTIVE', result: liveTicket });
        }
        const rateFreshLimit = resolveSlidingWindowRateLimit({
          limit: SOFT_MATCH_RATE_LIMIT,
          nowMs,
          rate: rateFresh.exists ? rateFresh.data() : undefined,
          windowMs: SOFT_MATCH_RATE_WINDOW_MS,
        });
        if (!rateFreshLimit.ok) {
          throw Object.assign(new Error('RATE_LIMITED'), { code: 'RATE_LIMITED' });
        }

        const timestamp = fieldValue.serverTimestamp();
        transaction.set(queueRef, {
          countryCode: actorCountry,
          enqueuedAtMs: nowMs,
          expiresAtMs: waitingResult.expiresAtMs,
          gender: actorGender,
          preferGender: actorPreferGender,
          status: 'waiting',
          uid,
          updatedAt: timestamp,
          updatedAtMs: nowMs,
        });
        transaction.set(requestRef, {
          createdAt: timestamp,
          result: waitingResult,
          requestId,
          uid,
        });
        transaction.set(rateLimitRef, {
          attemptsMs: rateFreshLimit.value.attemptsMs,
          count: rateFreshLimit.value.count,
          uid,
          updatedAt: timestamp,
          windowStartedAt: rateFreshLimit.value.windowStartedAtMs,
        }, { merge: true });
      });
    } catch (error) {
      if (error?.code === 'RATE_LIMITED') return { errorCode: 'RATE_LIMITED' };
      if (error?.code === 'REQUEST_CONFLICT') return { errorCode: 'REQUEST_CONFLICT' };
      if (error?.code === 'REQUEST_REPLAY' && error.result) return { result: error.result };
      if (error?.code === 'ALREADY_ACTIVE' && error.result) return { result: error.result };
      console.error('[softMatch] enqueue wait failed', error instanceof Error ? error.message : String(error));
      return { errorCode: 'INTERNAL' };
    }
    return { result: waitingResult };
  }

  const peerProfileSnap = await db.doc(`publicProfiles/${peer.uid}`).get();
  const peerProfile = peerProfileSnap.exists ? peerProfileSnap.data() : undefined;
  if (!isActiveModeration(peerProfile)) {
    return softMatchEnqueueAsWaiting({
      actorCountry,
      actorDisplayName,
      actorGender,
      actorPreferGender,
      clock,
      db,
      fieldValue,
      nowMs,
      queueRef,
      rateLimitRef,
      requestId,
      requestRef,
      uid,
    });
  }

  const stillBlocked = await loadBlockedPeerUids(db, uid, [peer.uid]);
  if (stillBlocked.has(peer.uid)) {
    return softMatchEnqueueAsWaiting({
      actorCountry,
      actorDisplayName,
      actorGender,
      actorPreferGender,
      clock,
      db,
      fieldValue,
      nowMs,
      queueRef,
      rateLimitRef,
      requestId,
      requestRef,
      uid,
    });
  }

  const sessionId = createSoftMatchSessionId(requestId, uid);
  const roomId = createSoftMatchRoomId(sessionId);
  const sessionExpiresAtMs = nowMs + SOFT_MATCH_SESSION_TTL_MS;
  const room = buildSoftMatchRoomDocument({
    countryCode: actorCountry,
    hostDisplayName: actorDisplayName,
    hostUid: uid,
    nowMs,
    peerUid: peer.uid,
    roomId,
    sessionId,
  });
  if (!room) return { errorCode: 'INTERNAL' };

  const hostMember = buildSoftMatchMemberDocument({
    displayName: actorDisplayName,
    role: 'host',
    uid,
  });
  const peerMember = buildSoftMatchMemberDocument({
    displayName: typeof peerProfile.displayName === 'string' ? peerProfile.displayName : '',
    role: 'speaker',
    uid: peer.uid,
  });
  if (!hostMember || !peerMember) return { errorCode: 'INTERNAL' };

  const matchedForActor = {
    inviteCode: room.inviteCode,
    peerLabelAr: 'ضيف صوتي',
    roomId,
    sessionExpiresAtMs,
    sessionId,
    status: 'matched',
  };
  const matchedForPeer = {
    inviteCode: room.inviteCode,
    peerLabelAr: 'ضيف صوتي',
    roomId,
    sessionExpiresAtMs,
    sessionId,
    status: 'matched',
  };

  try {
    await db.runTransaction(async (transaction) => {
      await assertSoftMatchRequestFresh(transaction, requestRef, uid);

      const peerQueueRef = db.doc(`softMatchQueue/${peer.uid}`);
      const peerProfileRef = db.doc(`publicProfiles/${peer.uid}`);
      const actorProfileRef = db.doc(`publicProfiles/${uid}`);
      const actorBlocksPeerRef = db.doc(`blocks/${uid}/blocked/${peer.uid}`);
      const peerBlocksActorRef = db.doc(`blocks/${peer.uid}/blocked/${uid}`);
      const [
        rateFresh,
        peerFresh,
        actorFresh,
        peerProfileFresh,
        actorProfileFresh,
        actorBlocksPeer,
        peerBlocksActor,
      ] = await Promise.all([
        transaction.get(rateLimitRef),
        transaction.get(peerQueueRef),
        transaction.get(queueRef),
        transaction.get(peerProfileRef),
        transaction.get(actorProfileRef),
        transaction.get(actorBlocksPeerRef),
        transaction.get(peerBlocksActorRef),
      ]);

      const rateFreshLimit = resolveSlidingWindowRateLimit({
        limit: SOFT_MATCH_RATE_LIMIT,
        nowMs,
        rate: rateFresh.exists ? rateFresh.data() : undefined,
        windowMs: SOFT_MATCH_RATE_WINDOW_MS,
      });
      if (!rateFreshLimit.ok) {
        throw Object.assign(new Error('RATE_LIMITED'), { code: 'RATE_LIMITED' });
      }

      if (!isActiveModeration(actorProfileFresh.exists ? actorProfileFresh.data() : undefined)) {
        throw Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' });
      }
      if (!isSoftMatchQueueWaiting(peerFresh.exists ? peerFresh.data() : undefined, nowMs)) {
        throw Object.assign(new Error('PEER_UNAVAILABLE'), { code: 'PEER_UNAVAILABLE' });
      }
      if (!isActiveModeration(peerProfileFresh.exists ? peerProfileFresh.data() : undefined)) {
        throw Object.assign(new Error('PEER_UNAVAILABLE'), { code: 'PEER_UNAVAILABLE' });
      }
      if (actorBlocksPeer.exists || peerBlocksActor.exists) {
        throw Object.assign(new Error('PEER_UNAVAILABLE'), { code: 'PEER_UNAVAILABLE' });
      }
      if (isSoftMatchQueueWaiting(actorFresh.exists ? actorFresh.data() : undefined, nowMs)
        || (actorFresh.exists && actorFresh.data()?.status === 'matched'
          && Number(actorFresh.data()?.sessionExpiresAtMs) > nowMs)) {
        throw Object.assign(new Error('ALREADY_QUEUED'), { code: 'ALREADY_QUEUED' });
      }

      const timestamp = fieldValue.serverTimestamp();
      const roomRef = db.doc(`rooms/${roomId}`);
      const sessionRef = db.doc(`softMatchSessions/${sessionId}`);
      const hostMemberRef = db.doc(`rooms/${roomId}/members/${uid}`);
      const peerMemberRef = db.doc(`rooms/${roomId}/members/${peer.uid}`);

      transaction.set(roomRef, {
        ...room,
        createdAt: timestamp,
        createdAtMs: nowMs,
        updatedAt: timestamp,
        updatedAtMs: nowMs,
      });
      transaction.set(hostMemberRef, {
        ...hostMember,
        joinedAt: timestamp,
        updatedAt: timestamp,
      });
      transaction.set(peerMemberRef, {
        ...peerMember,
        joinedAt: timestamp,
        updatedAt: timestamp,
      });
      transaction.set(sessionRef, {
        createdAt: timestamp,
        createdAtMs: nowMs,
        expiresAtMs: sessionExpiresAtMs,
        peerUids: [uid, peer.uid],
        roomId,
        sessionId,
        status: 'active',
        updatedAt: timestamp,
      });
      transaction.set(queueRef, {
        countryCode: actorCountry,
        enqueuedAtMs: nowMs,
        expiresAtMs: nowMs,
        gender: actorGender,
        inviteCode: room.inviteCode,
        peerLabelAr: matchedForActor.peerLabelAr,
        peerUid: peer.uid,
        preferGender: actorPreferGender,
        roomId,
        sessionExpiresAtMs,
        sessionId,
        status: 'matched',
        uid,
        updatedAt: timestamp,
        updatedAtMs: nowMs,
      });
      transaction.set(peerQueueRef, {
        countryCode: typeof peer.countryCode === 'string' ? peer.countryCode : actorCountry,
        enqueuedAtMs: Number(peer.enqueuedAtMs) || nowMs,
        expiresAtMs: nowMs,
        gender: normalizeGender(peer.gender),
        inviteCode: room.inviteCode,
        peerLabelAr: matchedForPeer.peerLabelAr,
        peerUid: uid,
        preferGender: normalizeGender(peer.preferGender),
        roomId,
        sessionExpiresAtMs,
        sessionId,
        status: 'matched',
        uid: peer.uid,
        updatedAt: timestamp,
        updatedAtMs: nowMs,
      });
      transaction.set(requestRef, {
        createdAt: timestamp,
        result: matchedForActor,
        requestId,
        uid,
      });
      transaction.set(rateLimitRef, {
        attemptsMs: rateFreshLimit.value.attemptsMs,
        count: rateFreshLimit.value.count,
        uid,
        updatedAt: timestamp,
        windowStartedAt: rateFreshLimit.value.windowStartedAtMs,
      }, { merge: true });
    });
  } catch (error) {
    if (error?.code === 'RATE_LIMITED') return { errorCode: 'RATE_LIMITED' };
    if (error?.code === 'PERMISSION_DENIED') return { errorCode: 'PERMISSION_DENIED' };
    if (error?.code === 'REQUEST_CONFLICT') return { errorCode: 'REQUEST_CONFLICT' };
    if (error?.code === 'REQUEST_REPLAY' && error.result) return { result: error.result };
    if (error?.code === 'PEER_UNAVAILABLE' || error?.code === 'ALREADY_QUEUED') {
      const recovered = await recoverLiveSoftMatchTicket({
        db,
        fieldValue,
        nowMs,
        requestId,
        requestRef,
        uid,
      });
      if (recovered) return { result: recovered };
      return softMatchEnqueueAsWaiting({
        actorCountry,
        actorDisplayName,
        actorGender,
        actorPreferGender,
        clock,
        db,
        fieldValue,
        nowMs,
        queueRef,
        rateLimitRef,
        requestId,
        requestRef,
        uid,
      });
    }
    console.error('[softMatch] pair commit failed', error instanceof Error ? error.message : String(error));
    return { errorCode: 'INTERNAL' };
  }

  await incrementGrowthTelemetry({
    db,
    fieldValue,
    input: { key: 'softMatchPaired', amount: 1 },
  });

  return { result: matchedForActor };
}

async function softMatchEnqueueAsWaiting({
  actorCountry,
  actorGender,
  actorPreferGender,
  db,
  fieldValue,
  nowMs,
  queueRef,
  rateLimitRef,
  requestId,
  requestRef,
  uid,
}) {
  const waitingResult = {
    expiresAtMs: nowMs + SOFT_MATCH_QUEUE_TTL_MS,
    preferGender: actorPreferGender,
    status: 'waiting',
  };
  try {
    await db.runTransaction(async (transaction) => {
      await assertSoftMatchRequestFresh(transaction, requestRef, uid);
      const [rateFresh, actorFresh] = await Promise.all([
        transaction.get(rateLimitRef),
        transaction.get(queueRef),
      ]);
      const liveTicket = mapLiveSoftMatchTicket(actorFresh.exists ? actorFresh.data() : undefined, nowMs);
      if (liveTicket) {
        throw Object.assign(new Error('ALREADY_ACTIVE'), { code: 'ALREADY_ACTIVE', result: liveTicket });
      }
      const rateFreshLimit = resolveSlidingWindowRateLimit({
        limit: SOFT_MATCH_RATE_LIMIT,
        nowMs,
        rate: rateFresh.exists ? rateFresh.data() : undefined,
        windowMs: SOFT_MATCH_RATE_WINDOW_MS,
      });
      if (!rateFreshLimit.ok) {
        throw Object.assign(new Error('RATE_LIMITED'), { code: 'RATE_LIMITED' });
      }
      const timestamp = fieldValue.serverTimestamp();
      transaction.set(queueRef, {
        countryCode: actorCountry,
        enqueuedAtMs: nowMs,
        expiresAtMs: waitingResult.expiresAtMs,
        gender: actorGender,
        preferGender: actorPreferGender,
        status: 'waiting',
        uid,
        updatedAt: timestamp,
        updatedAtMs: nowMs,
      });
      transaction.set(requestRef, {
        createdAt: timestamp,
        result: waitingResult,
        requestId,
        uid,
      });
      transaction.set(rateLimitRef, {
        attemptsMs: rateFreshLimit.value.attemptsMs,
        count: rateFreshLimit.value.count,
        uid,
        updatedAt: timestamp,
        windowStartedAt: rateFreshLimit.value.windowStartedAtMs,
      }, { merge: true });
    });
  } catch (error) {
    if (error?.code === 'RATE_LIMITED') return { errorCode: 'RATE_LIMITED' };
    if (error?.code === 'REQUEST_CONFLICT') return { errorCode: 'REQUEST_CONFLICT' };
    if (error?.code === 'REQUEST_REPLAY' && error.result) return { result: error.result };
    if (error?.code === 'ALREADY_ACTIVE' && error.result) return { result: error.result };
    console.error('[softMatch] fallback wait failed', error instanceof Error ? error.message : String(error));
    return { errorCode: 'INTERNAL' };
  }
  return { result: waitingResult };
}

async function recoverLiveSoftMatchTicket({ db, fieldValue, nowMs, requestId, requestRef, uid }) {
  const queueSnap = await db.doc(`softMatchQueue/${uid}`).get();
  const live = mapLiveSoftMatchTicket(queueSnap.exists ? queueSnap.data() : undefined, nowMs);
  if (!live) return null;
  await persistSoftMatchRequest({
    db,
    fieldValue,
    requestId,
    requestRef,
    result: live,
    uid,
  });
  return live;
}

async function softMatchCancel({ clock = Date, db, fieldValue, input, requestId, uid }) {
  const flags = await readGrowthFeatureFlags(db);
  if (flags.softOneToOneMatch !== true) return { errorCode: 'FEATURE_DISABLED' };

  const normalized = normalizeSoftMatchCancelInput(input);
  if (!normalized.ok) return { errorCode: normalized.code };

  const requestRef = db.doc(`softMatchRequests/${requestId}`);
  const existing = await requestRef.get();
  if (existing.exists) {
    const prior = mapSoftMatchResult(existing.data()?.result);
    if (prior) return { result: prior };
    return { errorCode: 'REQUEST_CONFLICT' };
  }

  const nowMs = typeof clock.now === 'function' ? clock.now() : Date.now();
  const queueRef = db.doc(`softMatchQueue/${uid}`);
  const idleResult = { status: 'idle' };

  try {
    await db.runTransaction(async (transaction) => {
      await assertSoftMatchRequestFresh(transaction, requestRef, uid);
      const queueSnap = await transaction.get(queueRef);
      const timestamp = fieldValue.serverTimestamp();
      if (queueSnap.exists && isSoftMatchQueueWaiting(queueSnap.data(), nowMs)) {
        transaction.set(queueRef, {
          ...queueSnap.data(),
          status: 'cancelled',
          updatedAt: timestamp,
          updatedAtMs: nowMs,
        }, { merge: true });
      }
      transaction.set(requestRef, {
        createdAt: timestamp,
        result: idleResult,
        requestId,
        uid,
      });
    });
  } catch (error) {
    if (error?.code === 'REQUEST_CONFLICT') return { errorCode: 'REQUEST_CONFLICT' };
    console.error('[softMatch] cancel failed', error instanceof Error ? error.message : String(error));
    return { errorCode: 'INTERNAL' };
  }

  return { result: idleResult };
}

async function softMatchStatus({ clock = Date, db, input, uid }) {
  const flags = await readGrowthFeatureFlags(db);
  if (flags.softOneToOneMatch !== true) return { errorCode: 'FEATURE_DISABLED' };

  const normalized = normalizeSoftMatchStatusInput(input);
  if (!normalized.ok) return { errorCode: normalized.code };

  const nowMs = typeof clock.now === 'function' ? clock.now() : Date.now();
  const queueSnap = await db.doc(`softMatchQueue/${uid}`).get();
  if (!queueSnap.exists) return { result: { status: 'idle' } };
  const live = mapLiveSoftMatchTicket(queueSnap.data(), nowMs);
  if (live) return { result: live };
  return { result: { status: 'idle' } };
}

const SOFT_MATCH_RETENTION_MS = 24 * 60 * 60 * 1000;

async function expireSoftMatchQueueAndSessions({
  clock = Date,
  db,
  fieldValue,
  limit = 100,
}) {
  const nowMs = typeof clock.now === 'function' ? clock.now() : Date.now();
  const timestamp = fieldValue && typeof fieldValue.serverTimestamp === 'function'
    ? fieldValue.serverTimestamp()
    : null;
  let expiredQueue = 0;
  let expiredSessions = 0;

  const waitingSnap = await db.collection('softMatchQueue')
    .where('status', '==', 'waiting')
    .where('expiresAtMs', '<=', nowMs)
    .orderBy('expiresAtMs', 'asc')
    .limit(limit)
    .get();

  for (const candidate of waitingSnap.docs) {
    const changed = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(candidate.ref);
      if (!snap.exists) return false;
      const data = snap.data() || {};
      if (data.status !== 'waiting' || Number(data.expiresAtMs) > nowMs) return false;
      const patch = {
        purgeAfterMs: nowMs + SOFT_MATCH_RETENTION_MS,
        status: 'expired',
        updatedAtMs: nowMs,
      };
      if (timestamp) patch.updatedAt = timestamp;
      transaction.set(candidate.ref, patch, { merge: true });
      return true;
    });
    if (changed) expiredQueue += 1;
  }

  const sessionSnap = await db.collection('softMatchSessions')
    .where('status', '==', 'active')
    .where('expiresAtMs', '<=', nowMs)
    .orderBy('expiresAtMs', 'asc')
    .limit(limit)
    .get();

  for (const candidate of sessionSnap.docs) {
    const changed = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(candidate.ref);
      if (!snap.exists) return false;
      const data = snap.data() || {};
      if (data.status !== 'active' || Number(data.expiresAtMs) > nowMs) return false;

      const sessionId = typeof data.sessionId === 'string' ? data.sessionId : candidate.id;
      const roomId = typeof data.roomId === 'string' ? data.roomId.trim() : '';
      const peerUids = Array.isArray(data.peerUids)
        ? data.peerUids.filter((peerUid) => typeof peerUid === 'string' && peerUid.trim())
        : [];

      const roomRef = roomId ? db.doc(`rooms/${roomId}`) : null;
      const queueRefs = peerUids.map((peerUid) => db.doc(`softMatchQueue/${peerUid.trim()}`));
      const [roomSnap, ...queueSnaps] = await Promise.all([
        roomRef ? transaction.get(roomRef) : Promise.resolve(null),
        ...queueRefs.map((queueRef) => transaction.get(queueRef)),
      ]);

      const sessionPatch = {
        purgeAfterMs: nowMs + SOFT_MATCH_RETENTION_MS,
        status: 'expired',
        updatedAtMs: nowMs,
      };
      if (timestamp) sessionPatch.updatedAt = timestamp;
      transaction.set(candidate.ref, sessionPatch, { merge: true });

      if (roomRef && roomSnap?.exists && roomSnap.data()?.softMatch === true) {
        const roomPatch = {
          availability: 'removed',
          status: 'closed',
          updatedAtMs: nowMs,
          updatedBy: 'system',
        };
        if (timestamp) roomPatch.updatedAt = timestamp;
        transaction.set(roomRef, roomPatch, { merge: true });
      }

      for (let index = 0; index < queueRefs.length; index += 1) {
        const queueSnap = queueSnaps[index];
        if (!queueSnap?.exists) continue;
        const queue = queueSnap.data() || {};
        if (queue.sessionId !== sessionId) continue;
        const queuePatch = {
          expiresAtMs: nowMs,
          purgeAfterMs: nowMs + SOFT_MATCH_RETENTION_MS,
          status: 'expired',
          updatedAtMs: nowMs,
        };
        if (timestamp) queuePatch.updatedAt = timestamp;
        transaction.set(queueRefs[index], queuePatch, { merge: true });
      }
      return true;
    });
    if (changed) expiredSessions += 1;
  }

  return { expiredQueue, expiredSessions };
}

async function cleanupExpiredSoftMatchRecords({
  clock = Date,
  db,
  limit = 200,
}) {
  const nowMs = typeof clock.now === 'function' ? clock.now() : Date.now();
  let cleaned = 0;

  for (const collectionName of ['softMatchQueue', 'softMatchSessions']) {
    const snapshot = await db.collection(collectionName)
      .where('purgeAfterMs', '<=', nowMs)
      .orderBy('purgeAfterMs', 'asc')
      .limit(limit)
      .get()
      .catch(() => null);
    if (!snapshot) continue;
    for (const document of snapshot.docs) {
      if (document.ref && typeof document.ref.delete === 'function') {
        await document.ref.delete().catch(() => undefined);
      }
      cleaned += 1;
    }
  }

  return { cleaned };
}

async function loadBlockedPeerUids(db, uid, peerUids) {
  const unique = [...new Set((peerUids || []).filter((peerUid) => typeof peerUid === 'string' && peerUid && peerUid !== uid))];
  const blocked = new Set();
  if (unique.length === 0) return blocked;

  const refs = [];
  for (const peerUid of unique) {
    refs.push(db.doc(`blocks/${uid}/blocked/${peerUid}`));
    refs.push(db.doc(`blocks/${peerUid}/blocked/${uid}`));
  }

  const snaps = typeof db.getAll === 'function'
    ? await db.getAll(...refs)
    : await Promise.all(refs.map((ref) => ref.get()));

  for (let index = 0; index < unique.length; index += 1) {
    const peerUid = unique[index];
    const actorBlocks = snaps[index * 2];
    const peerBlocks = snaps[index * 2 + 1];
    if (actorBlocks?.exists || peerBlocks?.exists) {
      blocked.add(peerUid);
    }
  }
  return blocked;
}

async function assertSoftMatchRequestFresh(transaction, requestRef, uid) {
  const replay = await transaction.get(requestRef);
  if (replay.exists) {
    const prior = mapSoftMatchResult(replay.data()?.result);
    if (prior && replay.data()?.uid === uid) {
      throw Object.assign(new Error('REQUEST_REPLAY'), { code: 'REQUEST_REPLAY', result: prior });
    }
    throw Object.assign(new Error('REQUEST_CONFLICT'), { code: 'REQUEST_CONFLICT' });
  }
}

async function persistSoftMatchRequest({ db, fieldValue, requestId, requestRef, result, uid }) {
  try {
    await db.runTransaction(async (transaction) => {
      const replay = await transaction.get(requestRef);
      if (replay.exists) return;
      transaction.set(requestRef, {
        createdAt: fieldValue.serverTimestamp(),
        result,
        requestId,
        uid,
      });
    });
  } catch (error) {
    console.error('[softMatch] request persist failed', error instanceof Error ? error.message : String(error));
  }
}

module.exports = {
  SOFT_MATCH_RETENTION_MS,
  cleanupExpiredSoftMatchRecords,
  expireSoftMatchQueueAndSessions,
  softMatchCancel,
  softMatchEnqueue,
  softMatchStatus,
};
