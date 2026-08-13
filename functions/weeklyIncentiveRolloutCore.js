'use strict';

/**
 * Weekly room incentives rollout stages (Wave 10 baseline + Wave 4 live payouts).
 *
 * Stages 0–4 are report/tracking only (no economic payouts).
 * Stages 5–7 are economic and **accumulate** prior payout flags so advancing
 * never silently disables an earlier payout rail.
 *
 * Runtime: `appRuntime/weeklyIncentiveRollout`
 * Flag patches: `appConfig/voiceRoomFeatures`
 */

const WEEKLY_INCENTIVE_FLAG_NAMES = Object.freeze([
  'voice_room_attendance_device_attestation',
  'voice_room_attendance_shadow',
  'voice_room_owner_target_payouts',
  'voice_room_owner_targets',
  'voice_room_payroll_payouts',
  'voice_room_payroll_tracking',
  'voice_room_rocket_rewards',
  'voice_room_supporter_rankings',
]);

const DARK_FLAGS = Object.freeze(Object.fromEntries(
  WEEKLY_INCENTIVE_FLAG_NAMES.map((name) => [name, false]),
));

const TRACKING_BASE = Object.freeze({
  voice_room_attendance_shadow: true,
  voice_room_owner_targets: true,
  voice_room_payroll_tracking: true,
  voice_room_supporter_rankings: true,
});

const WEEKLY_INCENTIVE_ROLLOUT_STAGES = Object.freeze([
  stage(0, 'dark', {}),
  stage(1, 'rankings-shadow-readout', { voice_room_supporter_rankings: true }),
  stage(2, 'attendance-report-only', {
    voice_room_attendance_shadow: true,
    voice_room_supporter_rankings: true,
  }),
  stage(3, 'room-target-preview', {
    voice_room_attendance_shadow: true,
    voice_room_owner_targets: true,
    voice_room_supporter_rankings: true,
  }),
  stage(4, 'payroll-report-only', { ...TRACKING_BASE }),
  // Wave 4 economic ladder — each stage keeps earlier payout rails on.
  stage(5, 'rocket-synthetic-payout', {
    ...TRACKING_BASE,
    voice_room_rocket_rewards: true,
  }, true),
  stage(6, 'target-synthetic-payout', {
    ...TRACKING_BASE,
    voice_room_owner_target_payouts: true,
    voice_room_rocket_rewards: true,
  }, true),
  stage(7, 'payroll-synthetic-payout', {
    ...TRACKING_BASE,
    voice_room_owner_target_payouts: true,
    voice_room_payroll_payouts: true,
    voice_room_rocket_rewards: true,
  }, true),
]);

function stage(id, name, patch, economic = false) {
  return Object.freeze({
    economic,
    flags: Object.freeze({ ...DARK_FLAGS, ...patch }),
    id,
    name,
  });
}

function resolveWeeklyIncentiveRolloutStage(value) {
  const id = typeof value === 'number' ? value : Number(value);
  return WEEKLY_INCENTIVE_ROLLOUT_STAGES.find((candidate) => candidate.id === id) || null;
}

function resolveWeeklyIncentiveRolloutStageByName(name) {
  const normalized = typeof name === 'string' ? name.trim() : '';
  return WEEKLY_INCENTIVE_ROLLOUT_STAGES.find((candidate) => candidate.name === normalized) || null;
}

function validateWeeklyIncentiveStageTransition({ acknowledgeEconomicImpact = false, currentStageId, nextStageId }) {
  const current = resolveWeeklyIncentiveRolloutStage(currentStageId);
  const next = resolveWeeklyIncentiveRolloutStage(nextStageId);
  if (!current || !next) return { code: 'INVALID_STAGE', ok: false };
  if (next.id === current.id) return { ok: true, value: next, noop: true };
  if (next.id === 0) return { ok: true, value: next, rollback: true };
  if (next.id !== current.id + 1) return { code: 'NON_SEQUENTIAL_STAGE', ok: false };
  if (next.economic && acknowledgeEconomicImpact !== true) return { code: 'ECONOMIC_ACK_REQUIRED', ok: false };
  return { ok: true, value: next };
}

function summarizeWeeklyIncentivePayoutReadiness(flags = {}) {
  return {
    ownerTargetPayouts: flags.voice_room_owner_target_payouts === true,
    payrollPayouts: flags.voice_room_payroll_payouts === true,
    payrollTracking: flags.voice_room_payroll_tracking === true,
    rocketRewards: flags.voice_room_rocket_rewards === true,
    roomTargets: flags.voice_room_owner_targets === true,
    supporterRankings: flags.voice_room_supporter_rankings === true,
  };
}

module.exports = {
  DARK_FLAGS,
  WEEKLY_INCENTIVE_FLAG_NAMES,
  WEEKLY_INCENTIVE_ROLLOUT_STAGES,
  resolveWeeklyIncentiveRolloutStage,
  resolveWeeklyIncentiveRolloutStageByName,
  summarizeWeeklyIncentivePayoutReadiness,
  validateWeeklyIncentiveStageTransition,
};
