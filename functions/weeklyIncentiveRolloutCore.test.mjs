import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  WEEKLY_INCENTIVE_ROLLOUT_STAGES,
  validateWeeklyIncentiveStageTransition,
} = require('./weeklyIncentiveRolloutCore');

describe('weekly incentive staged rollout', () => {
  it('keeps every payout disabled through report-only stages', () => {
    for (const stage of WEEKLY_INCENTIVE_ROLLOUT_STAGES.filter((value) => value.id <= 4)) {
      expect(stage.flags.voice_room_rocket_rewards).toBe(false);
      expect(stage.flags.voice_room_owner_target_payouts).toBe(false);
      expect(stage.flags.voice_room_payroll_payouts).toBe(false);
    }
  });

  it('requires sequential movement and explicit economic acknowledgement', () => {
    expect(validateWeeklyIncentiveStageTransition({ currentStageId: 0, nextStageId: 2 }).code).toBe('NON_SEQUENTIAL_STAGE');
    expect(validateWeeklyIncentiveStageTransition({ currentStageId: 4, nextStageId: 5 }).code).toBe('ECONOMIC_ACK_REQUIRED');
    expect(validateWeeklyIncentiveStageTransition({
      acknowledgeEconomicImpact: true,
      currentStageId: 4,
      nextStageId: 5,
    })).toMatchObject({ ok: true, value: { economic: true, id: 5 } });
  });

  it('always permits an immediate rollback to dark', () => {
    expect(validateWeeklyIncentiveStageTransition({ currentStageId: 7, nextStageId: 0 })).toMatchObject({
      ok: true,
      value: { id: 0 },
    });
  });
});
