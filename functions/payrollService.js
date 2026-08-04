const crypto = require('node:crypto');

const {
  buildPayrollReward,
  createPayrollCycleId,
  createPayrollOutcomeId,
  evaluatePayrollQualification,
  normalizePayrollEnrollment,
  normalizePayrollPlan,
  projectPayrollCost,
} = require('./payrollCore');
const {
  DEFAULT_INCENTIVE_TIME_ZONE,
  WEEK_MS,
  createDailyBucket,
  createSettlementId,
  createWeeklyCycle,
  timestampToMillis,
} = require('./weeklyIncentiveCore');
const { splitAndUnionAttendanceIntervals } = require('./roomAttendanceCore');
const {
  enqueueWeeklyIncentiveSettlement,
  reconcileWeeklyIncentiveSettlement,
} = require('./weeklyIncentiveService');

const MAX_PLANS = 50;
const MAX_ENROLLMENTS = 2_000;

async function mutateAdminPayroll({ clock, db, decodedToken, fieldValue, input }) {
  const commandRef = db.doc(`payrollAdminCommands/${input.requestId}`);
  const auditRef = db.doc(`adminAuditEvents/payroll_${input.requestId}`);
  const nextCycle = createWeeklyCycle({
    nowMillis: clock.nowMillis() + WEEK_MS,
    timeZone: DEFAULT_INCENTIVE_TIME_ZONE,
  });
  if (!nextCycle.ok) return { errorCode: nextCycle.code };

  if (input.operation === 'upsert-plan') {
    if (input.plan.effectiveFromCycleId !== nextCycle.value.cycleId) {
      return { errorCode: 'NEXT_CYCLE_REQUIRED' };
    }
    return db.runTransaction(async (transaction) => {
      const planRef = db.doc(`payrollPlans/${input.plan.planId}`);
      const [commandSnapshot, planSnapshot] = await Promise.all([
        transaction.get(commandRef),
        transaction.get(planRef),
      ]);
      if (commandSnapshot.exists) return replayCommand(commandSnapshot, decodedToken.uid, input.operation);
      const previous = planSnapshot.exists ? planSnapshot.data() : {};
      const currentRevision = Math.max(
        Number(previous.currentConfig?.revision) || 0,
        Number(previous.pendingConfig?.revision) || 0,
      );
      if (input.plan.revision !== currentRevision + 1) return { errorCode: 'REVISION_CONFLICT' };
      const timestamp = fieldValue.serverTimestamp();
      transaction.set(planRef, {
        currentConfig: previous.currentConfig || null,
        pendingConfig: input.plan,
        planId: input.plan.planId,
        schemaVersion: 1,
        updatedAt: timestamp,
        updatedBy: decodedToken.uid,
      }, { merge: true });
      writeCommandAndAudit({
        auditRef,
        commandRef,
        decodedToken,
        entityId: input.plan.planId,
        fieldValue,
        input,
        transaction,
      });
      return { auditId: auditRef.id, effectiveFromCycleId: nextCycle.value.cycleId, replayed: false };
    });
  }

  if (input.operation === 'enroll') {
    if (input.enrollment.effectiveFromCycleId !== nextCycle.value.cycleId) {
      return { errorCode: 'NEXT_CYCLE_REQUIRED' };
    }
    const [planSnapshot, profileSnapshot] = await Promise.all([
      db.doc(`payrollPlans/${input.enrollment.planId}`).get(),
      db.doc(`publicProfiles/${input.uid}`).get(),
    ]);
    const plan = resolveConfigForCycle(planSnapshot.data(), nextCycle.value.cycleId);
    if (!plan || !normalizePayrollPlan(plan).ok) return { errorCode: 'PLAN_NOT_FOUND' };
    if (!profileSnapshot.exists) return { errorCode: 'PROFILE_NOT_FOUND' };
    if (plan.category === 'female-host' && profileSnapshot.data()?.gender !== 'female') {
      return { errorCode: 'FEMALE_PROFILE_REQUIRED' };
    }
    return db.runTransaction(async (transaction) => {
      const enrollmentRef = db.doc(`payrollEnrollments/${input.uid}`);
      const [commandSnapshot, enrollmentSnapshot] = await Promise.all([
        transaction.get(commandRef),
        transaction.get(enrollmentRef),
      ]);
      if (commandSnapshot.exists) return replayCommand(commandSnapshot, decodedToken.uid, input.operation);
      const timestamp = fieldValue.serverTimestamp();
      transaction.set(enrollmentRef, {
        currentConfig: enrollmentSnapshot.data()?.currentConfig || null,
        pendingConfig: input.enrollment,
        schemaVersion: 1,
        uid: input.uid,
        updatedAt: timestamp,
        updatedBy: decodedToken.uid,
      }, { merge: true });
      writeCommandAndAudit({
        auditRef,
        commandRef,
        decodedToken,
        entityId: input.uid,
        fieldValue,
        input,
        transaction,
      });
      return { auditId: auditRef.id, effectiveFromCycleId: nextCycle.value.cycleId, replayed: false };
    });
  }

  if (input.operation === 'hold' || input.operation === 'release-hold') {
    const result = await db.runTransaction(async (transaction) => {
      const holdRef = db.doc(`weeklyIncentiveHolds/${input.uid}`);
      const commandSnapshot = await transaction.get(commandRef);
      if (commandSnapshot.exists) return replayCommand(commandSnapshot, decodedToken.uid, input.operation);
      const timestamp = fieldValue.serverTimestamp();
      transaction.set(holdRef, {
        active: input.operation === 'hold',
        feature: 'payroll',
        reason: input.reason,
        schemaVersion: 1,
        uid: input.uid,
        updatedAt: timestamp,
        updatedBy: decodedToken.uid,
      }, { merge: true });
      writeCommandAndAudit({
        auditRef,
        commandRef,
        decodedToken,
        entityId: input.uid,
        fieldValue,
        input,
        transaction,
      });
      return { auditId: auditRef.id, replayed: false };
    });
    if (input.operation === 'release-hold' && !result.errorCode) {
      await releasePayrollSettlementHolds({ db, fieldValue, uid: input.uid });
    }
    return result;
  }

  if (input.operation === 'excuse-day') {
    const activeCycle = createWeeklyCycle({
      nowMillis: clock.nowMillis(),
      timeZone: DEFAULT_INCENTIVE_TIME_ZONE,
    });
    if (!activeCycle.ok || input.cycleId !== activeCycle.value.cycleId) {
      return { errorCode: 'ACTIVE_CYCLE_REQUIRED' };
    }
    return db.runTransaction(async (transaction) => {
      const exceptionId = hashId(`${input.cycleId}\0${input.uid}\0${input.dayId}`);
      const exceptionRef = db.doc(`payrollExceptions/${exceptionId}`);
      const commandSnapshot = await transaction.get(commandRef);
      if (commandSnapshot.exists) return replayCommand(commandSnapshot, decodedToken.uid, input.operation);
      const timestamp = fieldValue.serverTimestamp();
      transaction.set(exceptionRef, {
        active: true,
        createdAt: timestamp,
        createdBy: decodedToken.uid,
        cycleId: input.cycleId,
        dayId: input.dayId,
        exceptionId,
        kind: 'excused-day',
        reason: input.reason,
        schemaVersion: 1,
        uid: input.uid,
      }, { merge: false });
      writeCommandAndAudit({
        auditRef,
        commandRef,
        decodedToken,
        entityId: input.uid,
        fieldValue,
        input,
        transaction,
      });
      return { auditId: auditRef.id, exceptionId, replayed: false };
    });
  }

  return mutateEnrollmentState({
    clock,
    db,
    decodedToken,
    fieldValue,
    input,
    nextCycleId: nextCycle.value.cycleId,
  });
}

async function mutateEnrollmentState({
  clock,
  db,
  decodedToken,
  fieldValue,
  input,
  nextCycleId,
}) {
  const commandRef = db.doc(`payrollAdminCommands/${input.requestId}`);
  const auditRef = db.doc(`adminAuditEvents/payroll_${input.requestId}`);
  return db.runTransaction(async (transaction) => {
    const enrollmentRef = db.doc(`payrollEnrollments/${input.uid}`);
    const [commandSnapshot, enrollmentSnapshot] = await Promise.all([
      transaction.get(commandRef),
      transaction.get(enrollmentRef),
    ]);
    if (commandSnapshot.exists) return replayCommand(commandSnapshot, decodedToken.uid, input.operation);
    if (!enrollmentSnapshot.exists) return { errorCode: 'ENROLLMENT_NOT_FOUND' };
    const document = enrollmentSnapshot.data();
    const current = document.currentConfig || document.pendingConfig;
    const validation = normalizePayrollEnrollment(current);
    if (!validation.ok) return { errorCode: 'ENROLLMENT_INVALID' };
    const targetState = input.operation === 'suspend'
      ? 'suspended'
      : input.operation === 'end'
        ? 'ended'
        : 'active';
    const effectiveFromCycleId = input.operation === 'suspend'
      ? validation.value.effectiveFromCycleId
      : nextCycleId;
    const next = {
      ...validation.value,
      effectiveFromCycleId,
      endAtMillis: input.operation === 'end' ? clock.nowMillis() : 0,
      state: targetState,
    };
    const timestamp = fieldValue.serverTimestamp();
    if (input.operation === 'suspend') {
      transaction.set(enrollmentRef, {
        currentConfig: document.currentConfig ? next : null,
        pendingConfig: document.pendingConfig ? { ...document.pendingConfig, state: 'suspended' } : null,
        updatedAt: timestamp,
        updatedBy: decodedToken.uid,
      }, { merge: true });
    } else {
      transaction.set(enrollmentRef, {
        pendingConfig: next,
        updatedAt: timestamp,
        updatedBy: decodedToken.uid,
      }, { merge: true });
    }
    writeCommandAndAudit({
      auditRef,
      commandRef,
      decodedToken,
      entityId: input.uid,
      fieldValue,
      input,
      transaction,
    });
    return {
      auditId: auditRef.id,
      effectiveFromCycleId: input.operation === 'suspend' ? 'immediate' : nextCycleId,
      replayed: false,
    };
  });
}

async function getAdminPayroll({ clock, db }) {
  const cycle = createWeeklyCycle({ nowMillis: clock.nowMillis(), timeZone: DEFAULT_INCENTIVE_TIME_ZONE });
  const nextCycle = createWeeklyCycle({ nowMillis: clock.nowMillis() + WEEK_MS, timeZone: DEFAULT_INCENTIVE_TIME_ZONE });
  if (!cycle.ok || !nextCycle.ok) throw new Error('INVALID_CYCLE');
  const [planSnapshot, enrollmentSnapshot, outcomeSnapshot] = await Promise.all([
    db.collection('payrollPlans').limit(MAX_PLANS).get(),
    db.collection('payrollEnrollments').limit(MAX_ENROLLMENTS).get(),
    db.collection('payrollOutcomes').orderBy('createdAt', 'desc').limit(100).get(),
  ]);
  const plans = planSnapshot.docs.map((document) => ({
    currentConfig: mapConfig(document.data()?.currentConfig),
    pendingConfig: mapConfig(document.data()?.pendingConfig),
    planId: document.id,
  }));
  const enrollments = enrollmentSnapshot.docs.map((document) => ({
    currentConfig: mapConfig(document.data()?.currentConfig),
    pendingConfig: mapConfig(document.data()?.pendingConfig),
    uid: document.id,
  }));
  const projected = plans.flatMap((planDocument) => {
    const plan = resolveConfigForCycle(planDocument, cycle.value.cycleId);
    if (!plan) return [];
    const activeEnrollments = enrollments.flatMap((item) => {
      const enrollment = resolveConfigForCycle(item, cycle.value.cycleId);
      return enrollment ? [enrollment] : [];
    });
    return [{ planId: plan.planId, ...projectPayrollCost(plan, activeEnrollments) }];
  });
  return {
    cycle: cycle.value,
    nextCycle: nextCycle.value,
    enrollments,
    outcomes: outcomeSnapshot.docs.map((document) => mapOutcome(document.id, document.data())),
    plans,
    projected,
  };
}

async function getPayrollProgress({ clock, db, uid }) {
  const cycle = createWeeklyCycle({ nowMillis: clock.nowMillis(), timeZone: DEFAULT_INCENTIVE_TIME_ZONE });
  if (!cycle.ok) return { errorCode: cycle.code };
  const enrollmentSnapshot = await db.doc(`payrollEnrollments/${uid}`).get();
  if (!enrollmentSnapshot.exists) return { enrolled: false, uid };
  const enrollment = resolveConfigForCycle(enrollmentSnapshot.data(), cycle.value.cycleId);
  if (!enrollment) return { enrolled: false, pending: mapConfig(enrollmentSnapshot.data()?.pendingConfig), uid };
  const planSnapshot = await db.doc(`payrollPlans/${enrollment.planId}`).get();
  const plan = resolveConfigForCycle(planSnapshot.data(), cycle.value.cycleId);
  if (!plan) return { errorCode: 'PLAN_NOT_FOUND' };
  const evidence = await loadPayrollEvidence({ clock, cycle: cycle.value, db, uid });
  const qualification = evaluatePayrollQualification({
    attendanceDays: evidence.attendanceDays,
    deviceEnrollment: evidence.deviceEnrollment,
    enrollment,
    exceptions: evidence.exceptions,
    hold: evidence.hold,
    plan,
    profile: evidence.profile,
  });
  if (!qualification.ok) return { errorCode: qualification.code };
  return {
    cycle: cycle.value,
    enrolled: true,
    plan: publicPlan(plan),
    progress: qualification.value,
    uid,
  };
}

async function processPayrollCycles({ clock, db, fieldValue, limit = 100 }) {
  const featureSnapshot = await db.doc('appConfig/voiceRoomFeatures').get();
  if (featureSnapshot.data()?.voice_room_payroll_tracking !== true) {
    return { processed: 0, reason: 'feature-disabled', settled: 0, snapshotted: 0 };
  }
  const currentCycle = createWeeklyCycle({ nowMillis: clock.nowMillis(), timeZone: DEFAULT_INCENTIVE_TIME_ZONE });
  const priorCycle = createWeeklyCycle({ nowMillis: clock.nowMillis() - WEEK_MS, timeZone: DEFAULT_INCENTIVE_TIME_ZONE });
  if (!currentCycle.ok || !priorCycle.ok) return { errorCode: 'INVALID_CYCLE' };
  const synchronized = await syncPayrollOutcomeBatch({ db, fieldValue, limit: 200 });
  const snapshotted = await snapshotPayrollCycle({
    clock,
    cycle: currentCycle.value,
    db,
    fieldValue,
  });
  const settled = await settlePayrollCycle({
    clock,
    cycle: priorCycle.value,
    db,
    fieldValue,
    limit,
  });
  return {
    processed: settled.processed,
    settled: settled.enqueued,
    snapshotted: snapshotted.created,
    synchronized,
  };
}

async function snapshotPayrollCycle({ cycle, db, fieldValue }) {
  const [planSnapshot, enrollmentSnapshot] = await Promise.all([
    db.collection('payrollPlans').limit(MAX_PLANS).get(),
    db.collection('payrollEnrollments').limit(MAX_ENROLLMENTS).get(),
  ]);
  const plans = new Map();
  let created = 0;
  for (const document of planSnapshot.docs) {
    const config = resolveConfigForCycle(document.data(), cycle.cycleId);
    if (!config || !normalizePayrollPlan(config).ok || config.enabled !== true) continue;
    plans.set(config.planId, config);
    const cycleDocumentId = createPayrollCycleId(config.planId, cycle.cycleId);
    await db.runTransaction(async (transaction) => {
      const cycleRef = db.doc(`payrollCycles/${cycleDocumentId}`);
      const current = await transaction.get(cycleRef);
      if (current.exists) return;
      const timestamp = fieldValue.serverTimestamp();
      transaction.create(cycleRef, {
        createdAt: timestamp,
        cycleId: cycle.cycleId,
        endAt: clock.timestampFromMillis(cycle.endAtMillis),
        planSnapshot: config,
        payrollCycleId: cycleDocumentId,
        schemaVersion: 1,
        startAt: clock.timestampFromMillis(cycle.startAtMillis),
        state: 'active',
        timeZone: cycle.timeZone,
        updatedAt: timestamp,
      });
      created += 1;
    });
  }
  for (const document of enrollmentSnapshot.docs) {
    const config = resolveConfigForCycle(document.data(), cycle.cycleId);
    if (!config || config.state === 'ended' || !plans.has(config.planId)) continue;
    const cycleDocumentId = createPayrollCycleId(config.planId, cycle.cycleId);
    const snapshotRef = db.doc(`payrollCycles/${cycleDocumentId}/enrollments/${config.uid}`);
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(snapshotRef);
      if (existing.exists) return;
      transaction.create(snapshotRef, {
        createdAt: fieldValue.serverTimestamp(),
        enrollmentSnapshot: config,
        schemaVersion: 1,
        uid: config.uid,
      });
      created += 1;
    });
  }
  await promotePendingConfigurations({ cycleId: cycle.cycleId, db, fieldValue, planSnapshot, enrollmentSnapshot });
  return { created };
}

async function promotePendingConfigurations({ cycleId, db, fieldValue, planSnapshot, enrollmentSnapshot }) {
  let batch = db.batch();
  let batchWrites = 0;
  let writes = 0;
  for (const document of [...planSnapshot.docs, ...enrollmentSnapshot.docs]) {
    const pending = document.data()?.pendingConfig;
    if (!pending || pending.effectiveFromCycleId > cycleId) continue;
    batch.set(document.ref, {
      currentConfig: pending,
      pendingConfig: fieldValue.delete(),
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true });
    batchWrites += 1;
    writes += 1;
    if (batchWrites === 400) {
      await batch.commit();
      batch = db.batch();
      batchWrites = 0;
    }
  }
  if (batchWrites) await batch.commit();
}

async function settlePayrollCycle({ clock, cycle, db, fieldValue, limit }) {
  const cycleSnapshot = await db.collection('payrollCycles')
    .where('cycleId', '==', cycle.cycleId)
    .limit(MAX_PLANS)
    .get();
  let enqueued = 0;
  let processed = 0;
  for (const cycleDocument of cycleSnapshot.docs) {
    const cycleData = cycleDocument.data();
    const plan = cycleData.planSnapshot;
    let enrollmentQuery = cycleDocument.ref.collection('enrollments').orderBy('uid').limit(limit);
    if (cycleData.settlementCursorUid) {
      enrollmentQuery = enrollmentQuery.startAfter(cycleData.settlementCursorUid);
    }
    const enrollmentSnapshot = await enrollmentQuery.get();
    for (const enrollmentDocument of enrollmentSnapshot.docs) {
      const enrollment = enrollmentDocument.data()?.enrollmentSnapshot;
      const outcomeId = createPayrollOutcomeId(cycle.cycleId, plan.planId, enrollment?.uid);
      if (!outcomeId) continue;
      const outcomeRef = db.doc(`payrollOutcomes/${outcomeId}`);
      const existing = await outcomeRef.get();
      if (existing.exists) {
        await syncPayrollOutcome({ db, fieldValue, outcomeRef, outcome: existing.data() });
        continue;
      }
      const evidence = await loadPayrollEvidence({ clock, cycle, db, uid: enrollment.uid });
      const qualification = evaluatePayrollQualification({
        attendanceDays: evidence.attendanceDays,
        deviceEnrollment: evidence.deviceEnrollment,
        enrollment,
        exceptions: evidence.exceptions,
        hold: evidence.hold,
        plan,
        profile: evidence.profile,
      });
      if (!qualification.ok) continue;
      const result = qualification.value;
      const timestamp = fieldValue.serverTimestamp();
      let settlementId = '';
      let settlementError = '';
      if (result.qualified) {
        settlementId = createSettlementId({
          cycleId: cycle.cycleId,
          feature: 'payroll',
          planId: plan.planId,
          rank: 0,
          uid: enrollment.uid,
        });
        const reward = buildPayrollReward(plan, enrollment);
        if (reward.ok) {
          const queued = await enqueueWeeklyIncentiveSettlement({
            db,
            fieldValue,
            input: {
              cycleId: cycle.cycleId,
              feature: 'payroll',
              rewardBundle: reward.value,
              settlementId,
              source: { planId: plan.planId, rank: 0, roomId: '' },
              uid: enrollment.uid,
            },
          });
          if (!queued.errorCode) enqueued += 1;
          else settlementError = queued.errorCode;
        } else {
          settlementError = reward.code;
        }
      }
      const created = await db.runTransaction(async (transaction) => {
        const current = await transaction.get(outcomeRef);
        if (current.exists) return false;
        transaction.create(outcomeRef, {
          ...result,
          createdAt: timestamp,
          cycleId: cycle.cycleId,
          ...(settlementError ? { failureCode: settlementError } : {}),
          outcomeId,
          payrollCycleId: cycleDocument.id,
          settlementId,
          state: settlementError ? 'failed' : result.qualified ? 'eligible' : result.result,
          updatedAt: timestamp,
        });
        return true;
      });
      if (created) processed += 1;
    }
    const lastUid = enrollmentSnapshot.docs.at(-1)?.data()?.uid || '';
    await cycleDocument.ref.set({
      ...(lastUid ? { settlementCursorUid: lastUid } : {}),
      state: enrollmentSnapshot.size < limit ? 'settled' : 'settling',
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true });
  }
  return { enqueued, processed };
}

async function syncPayrollOutcome({ db, fieldValue, outcome, outcomeRef }) {
  if (!outcome.settlementId) return;
  const job = await db.doc(`rewardSettlementJobs/${outcome.settlementId}`).get();
  if (!job.exists || job.data()?.state === outcome.state) return;
  const update = {
    failureCode: job.data()?.failureCode || fieldValue.delete(),
    state: job.data()?.state || outcome.state,
    updatedAt: fieldValue.serverTimestamp(),
  };
  if (job.data()?.state === 'paid') {
    const reconciliation = await reconcileWeeklyIncentiveSettlement({
      db,
      settlementId: outcome.settlementId,
    });
    update.ledgerBalanced = reconciliation.balanced === true;
    update.ledgerDiscrepancies = reconciliation.discrepancies || [];
  }
  await outcomeRef.set(update, { merge: true });
}

async function releasePayrollSettlementHolds({ db, fieldValue, uid }) {
  const snapshot = await db.collection('rewardSettlementJobs')
    .where('uid', '==', uid)
    .limit(100)
    .get();
  const held = snapshot.docs.filter((document) => (
    document.data()?.feature === 'payroll'
    && document.data()?.state === 'held'
  ));
  if (!held.length) return 0;
  const batch = db.batch();
  for (const document of held) {
    batch.set(document.ref, {
      failureCode: fieldValue.delete(),
      state: 'eligible',
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
  return held.length;
}

async function syncPayrollOutcomeBatch({ db, fieldValue, limit }) {
  const snapshot = await db.collection('payrollOutcomes')
    .where('state', 'in', ['eligible', 'paying'])
    .limit(limit)
    .get();
  let updated = 0;
  for (const document of snapshot.docs) {
    const before = document.data()?.state;
    await syncPayrollOutcome({
      db,
      fieldValue,
      outcome: document.data(),
      outcomeRef: document.ref,
    });
    const after = await document.ref.get();
    if (after.data()?.state !== before) updated += 1;
  }
  return { scanned: snapshot.size, updated };
}

async function loadPayrollEvidence({ clock, cycle, db, uid }) {
  const [intervalSnapshot, sessionSnapshot, outageSnapshot, exceptionSnapshot, holdSnapshot, deviceSnapshot, profileSnapshot] = await Promise.all([
    db.collection('roomAttendanceIntervals').where('uid', '==', uid).limit(2_000).get(),
    db.collection('roomAttendanceSessions').where('uid', '==', uid).limit(100).get(),
    db.collection('attendanceOutageWindows').where('active', '==', true).limit(100).get(),
    db.collection('payrollExceptions').where('uid', '==', uid).where('cycleId', '==', cycle.cycleId).limit(20).get(),
    db.doc(`weeklyIncentiveHolds/${uid}`).get(),
    db.doc(`attendanceDeviceEnrollments/${uid}`).get(),
    db.doc(`publicProfiles/${uid}`).get(),
  ]);
  const now = Math.min(clock.nowMillis(), cycle.endAtMillis);
  const activeIntervalIds = new Set(sessionSnapshot.docs.flatMap((document) => {
    const data = document.data();
    return data.connected === true
      && data.seated === true
      && data.microphonePublished === true
      && data.activeIntervalId
      ? [data.activeIntervalId]
      : [];
  }));
  const intervals = intervalSnapshot.docs.flatMap((document) => {
    const data = document.data();
    const startAtMillis = timestampToMillis(data.startAt);
    const storedEndAtMillis = timestampToMillis(data.endAt);
    const endAtMillis = Number.isSafeInteger(storedEndAtMillis)
      ? storedEndAtMillis
      : activeIntervalIds.has(document.id)
        ? now
        : NaN;
    return startAtMillis < cycle.endAtMillis && endAtMillis > cycle.startAtMillis
      ? [{ endAtMillis, startAtMillis }]
      : [];
  });
  const outages = outageSnapshot.docs.map((document) => ({
    endAtMillis: timestampToMillis(document.data()?.endAt),
    startAtMillis: timestampToMillis(document.data()?.startAt),
  }));
  const attendanceDays = [];
  let cursor = cycle.startAtMillis;
  let weekday = 1;
  while (cursor < cycle.endAtMillis && weekday <= 7) {
    const day = createDailyBucket({ nowMillis: cursor, timeZone: cycle.timeZone });
    if (!day.ok) break;
    const aggregate = splitAndUnionAttendanceIntervals(intervals, {
      dayEndAtMillis: day.value.endAtMillis,
      dayStartAtMillis: day.value.startAtMillis,
      outageWindows: outages,
    });
    attendanceDays.push({
      dayId: day.value.dayId,
      excusedMillis: aggregate.ok ? aggregate.value.excusedMillis : 0,
      qualifiedMillis: aggregate.ok ? aggregate.value.qualifiedMillis : 0,
      weekday,
    });
    cursor = day.value.endAtMillis;
    weekday += 1;
  }
  return {
    attendanceDays,
    deviceEnrollment: deviceSnapshot.exists ? deviceSnapshot.data() : undefined,
    exceptions: exceptionSnapshot.docs.map((document) => document.data()),
    hold: holdSnapshot.exists ? holdSnapshot.data() : undefined,
    profile: profileSnapshot.exists ? profileSnapshot.data() : undefined,
  };
}

function writeCommandAndAudit({
  auditRef,
  commandRef,
  decodedToken,
  entityId,
  fieldValue,
  input,
  transaction,
}) {
  const timestamp = fieldValue.serverTimestamp();
  transaction.create(auditRef, {
    action: `payroll-${input.operation}`,
    actorEmail: decodedToken.email || '',
    actorRole: decodedToken.adminRole || '',
    actorUid: decodedToken.uid,
    createdAt: timestamp,
    entityId,
    entityType: 'system',
    kind: 'payroll',
    note: input.reason,
    source: 'admin-dashboard',
    status: 'recorded',
  });
  transaction.create(commandRef, {
    actorUid: decodedToken.uid,
    auditId: auditRef.id,
    createdAt: timestamp,
    operation: input.operation,
    requestId: input.requestId,
  });
}

function replayCommand(snapshot, actorUid, operation) {
  const previous = snapshot.data();
  if (previous.actorUid !== actorUid || previous.operation !== operation) {
    return { errorCode: 'REQUEST_ID_CONFLICT' };
  }
  return { auditId: previous.auditId || '', replayed: true };
}

function resolveConfigForCycle(document, cycleId) {
  if (!document) return undefined;
  const pending = document.pendingConfig;
  if (pending?.effectiveFromCycleId && pending.effectiveFromCycleId <= cycleId) return pending;
  const current = document.currentConfig;
  if (current?.effectiveFromCycleId && current.effectiveFromCycleId <= cycleId) return current;
  return undefined;
}

function publicPlan(plan) {
  return {
    category: plan.category,
    currency: plan.currency,
    dailyMinimumMinutes: plan.dailyMinimumMinutes,
    name: plan.name,
    planId: plan.planId,
    requiredWeekdays: plan.requiredWeekdays,
    weeklyAmount: plan.weeklyAmount,
  };
}

function mapConfig(value) {
  return value && typeof value === 'object' ? value : null;
}

function mapOutcome(id, value) {
  return {
    amount: value.amount || 0,
    createdAtMillis: timestampToMillis(value.createdAt) || 0,
    currency: value.currency || '',
    cycleId: value.cycleId || '',
    daily: Array.isArray(value.daily) ? value.daily : [],
    failureCode: value.failureCode || '',
    ledgerBalanced: value.ledgerBalanced === true,
    ledgerDiscrepancies: Array.isArray(value.ledgerDiscrepancies) ? value.ledgerDiscrepancies : [],
    outcomeId: id,
    planId: value.planId || '',
    settlementId: value.settlementId || '',
    state: value.state || value.result || '',
    uid: value.uid || '',
  };
}

function hashId(input) {
  return `pex_${crypto.createHash('sha256').update(input).digest('hex').slice(0, 40)}`;
}

module.exports = {
  getAdminPayroll,
  getPayrollProgress,
  loadPayrollEvidence,
  mutateAdminPayroll,
  processPayrollCycles,
  resolveConfigForCycle,
  snapshotPayrollCycle,
};
