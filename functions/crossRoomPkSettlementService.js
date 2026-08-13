'use strict';

const { randomUUID } = require('node:crypto');

const {
  CROSS_ROOM_PK_LIMITS,
  CROSS_ROOM_PK_RETENTION_MS,
  CROSS_ROOM_PK_SCORE_SHARD_COUNT,
  CROSS_ROOM_PK_TIMING_MS,
} = require('./crossRoomPkContract');
const { mapRoomPkSession, timestampToMillis } = require('./roomPkCore');
const {
  acquireCrossRoomPkLease,
  applyCrossRoomPkReconciliationPage,
  applyCrossRoomPkShardScore,
  buildVerifiedCrossRoomPkFinalization,
  createCrossRoomPkReconciliation,
  normalizeCommittedCrossRoomPkGift,
} = require('./crossRoomPkSettlementCore');

const systemClock = {
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => {
    const { Timestamp } = require('firebase-admin/firestore');
    return Timestamp.fromMillis(value);
  },
};

async function projectCrossRoomPkGift({ clock = systemClock, db, event, eventId, fieldValue, roomId }) {
  if (event?.pkContext?.mode !== 'cross-room' || !event?.pkContext?.pkId) {
    return { skipped: true, reason: 'not_cross_room_pk' };
  }
  return db.runTransaction(async (transaction) => {
    const sessionRef = db.doc(`roomPkSessions/${event.pkContext.pkId}`);
    const factRef = db.doc(`roomPkGiftFacts/${eventId}`);
    const [sessionSnapshot, factSnapshot] = await Promise.all([
      transaction.get(sessionRef),
      transaction.get(factRef),
    ]);
    if (factSnapshot.exists) {
      const fact = factSnapshot.data();
      return fact.eventId === eventId && fact.pkId === event.pkContext.pkId && fact.roomId === roomId
        ? { duplicate: true, ok: true, side: fact.side }
        : { errorCode: 'PROJECTION_CONFLICT' };
    }
    const session = sessionSnapshot.exists
      ? mapRoomPkSession({ pkId: sessionSnapshot.id, ...sessionSnapshot.data() })
      : null;
    if (!session || !['active', 'settling'].includes(session.status)) {
      return { skipped: true, reason: 'session_inactive' };
    }
    const gift = normalizeCommittedCrossRoomPkGift({ event, eventId, roomId, session });
    if (!gift) return { skipped: true, reason: 'gift_not_eligible' };

    const markerRef = db.doc(`roomPkSessions/${session.pkId}/gifters/${gift.side}_${gift.senderUid}`);
    const shardId = `${gift.side}_${String(gift.shard).padStart(2, '0')}`;
    const shardRef = db.doc(`roomPkSessions/${session.pkId}/scoreShards/${shardId}`);
    const [markerSnapshot, shardSnapshot] = await Promise.all([
      transaction.get(markerRef),
      transaction.get(shardRef),
    ]);
    if (!shardSnapshot.exists) return { errorCode: 'SCORE_SHARD_MISSING' };
    const firstGifter = !markerSnapshot.exists;
    const shardPatch = applyCrossRoomPkShardScore(shardSnapshot.data(), gift, firstGifter);
    if (!shardPatch) return { errorCode: 'SCORE_SHARD_INVALID' };
    const timestamp = fieldValue.serverTimestamp();
    const purgeAfter = clock.timestampFromMillis(session.purgeAfterMs);
    transaction.create(factRef, {
      createdAt: timestamp,
      eventId,
      occurredAt: clock.timestampFromMillis(gift.occurredAtMs),
      occurredAtMs: gift.occurredAtMs,
      pkId: gift.pkId,
      priceCoins: gift.priceCoins,
      purgeAfter,
      roomId,
      senderUid: gift.senderUid,
      shard: gift.shard,
      side: gift.side,
    });
    if (firstGifter) transaction.create(markerRef, {
      createdAt: timestamp,
      pkId: gift.pkId,
      purgeAfter,
      senderUid: gift.senderUid,
      side: gift.side,
    });
    transaction.update(shardRef, { ...shardPatch, updatedAt: timestamp });
    return { duplicate: false, ok: true, shard: gift.shard, side: gift.side };
  });
}

async function beginCrossRoomPkSettlement({ clock = systemClock, db, fieldValue, forfeitSide = '',
  limit = 20, reason = 'expired', ignoreEndTime = false, requireFlagsOff = false }) {
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);
  let query = db.collection('roomPkSessions')
    .where('mode', '==', 'cross-room')
    .where('status', '==', 'active');
  if (!forfeitSide && !ignoreEndTime) query = query.where('endsAt', '<=', now).orderBy('endsAt', 'asc');
  const snapshot = await query.limit(limit).get();
  let started = 0;
  for (const candidate of snapshot.docs) {
    const changed = await db.runTransaction(async (transaction) => {
      const growthRef = db.doc('appConfig/growthFeatures');
      const [sessionSnapshot, growthSnapshot] = await Promise.all([
        transaction.get(candidate.ref),
        requireFlagsOff ? transaction.get(growthRef) : Promise.resolve(null),
      ]);
      if (requireFlagsOff) {
        const currentFlags = growthSnapshot?.exists ? growthSnapshot.data() : {};
        if (currentFlags.roomPk === true && currentFlags.crossRoomPk === true) return false;
      }
      const session = sessionSnapshot.exists
        ? mapRoomPkSession({ pkId: candidate.id, ...sessionSnapshot.data() }) : null;
      if (!session || session.status !== 'active') return false;
      if (!forfeitSide && !ignoreEndTime && session.endsAtMs > nowMs) return false;
      const jobRef = db.doc(`roomPkReconciliations/${session.pkId}`);
      const jobSnapshot = await transaction.get(jobRef);
      const job = createCrossRoomPkReconciliation({ nowMs, session });
      if (!job) return false;
      const timestamp = fieldValue.serverTimestamp();
      const scoringEndsAtMs = Math.min(nowMs, session.endsAtMs);
      const settleAfterMs = forfeitSide || ignoreEndTime
        ? scoringEndsAtMs + CROSS_ROOM_PK_TIMING_MS.ingestionGrace
        : session.settleAfterMs;
      transaction.update(candidate.ref, {
        ...(forfeitSide ? { forfeitSide } : {}),
        endReason: reason,
        ...(forfeitSide || ignoreEndTime ? {
          scoringEndsAt: clock.timestampFromMillis(scoringEndsAtMs),
          scoringEndsAtMs,
        } : {}),
        settleAfter: clock.timestampFromMillis(settleAfterMs),
        settleAfterMs,
        status: 'settling',
        updatedAt: timestamp,
      });
      if (!jobSnapshot.exists) transaction.create(jobRef, serializeJob(job, clock, timestamp));
      return true;
    });
    if (changed) started += 1;
  }
  return { scanned: snapshot.size, started };
}

async function beginCrossRoomPkSessionSettlement({ clock = systemClock, db, fieldValue,
  forfeitSide = '', pkId, reason }) {
  return db.runTransaction(async (transaction) => {
    const sessionRef = db.doc(`roomPkSessions/${pkId}`);
    const jobRef = db.doc(`roomPkReconciliations/${pkId}`);
    const [sessionSnapshot, jobSnapshot] = await Promise.all([
      transaction.get(sessionRef), transaction.get(jobRef),
    ]);
    const session = sessionSnapshot.exists
      ? mapRoomPkSession({ pkId, ...sessionSnapshot.data() }) : null;
    if (!session) return { ok: false, code: 'SESSION_NOT_ACTIVE' };
    if (session.status === 'settling' || ['ended', 'forfeited', 'void'].includes(session.status)) {
      return { ok: true, alreadySettling: true, session };
    }
    if (session.status !== 'active') return { ok: false, code: 'SESSION_NOT_ACTIVE' };
    const nowMs = clock.nowMillis();
    const job = createCrossRoomPkReconciliation({ nowMs, session });
    const timestamp = fieldValue.serverTimestamp();
    const scoringEndsAtMs = Math.min(nowMs, session.endsAtMs);
    const settleAfterMs = scoringEndsAtMs + CROSS_ROOM_PK_TIMING_MS.ingestionGrace;
    transaction.update(sessionRef, {
      ...(forfeitSide ? { forfeitSide } : {}),
      endReason: reason,
      scoringEndsAt: clock.timestampFromMillis(scoringEndsAtMs),
      scoringEndsAtMs,
      settleAfter: clock.timestampFromMillis(settleAfterMs),
      settleAfterMs,
      status: 'settling',
      updatedAt: timestamp,
    });
    if (!jobSnapshot.exists) transaction.create(jobRef, serializeJob(job, clock, timestamp));
    return { ok: true, alreadySettling: false, session: {
      ...session, ...(forfeitSide ? { forfeitSide } : {}), endReason: reason, status: 'settling',
    } };
  });
}

async function processCrossRoomPkReconciliations({ clock = systemClock, db,
  documentIdField = '__name__', fieldValue, jobLimit = 10, maxPagesPerSide = 10,
  workerId = `cross-room-pk-finalizer-${randomUUID()}` }) {
  const jobsSnapshot = await db.collection('roomPkReconciliations')
    .where('status', 'in', ['pending', 'running'])
    .limit(jobLimit)
    .get();
  let completed = 0;
  let processed = 0;
  for (const candidate of jobsSnapshot.docs) {
    const result = await processCrossRoomPkReconciliation({
      clock, db, documentIdField, fieldValue, maxPagesPerSide, pkId: candidate.id, workerId,
    });
    processed += result.processed ? 1 : 0;
    completed += result.completed ? 1 : 0;
  }
  return { completed, processed, scanned: jobsSnapshot.size };
}

async function forceSettleCrossRoomPkOnFlagOff({ clock = systemClock, db, fieldValue, limit = 20 }) {
  const growthSnapshot = await db.doc('appConfig/growthFeatures').get();
  const flags = growthSnapshot.exists ? growthSnapshot.data() : {};
  if (flags.roomPk === true && flags.crossRoomPk === true) {
    return { scanned: 0, skipped: true, started: 0 };
  }
  return beginCrossRoomPkSettlement({
    clock,
    db,
    fieldValue,
    ignoreEndTime: true,
    limit,
    reason: flags.roomPk === true ? 'feature_flag_off' : 'room_pk_flag_off',
    requireFlagsOff: true,
  });
}

async function processCrossRoomPkReconciliation({ clock = systemClock, db,
  documentIdField = '__name__', fieldValue, maxPagesPerSide = 10, pkId, workerId }) {
  const nowMs = clock.nowMillis();
  const acquired = await db.runTransaction(async (transaction) => {
    const jobRef = db.doc(`roomPkReconciliations/${pkId}`);
    const sessionRef = db.doc(`roomPkSessions/${pkId}`);
    const [jobSnapshot, sessionSnapshot] = await Promise.all([
      transaction.get(jobRef), transaction.get(sessionRef),
    ]);
    if (!jobSnapshot.exists || !sessionSnapshot.exists) return null;
    const session = mapRoomPkSession({ pkId, ...sessionSnapshot.data() });
    if (!session || session.status !== 'settling' || session.settleAfterMs > nowMs) return null;
    const job = mapJob(jobSnapshot.data());
    const leased = acquireCrossRoomPkLease(job, workerId, nowMs);
    if (!leased) return null;
    transaction.update(jobRef, serializeLease(leased, clock, fieldValue.serverTimestamp()));
    return { job: leased, session };
  });
  if (!acquired) return { processed: false };

  let job = acquired.job;
  for (const side of ['red', 'blue']) {
    let pages = 0;
    while (!job[side].done && pages < maxPagesPerSide) {
      const checkpoint = job[side];
      let query = db.collection(`rooms/${checkpoint.roomId}/giftEvents`)
        .where('pkContext.pkId', '==', pkId)
        .orderBy('createdAt', 'asc')
        .orderBy(documentIdField, 'asc')
        .limit(CROSS_ROOM_PK_LIMITS.reconciliationPageSize);
      if (checkpoint.cursorEventId) {
        query = query.startAfter(
          checkpoint.cursorCreatedAt || clock.timestampFromMillis(checkpoint.cursorCreatedAtMs),
          checkpoint.cursorEventId,
        );
      }
      const page = await query.get();
      const normalized = page.docs.map((document) => {
        const source = document.data();
        const cursorCreatedAt = source?.createdAt || null;
        const occurredAtMs = timestampToMillis(cursorCreatedAt) || Number(source?.createdAtMs) || 0;
        const gift = normalizeCommittedCrossRoomPkGift({
          event: source, eventId: document.id, roomId: checkpoint.roomId, session: acquired.session,
        });
        return gift
          ? { ...gift, cursorCreatedAt }
          : {
              cursorCreatedAt,
              eventId: document.id,
              failureCode: isCorruptBoundGift(source, document.id, checkpoint.roomId, occurredAtMs)
                ? 'SOURCE_DATA_INVALID' : '',
              occurredAtMs,
              valid: false,
            };
      });
      const pageResult = await commitReconciliationPage({
        clock, db, fieldValue, job, normalized, nowMs: clock.nowMillis(),
        pkId, side, workerId,
      });
      if (!pageResult) return { processed: false, reason: 'lease_or_cursor_changed' };
      job = pageResult;
      pages += 1;
      if (job.status === 'attention-required') return { processed: true, attentionRequired: true };
    }
  }
  if (!job.red.done || !job.blue.done) return { processed: true, completed: false };
  return finalizeReconciliation({ clock, db, fieldValue, job, pkId, session: acquired.session, workerId });
}

function isCorruptBoundGift(event, eventId, roomId, occurredAtMs) {
  return !occurredAtMs
    || event?.status !== 'committed'
    || event?.eventId !== eventId
    || event?.roomId !== roomId
    || event?.pkContext?.mode !== 'cross-room'
    || typeof event?.senderUid !== 'string'
    || !event.senderUid.trim()
    || !Number.isSafeInteger(Number(event?.priceCoins))
    || Number(event.priceCoins) < 1;
}

async function commitReconciliationPage({ clock, db, fieldValue, job, normalized, nowMs,
  pkId, side, workerId }) {
  return db.runTransaction(async (transaction) => {
    const jobRef = db.doc(`roomPkReconciliations/${pkId}`);
    const jobSnapshot = await transaction.get(jobRef);
    if (!jobSnapshot.exists) return null;
    const current = mapJob(jobSnapshot.data());
    const markerRefs = [...new Set(normalized.filter((event) => event.valid !== false)
      .map((event) => `${side}_${event.senderUid}`))]
      .map((key) => ({ key, ref: db.doc(`roomPkReconciliations/${pkId}/gifters/${key}`) }));
    const markerSnapshots = await Promise.all(markerRefs.map(({ ref }) => transaction.get(ref)));
    const existingGifterKeys = markerRefs
      .filter((_, index) => markerSnapshots[index].exists)
      .map(({ key }) => key);
    const applied = applyCrossRoomPkReconciliationPage({
      events: normalized,
      existingGifterKeys,
      job: current,
      nowMs,
      side,
      startCursor: { createdAtMs: job[side].cursorCreatedAtMs, eventId: job[side].cursorEventId },
      workerId,
    });
    if (!applied) return null;
    if (normalized.length > 0) {
      applied.job[side].cursorCreatedAt = normalized.at(-1).cursorCreatedAt || null;
    }
    const timestamp = fieldValue.serverTimestamp();
    for (const key of applied.createdGifterKeys) {
      transaction.create(db.doc(`roomPkReconciliations/${pkId}/gifters/${key}`), {
        createdAt: timestamp, pkId, purgeAfter: clock.timestampFromMillis(job.purgeAfterMs), side,
        uid: key.slice(side.length + 1),
      });
    }
    transaction.update(jobRef, serializeJob(applied.job, clock, timestamp));
    return applied.job;
  });
}

async function finalizeReconciliation({ clock, db, fieldValue, job, pkId, session, workerId }) {
  const shardRefs = [];
  for (const side of ['red', 'blue']) for (let shard = 0; shard < CROSS_ROOM_PK_SCORE_SHARD_COUNT; shard += 1) {
    shardRefs.push({ side, ref: db.doc(`roomPkSessions/${pkId}/scoreShards/${side}_${String(shard).padStart(2, '0')}`) });
  }
  const nowMs = clock.nowMillis();
  return db.runTransaction(async (transaction) => {
    const jobRef = db.doc(`roomPkReconciliations/${pkId}`);
    const sessionRef = db.doc(`roomPkSessions/${pkId}`);
    const redRoomRef = db.doc(`rooms/${session.redRoomId}`);
    const blueRoomRef = db.doc(`rooms/${session.blueRoomId}`);
    const [jobSnapshot, sessionSnapshot, redRoomSnapshot, blueRoomSnapshot, ...shardSnapshots] = await Promise.all([
      transaction.get(jobRef), transaction.get(sessionRef), transaction.get(redRoomRef), transaction.get(blueRoomRef),
      ...shardRefs.map(({ ref }) => transaction.get(ref)),
    ]);
    const currentJob = jobSnapshot.exists ? mapJob(jobSnapshot.data()) : null;
    const currentSession = sessionSnapshot.exists
      ? mapRoomPkSession({ pkId, ...sessionSnapshot.data() }) : null;
    if (!currentJob || currentJob.status !== 'running' || currentJob.leaseOwner !== workerId
      || !currentJob.red.done || !currentJob.blue.done || !currentSession
      || currentSession.status !== 'settling') return { processed: false };
    const liveScores = { red: 0, blue: 0 };
    shardRefs.forEach(({ side }, index) => {
      liveScores[side] += Number(shardSnapshots[index].data()?.score) || 0;
    });
    const verified = buildVerifiedCrossRoomPkFinalization({
      job: currentJob, liveScores, nowMs, session: currentSession,
    });
    if (!verified) return { processed: true, completed: false };
    const timestamp = fieldValue.serverTimestamp();
    transaction.update(sessionRef, {
      ...verified.sessionPatch,
      endedAt: clock.timestampFromMillis(nowMs),
      scoreVerifiedAt: clock.timestampFromMillis(nowMs),
      updatedAt: timestamp,
      verificationDrift: verified.drift,
    });
    transaction.update(jobRef, { ...verified.jobPatch, updatedAt: timestamp });
    const recentExpiresAtMs = nowMs + CROSS_ROOM_PK_TIMING_MS.recentResultPointer;
    const pairId = createCrossRoomPkPairId(currentSession.redRoomId, currentSession.blueRoomId);
    transaction.set(db.doc(`crossRoomPkPairCooldowns/${pairId}`), {
      blueRoomId: currentSession.blueRoomId,
      cooldownUntil: clock.timestampFromMillis(nowMs + CROSS_ROOM_PK_TIMING_MS.repeatOpponentCooldown),
      cooldownUntilMs: nowMs + CROSS_ROOM_PK_TIMING_MS.repeatOpponentCooldown,
      purgeAfter: clock.timestampFromMillis(
        nowMs + CROSS_ROOM_PK_TIMING_MS.repeatOpponentCooldown + CROSS_ROOM_PK_RETENTION_MS.command,
      ),
      redRoomId: currentSession.redRoomId,
      updatedAt: timestamp,
    }, { merge: true });
    for (const [roomRef, snapshot] of [[redRoomRef, redRoomSnapshot], [blueRoomRef, blueRoomSnapshot]]) {
      if (snapshot.exists && snapshot.data()?.activePkSessionId === pkId) transaction.update(roomRef, {
        activePkSessionId: null,
        lastPkEndedAtMs: nowMs,
        recentPkExpiresAt: clock.timestampFromMillis(recentExpiresAtMs),
        recentPkSessionId: pkId,
        updatedAt: timestamp,
      });
    }
    return { completed: true, processed: true, result: verified.sessionPatch };
  });
}

function createCrossRoomPkPairId(redRoomId, blueRoomId) {
  const { createHash } = require('node:crypto');
  return `crpkp_${createHash('sha256').update([redRoomId, blueRoomId].sort().join('|')).digest('hex').slice(0, 24)}`;
}

function serializeJob(job, clock, timestamp) {
  return {
    ...job,
    leaseExpiresAt: job.leaseExpiresAtMs ? clock.timestampFromMillis(job.leaseExpiresAtMs) : null,
    purgeAfter: clock.timestampFromMillis(job.purgeAfterMs),
    red: serializeCheckpoint(job.red, clock),
    blue: serializeCheckpoint(job.blue, clock),
    updatedAt: timestamp,
  };
}

function serializeCheckpoint(value, clock) {
  return {
    ...value,
    cursorCreatedAt: value.cursorCreatedAt
      || (value.cursorCreatedAtMs ? clock.timestampFromMillis(value.cursorCreatedAtMs) : null),
  };
}

function serializeLease(job, clock, timestamp) {
  return {
    leaseExpiresAt: clock.timestampFromMillis(job.leaseExpiresAtMs),
    leaseExpiresAtMs: job.leaseExpiresAtMs,
    leaseOwner: job.leaseOwner,
    status: job.status,
    updatedAt: timestamp,
    updatedAtMs: job.updatedAtMs,
  };
}

function mapJob(data) {
  if (!data || data.schemaVersion !== 1) return null;
  const mapCheckpoint = (value = {}) => ({
    cursorCreatedAt: value.cursorCreatedAt || null,
    cursorCreatedAtMs: timestampToMillis(value.cursorCreatedAt) || Number(value.cursorCreatedAtMs) || 0,
    cursorEventId: typeof value.cursorEventId === 'string' ? value.cursorEventId : '',
    distinctGifterCount: Number(value.distinctGifterCount) || 0,
    done: value.done === true,
    eventCount: Number(value.eventCount) || 0,
    roomId: typeof value.roomId === 'string' ? value.roomId : '',
    scannedEventCount: Number(value.scannedEventCount) || 0,
    score: Number(value.score) || 0,
  });
  return {
    ...data,
    blue: mapCheckpoint(data.blue),
    leaseExpiresAtMs: timestampToMillis(data.leaseExpiresAt) || Number(data.leaseExpiresAtMs) || 0,
    purgeAfterMs: timestampToMillis(data.purgeAfter) || Number(data.purgeAfterMs) || 0,
    red: mapCheckpoint(data.red),
    scannedEventCount: Number(data.scannedEventCount) || 0,
  };
}

module.exports = {
  beginCrossRoomPkSessionSettlement,
  beginCrossRoomPkSettlement,
  forceSettleCrossRoomPkOnFlagOff,
  processCrossRoomPkReconciliation,
  processCrossRoomPkReconciliations,
  projectCrossRoomPkGift,
};
