import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  applyRoomSupportAggregate,
  buildRoomSupportExpectedState,
  createRoomSupportLeaderboard,
  createRoomSupportPeriod,
  createRoomSupportProjectionFact,
  createRoomSupportShardId,
} = require('./roomSupportProjectionCore');

describe('roomSupportProjectionCore', () => {
  it('maps a committed public-room gift to Baghdad day and week buckets', () => {
    const projection = createRoomSupportProjectionFact(gift({
      createdAt: timestamp(Date.parse('2026-07-26T21:00:00.000Z')),
      price: 700,
      scoreValue: 9,
    }));
    expect(projection).toMatchObject({
      ok: true,
      value: {
        catalogScoreValue: 9,
        dayId: 'day_2026-07-27_asia-baghdad',
        debitedCoins: 700,
        supportPoints: 700,
        weekId: 'weekly_2026-07-27_asia-baghdad',
      },
    });
  });

  it('splits events exactly at the configured weekly boundary', () => {
    const before = createRoomSupportProjectionFact(gift({
      createdAt: timestamp(Date.parse('2026-07-26T20:59:59.999Z')),
      eventId: 'before-boundary',
    })).value;
    const after = createRoomSupportProjectionFact(gift({
      createdAt: timestamp(Date.parse('2026-07-26T21:00:00.000Z')),
      eventId: 'after-boundary',
    })).value;
    expect(before.weekId).toBe('weekly_2026-07-20_asia-baghdad');
    expect(after.weekId).toBe('weekly_2026-07-27_asia-baghdad');
    expect(before.dayId).toBe('day_2026-07-26_asia-baghdad');
    expect(after.dayId).toBe('day_2026-07-27_asia-baghdad');
  });

  it('rejects private, inactive, self, and unbalanced gifts', () => {
    expect(createRoomSupportProjectionFact(gift({ roomVisibility: 'private' }))).toEqual({
      ok: false,
      code: 'INELIGIBLE_GIFT',
    });
    expect(createRoomSupportProjectionFact(gift({ roomStatus: 'closed' }))).toEqual({
      ok: false,
      code: 'INELIGIBLE_GIFT',
    });
    expect(createRoomSupportProjectionFact(gift({ recipientUid: 'sender-1' }))).toEqual({
      ok: false,
      code: 'INELIGIBLE_GIFT',
    });
    expect(createRoomSupportProjectionFact(gift({
      reconciliation: { balanced: false, platformCredit: 10, recipientCredit: 80, senderDebit: 100 },
    }))).toEqual({ ok: false, code: 'INELIGIBLE_GIFT' });
  });

  it('keeps first contribution deterministic for delayed out-of-order delivery', () => {
    const later = createRoomSupportProjectionFact(gift({
      createdAt: timestamp(2_000),
      eventId: 'event-later',
    })).value;
    const earlier = createRoomSupportProjectionFact(gift({
      createdAt: timestamp(1_000),
      eventId: 'event-earlier',
    })).value;
    const period = createRoomSupportPeriod({ fact: later, periodType: 'week' });
    const first = applyRoomSupportAggregate(undefined, later, period);
    const second = applyRoomSupportAggregate({
      ...first.value,
      firstContributionAt: timestamp(first.value.firstContributionAtMillis),
      lastContributionAt: timestamp(first.value.lastContributionAtMillis),
    }, earlier, period);
    expect(second).toMatchObject({
      ok: true,
      value: {
        eligibleSpendCoins: 200,
        firstContributionAtMillis: 1_000,
        giftCount: 2,
        lastContributionAtMillis: 2_000,
      },
    });
  });

  it('assigns an event to one stable shard', () => {
    const first = createRoomSupportShardId('event-1');
    expect(first).toMatch(/^shard_(0[0-9]|[12][0-9]|3[01])$/);
    expect(createRoomSupportShardId('event-1')).toBe(first);
  });

  it('sorts ties by first contribution and then uid', () => {
    const period = {
      periodId: 'weekly_2026-07-27_asia-baghdad',
      periodType: 'week',
      roomId: 'room-1',
    };
    const result = createRoomSupportLeaderboard([
      candidate('user-c', 500, 2000),
      candidate('user-b', 500, 1000),
      candidate('user-a', 500, 1000),
      candidate('user-z', 900, 3000),
    ], {
      generatedAtMillis: 5000,
      period,
      totals: { eligibleSpendCoins: 2400, giftCount: 4, supportPoints: 2400 },
    });
    expect(result.value.entries.map((entry) => entry.uid)).toEqual([
      'user-z',
      'user-a',
      'user-b',
      'user-c',
    ]);
    expect(result.value.entries.map((entry) => entry.rank)).toEqual([1, 2, 3, 4]);
  });

  it('rebuilds the same supporter and shard state from immutable facts', () => {
    const facts = [
      createRoomSupportProjectionFact(gift({ eventId: 'event-1', price: 100 })).value,
      createRoomSupportProjectionFact(gift({ eventId: 'event-2', price: 250 })).value,
      createRoomSupportProjectionFact(gift({ eventId: 'event-3', price: 40, senderUid: 'sender-2' })).value,
    ];
    const period = createRoomSupportPeriod({ fact: facts[0], periodType: 'week' });
    const expected = buildRoomSupportExpectedState(facts, period);
    expect(expected.value.supporters.get('sender-1')).toMatchObject({
      eligibleSpendCoins: 350,
      giftCount: 2,
      supportPoints: 350,
    });
    expect(expected.value.supporters.get('sender-2')).toMatchObject({
      eligibleSpendCoins: 40,
      giftCount: 1,
    });
    expect(expected.value.totals).toEqual({
      eligibleSpendCoins: 390,
      giftCount: 3,
      supportPoints: 390,
    });
  });
});

function gift(overrides = {}) {
  const price = overrides.price ?? 100;
  return {
    createdAt: timestamp(Date.parse('2026-07-29T12:00:00.000Z')),
    currency: 'coins',
    eventId: 'event-1',
    price,
    recipientUid: 'target-1',
    reconciliation: {
      balanced: true,
      platformCredit: Math.floor(price / 10),
      recipientCredit: price - Math.floor(price / 10),
      senderDebit: price,
    },
    roomAvailability: 'active',
    roomId: 'room-1',
    roomStatus: 'active',
    roomVisibility: 'public',
    scoreValue: 2,
    senderDisplayName: 'Sender',
    senderUid: 'sender-1',
    status: 'committed',
    ...overrides,
  };
}

function candidate(uid, eligibleSpendCoins, firstContributionAtMillis) {
  return {
    displayNameSnapshot: uid,
    eligibleSpendCoins,
    firstContributionAt: timestamp(firstContributionAtMillis),
    firstContributionAtMillis,
    supportPoints: eligibleSpendCoins,
    uid,
  };
}

function timestamp(value) {
  return { toMillis: () => value };
}
