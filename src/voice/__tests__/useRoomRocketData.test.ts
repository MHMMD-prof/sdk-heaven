import { describe, expect, it } from 'vitest';

import { createRoomSupportPeriodIds } from '../roomRocketPeriod';

describe('createRoomSupportPeriodIds', () => {
  it('uses Baghdad calendar days and Monday weekly boundaries', () => {
    expect(createRoomSupportPeriodIds(Date.parse('2026-07-29T12:00:00.000Z'))).toEqual({
      dayId: 'day_2026-07-29_asia-baghdad',
      weekId: 'weekly_2026-07-27_asia-baghdad',
    });
  });

  it('crosses into the next Baghdad day before UTC midnight', () => {
    expect(createRoomSupportPeriodIds(Date.parse('2026-07-29T22:30:00.000Z')).dayId)
      .toBe('day_2026-07-30_asia-baghdad');
  });
});
