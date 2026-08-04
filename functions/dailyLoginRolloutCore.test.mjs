import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  resolveDailyLoginRolloutStage,
  validateDailyLoginStageTransition,
} = require('./dailyLoginRolloutCore');

describe('dailyLoginRolloutCore', () => {
  it('keeps the rollout dark, currency-only, then item-enabled', () => {
    expect(resolveDailyLoginRolloutStage(0)).toMatchObject({
      economic: false,
      flags: { daily_login_reward_items: false, daily_login_rewards: false },
      name: 'dark',
    });
    expect(resolveDailyLoginRolloutStage(1)).toMatchObject({
      flags: { daily_login_reward_items: false, daily_login_rewards: true },
      name: 'currency-only',
    });
    expect(resolveDailyLoginRolloutStage(2)).toMatchObject({
      flags: { daily_login_reward_items: true, daily_login_rewards: true },
      name: 'currency-and-items',
    });
  });

  it('requires campaign readiness and explicit economic acknowledgement', () => {
    expect(validateDailyLoginStageTransition({
      acknowledgeEconomicImpact: true,
      campaignReady: false,
      currentStageId: 0,
      itemReconciliationReady: false,
      nextStageId: 1,
    })).toMatchObject({ ok: false, code: 'CAMPAIGN_NOT_READY' });
    expect(validateDailyLoginStageTransition({
      acknowledgeEconomicImpact: false,
      campaignReady: true,
      currentStageId: 0,
      itemReconciliationReady: false,
      nextStageId: 1,
    })).toMatchObject({ ok: false, code: 'ECONOMIC_ACKNOWLEDGEMENT_REQUIRED' });
  });

  it('forbids skipped stages and gates item rewards on reconciliation', () => {
    expect(validateDailyLoginStageTransition({
      acknowledgeEconomicImpact: true,
      campaignReady: true,
      currentStageId: 0,
      itemReconciliationReady: true,
      nextStageId: 2,
    })).toMatchObject({ ok: false, code: 'STAGE_SKIP_FORBIDDEN' });
    expect(validateDailyLoginStageTransition({
      acknowledgeEconomicImpact: true,
      campaignReady: true,
      currentStageId: 1,
      itemReconciliationReady: false,
      nextStageId: 2,
    })).toMatchObject({ ok: false, code: 'ITEM_RECONCILIATION_REQUIRED' });
    expect(validateDailyLoginStageTransition({
      acknowledgeEconomicImpact: true,
      campaignReady: true,
      currentStageId: 2,
      itemReconciliationReady: false,
      nextStageId: 0,
    })).toMatchObject({ ok: true, value: { name: 'dark' } });
  });
});
