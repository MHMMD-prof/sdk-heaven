import { describe, expect, it } from 'vitest';

import type { RoomRocketData } from '../useRoomRocketData';
import type { RoomTargetData } from '../useRoomTargetData';
import {
  formatCompactIncentiveAmount,
  resolveRoomRocketRailSummary,
  resolveRoomTargetRailSummary,
} from '../roomIncentivePresentationModel';

describe('roomIncentivePresentationModel', () => {
  it('projects weekly Top-3 supporters and bounded rocket progress', () => {
    const supporters = [1, 2, 3, 4].map((rank) => ({
      avatarLabel: String(rank), avatarUrl: '', displayName: `User ${rank}`, eligibleSpendCoins: 100,
      firstContributionAtMillis: rank, rank, supportPoints: 500 - rank, uid: `u${rank}`,
    }));
    const summary = resolveRoomRocketRailSummary({
      error: false,
      loading: false,
      renderingEnabled: true,
      week: {
        entries: supporters,
        generatedAtMillis: 1,
        periodId: 'weekly_test',
        periodType: 'week',
        projectionVersion: 1,
        roomId: 'room',
        totals: { eligibleSpendCoins: 400, giftCount: 4, supportPoints: 1_000 },
      },
    } as RoomRocketData);
    expect(summary.supporters.map((entry) => entry.rank)).toEqual([1, 2, 3]);
    expect(summary.progressPercent).toBe(0);
  });

  it('shows target completion and the total projected roster return', () => {
    const summary = resolveRoomTargetRailSummary({
      cycle: {
        conversion: { denominator: 1, numerator: 1, payoutCurrency: 'diamonds' },
        roster: [
          { estimatedReturn: 1250, finalReturn: 1500 },
          { estimatedReturn: 750 },
        ],
        supportPoints: 750,
        targetSupportPoints: 1000,
      },
      error: false,
      loading: false,
      renderingEnabled: true,
    } as RoomTargetData);
    expect(summary).toMatchObject({
      currency: 'diamonds',
      progressPercent: 75,
      projectedReturn: 2250,
      projectedReturnLabel: '◆ 2.3K',
    });
  });

  it('formats compact values without exaggerating missing data', () => {
    expect(formatCompactIncentiveAmount(0)).toBe('0');
    expect(formatCompactIncentiveAmount(12_500)).toBe('12.5K');
    expect(formatCompactIncentiveAmount(2_000_000)).toBe('2M');
  });
});
