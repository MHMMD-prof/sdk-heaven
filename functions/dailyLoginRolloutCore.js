const DAILY_LOGIN_ROLLOUT_STAGES = Object.freeze([
  Object.freeze({
    economic: false,
    flags: Object.freeze({
      daily_login_reward_items: false,
      daily_login_rewards: false,
    }),
    name: 'dark',
    stageId: 0,
  }),
  Object.freeze({
    economic: true,
    flags: Object.freeze({
      daily_login_reward_items: false,
      daily_login_rewards: true,
    }),
    name: 'currency-only',
    stageId: 1,
  }),
  Object.freeze({
    economic: true,
    flags: Object.freeze({
      daily_login_reward_items: true,
      daily_login_rewards: true,
    }),
    name: 'currency-and-items',
    stageId: 2,
  }),
]);

function resolveDailyLoginRolloutStage(stageId) {
  return DAILY_LOGIN_ROLLOUT_STAGES.find((stage) => stage.stageId === stageId);
}

function validateDailyLoginStageTransition({
  acknowledgeEconomicImpact,
  campaignReady,
  currentStageId,
  itemReconciliationReady,
  nextStageId,
}) {
  const current = resolveDailyLoginRolloutStage(currentStageId);
  const next = resolveDailyLoginRolloutStage(nextStageId);
  if (!current || !next) return { ok: false, code: 'STAGE_INVALID' };
  if (nextStageId > currentStageId + 1) return { ok: false, code: 'STAGE_SKIP_FORBIDDEN' };
  if (nextStageId > 0 && campaignReady !== true) return { ok: false, code: 'CAMPAIGN_NOT_READY' };
  if (next.economic && acknowledgeEconomicImpact !== true) {
    return { ok: false, code: 'ECONOMIC_ACKNOWLEDGEMENT_REQUIRED' };
  }
  if (nextStageId === 2 && itemReconciliationReady !== true) {
    return { ok: false, code: 'ITEM_RECONCILIATION_REQUIRED' };
  }
  return { ok: true, value: next };
}

module.exports = {
  DAILY_LOGIN_ROLLOUT_STAGES,
  resolveDailyLoginRolloutStage,
  validateDailyLoginStageTransition,
};
