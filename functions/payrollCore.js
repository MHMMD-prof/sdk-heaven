const crypto = require('node:crypto');

const { normalizeRewardBundle } = require('./weeklyIncentiveCore');

const PAYROLL_SCHEMA_VERSION = 1;
const PAYROLL_CATEGORIES = Object.freeze(['super-admin', 'employee', 'female-host']);
const PAYROLL_ENROLLMENT_STATES = Object.freeze(['active', 'suspended', 'ended']);
const PAYROLL_OUTCOMES = Object.freeze([
  'eligible',
  'paid',
  'missed-day',
  'insufficient-time',
  'suspended',
  'profile-ineligible',
  'device-conflict',
  'held',
  'failed',
]);

function normalizePayrollPlan(input) {
  if (!isObject(input) || unknownKeys(input, [
    'category',
    'currency',
    'dailyMinimumMinutes',
    'enabled',
    'effectiveFromCycleId',
    'muteGraceMinutes',
    'name',
    'planId',
    'requiredWeekdays',
    'revision',
    'schemaVersion',
    'timeZone',
    'weeklyAmount',
  ])) return invalid('INVALID_PLAN');
  const planId = identifier(input.planId, 120);
  const effectiveFromCycleId = identifier(input.effectiveFromCycleId, 120);
  const name = normalizeName(input.name);
  const weekdays = normalizeWeekdays(input.requiredWeekdays);
  if (
    !planId
    || !effectiveFromCycleId
    || !name
    || !PAYROLL_CATEGORIES.includes(input.category)
    || !['coins', 'diamonds'].includes(input.currency)
    || !positiveAmount(input.weeklyAmount)
    || !Number.isSafeInteger(input.dailyMinimumMinutes)
    || input.dailyMinimumMinutes < 1
    || input.dailyMinimumMinutes > 24 * 60
    || !weekdays
    || input.muteGraceMinutes !== 5
    || !validTimeZone(input.timeZone)
    || typeof input.enabled !== 'boolean'
    || !Number.isSafeInteger(input.revision)
    || input.revision < 1
    || input.schemaVersion !== PAYROLL_SCHEMA_VERSION
  ) return invalid('INVALID_PLAN');
  return {
    ok: true,
    value: {
      category: input.category,
      currency: input.currency,
      dailyMinimumMinutes: input.dailyMinimumMinutes,
      enabled: input.enabled,
      effectiveFromCycleId,
      muteGraceMinutes: 5,
      name,
      planId,
      requiredWeekdays: weekdays,
      revision: input.revision,
      schemaVersion: PAYROLL_SCHEMA_VERSION,
      timeZone: input.timeZone,
      weeklyAmount: input.weeklyAmount,
    },
  };
}

function normalizePayrollEnrollment(input) {
  if (!isObject(input) || unknownKeys(input, [
    'effectiveFromCycleId',
    'endAtMillis',
    'planId',
    'schemaVersion',
    'startAtMillis',
    'state',
    'uid',
    'weeklyAmountOverride',
  ])) return invalid('INVALID_ENROLLMENT');
  const uid = identifier(input.uid, 128);
  const planId = identifier(input.planId, 120);
  const effectiveFromCycleId = identifier(input.effectiveFromCycleId, 120);
  const weeklyAmountOverride = input.weeklyAmountOverride === undefined
    ? 0
    : input.weeklyAmountOverride;
  const startAtMillis = input.startAtMillis === undefined ? 0 : input.startAtMillis;
  const endAtMillis = input.endAtMillis === undefined ? 0 : input.endAtMillis;
  if (
    !uid
    || !planId
    || !effectiveFromCycleId
    || !PAYROLL_ENROLLMENT_STATES.includes(input.state)
    || !nonNegativeAmount(weeklyAmountOverride)
    || !nonNegativeMillis(startAtMillis)
    || !nonNegativeMillis(endAtMillis)
    || endAtMillis && startAtMillis && endAtMillis <= startAtMillis
    || input.schemaVersion !== PAYROLL_SCHEMA_VERSION
  ) return invalid('INVALID_ENROLLMENT');
  return {
    ok: true,
    value: {
      effectiveFromCycleId,
      endAtMillis,
      planId,
      schemaVersion: PAYROLL_SCHEMA_VERSION,
      startAtMillis,
      state: input.state,
      uid,
      weeklyAmountOverride,
    },
  };
}

function normalizePayrollAdminMutation(input) {
  if (!isObject(input)) return invalid('INVALID_MUTATION');
  const operation = input.operation;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  const requestId = identifier(input.requestId, 100);
  if (
    !['upsert-plan', 'enroll', 'suspend', 'resume', 'end', 'hold', 'release-hold', 'excuse-day'].includes(operation)
    || reason.length < 3
    || reason.length > 500
    || !requestId
  ) return invalid('INVALID_MUTATION');
  if (operation === 'upsert-plan') {
    const plan = normalizePayrollPlan(input.plan);
    return plan.ok ? { ok: true, value: { operation, plan: plan.value, reason, requestId } } : plan;
  }
  const uid = identifier(input.uid, 128);
  if (!uid) return invalid('INVALID_MUTATION');
  if (operation === 'enroll') {
    const enrollment = normalizePayrollEnrollment(input.enrollment);
    if (!enrollment.ok || enrollment.value.uid !== uid) return invalid('INVALID_ENROLLMENT');
    return { ok: true, value: { enrollment: enrollment.value, operation, reason, requestId, uid } };
  }
  if (operation === 'excuse-day') {
    const cycleId = identifier(input.cycleId, 120);
    const dayId = identifier(input.dayId, 120);
    if (!cycleId || !dayId) return invalid('INVALID_MUTATION');
    return { ok: true, value: { cycleId, dayId, operation, reason, requestId, uid } };
  }
  return { ok: true, value: { operation, reason, requestId, uid } };
}

function evaluatePayrollQualification({
  attendanceDays,
  deviceEnrollment,
  enrollment,
  exceptions = [],
  hold,
  plan,
  profile,
}) {
  const normalizedPlan = normalizePayrollPlan(plan);
  const normalizedEnrollment = normalizePayrollEnrollment(enrollment);
  if (!normalizedPlan.ok || !normalizedEnrollment.ok) return invalid('FAILED');
  const planValue = normalizedPlan.value;
  const enrollmentValue = normalizedEnrollment.value;
  const base = {
    amount: enrollmentValue.weeklyAmountOverride || planValue.weeklyAmount,
    currency: planValue.currency,
    daily: [],
    planId: planValue.planId,
    uid: enrollmentValue.uid,
  };
  if (enrollmentValue.state !== 'active' || profile?.payrollSuspended === true) {
    return outcome(base, 'suspended');
  }
  if (hold?.active === true) return outcome(base, 'held');
  if (planValue.category === 'female-host' && profile?.gender !== 'female') {
    return outcome(base, 'profile-ineligible');
  }
  if (
    planValue.category === 'female-host'
    && (
      deviceEnrollment?.state !== 'active'
      || deviceEnrollment?.conflict === true
      || deviceEnrollment?.uid !== enrollmentValue.uid
    )
  ) return outcome(base, 'device-conflict');

  const excused = new Set(exceptions
    .filter((item) => item?.active !== false && item?.kind === 'excused-day')
    .map((item) => item.dayId));
  let failure = '';
  for (const weekday of planValue.requiredWeekdays) {
    const day = attendanceDays.find((candidate) => candidate.weekday === weekday);
    const qualifiedMinutes = Math.floor((day?.qualifiedMillis || 0) / 60_000);
    const outageExcusedMinutes = Math.floor((day?.excusedMillis || 0) / 60_000);
    const manuallyExcused = Boolean(day?.dayId && excused.has(day.dayId));
    const totalMinutes = manuallyExcused
      ? planValue.dailyMinimumMinutes
      : qualifiedMinutes + outageExcusedMinutes;
    const met = totalMinutes >= planValue.dailyMinimumMinutes;
    base.daily.push({
      dayId: day?.dayId || `weekday-${weekday}`,
      manuallyExcused,
      met,
      outageExcusedMinutes,
      qualifiedMinutes,
      requiredMinutes: planValue.dailyMinimumMinutes,
      weekday,
    });
    if (!met && !failure) failure = totalMinutes === 0 ? 'missed-day' : 'insufficient-time';
  }
  return outcome(base, failure || 'eligible');
}

function createPayrollCycleId(planId, cycleId) {
  if (!identifier(planId, 120) || !identifier(cycleId, 120)) return '';
  return `prc_${digest({ cycleId, planId })}`;
}

function createPayrollOutcomeId(cycleId, planId, uid) {
  if (!identifier(cycleId, 120) || !identifier(planId, 120) || !identifier(uid, 128)) return '';
  return `pro_${digest({ cycleId, planId, uid })}`;
}

function buildPayrollReward(plan, enrollment) {
  const normalizedPlan = normalizePayrollPlan(plan);
  const normalizedEnrollment = normalizePayrollEnrollment(enrollment);
  if (!normalizedPlan.ok || !normalizedEnrollment.ok) return invalid('INVALID_REWARD');
  const amount = normalizedEnrollment.value.weeklyAmountOverride || normalizedPlan.value.weeklyAmount;
  return normalizeRewardBundle({
    coins: normalizedPlan.value.currency === 'coins' ? amount : 0,
    diamonds: normalizedPlan.value.currency === 'diamonds' ? amount : 0,
    items: [],
    schemaVersion: PAYROLL_SCHEMA_VERSION,
  });
}

function projectPayrollCost(plan, enrollments) {
  const normalized = normalizePayrollPlan(plan);
  if (!normalized.ok) return { amount: 0, currency: '', enrollmentCount: 0 };
  const active = (Array.isArray(enrollments) ? enrollments : [])
    .map(normalizePayrollEnrollment)
    .filter((item) => item.ok && item.value.planId === normalized.value.planId && item.value.state === 'active');
  return {
    amount: active.reduce((sum, item) => sum + (item.value.weeklyAmountOverride || normalized.value.weeklyAmount), 0),
    currency: normalized.value.currency,
    enrollmentCount: active.length,
  };
}

function outcome(base, result) {
  return {
    ok: true,
    value: {
      ...base,
      qualified: result === 'eligible' || result === 'paid',
      result,
      schemaVersion: PAYROLL_SCHEMA_VERSION,
    },
  };
}

function normalizeName(value) {
  if (!isObject(value) || unknownKeys(value, ['ar', 'en'])) return undefined;
  const ar = typeof value.ar === 'string' ? value.ar.trim() : '';
  const en = typeof value.en === 'string' ? value.en.trim() : '';
  return ar.length >= 2 && ar.length <= 80 && en.length >= 2 && en.length <= 80 ? { ar, en } : undefined;
}

function normalizeWeekdays(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 7) return undefined;
  const result = [...new Set(value)];
  return result.length === value.length && result.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    ? result.sort((a, b) => a - b)
    : undefined;
}

function validTimeZone(value) {
  if (typeof value !== 'string' || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function identifier(value, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= max && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(text) ? text : '';
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 40);
}

function positiveAmount(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000;
}

function nonNegativeAmount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
}

function nonNegativeMillis(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function unknownKeys(value, allowed) {
  return Object.keys(value).some((key) => !allowed.includes(key));
}

function invalid(code) {
  return { ok: false, code };
}

module.exports = {
  PAYROLL_CATEGORIES,
  PAYROLL_ENROLLMENT_STATES,
  PAYROLL_OUTCOMES,
  PAYROLL_SCHEMA_VERSION,
  buildPayrollReward,
  createPayrollCycleId,
  createPayrollOutcomeId,
  evaluatePayrollQualification,
  normalizePayrollAdminMutation,
  normalizePayrollEnrollment,
  normalizePayrollPlan,
  projectPayrollCost,
};
