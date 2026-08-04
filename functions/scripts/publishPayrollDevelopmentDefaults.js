const admin = require('firebase-admin');

const { normalizePayrollAdminMutation } = require('../payrollCore');
const { mutateAdminPayroll } = require('../payrollService');
const {
  DEFAULT_INCENTIVE_TIME_ZONE,
  WEEK_MS,
  createWeeklyCycle,
} = require('../weeklyIncentiveCore');

const OWNER_UID = 'loVyyTeaNOQTJNSaNyOgtrVTB622';
const PLANS = Object.freeze([
  {
    category: 'super-admin',
    dailyMinimumMinutes: 60,
    name: { ar: 'سوبر أدمن — إعداد تجريبي', en: 'Super Admin — Development' },
    planId: 'super-admins',
    weeklyAmount: 500,
  },
  {
    category: 'employee',
    dailyMinimumMinutes: 60,
    name: { ar: 'موظفو التطبيق — إعداد تجريبي', en: 'Employees — Development' },
    planId: 'employees',
    weeklyAmount: 400,
  },
  {
    category: 'female-host',
    dailyMinimumMinutes: 120,
    name: { ar: 'المضيفات — إعداد تجريبي', en: 'Female Hosts — Development' },
    planId: 'female-hosts',
    weeklyAmount: 700,
  },
]);
const ENROLLMENTS = Object.freeze([
  { planId: 'employees', uid: 'qLaisDcEGpcp5XIJ8XqHpigZqDJ3' },
  { planId: 'super-admins', uid: 'oyYzJ9D5SdPpwTCEHS6SMXIaiNo2' },
]);

admin.initializeApp();

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  if (!process.argv.includes('--apply')) {
    throw new Error('Publishing payroll development defaults requires explicit --apply.');
  }
  const db = admin.firestore();
  const [ownerProfile, plans, enrollments] = await Promise.all([
    db.doc(`adminProfiles/${OWNER_UID}`).get(),
    db.collection('payrollPlans').limit(1).get(),
    db.collection('payrollEnrollments').limit(1).get(),
  ]);
  if (
    !ownerProfile.exists
    || ownerProfile.data()?.role !== 'owner'
    || ownerProfile.data()?.status !== 'active'
  ) {
    throw new Error('The configured Platform Owner is not active.');
  }
  if (!plans.empty || !enrollments.empty) {
    throw new Error('Payroll configuration already exists. Use the dashboard for later revisions.');
  }
  const owner = await admin.auth().getUser(OWNER_UID);
  const decodedToken = { email: owner.email || '', uid: OWNER_UID };
  const nowMillis = Date.now();
  const nextCycle = createWeeklyCycle({
    nowMillis: nowMillis + WEEK_MS,
    timeZone: DEFAULT_INCENTIVE_TIME_ZONE,
  });
  if (!nextCycle.ok) throw new Error(nextCycle.code);
  const clock = {
    nowMillis: () => nowMillis,
    timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
  };
  const fieldValue = admin.firestore.FieldValue;
  const results = { enrollments: [], plans: [] };

  for (const value of PLANS) {
    const input = requireValid(normalizePayrollAdminMutation({
      operation: 'upsert-plan',
      plan: {
        ...value,
        currency: 'diamonds',
        effectiveFromCycleId: nextCycle.value.cycleId,
        enabled: true,
        muteGraceMinutes: 5,
        requiredWeekdays: [1, 2, 3, 4, 5, 6, 7],
        revision: 1,
        schemaVersion: 1,
        timeZone: DEFAULT_INCENTIVE_TIME_ZONE,
      },
      reason: 'Initial report-only development defaults',
      requestId: `wave10_payroll_plan_${value.planId}`,
    }), `Payroll plan ${value.planId}`);
    const result = await mutateAdminPayroll({ clock, db, decodedToken, fieldValue, input });
    if (result.errorCode) throw new Error(`${value.planId}: ${result.errorCode}`);
    results.plans.push({
      dailyMinimumMinutes: value.dailyMinimumMinutes,
      planId: value.planId,
      weeklyAmount: value.weeklyAmount,
    });
  }

  for (const value of ENROLLMENTS) {
    const input = requireValid(normalizePayrollAdminMutation({
      enrollment: {
        effectiveFromCycleId: nextCycle.value.cycleId,
        endAtMillis: 0,
        planId: value.planId,
        schemaVersion: 1,
        startAtMillis: nowMillis,
        state: 'active',
        uid: value.uid,
        weeklyAmountOverride: 0,
      },
      operation: 'enroll',
      reason: 'Report-only development enrollment',
      requestId: `wave10_payroll_enroll_${value.planId}`,
      uid: value.uid,
    }), `Payroll enrollment ${value.uid}`);
    const result = await mutateAdminPayroll({ clock, db, decodedToken, fieldValue, input });
    if (result.errorCode) throw new Error(`${value.uid}: ${result.errorCode}`);
    results.enrollments.push(value);
  }

  console.info(JSON.stringify({
    currency: 'diamonds',
    effectiveFromCycleId: nextCycle.value.cycleId,
    femaleHostEnrollmentDeferred: true,
    muteGraceMinutes: 5,
    payoutsEnabled: false,
    requiredWeekdays: [1, 2, 3, 4, 5, 6, 7],
    ...results,
  }, null, 2));
}

function requireValid(result, label) {
  if (!result.ok) throw new Error(`${label} is invalid: ${result.code}`);
  return result.value;
}
