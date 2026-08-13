'use strict';

const { createHash } = require('node:crypto');
const { mapGrowthFeatures } = require('./growthRolloutCore');
const { mapRoomPkSession, timestampToMillis } = require('./roomPkCore');
const {
  CROSS_ROOM_PK_RETENTION_MS,
  CROSS_ROOM_PK_TIMING_MS,
} = require('./crossRoomPkContract');
const { createCrossRoomPkReconciliation } = require('./crossRoomPkSettlementCore');
const { forceSettleCrossRoomPkOnFlagOff } = require('./crossRoomPkSettlementService');

const systemClock = {
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => {
    const { Timestamp } = require('firebase-admin/firestore');
    return Timestamp.fromMillis(value);
  },
};

function resolveCrossRoomPkRoomInvalidation(before, after) {
  if (!before || !after) return after ? '' : 'room_removed';
  if (before.availability !== 'removed' && ['removed', 'purged'].includes(after.availability)) return 'room_removed';
  if (before.status !== 'closed' && after.status === 'closed') return 'room_closed';
  if (!hasStaffLockdown(before) && hasStaffLockdown(after)) return 'staff_lockdown';
  if (before.giftsPaused !== true && after.giftsPaused === true) return 'gifts_paused';
  return '';
}

async function processCrossRoomPkRoomLifecycle({ activePkSessionId = '', clock = systemClock, db,
  fieldValue, pendingPkChallengeId = '', reason, roomId }) {
  if (!cleanId(roomId) || !LIFECYCLE_REASONS.has(reason)) return { processed: false, reason: 'not_applicable' };
  return db.runTransaction(async (transaction) => {
    const roomRef = db.doc(`rooms/${roomId}`);
    const roomSnapshot = await transaction.get(roomRef);
    const room = roomSnapshot.exists ? { id: roomId, ...roomSnapshot.data() } : { id: roomId };
    const challengeId = cleanId(room.pendingPkChallengeId) || cleanId(pendingPkChallengeId);
    const pkId = cleanId(room.activePkSessionId) || cleanId(activePkSessionId);
    const challengeRef = challengeId ? db.doc(`roomPkChallenges/${challengeId}`) : null;
    const sessionRef = pkId ? db.doc(`roomPkSessions/${pkId}`) : null;
    const [challengeSnapshot, sessionSnapshot] = await Promise.all([
      challengeRef ? transaction.get(challengeRef) : Promise.resolve(null),
      sessionRef ? transaction.get(sessionRef) : Promise.resolve(null),
    ]);

    const challenge = challengeSnapshot?.exists ? challengeSnapshot.data() : null;
    const session = sessionSnapshot?.exists
      ? mapRoomPkSession({ pkId, ...sessionSnapshot.data() }) : null;
    const relatedRoomIds = new Set();
    if (challenge?.challengerRoomId) relatedRoomIds.add(challenge.challengerRoomId);
    if (challenge?.opponentRoomId) relatedRoomIds.add(challenge.opponentRoomId);
    if (session?.redRoomId) relatedRoomIds.add(session.redRoomId);
    if (session?.blueRoomId) relatedRoomIds.add(session.blueRoomId);
    relatedRoomIds.delete(roomId);
    const otherRoomId = [...relatedRoomIds][0] || '';
    const otherRoomRef = otherRoomId ? db.doc(`rooms/${otherRoomId}`) : null;
    const otherRoomSnapshot = otherRoomRef ? await transaction.get(otherRoomRef) : null;
    const otherRoom = otherRoomSnapshot?.exists
      ? { id: otherRoomId, ...otherRoomSnapshot.data() } : { id: otherRoomId };
    const jobRef = session?.status === 'active'
      ? db.doc(`roomPkReconciliations/${pkId}`) : null;
    const jobSnapshot = jobRef ? await transaction.get(jobRef) : null;
    const nowMs = clock.nowMillis();
    const timestamp = fieldValue.serverTimestamp();
    let challengeCancelled = false;
    let sessionSettling = false;

    if (challengeId && challenge?.status === 'pending'
      && [challenge.challengerRoomId, challenge.opponentRoomId].includes(roomId)) {
      transaction.update(challengeRef, {
        resolutionReason: reason,
        resolvedAt: timestamp,
        status: 'cancelled',
      });
      clearChallengePointer(transaction, roomRef, room, challengeId, timestamp);
      if (otherRoomRef) clearChallengePointer(transaction, otherRoomRef, otherRoom, challengeId, timestamp);
      writeLifecycleAudit({ challengeId, db, nowMs, outcome: 'challenge_cancelled', reason,
        roomId, timestamp, transaction });
      challengeCancelled = true;
    } else if (challengeId && (!challenge || challenge.status !== 'pending')) {
      clearChallengePointer(transaction, roomRef, room, challengeId, timestamp);
    }

    if (pkId && session && session.mode === 'cross-room'
      && [session.redRoomId, session.blueRoomId].includes(roomId)) {
      if (session.status === 'active') {
        const naturalEnd = nowMs >= session.endsAtMs;
        const redInvalid = !naturalEnd && roomOperationallyInvalid(
          session.redRoomId === roomId ? room : otherRoom,
        );
        const blueInvalid = !naturalEnd && roomOperationallyInvalid(
          session.blueRoomId === roomId ? room : otherRoom,
        );
        const forfeitSide = redInvalid && blueInvalid ? 'both' : redInvalid ? 'red' : blueInvalid ? 'blue' : '';
        const scoringEndsAtMs = naturalEnd ? session.endsAtMs : Math.min(nowMs, session.endsAtMs);
        const settleAfterMs = scoringEndsAtMs + CROSS_ROOM_PK_TIMING_MS.ingestionGrace;
        const job = createCrossRoomPkReconciliation({ nowMs, session });
        transaction.update(sessionRef, {
          endedBy: 'system',
          endReason: naturalEnd ? 'expired' : forfeitSide === 'both' ? 'both_rooms_invalid' : reason,
          ...(forfeitSide ? { forfeitSide } : {}),
          scoringEndsAt: clock.timestampFromMillis(scoringEndsAtMs),
          scoringEndsAtMs,
          settleAfter: clock.timestampFromMillis(settleAfterMs),
          settleAfterMs,
          status: 'settling',
          updatedAt: timestamp,
        });
        if (!jobSnapshot?.exists) transaction.create(jobRef, serializeJob(job, clock, timestamp));
        writeLifecycleAudit({ db, nowMs, outcome: 'session_settling', pkId,
          reason: naturalEnd ? 'expired' : forfeitSide === 'both' ? 'both_rooms_invalid' : reason,
          roomId, timestamp, transaction });
        sessionSettling = true;
      } else if (session.status === 'settling' && session.forfeitSide) {
        const currentSide = session.forfeitSide || '';
        const invalidSide = roomId === session.redRoomId ? 'red' : 'blue';
        const forfeitSide = currentSide && currentSide !== invalidSide ? 'both' : invalidSide;
        transaction.update(sessionRef, {
          endReason: forfeitSide === 'both' ? 'both_rooms_invalid' : reason,
          forfeitSide,
          updatedAt: timestamp,
        });
        sessionSettling = true;
      } else if (['ended', 'forfeited', 'void'].includes(session.status)) {
        clearActivePointer(transaction, roomRef, room, pkId, timestamp);
      }
    } else if (pkId && !session) {
      clearActivePointer(transaction, roomRef, room, pkId, timestamp);
    }

    return { challengeCancelled, processed: challengeCancelled || sessionSettling, sessionSettling };
  });
}

async function expireCrossRoomPkChallenges({ clock = systemClock, db, fieldValue, limit = 50 }) {
  const nowMs = clock.nowMillis();
  const snapshot = await db.collection('roomPkChallenges')
    .where('status', '==', 'pending')
    .where('expiresAt', '<=', clock.timestampFromMillis(nowMs))
    .orderBy('expiresAt', 'asc')
    .limit(limit)
    .get();
  let expired = 0;
  for (const candidate of snapshot.docs) {
    const changed = await terminatePendingChallenge({
      clock, db, fieldValue, challengeId: candidate.id, reason: 'expired', status: 'expired',
    });
    if (changed) expired += 1;
  }
  return { expired, scanned: snapshot.size };
}

async function drainCrossRoomPkOnFlagOff({ clock = systemClock, db, fieldValue, limit = 50 }) {
  const growthSnapshot = await db.doc('appConfig/growthFeatures').get();
  const flags = mapGrowthFeatures(growthSnapshot.exists ? growthSnapshot.data() : {});
  if (flags.roomPk === true && flags.crossRoomPk === true) {
    return { challenges: { cancelled: 0, scanned: 0 }, sessions: { scanned: 0, skipped: true, started: 0 } };
  }
  const reason = flags.roomPk === true ? 'feature_flag_off' : 'room_pk_flag_off';
  const pending = await db.collection('roomPkChallenges')
    .where('status', '==', 'pending')
    .limit(limit)
    .get();
  let cancelled = 0;
  for (const candidate of pending.docs) {
    const changed = await terminatePendingChallenge({
      clock, db, fieldValue, challengeId: candidate.id, reason, status: 'cancelled', verifyFlagsOff: true,
    });
    if (changed) cancelled += 1;
  }
  const sessions = await forceSettleCrossRoomPkOnFlagOff({ clock, db, fieldValue, limit });
  return { challenges: { cancelled, scanned: pending.size }, sessions };
}

async function cleanupExpiredCrossRoomPkRecentPointers({ clock = systemClock, db, fieldValue, limit = 100 }) {
  const nowMs = clock.nowMillis();
  const snapshot = await db.collection('rooms')
    .where('recentPkExpiresAt', '<=', clock.timestampFromMillis(nowMs))
    .orderBy('recentPkExpiresAt', 'asc')
    .limit(limit)
    .get();
  let cleared = 0;
  for (const candidate of snapshot.docs) {
    const changed = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(candidate.ref);
      if (!current.exists || !cleanId(current.data()?.recentPkSessionId)
        || timestampToMillis(current.data()?.recentPkExpiresAt) > nowMs) return false;
      transaction.update(candidate.ref, {
        recentPkExpiresAt: null,
        recentPkSessionId: null,
        updatedAt: fieldValue.serverTimestamp(),
      });
      return true;
    });
    if (changed) cleared += 1;
  }
  return { cleared, scanned: snapshot.size };
}

async function terminatePendingChallenge({ challengeId, clock, db, fieldValue, reason, status,
  verifyFlagsOff = false }) {
  return db.runTransaction(async (transaction) => {
    const challengeRef = db.doc(`roomPkChallenges/${challengeId}`);
    const flagsRef = db.doc('appConfig/growthFeatures');
    const [challengeSnapshot, flagsSnapshot] = await Promise.all([
      transaction.get(challengeRef),
      verifyFlagsOff ? transaction.get(flagsRef) : Promise.resolve(null),
    ]);
    if (!challengeSnapshot.exists || challengeSnapshot.data()?.status !== 'pending') return false;
    if (verifyFlagsOff) {
      const flags = mapGrowthFeatures(flagsSnapshot?.exists ? flagsSnapshot.data() : {});
      if (flags.roomPk === true && flags.crossRoomPk === true) return false;
    }
    const challenge = challengeSnapshot.data();
    const redRoomRef = db.doc(`rooms/${challenge.challengerRoomId}`);
    const blueRoomRef = db.doc(`rooms/${challenge.opponentRoomId}`);
    const [redRoomSnapshot, blueRoomSnapshot] = await Promise.all([
      transaction.get(redRoomRef), transaction.get(blueRoomRef),
    ]);
    const timestamp = fieldValue.serverTimestamp();
    transaction.update(challengeRef, { resolutionReason: reason, resolvedAt: timestamp, status });
    if (redRoomSnapshot.exists) clearChallengePointer(
      transaction, redRoomRef, redRoomSnapshot.data(), challengeId, timestamp,
    );
    if (blueRoomSnapshot.exists) clearChallengePointer(
      transaction, blueRoomRef, blueRoomSnapshot.data(), challengeId, timestamp,
    );
    writeLifecycleAudit({ challengeId, db, nowMs: clock.nowMillis(),
      outcome: `challenge_${status}`, reason, roomId: challenge.challengerRoomId, timestamp, transaction });
    return true;
  });
}

function roomOperationallyInvalid(room) {
  return !room?.id || room.status !== 'active' || room.availability !== 'active'
    || hasStaffLockdown(room) || room.giftsPaused === true;
}

function hasStaffLockdown(room) {
  return Boolean(room?.staffLockdown && typeof room.staffLockdown === 'object');
}

function clearChallengePointer(transaction, ref, room, challengeId, timestamp) {
  if (room?.pendingPkChallengeId === challengeId) {
    transaction.update(ref, { pendingPkChallengeId: null, updatedAt: timestamp });
  }
}

function clearActivePointer(transaction, ref, room, pkId, timestamp) {
  if (room?.activePkSessionId === pkId) {
    transaction.update(ref, { activePkSessionId: null, updatedAt: timestamp });
  }
}

function serializeJob(job, clock, timestamp) {
  const checkpoint = (value) => ({ ...value, cursorCreatedAt: null });
  return {
    ...job,
    blue: checkpoint(job.blue),
    leaseExpiresAt: null,
    purgeAfter: clock.timestampFromMillis(job.purgeAfterMs),
    red: checkpoint(job.red),
    updatedAt: timestamp,
  };
}

function writeLifecycleAudit({ challengeId = '', db, nowMs, outcome, pkId = '', reason,
  roomId, timestamp, transaction, purgeAfter }) {
  const auditId = createHash('sha256')
    .update(['lifecycle', challengeId, pkId, roomId, reason, outcome].join('|'))
    .digest('hex').slice(0, 32);
  transaction.set(db.doc(`roomPkAuditEvents/${auditId}`), {
    action: 'cross-room-pk-lifecycle',
    actorUid: 'system',
    challengeId,
    createdAt: timestamp,
    mode: 'cross-room',
    outcome,
    pkId,
    purgeAfter: purgeAfter || new Date(nowMs + CROSS_ROOM_PK_RETENTION_MS.session),
    reason,
    roomId,
  }, { merge: true });
}

function cleanId(value) {
  return typeof value === 'string' && value.trim() && !value.includes('/') ? value.trim().slice(0, 128) : '';
}

const LIFECYCLE_REASONS = new Set(['gifts_paused', 'room_closed', 'room_removed', 'staff_lockdown']);

module.exports = {
  cleanupExpiredCrossRoomPkRecentPointers,
  drainCrossRoomPkOnFlagOff,
  expireCrossRoomPkChallenges,
  processCrossRoomPkRoomLifecycle,
  resolveCrossRoomPkRoomInvalidation,
};
