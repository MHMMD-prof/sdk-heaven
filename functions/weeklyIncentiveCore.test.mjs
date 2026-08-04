import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  WEEK_MS,
  createSettlementFingerprint,
  createSettlementId,
  createWeeklyCycle,
  normalizeCanonicalGiftFact,
  normalizeRewardBundle,
  normalizeSettlementWorkerOptions,
  normalizeWeeklyCycle,
} = require('./weeklyIncentiveCore');

describe('weeklyIncentiveCore', () => {
  it('creates a stable Baghdad Monday-to-Monday cycle', () => {
    const now = Date.parse('2026-07-29T12:00:00.000Z');
    const cycle = createWeeklyCycle({ nowMillis: now });
    expect(cycle.ok).toBe(true);
    expect(cycle.value).toMatchObject({
      cycleId: 'weekly_2026-07-27_asia-baghdad',
      startAtMillis: Date.parse('2026-07-26T21:00:00.000Z'),
      endAtMillis: Date.parse('2026-08-02T21:00:00.000Z'),
      timeZone: 'Asia/Baghdad',
    });
    expect(cycle.value.endAtMillis - cycle.value.startAtMillis).toBe(WEEK_MS);
    expect(normalizeWeeklyCycle(cycle.value)).toEqual(cycle);
  });

  it('keeps local Monday boundaries through daylight-saving changes', () => {
    const cycle = createWeeklyCycle({
      nowMillis: Date.parse('2026-03-08T12:00:00.000Z'),
      timeZone: 'America/New_York',
    });
    expect(cycle).toMatchObject({
      ok: true,
      value: {
        endAtMillis: Date.parse('2026-03-09T04:00:00.000Z'),
        startAtMillis: Date.parse('2026-03-02T05:00:00.000Z'),
      },
    });
    expect(cycle.value.endAtMillis - cycle.value.startAtMillis).toBe(WEEK_MS - 60 * 60 * 1000);
  });

  it('validates multi-currency and item rewards without duplicate items', () => {
    expect(normalizeRewardBundle({
      coins: 500,
      diamonds: 10,
      items: [{
        duplicateFallback: { amount: 20, currency: 'coins' },
        itemId: 'gold-frame',
      }],
    })).toMatchObject({
      ok: true,
      value: { coins: 500, diamonds: 10, schemaVersion: 1 },
    });
    expect(normalizeRewardBundle({ coins: 0 })).toEqual({ ok: false, code: 'EMPTY_REWARD' });
    expect(normalizeRewardBundle({
      items: [{ itemId: 'gold-frame' }, { itemId: 'gold-frame' }],
    })).toEqual({ ok: false, code: 'INVALID_REWARD' });
    expect(normalizeRewardBundle({
      items: [{ duplicateFallback: { amount: -1, currency: 'coins' }, itemId: 'gold-frame' }],
    })).toEqual({ ok: false, code: 'INVALID_REWARD' });
  });

  it('derives opaque deterministic settlement IDs and conflict fingerprints', () => {
    const base = {
      cycleId: 'weekly_2026-07-27_asia-baghdad',
      feature: 'rocket-rewards',
      rank: 1,
      roomId: 'room-1',
      uid: 'user-1',
    };
    const first = createSettlementId(base);
    expect(first).toMatch(/^ris_[a-f0-9]{40}$/);
    expect(createSettlementId({ ...base })).toBe(first);
    expect(createSettlementId({ ...base, rank: 2 })).not.toBe(first);
    expect(createSettlementId({ ...base, rank: 0 })).toBe('');
    expect(createSettlementId({
      cycleId: base.cycleId,
      feature: 'payroll',
      planId: 'employees',
      uid: base.uid,
    })).toMatch(/^ris_[a-f0-9]{40}$/);

    const fingerprint = createSettlementFingerprint({
      cycleId: base.cycleId,
      feature: base.feature,
      rewardBundle: { coins: 10 },
      source: { planId: '', rank: 1, roomId: 'room-1' },
      uid: base.uid,
    });
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses the committed wallet debit as the immutable support value', () => {
    expect(normalizeCanonicalGiftFact({
      createdAt: { toMillis: () => 1234 },
      currency: 'coins',
      eventId: 'gift-event-1',
      price: 900,
      recipientUid: 'target-1',
      roomId: 'room-1',
      scoreValue: 5,
      senderUid: 'sender-1',
      status: 'committed',
    }, { cycleId: 'weekly_2026-07-27_asia-baghdad' })).toEqual({
      ok: true,
      value: {
        catalogScoreValue: 5,
        cycleId: 'weekly_2026-07-27_asia-baghdad',
        debitedCoins: 900,
        eventId: 'gift-event-1',
        occurredAtMillis: 1234,
        recipientUid: 'target-1',
        roomId: 'room-1',
        schemaVersion: 1,
        senderUid: 'sender-1',
        supportPoints: 900,
      },
    });
  });

  it('bounds worker batches and lease durations', () => {
    expect(normalizeSettlementWorkerOptions({ workerId: 'worker-1' })).toMatchObject({
      ok: true,
      value: { dryRun: false, leaseMillis: 60_000, limit: 50 },
    });
    expect(normalizeSettlementWorkerOptions({ limit: 201, workerId: 'worker-1' }))
      .toEqual({ ok: false, code: 'INVALID_WORKER_OPTIONS' });
  });
});
