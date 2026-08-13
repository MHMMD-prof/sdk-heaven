import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  LEADERBOARD_LIMIT,
  LEADERBOARD_STALE_MS,
  LEADERBOARD_TIME_ZONE,
  buildBoardId,
  buildPeriodId,
  compareLeaderboardEntries,
  isBoardFresh,
  mapLeaderboardDocument,
  mapLeaderboardUserScore,
  normalizeGetLeaderboardInput,
  rankEntries,
} = require('./growthLeaderboardCore');
const { createDailyBucket, createWeeklyCycle } = require('./weeklyIncentiveCore');

describe('growthLeaderboardCore', () => {
  it('exports board constants', () => {
    expect(LEADERBOARD_LIMIT).toBe(50);
    expect(LEADERBOARD_STALE_MS).toBe(5 * 60 * 1000);
    expect(LEADERBOARD_TIME_ZONE).toBe('Asia/Baghdad');
  });

  it('builds daily, weekly, and all-time period ids', () => {
    const nowMs = Date.UTC(2026, 7, 8, 12, 0, 0);
    const day = createDailyBucket({ nowMillis: nowMs, timeZone: LEADERBOARD_TIME_ZONE });
    const week = createWeeklyCycle({ nowMillis: nowMs, timeZone: LEADERBOARD_TIME_ZONE });
    expect(buildPeriodId({ window: 'daily', nowMs })).toEqual({ ok: true, value: day.value.dayId });
    expect(buildPeriodId({ window: 'weekly', nowMs })).toEqual({ ok: true, value: week.value.cycleId });
    expect(buildPeriodId({ window: 'all', nowMs })).toEqual({ ok: true, value: 'all' });
    expect(buildPeriodId({ window: 'monthly', nowMs }).ok).toBe(false);
  });

  it('builds board ids and normalizes get-leaderboard input', () => {
    expect(buildBoardId({ kind: 'wealth', window: 'daily', scope: 'global' })).toBe('wealth_daily_global');
    expect(buildBoardId({ kind: 'charm', window: 'weekly', scope: 'iq' })).toBe('charm_weekly_IQ');
    expect(buildBoardId({ kind: 'wealth', window: 'daily', scope: 'ZZ' })).toBe('');
    expect(normalizeGetLeaderboardInput({
      kind: 'Wealth',
      scope: 'iq',
      window: 'Daily',
    })).toEqual({
      ok: true,
      value: {
        boardId: 'wealth_daily_IQ',
        kind: 'wealth',
        scope: 'IQ',
        window: 'daily',
      },
    });
    expect(normalizeGetLeaderboardInput({ kind: 'wealth', window: 'daily' }).value.scope).toBe('global');
    expect(normalizeGetLeaderboardInput({ kind: 'nope', window: 'daily' }).ok).toBe(false);
    expect(normalizeGetLeaderboardInput({
      kind: 'family_wealth',
      window: 'weekly',
      scope: 'global',
    })).toMatchObject({
      ok: true,
      value: {
        boardId: 'family_wealth_weekly_global',
        kind: 'family_wealth',
        window: 'weekly',
      },
    });
    expect(normalizeGetLeaderboardInput({ kind: 'family_charm', window: 'daily' }).ok).toBe(false);
  });

  it('compares and ranks entries with deterministic ties', () => {
    const ranked = rankEntries([
      { firstContributionAtMs: 30, score: 10, uid: 'b' },
      { firstContributionAtMs: 10, score: 10, uid: 'a' },
      { firstContributionAtMs: 5, score: 20, uid: 'c' },
      { firstContributionAtMs: 10, score: 10, uid: 'z' },
    ]);
    expect(ranked.map((entry) => entry.uid)).toEqual(['c', 'a', 'z', 'b']);
    expect(ranked.map((entry) => entry.rank)).toEqual([1, 2, 3, 4]);
    expect(compareLeaderboardEntries(
      { firstContributionAtMs: 1, score: 5, uid: 'a' },
      { firstContributionAtMs: 2, score: 5, uid: 'b' },
    )).toBeLessThan(0);
  });

  it('maps score docs and board snapshots', () => {
    expect(mapLeaderboardUserScore({
      charmScore: 12,
      countryCode: 'iq',
      displayName: 'Sara',
      firstContributionAtMs: 100,
      publicId: 1234567,
      uid: 'u1',
      wealthCoins: 50,
    })).toMatchObject({
      charmScore: 12,
      countryCode: 'IQ',
      publicId: '1234567',
      wealthCoins: 50,
    });
    expect(mapLeaderboardDocument({
      boardId: 'wealth_daily_global',
      entries: [{ rank: 1, score: 50, uid: 'u1' }],
      kind: 'wealth',
      periodId: 'all',
      scope: 'global',
      updatedAtMs: 1_000,
      window: 'daily',
    })).toMatchObject({
      boardId: 'wealth_daily_global',
      entries: [{ rank: 1, score: 50, uid: 'u1' }],
      frozen: false,
      kind: 'wealth',
      window: 'daily',
    });
    expect(isBoardFresh({ frozen: false, updatedAtMs: Date.now() - 1_000 }, Date.now())).toBe(true);
    expect(isBoardFresh({ frozen: false, updatedAtMs: Date.now() - LEADERBOARD_STALE_MS - 1 }, Date.now())).toBe(false);
  });
});
