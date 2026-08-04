import { describe, expect, it } from 'vitest';

import {
  mapRoomTargetPublicCycleV1,
  mapRoomTargetRosterPreviewV1,
} from '../roomTargetContract';

const timestamp = (value: number) => ({ toMillis: () => value });

describe('roomTargetContract', () => {
  it('maps only the safe public cycle projection', () => {
    expect(mapRoomTargetPublicCycleV1({
      conversion: { denominator: 1, numerator: 1, payoutCurrency: 'coins' },
      cycleId: 'weekly_2026-07-27_asia-baghdad',
      endAt: timestamp(20),
      perRoomReturnCap: 1000,
      perUserReturnCap: 500,
      returnBps: 500,
      roomId: 'room-1',
      roster: [{
        avatarLabel: 'A',
        avatarUrl: '',
        displayName: 'Ali',
        eligibleSpendCoins: 100,
        estimatedReturn: 5,
        role: 'selected',
        supportPoints: 100,
        uid: 'user-1',
      }],
      startAt: timestamp(10),
      state: 'active',
      supportPoints: 100,
      targetSupportPoints: 1000,
      templateRevision: 2,
    }, 'room-1')).toMatchObject({
      endAtMillis: 20,
      roster: [{ estimatedReturn: 5, uid: 'user-1' }],
      supportPoints: 100,
    });
  });

  it('rejects cross-room documents and malformed roster members', () => {
    expect(mapRoomTargetPublicCycleV1({ roomId: 'other' }, 'room-1')).toBeUndefined();
    expect(mapRoomTargetPublicCycleV1({
      conversion: { denominator: 1, numerator: 1, payoutCurrency: 'coins' },
      cycleId: 'week',
      roomId: 'room-1',
      roster: [{ role: 'selected', uid: '../private' }],
      state: 'active',
      supportPoints: 0,
      targetSupportPoints: 1,
    }, 'room-1')?.roster).toEqual([]);
  });

  it('maps the next roster only for the expected owner', () => {
    const value = {
      cycleId: 'week-next',
      endAt: timestamp(20),
      ownerUid: 'owner',
      roomId: 'room-1',
      roster: [{ avatarLabel: 'O', avatarUrl: '', displayName: 'Owner', role: 'owner', uid: 'owner' }],
      rules: { maxSelectedUsers: 3 },
      startAt: timestamp(10),
    };
    expect(mapRoomTargetRosterPreviewV1(value, 'room-1', 'owner')).toMatchObject({
      maxSelectedUsers: 3,
      roster: [{ uid: 'owner' }],
    });
    expect(mapRoomTargetRosterPreviewV1(value, 'room-1', 'not-owner')).toBeUndefined();
  });
});
