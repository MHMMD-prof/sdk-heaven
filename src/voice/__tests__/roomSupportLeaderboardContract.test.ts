import { describe, expect, it } from 'vitest';

import { mapRoomSupportLeaderboardV1 } from '../roomSupportLeaderboardContract';

describe('roomSupportLeaderboardContract', () => {
  it('maps the compact server-authored leaderboard projection', () => {
    expect(mapRoomSupportLeaderboardV1({
      entries: [{
        avatarLabel: 'S',
        avatarUrl: 'https://example.com/avatar.png',
        displayName: 'Supporter',
        eligibleSpendCoins: 500,
        firstContributionAt: { toMillis: () => 1000 },
        rank: 1,
        supportPoints: 500,
        uid: 'user-1',
      }],
      generatedAt: { toMillis: () => 2000 },
      periodId: 'weekly_2026-07-27_asia-baghdad',
      periodType: 'week',
      projectionVersion: 1,
      roomId: 'room-1',
      totals: {
        eligibleSpendCoins: 500,
        giftCount: 1,
        supportPoints: 500,
      },
    }, 'room-1')).toMatchObject({
      entries: [{ rank: 1, uid: 'user-1' }],
      generatedAtMillis: 2000,
      roomId: 'room-1',
    });
  });

  it('rejects cross-room, duplicate, and non-contiguous entries', () => {
    const base = {
      avatarLabel: '',
      avatarUrl: '',
      displayName: 'Supporter',
      eligibleSpendCoins: 1,
      firstContributionAtMillis: 1,
      supportPoints: 1,
    };
    expect(mapRoomSupportLeaderboardV1({
      entries: [
        { ...base, rank: 1, uid: 'same-user' },
        { ...base, rank: 3, uid: 'same-user' },
      ],
      generatedAtMillis: 2,
      periodId: 'day_2026-07-29_asia-baghdad',
      periodType: 'day',
      projectionVersion: 1,
      roomId: 'room-2',
      totals: { eligibleSpendCoins: 2, giftCount: 2, supportPoints: 2 },
    }, 'room-1')).toBeUndefined();
  });
});
