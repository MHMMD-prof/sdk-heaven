'use strict';

const {
  acquireCrossRoomPkLease,
  applyCrossRoomPkReconciliationPage,
  buildVerifiedCrossRoomPkFinalization,
  createCrossRoomPkReconciliation,
} = require('../crossRoomPkSettlementCore');
const {
  CROSS_ROOM_PK_LIMITS,
  CROSS_ROOM_PK_TIMING_MS,
} = require('../crossRoomPkContract');
const sessionFixture = require('../fixtures/crossRoomPk/v2-cross-room-session.json');

function runSyntheticCrossRoomPkLoad({ eventsPerRoom = 10_000, restartEveryPages = 50 } = {}) {
  if (!Number.isInteger(eventsPerRoom) || eventsPerRoom < 1
    || eventsPerRoom > CROSS_ROOM_PK_LIMITS.maxReconciliationEventsPerRoom) {
    throw new Error(`eventsPerRoom must be 1..${CROSS_ROOM_PK_LIMITS.maxReconciliationEventsPerRoom}.`);
  }
  if (!Number.isInteger(restartEveryPages) || restartEveryPages < 1) {
    throw new Error('restartEveryPages must be a positive integer.');
  }

  let nowMs = sessionFixture.settleAfterMs + 1;
  let workerNumber = 1;
  let workerId = `load-worker-${workerNumber}`;
  let job = acquireCrossRoomPkLease(
    createCrossRoomPkReconciliation({ nowMs, session: sessionFixture }), workerId, nowMs,
  );
  const gifterKeys = new Set();
  let pages = 0;
  let restarts = 0;

  for (const side of ['red', 'blue']) {
    let offset = 0;
    while (!job[side].done) {
      if (pages > 0 && pages % restartEveryPages === 0) {
        nowMs = job.leaseExpiresAtMs + 1;
        workerNumber += 1;
        workerId = `load-worker-${workerNumber}`;
        job = acquireCrossRoomPkLease(job, workerId, nowMs);
        restarts += 1;
      }
      const count = Math.min(CROSS_ROOM_PK_LIMITS.reconciliationPageSize, eventsPerRoom - offset);
      const events = Array.from({ length: Math.max(0, count) }, (_, pageIndex) => {
        const index = offset + pageIndex;
        return normalizedEvent(side, index);
      });
      const result = applyCrossRoomPkReconciliationPage({
        events,
        existingGifterKeys: [...gifterKeys],
        job,
        nowMs,
        side,
        startCursor: {
          createdAtMs: job[side].cursorCreatedAtMs,
          eventId: job[side].cursorEventId,
        },
        workerId,
      });
      if (!result || result.job.status === 'attention-required') {
        throw new Error(result?.job.failureCode || 'Synthetic reconciliation failed.');
      }
      result.createdGifterKeys.forEach((key) => gifterKeys.add(key));
      job = result.job;
      offset += count;
      pages += 1;
      nowMs += 1;
    }
  }

  const finalization = buildVerifiedCrossRoomPkFinalization({
    job,
    liveScores: { blue: eventsPerRoom * 2, red: eventsPerRoom },
    nowMs,
    session: sessionFixture,
  });
  if (!finalization) throw new Error('Synthetic finalization failed.');
  return {
    drift: finalization.drift,
    eventsPerRoom,
    pages,
    restarts,
    status: finalization.sessionPatch.status,
    totalEvents: job.red.eventCount + job.blue.eventCount,
    verifiedScores: {
      blue: finalization.sessionPatch.teams.blue.score,
      red: finalization.sessionPatch.teams.red.score,
    },
    winner: finalization.sessionPatch.winner,
  };
}

function normalizedEvent(side, index) {
  return {
    eventId: `${side}-load-${String(index).padStart(6, '0')}`,
    occurredAtMs: sessionFixture.startedAtMs + index + 1,
    pkId: sessionFixture.pkId,
    priceCoins: side === 'red' ? 1 : 2,
    roomId: side === 'red' ? sessionFixture.redRoomId : sessionFixture.blueRoomId,
    senderUid: `${side}-gifter-${index % 250}`,
    side,
  };
}

function parseOptions(argv) {
  const options = { eventsPerRoom: 10_000, restartEveryPages: 50 };
  for (const argument of argv) {
    if (argument.startsWith('--events-per-room=')) options.eventsPerRoom = Number(argument.split('=')[1]);
    else if (argument.startsWith('--restart-every-pages=')) options.restartEveryPages = Number(argument.split('=')[1]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

if (require.main === module) {
  const startedAt = Date.now();
  const result = runSyntheticCrossRoomPkLoad(parseOptions(process.argv.slice(2)));
  console.log(JSON.stringify({ ...result, elapsedMs: Date.now() - startedAt }, null, 2));
}

module.exports = { parseOptions, runSyntheticCrossRoomPkLoad };
