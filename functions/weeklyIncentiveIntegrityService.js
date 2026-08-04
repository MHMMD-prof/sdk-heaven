const {
  createRoomGiftLedgerId,
} = require('./roomGiftCore');
const {
  detectMuteGraceCycling,
} = require('./roomAttendanceCore');
const {
  timestampToMillis,
} = require('./weeklyIncentiveCore');
const {
  MAX_ANALYSIS_FACTS,
  RETENTION_POLICY_V1,
  analyzeWeeklyIncentiveRisk,
  createIntegrityDocumentId,
  reconcileGiftEconomyShape,
} = require('./weeklyIncentiveIntegrityCore');
const {
  reconcileWeeklyIncentiveSettlement,
} = require('./weeklyIncentiveService');

const RECONCILIATION_BATCH_LIMIT = 100;

async function evaluateWeeklyIncentiveSettlementRisk({ clock, db, fieldValue, job, persist = true }) {
  const assessmentId = createIntegrityDocumentId('wir', [job.cycleId, job.feature, job.uid, job.settlementId]);
  if (!assessmentId) return { errorCode: 'INVALID_INTEGRITY_JOB' };
  const assessmentRef = db.doc(`weeklyIncentiveRiskAssessments/${assessmentId}`);
  const previous = await assessmentRef.get();
  if (previous.exists && previous.data()?.reviewState === 'approved') {
    return { assessmentId, hold: false, override: true, riskScore: previous.data()?.riskScore || 0 };
  }
  const [outgoing, incoming, integrityEvents, enrollment, sessions, globalHold, cycle] = await Promise.all([
    safeSnapshot(() => db.collection('canonicalRoomGiftFacts')
      .where('cycleId', '==', job.cycleId)
      .where('senderUid', '==', job.uid)
      .limit(MAX_ANALYSIS_FACTS)
      .get()),
    safeSnapshot(() => db.collection('canonicalRoomGiftFacts')
      .where('cycleId', '==', job.cycleId)
      .where('recipientUid', '==', job.uid)
      .limit(MAX_ANALYSIS_FACTS)
      .get()),
    safeSnapshot(() => db.collection('roomGiftIntegrityEvents')
      .where('cycleId', '==', job.cycleId)
      .where('uid', '==', job.uid)
      .limit(100)
      .get()),
    db.doc(`attendanceDeviceEnrollments/${job.uid}`).get(),
    safeSnapshot(() => db.collection('roomAttendanceSessions').where('uid', '==', job.uid).limit(50).get()),
    db.doc(`weeklyIncentiveHolds/${job.uid}`).get(),
    loadSourceCycle(db, job),
  ]);
  if (globalHold.data()?.active === true || globalHold.data()?.state === 'active') {
    return finalizeRiskAssessment({
      assessmentId,
      clock,
      db,
      fieldValue,
      job,
      persist,
      result: {
        hold: true,
        riskScore: 100,
        schemaVersion: 1,
        signals: [{ code: 'GLOBAL_PAYOUT_HOLD', details: {}, severity: 'critical' }],
        state: 'held',
      },
    });
  }
  let relatedInstallationCount = 0;
  const installationId = enrollment.data()?.state === 'active' ? enrollment.data()?.installationId : '';
  if (installationId) {
    const related = await safeSnapshot(() => db.collection('attendanceDeviceEnrollments')
      .where('installationId', '==', installationId)
      .where('state', '==', 'active')
      .limit(3)
      .get());
    relatedInstallationCount = related?.size || 0;
  }
  const roomId = job.source?.roomId || '';
  const churn = roomId
    ? await db.doc(`roomTargetRosterChurn/${createIntegrityDocumentId('rtc', [roomId, job.cycleId])}`).get()
    : undefined;
  const factsById = new Map();
  for (const document of [...(outgoing?.docs || []), ...(incoming?.docs || [])]) {
    factsById.set(document.id, document.data());
  }
  const events = (integrityEvents?.docs || []).map((document) => document.data());
  const risk = analyzeWeeklyIncentiveRisk({
    cycleId: job.cycleId,
    facts: [...factsById.values()],
    incomplete: (outgoing?.size || 0) >= MAX_ANALYSIS_FACTS || (incoming?.size || 0) >= MAX_ANALYSIS_FACTS,
    muteGraceCycling: detectMuteGraceCycling(
      (sessions?.docs || []).flatMap((document) => document.data()?.recentMuteEvents || []),
    ),
    refundCount: events.filter((event) => event.kind === 'refund').length,
    relatedInstallationCount,
    retainedCommissionCoins: cycle?.riskSnapshot?.targetCommissionCoins || cycle?.retainedCommissionCoins || 0,
    reversalCount: events.filter((event) => event.kind === 'reversal').length,
    rosterChangeCount: churn?.data()?.changeCount || 0,
    stackedLiabilityCoins: cycle?.riskSnapshot?.stackedLiabilityCoins || cycle?.stackedLiabilityCoins || 0,
    uid: job.uid,
  });
  if (!risk.ok) return { errorCode: risk.code };
  return finalizeRiskAssessment({
    assessmentId,
    clock,
    db,
    fieldValue,
    job,
    persist,
    result: risk.value,
  });
}

async function finalizeRiskAssessment({ assessmentId, clock, db, fieldValue, job, persist, result }) {
  if (!persist) {
    return {
      assessmentId,
      hold: result.hold === true,
      riskScore: result.riskScore,
      signals: result.signals,
    };
  }
  const assessmentRef = db.doc(`weeklyIncentiveRiskAssessments/${assessmentId}`);
  const timestamp = fieldValue.serverTimestamp();
  await assessmentRef.set({
    ...result,
    assessmentId,
    createdAt: timestamp,
    cycleId: job.cycleId,
    evaluatedAt: timestamp,
    evaluatedAtMillis: clock.nowMillis(),
    feature: job.feature,
    reviewState: result.hold ? 'pending' : 'not-required',
    settlementId: job.settlementId,
    uid: job.uid,
    updatedAt: timestamp,
  }, { merge: true });
  if (result.hold) {
    await db.doc(`weeklyIncentiveIntegrityAlerts/${assessmentId}`).set({
      alertId: assessmentId,
      assessmentId,
      createdAt: timestamp,
      cycleId: job.cycleId,
      feature: job.feature,
      riskScore: result.riskScore,
      settlementId: job.settlementId,
      signals: result.signals,
      state: 'open',
      uid: job.uid,
      updatedAt: timestamp,
    }, { merge: true });
  }
  return {
    assessmentId,
    hold: result.hold === true,
    riskScore: result.riskScore,
    signals: result.signals,
  };
}

async function reconcileRoomGiftEconomyEvent({ db, event, roomId }) {
  if (!event?.requestId || !event?.eventId || !roomId) {
    return { balanced: false, discrepancies: ['GIFT_EVENT_INVALID'], eventId: event?.eventId || '' };
  }
  const [sender, recipient, platform] = await Promise.all([
    db.doc(`walletTransactions/${createRoomGiftLedgerId({
      kind: 'spend',
      requestId: event.requestId,
      roomId,
      uid: event.senderUid,
    })}`).get(),
    event.recipientCredit > 0
      ? db.doc(`walletTransactions/${createRoomGiftLedgerId({
          kind: 'earn',
          requestId: event.requestId,
          roomId,
          uid: event.recipientUid,
        })}`).get()
      : Promise.resolve(undefined),
    event.platformShare > 0
      ? db.doc(`platformEconomyTransactions/${createRoomGiftLedgerId({
          kind: 'platform',
          requestId: event.requestId,
          roomId,
          uid: 'room-gifts',
        })}`).get()
      : Promise.resolve(undefined),
  ]);
  const report = reconcileGiftEconomyShape({
    event,
    platformLedger: platform?.exists ? platform.data() : undefined,
    recipientLedger: recipient?.exists ? recipient.data() : undefined,
    senderLedger: sender.exists ? sender.data() : undefined,
  });
  return { ...report, eventId: event.eventId, roomId };
}

async function processWeeklyIncentiveReconciliationBatch({
  apply = false,
  db,
  documentIdField = '__name__',
  fieldValue,
  giftCursor = '',
  limit = RECONCILIATION_BATCH_LIMIT,
  settlementCursor = '',
}) {
  const boundedLimit = Math.min(Math.max(1, limit), RECONCILIATION_BATCH_LIMIT);
  let giftQuery = db.collectionGroup('giftEvents').orderBy(documentIdField);
  if (giftCursor) giftQuery = giftQuery.startAfter(giftCursor);
  let settlementQuery = db.collection('rewardSettlements')
    .where('state', '==', 'paid')
    .orderBy('settlementId');
  if (settlementCursor) settlementQuery = settlementQuery.startAfter(settlementCursor);
  const [gifts, settlements] = await Promise.all([
    giftQuery.limit(boundedLimit).get(),
    settlementQuery.limit(boundedLimit).get(),
  ]);
  const giftReports = [];
  for (const document of gifts.docs) {
    const roomId = document.data()?.roomId || document.ref.parent.parent?.id || '';
    giftReports.push(await reconcileRoomGiftEconomyEvent({ db, event: document.data(), roomId }));
  }
  const settlementReports = [];
  for (const document of settlements.docs) {
    settlementReports.push(await reconcileWeeklyIncentiveSettlement({
      db,
      settlementId: document.id,
    }));
  }
  const allReports = [...giftReports.map((report) => ({ kind: 'gift', report })),
    ...settlementReports.map((report) => ({ kind: 'settlement', report }))];
  if (apply) {
    const timestamp = fieldValue.serverTimestamp();
    const batch = db.batch();
    for (const entry of allReports) {
      const sourceId = entry.kind === 'gift' ? entry.report.eventId : entry.report.settlementId;
      const reportId = createIntegrityDocumentId('wir', [entry.kind, sourceId]);
      batch.set(db.doc(`incentiveReconciliationReports/${reportId}`), {
        balanced: entry.report.balanced === true,
        checkedAt: timestamp,
        discrepancies: entry.report.discrepancies || [],
        kind: entry.kind,
        reportId,
        schemaVersion: 1,
        sourceId,
        ...(entry.report.roomId ? { roomId: entry.report.roomId } : {}),
      }, { merge: true });
      if (entry.report.balanced !== true) {
        const alertId = createIntegrityDocumentId('wia', ['reconciliation', entry.kind, sourceId]);
        batch.set(db.doc(`weeklyIncentiveIntegrityAlerts/${alertId}`), {
          alertId,
          createdAt: timestamp,
          discrepancies: entry.report.discrepancies || [],
          kind: 'reconciliation',
          sourceId,
          state: 'open',
          updatedAt: timestamp,
        }, { merge: true });
      }
    }
    await batch.commit();
  }
  return {
    giftReports,
    nextGiftCursor: gifts.size === boundedLimit ? gifts.docs.at(-1).ref.path : '',
    nextSettlementCursor: settlements.size === boundedLimit ? settlements.docs.at(-1).id : '',
    settlementReports,
    summary: {
      balanced: allReports.filter((entry) => entry.report.balanced === true).length,
      scanned: allReports.length,
      unbalanced: allReports.filter((entry) => entry.report.balanced !== true).length,
    },
  };
}

async function getAdminWeeklyIncentiveIntegrity({ clock, db }) {
  const [openAlerts, heldJobs, failedJobs, reports, assessments, runtimes, settlements] = await Promise.all([
    safeSnapshot(() => db.collection('weeklyIncentiveIntegrityAlerts').where('state', '==', 'open').limit(100).get()),
    safeSnapshot(() => db.collection('rewardSettlementJobs').where('state', '==', 'held').limit(100).get()),
    safeSnapshot(() => db.collection('rewardSettlementJobs').where('state', '==', 'failed').limit(100).get()),
    safeSnapshot(() => db.collection('incentiveReconciliationReports').orderBy('checkedAt', 'desc').limit(50).get()),
    safeSnapshot(() => db.collection('weeklyIncentiveRiskAssessments').where('reviewState', '==', 'pending').limit(50).get()),
    Promise.all([
      db.doc('appRuntime/weeklyIncentiveSettlementWorker').get(),
      db.doc('appRuntime/weeklyIncentiveIntegrityMonitor').get(),
      db.doc('appRuntime/roomSupportGiftReconciler').get(),
      db.doc('appRuntime/liveKitAttendanceReconciler').get(),
    ]),
    safeSnapshot(() => db.collection('rewardSettlements').where('state', '==', 'paid').limit(500).get()),
  ]);
  const heldValue = (heldJobs?.docs || []).reduce((total, document) => (
    total + rewardBundleCoinValue(document.data()?.rewardBundle)
  ), 0);
  const estimatedLiability = (settlements?.docs || []).reduce((total, document) => (
    total + rewardBundleCoinValue(document.data()?.rewardBundle)
  ), 0);
  return {
    alerts: (openAlerts?.docs || []).map((document) => ({ id: document.id, ...safeData(document.data()) })),
    assessments: (assessments?.docs || []).map((document) => ({ id: document.id, ...safeData(document.data()) })),
    generatedAtMillis: clock.nowMillis(),
    health: {
      failedPayoutCount: failedJobs?.size || 0,
      heldPayoutCount: heldJobs?.size || 0,
      heldValueCoins: heldValue,
      estimatedLiabilityCoins: estimatedLiability,
      reconciliationDriftCount: (reports?.docs || []).filter((document) => document.data()?.balanced !== true).length,
      schedulers: runtimes.map((snapshot) => {
        const value = snapshot.data() || {};
        const lastRunAtMillis = timestampToMillis(value.lastRunAt);
        return {
          id: snapshot.ref?.id || '',
          lagMillis: lastRunAtMillis ? Math.max(0, clock.nowMillis() - lastRunAtMillis) : -1,
          lastRunAtMillis,
          status: value.status || (lastRunAtMillis ? 'ok' : 'missing'),
        };
      }),
    },
    reports: (reports?.docs || []).map((document) => ({ id: document.id, ...safeData(document.data()) })),
    retentionPolicy: RETENTION_POLICY_V1,
  };
}

async function mutateAdminWeeklyIncentiveIntegrity({ db, decodedToken, fieldValue, input }) {
  const assessmentRef = input.assessmentId
    ? db.doc(`weeklyIncentiveRiskAssessments/${input.assessmentId}`)
    : undefined;
  const alertRef = input.alertId
    ? db.doc(`weeklyIncentiveIntegrityAlerts/${input.alertId}`)
    : undefined;
  const jobRef = input.settlementId ? db.doc(`rewardSettlementJobs/${input.settlementId}`) : undefined;
  const auditRef = db.doc(`adminAuditEvents/integrity_${input.requestId}`);
  return db.runTransaction(async (transaction) => {
    const refs = [auditRef, ...(assessmentRef ? [assessmentRef] : []), ...(alertRef ? [alertRef] : []), ...(jobRef ? [jobRef] : [])];
    const snapshots = await transaction.getAll(...refs);
    if (snapshots[0].exists) return { auditId: auditRef.id, replayed: true };
    const timestamp = fieldValue.serverTimestamp();
    if (input.operation === 'approve-settlement') {
      const assessment = snapshots[1];
      const job = snapshots.at(-1);
      if (!assessment?.exists || !job?.exists || assessment.data()?.settlementId !== input.settlementId || job.data()?.state !== 'held') {
        throw adminError(409, 'The held settlement and assessment no longer match.');
      }
      transaction.set(assessmentRef, {
        reviewReason: input.reason,
        reviewState: 'approved',
        reviewedAt: timestamp,
        reviewedBy: decodedToken.uid,
        updatedAt: timestamp,
      }, { merge: true });
      transaction.set(jobRef, {
        failureCode: fieldValue.delete(),
        integrityAssessmentId: input.assessmentId,
        integrityOverride: 'approved',
        state: 'eligible',
        updatedAt: timestamp,
      }, { merge: true });
    } else if (input.operation === 'reject-settlement') {
      const assessment = snapshots[1];
      const job = snapshots.at(-1);
      if (!assessment?.exists || !job?.exists || assessment.data()?.settlementId !== input.settlementId) {
        throw adminError(409, 'The settlement and assessment no longer match.');
      }
      transaction.set(assessmentRef, {
        reviewReason: input.reason,
        reviewState: 'rejected',
        reviewedAt: timestamp,
        reviewedBy: decodedToken.uid,
        updatedAt: timestamp,
      }, { merge: true });
      transaction.set(jobRef, {
        failureCode: 'INTEGRITY_REJECTED',
        state: 'held',
        updatedAt: timestamp,
      }, { merge: true });
    } else if (input.operation === 'resolve-alert') {
      const alert = snapshots[1];
      if (!alert?.exists || alert.data()?.state !== 'open') throw adminError(409, 'The alert is no longer open.');
      transaction.set(alertRef, {
        resolutionReason: input.reason,
        resolvedAt: timestamp,
        resolvedBy: decodedToken.uid,
        state: 'resolved',
        updatedAt: timestamp,
      }, { merge: true });
    } else {
      throw adminError(400, 'Unsupported integrity operation.');
    }
    transaction.create(auditRef, {
      action: `weekly-incentive-${input.operation}`,
      actorEmail: decodedToken.email || '',
      actorRole: decodedToken.adminRole || '',
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      entityId: input.assessmentId || input.alertId || input.settlementId,
      entityType: 'system',
      id: auditRef.id,
      kind: 'weekly-incentive-integrity',
      note: input.reason,
      status: 'completed',
    });
    return { auditId: auditRef.id, replayed: false };
  });
}

async function processWeeklyIncentiveRetention({
  apply = false,
  clock,
  db,
  fieldValue,
  limit = 100,
  actorUid = 'system',
}) {
  const definitions = [
    { collection: 'canonicalRoomGiftFacts', dateField: 'occurredAt', days: 730 },
    { collection: 'roomAttendanceIntervals', dateField: 'endAt', days: 180 },
    { collection: 'attendanceDeviceEnrollments', dateField: 'updatedAt', days: 180, inactiveOnly: true },
    { collection: 'rewardSettlements', dateField: 'paidAt', days: 2555 },
    { collection: 'walletTransactions', dateField: 'createdAt', days: 2555 },
    { collection: 'rewardEntitlementTransactions', dateField: 'createdAt', days: 2555 },
    { collection: 'adminAuditEvents', dateField: 'createdAt', days: 365 },
  ];
  const candidates = [];
  for (const definition of definitions) {
    if (candidates.length >= limit) break;
    const threshold = clock.timestampFromMillis(clock.nowMillis() - definition.days * 86_400_000);
    const snapshot = await safeSnapshot(() => db.collection(definition.collection)
      .where(definition.dateField, '<=', threshold)
      .orderBy(definition.dateField, 'asc')
      .limit(limit - candidates.length)
      .get());
    for (const document of snapshot?.docs || []) {
      const value = document.data();
      if (value.legalHold === true) continue;
      if (definition.inactiveOnly && !['replaced', 'revoked'].includes(value.state)) continue;
      candidates.push({ collection: definition.collection, path: document.ref.path, ref: document.ref });
    }
  }
  if (!apply || candidates.length === 0) {
    return { applied: false, candidates: candidates.map(({ collection, path }) => ({ collection, path })), deleted: 0 };
  }
  const batch = db.batch();
  candidates.forEach((candidate) => batch.delete(candidate.ref));
  const auditId = createIntegrityDocumentId('ret', [String(clock.nowMillis()), actorUid, ...candidates.map((candidate) => candidate.path)]);
  batch.set(db.doc(`adminAuditEvents/${auditId}`), {
    action: 'weekly-incentive-retention',
    actorUid,
    count: candidates.length,
    createdAt: fieldValue.serverTimestamp(),
    entityId: auditId,
    entityType: 'system',
    id: auditId,
    kind: 'retention',
    paths: candidates.map((candidate) => candidate.path),
    status: 'completed',
  });
  await batch.commit();
  return { applied: true, auditId, candidates: [], deleted: candidates.length };
}

async function loadSourceCycle(db, job) {
  if (!job.source?.roomId) return undefined;
  const collection = job.feature === 'owner-targets' ? 'targetCycles' : job.feature === 'rocket-rewards' ? 'rocketCycles' : '';
  if (!collection) return undefined;
  const snapshot = await db.doc(`rooms/${job.source.roomId}/${collection}/${job.cycleId}`).get();
  return snapshot.exists ? snapshot.data() : undefined;
}

function rewardBundleCoinValue(bundle) {
  const coins = Number.isSafeInteger(bundle?.coins) ? bundle.coins : 0;
  const diamonds = Number.isSafeInteger(bundle?.diamonds) ? bundle.diamonds : 0;
  return coins + diamonds * 100;
}

function safeData(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => ![
    'deviceFingerprint',
    'installationId',
    'ipAddress',
    'riskValuation',
  ].includes(key)));
}

async function safeSnapshot(factory) {
  try {
    return await factory();
  } catch {
    return undefined;
  }
}

function adminError(status, message) {
  return Object.assign(new Error(message), { status });
}

module.exports = {
  RECONCILIATION_BATCH_LIMIT,
  evaluateWeeklyIncentiveSettlementRisk,
  getAdminWeeklyIncentiveIntegrity,
  mutateAdminWeeklyIncentiveIntegrity,
  processWeeklyIncentiveReconciliationBatch,
  processWeeklyIncentiveRetention,
  reconcileRoomGiftEconomyEvent,
};
