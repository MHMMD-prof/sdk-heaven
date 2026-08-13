import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  acquireCrossRoomPkLease,
  applyCrossRoomPkReconciliationPage,
  applyCrossRoomPkShardScore,
  buildVerifiedCrossRoomPkFinalization,
  createCrossRoomPkReconciliation,
  normalizeCommittedCrossRoomPkGift,
  resolveVerifiedCrossRoomPkWinner,
  scoreShardForEvent,
} = require('./crossRoomPkSettlementCore');
const sessionFixture = require('./fixtures/crossRoomPk/v2-cross-room-session.json');

const nowMs = 2_000_000_200_000;

describe('crossRoomPkSettlementCore', () => {
  it('normalizes only committed, bound, in-window gifts and never multiplies quantity', () => {
    const gift = normalizeCommittedCrossRoomPkGift({
      event: event('event-1', 'room-red-1', 'gifter-1', 250),
      eventId: 'event-1',
      roomId: 'room-red-1',
      session: sessionFixture,
    });
    expect(gift).toMatchObject({ priceCoins: 250, side: 'red' });
    expect(normalizeCommittedCrossRoomPkGift({
      event: { ...event('event-1', 'room-red-1', 'gifter-1', 250), quantity: 99 },
      eventId: 'event-1', roomId: 'room-red-1', session: sessionFixture,
    }).priceCoins).toBe(250);
    expect(normalizeCommittedCrossRoomPkGift({
      event: { ...event('event-1', 'room-red-1', 'gifter-1', 250), status: 'pending' },
      eventId: 'event-1', roomId: 'room-red-1', session: sessionFixture,
    })).toBeNull();
    expect(normalizeCommittedCrossRoomPkGift({
      event: { ...event('event-1', 'room-red-1', 'gifter-1', 250), createdAtMs: sessionFixture.endsAtMs + 1 },
      eventId: 'event-1', roomId: 'room-red-1', session: sessionFixture,
    })).toBeNull();
  });

  it('selects stable shards and updates score/counts without parent mutation', () => {
    expect(scoreShardForEvent('event-1')).toBe(scoreShardForEvent('event-1'));
    expect(scoreShardForEvent('event-1')).toBeGreaterThanOrEqual(0);
    expect(scoreShardForEvent('event-1')).toBeLessThan(16);
    expect(applyCrossRoomPkShardScore({ score: 10, giftCount: 1, distinctGifterCount: 1 },
      { priceCoins: 25 }, true)).toEqual({ score: 35, giftCount: 2, distinctGifterCount: 2 });
  });

  it('enforces lease owner and cursor preconditions while resuming pages exactly once', () => {
    const job = createCrossRoomPkReconciliation({ nowMs, session: sessionFixture });
    const leased = acquireCrossRoomPkLease(job, 'worker-1', nowMs);
    expect(acquireCrossRoomPkLease(leased, 'worker-2', nowMs + 1)).toBeNull();
    const applied = applyCrossRoomPkReconciliationPage({
      existingGifterKeys: [],
      events: [normalized('event-1', 'red', 'gifter-1', 100), normalized('event-2', 'red', 'gifter-1', 50)],
      job: leased,
      nowMs: nowMs + 1,
      side: 'red',
      startCursor: { createdAtMs: 0, eventId: '' },
      workerId: 'worker-1',
    });
    expect(applied.createdGifterKeys).toEqual(['red_gifter-1']);
    expect(applied.job.red).toMatchObject({ distinctGifterCount: 1, eventCount: 2, score: 150 });
    expect(applyCrossRoomPkReconciliationPage({
      events: [], job: applied.job, nowMs: nowMs + 2, side: 'red',
      startCursor: { createdAtMs: 0, eventId: '' }, workerId: 'worker-1',
    })).toBeNull();
    expect(acquireCrossRoomPkLease(applied.job, 'worker-2', applied.job.leaseExpiresAtMs + 1)?.leaseOwner)
      .toBe('worker-2');
  });

  it('marks a scan-cap overflow for operator attention instead of guessing', () => {
    const job = acquireCrossRoomPkLease(createCrossRoomPkReconciliation({ nowMs, session: sessionFixture }),
      'worker-1', nowMs);
    job.red.scannedEventCount = 50_000;
    const result = applyCrossRoomPkReconciliationPage({
      events: [normalized('event-cap', 'red', 'gifter-1', 1)],
      job, nowMs: nowMs + 1, side: 'red', startCursor: { createdAtMs: 0, eventId: '' }, workerId: 'worker-1',
    });
    expect(result.job).toMatchObject({ failureCode: 'SCAN_CAP_EXCEEDED', status: 'attention-required' });
  });

  it('marks unpageable source data for operator attention', () => {
    const job = acquireCrossRoomPkLease(createCrossRoomPkReconciliation({ nowMs, session: sessionFixture }),
      'worker-1', nowMs);
    const result = applyCrossRoomPkReconciliationPage({
      events: [{ eventId: 'event-invalid', occurredAtMs: 0, valid: false }],
      job, nowMs: nowMs + 1, side: 'red', startCursor: { createdAtMs: 0, eventId: '' }, workerId: 'worker-1',
    });
    expect(result.job).toMatchObject({ failureCode: 'SOURCE_DATA_INVALID', status: 'attention-required' });
  });

  it('resolves verified winner, draw, anti-farm void, and forfeit override', () => {
    expect(resolveVerifiedCrossRoomPkWinner({
      red: { score: 100, distinctGifterCount: 1 }, blue: { score: 50, distinctGifterCount: 1 },
    })).toMatchObject({ status: 'ended', winner: 'red' });
    expect(resolveVerifiedCrossRoomPkWinner({
      red: { score: 50, distinctGifterCount: 1 }, blue: { score: 50, distinctGifterCount: 1 },
    })).toMatchObject({ winner: 'draw' });
    expect(resolveVerifiedCrossRoomPkWinner({
      red: { score: 100, distinctGifterCount: 1 }, blue: { score: 0, distinctGifterCount: 0 },
    })).toMatchObject({ status: 'void', winner: 'void' });
    expect(resolveVerifiedCrossRoomPkWinner({
      red: { score: 1000, distinctGifterCount: 10 }, blue: { score: 1, distinctGifterCount: 1 }, forfeitSide: 'red',
    })).toMatchObject({ status: 'forfeited', winner: 'blue' });
  });

  it('builds final parent totals and explicit live-projection drift', () => {
    const job = acquireCrossRoomPkLease(createCrossRoomPkReconciliation({ nowMs, session: sessionFixture }),
      'worker-1', nowMs);
    job.red = { ...job.red, done: true, score: 100, distinctGifterCount: 1 };
    job.blue = { ...job.blue, done: true, score: 50, distinctGifterCount: 1 };
    const result = buildVerifiedCrossRoomPkFinalization({
      job,
      liveScores: { red: 90, blue: 50 },
      nowMs: nowMs + 1,
      session: sessionFixture,
    });
    expect(result).toMatchObject({
      drift: { red: -10, blue: 0 },
      sessionPatch: { status: 'ended', winner: 'red', teams: { red: { score: 100 }, blue: { score: 50 } } },
    });
  });
});

function event(eventId, roomId, senderUid, priceCoins) {
  return {
    createdAtMs: sessionFixture.startedAtMs + 100,
    eventId,
    pkContext: { mode: 'cross-room', pkId: sessionFixture.pkId },
    priceCoins,
    roomId,
    senderUid,
    status: 'committed',
  };
}

function normalized(eventId, side, senderUid, priceCoins) {
  return {
    eventId,
    occurredAtMs: sessionFixture.startedAtMs + (eventId === 'event-1' ? 1 : 2),
    pkId: sessionFixture.pkId,
    priceCoins,
    roomId: side === 'red' ? sessionFixture.redRoomId : sessionFixture.blueRoomId,
    senderUid,
    side,
  };
}
