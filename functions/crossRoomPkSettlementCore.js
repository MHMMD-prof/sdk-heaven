'use strict';

const { createHash } = require('node:crypto');
const {
  CROSS_ROOM_PK_LIMITS,
  CROSS_ROOM_PK_RECONCILIATION_SCHEMA_VERSION,
  CROSS_ROOM_PK_SCORE_SHARD_COUNT,
  CROSS_ROOM_PK_TIMING_MS,
} = require('./crossRoomPkContract');
const { MIN_DISTINCT_GIFTERS_FOR_VALID, timestampToMillis } = require('./roomPkCore');

function normalizeCommittedCrossRoomPkGift({ event, eventId, roomId, session }) {
  if (!event || !session || session.schemaVersion !== 2 || session.mode !== 'cross-room'
    || event.status !== 'committed' || event.eventId !== eventId || event.roomId !== roomId
    || event.pkContext?.mode !== 'cross-room' || event.pkContext?.pkId !== session.pkId) return null;
  const occurredAtMs = timestampToMillis(event.createdAt) || Number(event.createdAtMs) || 0;
  const priceCoins = Number(event.priceCoins);
  const senderUid = cleanId(event.senderUid);
  const side = roomId === session.redRoomId ? 'red' : roomId === session.blueRoomId ? 'blue' : '';
  const scoringEndsAtMs = Number(session.scoringEndsAtMs) || session.endsAtMs;
  if (!side || !occurredAtMs || occurredAtMs < session.startedAtMs || occurredAtMs > scoringEndsAtMs
    || !Number.isSafeInteger(priceCoins) || priceCoins < 1 || !senderUid) return null;
  return {
    eventId,
    occurredAtMs,
    pkId: session.pkId,
    priceCoins,
    roomId,
    senderUid,
    shard: scoreShardForEvent(eventId, session.scoreShardCount),
    side,
  };
}

function scoreShardForEvent(eventId, shardCount = CROSS_ROOM_PK_SCORE_SHARD_COUNT) {
  if (!cleanId(eventId) || !Number.isInteger(shardCount) || shardCount < 1 || shardCount > 128) return -1;
  return Number.parseInt(createHash('sha256').update(eventId).digest('hex').slice(0, 8), 16) % shardCount;
}

function applyCrossRoomPkShardScore(shard, gift, firstGifter) {
  if (!gift || !Number.isSafeInteger(gift.priceCoins) || gift.priceCoins < 1) return null;
  const current = shard && typeof shard === 'object' ? shard : {};
  const score = Number(current.score) || 0;
  const giftCount = Number(current.giftCount) || 0;
  const distinctGifterCount = Number(current.distinctGifterCount) || 0;
  if (![score, giftCount, distinctGifterCount].every(Number.isSafeInteger)) return null;
  return {
    distinctGifterCount: distinctGifterCount + (firstGifter ? 1 : 0),
    giftCount: giftCount + 1,
    score: score + gift.priceCoins,
  };
}

function createCrossRoomPkReconciliation({ nowMs, session }) {
  if (!session || session.schemaVersion !== 2 || session.mode !== 'cross-room') return null;
  return {
    blue: checkpoint(session.blueRoomId),
    failureCode: '',
    leaseExpiresAtMs: 0,
    leaseOwner: '',
    pkId: session.pkId,
    purgeAfterMs: session.purgeAfterMs,
    red: checkpoint(session.redRoomId),
    scannedEventCount: 0,
    schemaVersion: CROSS_ROOM_PK_RECONCILIATION_SCHEMA_VERSION,
    status: 'pending',
    updatedAtMs: nowMs,
  };
}

function canAcquireCrossRoomPkLease(job, workerId, nowMs) {
  return Boolean(job && ['pending', 'running'].includes(job.status) && cleanId(workerId)
    && (!job.leaseOwner || job.leaseOwner === workerId || Number(job.leaseExpiresAtMs) <= nowMs));
}

function acquireCrossRoomPkLease(job, workerId, nowMs) {
  if (!canAcquireCrossRoomPkLease(job, workerId, nowMs)) return null;
  return {
    ...job,
    leaseExpiresAtMs: nowMs + CROSS_ROOM_PK_TIMING_MS.reconciliationLease,
    leaseOwner: workerId,
    status: 'running',
    updatedAtMs: nowMs,
  };
}

function applyCrossRoomPkReconciliationPage({ existingGifterKeys = [], events, job, nowMs,
  side, startCursor, workerId }) {
  if (!job || job.status !== 'running' || job.leaseOwner !== workerId
    || Number(job.leaseExpiresAtMs) <= nowMs || !['red', 'blue'].includes(side)) return null;
  const checkpointValue = job[side];
  const expectedCursor = cursorKey(checkpointValue.cursorCreatedAtMs, checkpointValue.cursorEventId);
  if (expectedCursor !== cursorKey(startCursor?.createdAtMs, startCursor?.eventId)) return null;
  const page = Array.isArray(events) ? events : [];
  if (page.length > CROSS_ROOM_PK_LIMITS.reconciliationPageSize) return null;

  const existing = new Set(existingGifterKeys);
  const createdGifterKeys = [];
  let scoreDelta = 0;
  let eventCountDelta = 0;
  let scannedDelta = 0;
  let lastCursor = startCursor || { createdAtMs: 0, eventId: '' };
  for (const event of page) {
    if (event?.failureCode === 'SOURCE_DATA_INVALID'
      || !cleanId(event?.eventId) || !Number.isSafeInteger(event?.occurredAtMs) || event.occurredAtMs < 1) {
      return {
        createdGifterKeys: [],
        job: { ...job, failureCode: 'SOURCE_DATA_INVALID', status: 'attention-required', updatedAtMs: nowMs },
      };
    }
    scannedDelta += 1;
    lastCursor = { createdAtMs: event.occurredAtMs, eventId: event.eventId };
    if (event.valid === false || event.side !== side
      || event.roomId !== checkpointValue.roomId || event.pkId !== job.pkId) continue;
    scoreDelta += event.priceCoins;
    eventCountDelta += 1;
    const key = `${side}_${event.senderUid}`;
    if (!existing.has(key)) {
      existing.add(key);
      createdGifterKeys.push(key);
    }
  }
  const sideScannedEventCount = Number(checkpointValue.scannedEventCount || 0) + scannedDelta;
  const scannedEventCount = Number(job.scannedEventCount || 0) + scannedDelta;
  if (sideScannedEventCount > CROSS_ROOM_PK_LIMITS.maxReconciliationEventsPerRoom) {
    return {
      createdGifterKeys: [],
      job: { ...job, failureCode: 'SCAN_CAP_EXCEEDED', status: 'attention-required', updatedAtMs: nowMs },
    };
  }
  return {
    createdGifterKeys,
    job: {
      ...job,
      leaseExpiresAtMs: nowMs + CROSS_ROOM_PK_TIMING_MS.reconciliationLease,
      scannedEventCount,
      [side]: {
        ...checkpointValue,
        cursorCreatedAtMs: lastCursor.createdAtMs,
        cursorEventId: lastCursor.eventId,
        distinctGifterCount: checkpointValue.distinctGifterCount + createdGifterKeys.length,
        done: page.length < CROSS_ROOM_PK_LIMITS.reconciliationPageSize,
        eventCount: checkpointValue.eventCount + eventCountDelta,
        scannedEventCount: sideScannedEventCount,
        score: checkpointValue.score + scoreDelta,
      },
      updatedAtMs: nowMs,
    },
  };
}

function resolveVerifiedCrossRoomPkWinner({ blue, forfeitSide = '', red }) {
  if (forfeitSide === 'red') return { status: 'forfeited', winner: 'blue', winnerReason: 'red_forfeit' };
  if (forfeitSide === 'blue') return { status: 'forfeited', winner: 'red', winnerReason: 'blue_forfeit' };
  if (forfeitSide === 'both') return { status: 'void', winner: 'void', winnerReason: 'both_rooms_invalid' };
  const distinct = (Number(red?.distinctGifterCount) || 0) + (Number(blue?.distinctGifterCount) || 0);
  if (distinct < MIN_DISTINCT_GIFTERS_FOR_VALID) {
    return { status: 'void', winner: 'void', winnerReason: 'insufficient_distinct_gifters' };
  }
  if (red.score === blue.score) return { status: 'ended', winner: 'draw', winnerReason: 'tied_score' };
  return red.score > blue.score
    ? { status: 'ended', winner: 'red', winnerReason: 'higher_score' }
    : { status: 'ended', winner: 'blue', winnerReason: 'higher_score' };
}

function buildVerifiedCrossRoomPkFinalization({ job, liveScores, nowMs, session }) {
  if (!job || !session || job.status !== 'running' || !job.red.done || !job.blue.done) return null;
  const resolution = resolveVerifiedCrossRoomPkWinner({
    blue: job.blue,
    forfeitSide: session.forfeitSide || '',
    red: job.red,
  });
  return {
    drift: {
      blue: (Number(liveScores?.blue) || 0) - job.blue.score,
      red: (Number(liveScores?.red) || 0) - job.red.score,
    },
    endedAtMs: nowMs,
    jobPatch: { leaseExpiresAtMs: 0, leaseOwner: '', status: 'complete', updatedAtMs: nowMs },
    sessionPatch: {
      distinctGifterCount: job.red.distinctGifterCount + job.blue.distinctGifterCount,
      endedAtMs: nowMs,
      scoreVerifiedAtMs: nowMs,
      status: resolution.status,
      teams: {
        blue: { ...session.teams.blue, distinctGifterCount: job.blue.distinctGifterCount, score: job.blue.score },
        red: { ...session.teams.red, distinctGifterCount: job.red.distinctGifterCount, score: job.red.score },
      },
      winner: resolution.winner,
      winnerReason: resolution.winnerReason,
    },
  };
}

function checkpoint(roomId) {
  return { cursorCreatedAtMs: 0, cursorEventId: '', distinctGifterCount: 0,
    done: false, eventCount: 0, roomId, scannedEventCount: 0, score: 0 };
}

function cursorKey(createdAtMs, eventId) {
  return `${Number(createdAtMs) || 0}|${cleanId(eventId)}`;
}

function cleanId(value) {
  return typeof value === 'string' && value.trim() && !value.includes('/') ? value.trim().slice(0, 128) : '';
}

module.exports = {
  acquireCrossRoomPkLease,
  applyCrossRoomPkReconciliationPage,
  applyCrossRoomPkShardScore,
  buildVerifiedCrossRoomPkFinalization,
  canAcquireCrossRoomPkLease,
  createCrossRoomPkReconciliation,
  normalizeCommittedCrossRoomPkGift,
  resolveVerifiedCrossRoomPkWinner,
  scoreShardForEvent,
};
