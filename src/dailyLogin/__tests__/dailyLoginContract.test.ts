import { describe, expect, it } from 'vitest';

import { mapDailyLoginClaimResult, mapDailyLoginStatus } from '../dailyLoginContract';

describe('dailyLoginContract', () => {
  it('accepts the strict seven-day public status contract', () => {
    const status = mapDailyLoginStatus(statusFixture());
    expect(status).toMatchObject({
      campaignRevision: 4,
      claimable: true,
      streakPosition: 3,
      timeZone: 'Asia/Baghdad',
    });
    expect(status?.calendar).toHaveLength(7);
  });

  it('rejects reordered, missing, and malformed reward days', () => {
    const missing = statusFixture();
    missing.calendar = missing.calendar.slice(0, 6);
    expect(mapDailyLoginStatus(missing)).toBeUndefined();

    const reordered = statusFixture();
    reordered.calendar[2].day = 5;
    expect(mapDailyLoginStatus(reordered)).toBeUndefined();

    const malformed = statusFixture();
    malformed.calendar[0].reward.coins = -1;
    expect(mapDailyLoginStatus(malformed)).toBeUndefined();
  });

  it('maps an authoritative claim receipt and rejects unsafe wallet values', () => {
    const fixture = {
      balances: { coins: 1_100, diamonds: 50 },
      campaignRevision: 4,
      dayId: 'day_2026-07-31_asia-baghdad',
      items: [],
      nextResetAtMillis: 1_800_000_000_000,
      receiptId: 'dlc_receipt',
      reward: reward(30, 3),
      settlementId: 'dls_settlement',
      streakPosition: 3,
      walletCredits: [{ amount: 30, balanceAfter: 1_100, currency: 'coins' }],
    };
    expect(mapDailyLoginClaimResult(fixture)).toMatchObject({
      balances: { coins: 1_100, diamonds: 50 },
      streakPosition: 3,
    });
    expect(mapDailyLoginClaimResult({
      ...fixture,
      walletCredits: [{ amount: -30, balanceAfter: 1_100, currency: 'coins' }],
    })).toBeUndefined();
  });
});

function statusFixture() {
  return {
    alreadyClaimed: false,
    calendar: Array.from({ length: 7 }, (_, index) => ({
      day: index + 1,
      reward: reward((index + 1) * 10, index + 1),
    })),
    campaignRevision: 4,
    claimable: true,
    enabled: true,
    itemRewardsEnabled: false,
    minimumClientVersion: '1.0.0',
    nextResetAtMillis: 1_800_000_000_000,
    presentationVisible: true,
    reason: '',
    streakPosition: 3,
    timeZone: 'Asia/Baghdad',
    todayDayId: 'day_2026-07-31_asia-baghdad',
  };
}

function reward(coins: number, diamonds: number) {
  return { coins, diamonds, items: [], schemaVersion: 1 };
}
