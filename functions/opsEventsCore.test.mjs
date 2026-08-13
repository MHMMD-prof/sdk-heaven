'use strict';

import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  isEventActive,
  listDefaultDailyMissions,
  mapMissionProgressRow,
  normalizeAdminOpsEventMutation,
  normalizeClaimMissionInput,
} = require('./opsEventsCore');

describe('opsEventsCore', () => {
  it('ships a default gift mission', () => {
    const missions = listDefaultDailyMissions();
    expect(missions).toHaveLength(1);
    expect(missions[0]).toMatchObject({
      kind: 'send_gifts',
      missionId: 'daily_send_gifts_3',
      target: 3,
      rewardCoins: 50,
    });
  });

  it('marks missions claimable only when complete and unclaimed', () => {
    const definition = listDefaultDailyMissions()[0];
    expect(mapMissionProgressRow(definition, { progress: 2 }).claimable).toBe(false);
    expect(mapMissionProgressRow(definition, { progress: 3 }).claimable).toBe(true);
    expect(mapMissionProgressRow(definition, { progress: 3, claimed: true }).claimable).toBe(false);
  });

  it('validates claim and admin publish inputs', () => {
    expect(normalizeClaimMissionInput({ missionId: 'daily_send_gifts_3' }).ok).toBe(true);
    expect(normalizeClaimMissionInput({}).ok).toBe(false);
    expect(normalizeAdminOpsEventMutation({
      action: 'publish',
      titleAr: 'أسبوع الهدايا',
      themeAr: 'ثيم',
      startsAtMs: 1,
      endsAtMs: 2,
      reason: 'نشر تجريبي',
      requestId: 'ops_evt_abcdefghijklmn',
    }).ok).toBe(true);
    expect(normalizeAdminOpsEventMutation({
      action: 'ops-events-mutate',
      operation: 'retire',
      eventId: 'event-1',
      reason: 'إيقاف تجريبي',
      requestId: 'ops_evt_abcdefghijklmno',
    }).ok).toBe(true);
    expect(isEventActive({
      status: 'published',
      startsAtMs: 0,
      endsAtMs: 100,
    }, 50)).toBe(true);
    expect(isEventActive({
      status: 'retired',
      startsAtMs: 0,
      endsAtMs: 100,
    }, 50)).toBe(false);
  });
});
