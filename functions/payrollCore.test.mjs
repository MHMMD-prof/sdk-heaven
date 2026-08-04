import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildPayrollReward,
  createPayrollCycleId,
  evaluatePayrollQualification,
  normalizePayrollPlan,
  projectPayrollCost,
} = require('./payrollCore');

const plan = {
  category: 'female-host',
  currency: 'diamonds',
  dailyMinimumMinutes: 120,
  enabled: true,
  effectiveFromCycleId: 'weekly_2026-08-03_asia-baghdad',
  muteGraceMinutes: 5,
  name: { ar: 'راتب المضيفات', en: 'Female hosts' },
  planId: 'female-hosts',
  requiredWeekdays: [1, 2, 3, 4, 5, 6, 7],
  revision: 1,
  schemaVersion: 1,
  timeZone: 'Asia/Baghdad',
  weeklyAmount: 700,
};
const enrollment = {
  effectiveFromCycleId: 'weekly_2026-08-03_asia-baghdad',
  endAtMillis: 0,
  planId: 'female-hosts',
  schemaVersion: 1,
  startAtMillis: 0,
  state: 'active',
  uid: 'user-1',
  weeklyAmountOverride: 900,
};
const days = Array.from({ length: 7 }, (_, index) => ({
  dayId: `day-${index + 1}`,
  excusedMillis: 0,
  qualifiedMillis: 120 * 60_000,
  weekday: index + 1,
}));

describe('payrollCore', () => {
  it('validates a fixed five-minute trusted-attendance plan', () => {
    expect(normalizePayrollPlan(plan)).toMatchObject({ ok: true });
    expect(normalizePayrollPlan({ ...plan, muteGraceMinutes: 10 })).toEqual({ ok: false, code: 'INVALID_PLAN' });
    expect(normalizePayrollPlan({ ...plan, requiredWeekdays: [1, 1] })).toEqual({ ok: false, code: 'INVALID_PLAN' });
  });

  it('requires every configured day and distinguishes missed from insufficient time', () => {
    const eligible = evaluatePayrollQualification({
      attendanceDays: days,
      deviceEnrollment: { state: 'active', uid: 'user-1' },
      enrollment,
      plan,
      profile: { gender: 'female' },
    });
    expect(eligible).toMatchObject({ ok: true, value: { amount: 900, qualified: true, result: 'eligible' } });
    expect(evaluatePayrollQualification({
      attendanceDays: days.map((day, index) => index === 3 ? { ...day, qualifiedMillis: 0 } : day),
      deviceEnrollment: { state: 'active', uid: 'user-1' },
      enrollment,
      plan,
      profile: { gender: 'female' },
    })).toMatchObject({ value: { result: 'missed-day' } });
    expect(evaluatePayrollQualification({
      attendanceDays: days.map((day, index) => index === 3 ? { ...day, qualifiedMillis: 119 * 60_000 } : day),
      deviceEnrollment: { state: 'active', uid: 'user-1' },
      enrollment,
      plan,
      profile: { gender: 'female' },
    })).toMatchObject({ value: { result: 'insufficient-time' } });
  });

  it('supports audited day exceptions, holds, suspensions, and device conflict', () => {
    const missed = days.map((day, index) => index === 2 ? { ...day, qualifiedMillis: 0 } : day);
    expect(evaluatePayrollQualification({
      attendanceDays: missed,
      deviceEnrollment: { state: 'active', uid: 'user-1' },
      enrollment,
      exceptions: [{ active: true, dayId: 'day-3', kind: 'excused-day' }],
      plan,
      profile: { gender: 'female' },
    })).toMatchObject({ value: { qualified: true } });
    expect(evaluatePayrollQualification({ attendanceDays: days, enrollment, hold: { active: true }, plan }))
      .toMatchObject({ value: { result: 'held' } });
    expect(evaluatePayrollQualification({ attendanceDays: days, enrollment: { ...enrollment, state: 'suspended' }, plan }))
      .toMatchObject({ value: { result: 'suspended' } });
    expect(evaluatePayrollQualification({ attendanceDays: days, enrollment, plan }))
      .toMatchObject({ value: { result: 'profile-ineligible' } });
    expect(evaluatePayrollQualification({
      attendanceDays: days,
      enrollment,
      plan,
      profile: { gender: 'female' },
    })).toMatchObject({ value: { result: 'device-conflict' } });
    expect(evaluatePayrollQualification({
      attendanceDays: days,
      deviceEnrollment: { state: 'active', uid: 'user-1' },
      enrollment,
      plan,
      profile: { gender: 'male' },
    })).toMatchObject({ value: { result: 'profile-ineligible' } });
  });

  it('builds deterministic cycle scope, rewards, and projected liability', () => {
    expect(createPayrollCycleId('female-hosts', 'weekly_2026-08-03_asia-baghdad')).toMatch(/^prc_[a-f0-9]{40}$/);
    expect(buildPayrollReward(plan, enrollment)).toMatchObject({ ok: true, value: { diamonds: 900 } });
    expect(projectPayrollCost(plan, [enrollment, { ...enrollment, uid: 'user-2', weeklyAmountOverride: 0 }]))
      .toEqual({ amount: 1600, currency: 'diamonds', enrollmentCount: 2 });
  });
});
