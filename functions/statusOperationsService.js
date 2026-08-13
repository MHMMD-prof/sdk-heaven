'use strict';
const {
  STATUS_SCHEMA_VERSION,
  mapAristocracyEntitlement,
  mapStatusFeatureFlags,
  mapVipAccount,
  normalizeAristocracyCatalogVersion,
  normalizeVipCatalogVersion,
} = require('./statusMembershipCore');
const { buildVipProgressionMutation } = require('./statusProgressionCore');
const { activeCatalogVersion } = require('./statusMembershipService');
const { reconcileVipProgression } = require('./statusProgressionService');
const {
  approveAristocracyAdminOperation,
  proposeAristocracyAdminOperation,
  reconcileAristocracyEconomy,
} = require('./aristocracyEconomyService');
const {
  deriveAlertDecision,
  deriveOperationsReadiness,
  normalizeEmergencyFreeze,
  normalizeReconciliationRequest,
  normalizeStatusOperationProposal,
  normalizeStatusUserInspection,
} = require('./statusOperationsCore');

const OPS_SAMPLE_LIMIT = 50;
const ARISTOCRACY_ADMIN_OPERATIONS = Object.freeze(['complimentary-grant', 'revoke', 'freeze', 'unfreeze']);

async function proposeAnyStatusOperation(args) {
  if (!ARISTOCRACY_ADMIN_OPERATIONS.includes(args.input?.operation)) return proposeStatusOperation(args);
  const { operation: action, ...input } = args.input;
  return proposeAristocracyAdminOperation({ ...args, input: { ...input, action } });
}

async function approveAnyStatusOperation(args) {
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(args.requestId || '')) return { errorCode: 'PERMISSION_DENIED' };
  if (!activeAdminToken(args.decodedToken, ['owner'])) return { errorCode: 'PERMISSION_DENIED' };
  const proposal = await args.db.doc(`statusAdminProposals/${args.requestId}`).get();
  if (proposal.data()?.kind === 'aristocracy-admin-operation') return approveAristocracyAdminOperation(args);
  return approveStatusOperation(args);
}

async function getStatusOperationsOverview({ clock = systemClock(), db }) {
  const nowMillis = clock.nowMillis();
  const refs = {
    flags: db.doc('appConfig/statusFeatures'),
    operations: db.doc('appRuntime/statusOperations'),
    vipPointer: db.doc('statusCatalogPointers/vip-svip'),
    aristocracyPointer: db.doc('statusCatalogPointers/aristocracy'),
    reconciliation: db.doc('statusOperations/reconciliation'),
    migration: db.doc('statusOperations/migration'),
  };
  const [flags, operations, vipPointer, aristocracyPointer, reconciliation, migration, proposals, alerts,
    sourceQueued, sourceDead, projectionQueued, projectionDead, accounts, entitlements] = await Promise.all([
    refs.flags.get(), refs.operations.get(), refs.vipPointer.get(), refs.aristocracyPointer.get(), refs.reconciliation.get(), refs.migration.get(),
    db.collection('statusAdminProposals').where('state', '==', 'pending-approval').limit(OPS_SAMPLE_LIMIT).get(),
    db.collection('statusOpsAlerts').where('state', '==', 'open').limit(OPS_SAMPLE_LIMIT).get(),
    db.collection('statusSourceOutbox').where('state', '==', 'queued').orderBy('nextAttemptAt', 'asc').limit(OPS_SAMPLE_LIMIT).get(),
    db.collection('statusSourceOutbox').where('state', '==', 'dead-letter').limit(OPS_SAMPLE_LIMIT).get(),
    db.collection('statusPresentationJobs').where('state', '==', 'queued').orderBy('nextAttemptAt', 'asc').limit(OPS_SAMPLE_LIMIT).get(),
    db.collection('statusPresentationJobs').where('state', '==', 'dead-letter').limit(OPS_SAMPLE_LIMIT).get(),
    db.collection('vipAccounts').limit(OPS_SAMPLE_LIMIT).get(),
    db.collection('aristocracyEntitlements').limit(OPS_SAMPLE_LIMIT).get(),
  ]);
  const featureFlags = mapStatusFeatureFlags(flags.data());
  const oldestQueuedMillis = Math.min(
    oldestMillis(sourceQueued.docs, 'createdAt'),
    oldestMillis(projectionQueued.docs, 'createdAt'),
  );
  const queueState = {
    deadLetterCount: sourceDead.size + projectionDead.size,
    oldestQueuedAgeMs: Number.isFinite(oldestQueuedMillis) ? Math.max(0, nowMillis - oldestQueuedMillis) : 0,
    projectionDeadLetters: projectionDead.size,
    projectionQueued: projectionQueued.size,
    sourceDeadLetters: sourceDead.size,
    sourceQueued: sourceQueued.size,
    sampled: [sourceQueued, sourceDead, projectionQueued, projectionDead].some((snapshot) => snapshot.size === OPS_SAMPLE_LIMIT),
  };
  const migrationData = migration.data() || {};
  const reconciliationData = reconciliation.data() || {};
  const readiness = deriveOperationsReadiness({
    vip: { activeCatalogVersion: activeCatalogVersion(vipPointer.data(), 'vip-svip') },
    aristocracy: { activeCatalogVersion: activeCatalogVersion(aristocracyPointer.data(), 'aristocracy') },
    flags: featureFlags,
    migrations: {
      assessed: migrationData.assessed === true,
      required: migrationData.required === true,
      verified: migrationData.verified === true,
      userCount: Number.isSafeInteger(migrationData.userCount) ? migrationData.userCount : 0,
    },
    queues: queueState,
    reconciliation: { assessed: Number.isSafeInteger(reconciliationData.completedAtMillis) && reconciliationData.completedAtMillis > 0, consecutiveDriftRuns: readCount(reconciliationData.consecutiveDriftRuns) },
    signoffs: operations.data()?.signoffs || {},
  });
  return {
    result: {
      schemaVersion: STATUS_SCHEMA_VERSION,
      generatedAtMillis: nowMillis,
      flags: featureFlags,
      catalogs: {
        vip: activeCatalogVersion(vipPointer.data(), 'vip-svip'),
        aristocracy: activeCatalogVersion(aristocracyPointer.data(), 'aristocracy'),
      },
      queues: queueState,
      authority: {
        vipAccountsSampled: accounts.size,
        aristocracyEntitlementsSampled: entitlements.size,
        sampleLimit: OPS_SAMPLE_LIMIT,
        vipDistribution: countBy(accounts.docs, (doc) => cleanString(doc.data()?.levelId, 40) || 'none'),
        aristocracyDistribution: countBy(entitlements.docs, (doc) => `${cleanString(doc.data()?.rankId, 40) || 'none'}:${cleanString(doc.data()?.state, 20) || 'unknown'}`),
      },
      pendingProposals: proposals.docs.map(sanitizeProposal),
      alerts: alerts.docs.map(sanitizeAlert),
      reconciliation: sanitizeReconciliation(reconciliationData),
      migration: sanitizeMigration(migrationData),
      signoffs: sanitizeSignoffs(operations.data()?.signoffs),
      readiness,
    },
  };
}

async function inspectStatusUser({ clock = systemClock(), db, input }) {
  const normalized = normalizeStatusUserInspection(input);
  if (!normalized.ok) return { errorCode: normalized.code };
  const uid = normalized.value.targetUid;
  const [profile, wallet, vip, aristocracy, visibility, contributions, transitions, transactions, commands, quotes] = await Promise.all([
    db.doc(`publicProfiles/${uid}`).get(), db.doc(`walletSummaries/${uid}`).get(), db.doc(`vipAccounts/${uid}`).get(),
    db.doc(`aristocracyEntitlements/${uid}`).get(), db.doc(`statusVisibility/${uid}`).get(),
    db.collection('vipContributions').where('uid', '==', uid).orderBy('occurredAt', 'desc').limit(20).get(),
    db.collection(`vipTransitions/${uid}/items`).orderBy('createdAt', 'desc').limit(20).get(),
    db.collection('aristocracyTransactions').where('uid', '==', uid).orderBy('createdAt', 'desc').limit(20).get(),
    db.collection(`statusCommandRequests/${uid}/requests`).orderBy('createdAt', 'desc').limit(20).get(),
    db.collection(`aristocracyQuotes/${uid}/items`).orderBy('issuedAt', 'desc').limit(20).get(),
  ]);
  const vipAccount = vip.exists ? mapVipAccount(vip.data(), uid) : null;
  const entitlement = aristocracy.exists ? mapAristocracyEntitlement(aristocracy.data(), uid, clock.nowMillis()) : null;
  if (vip.exists && !vipAccount) return { errorCode: 'VIP_AUTHORITY_INVALID' };
  if (aristocracy.exists && !entitlement) return { errorCode: 'ARISTOCRACY_AUTHORITY_INVALID' };
  return { result: {
    uid,
    profile: profile.exists ? { displayName: cleanString(profile.data()?.displayName, 80), moderationStatus: cleanString(profile.data()?.moderationStatus, 20), publicId: cleanString(profile.data()?.publicId, 32), statusPresentation: profile.data()?.statusPresentation || null } : null,
    wallet: wallet.exists ? { coins: safeNumber(wallet.data()?.balances?.coins), diamonds: safeNumber(wallet.data()?.balances?.diamonds) } : { coins: 0, diamonds: 0 },
    vip: vipAccount,
    aristocracy: entitlement ? { catalogVersion: entitlement.catalogVersion, expiresAtMillis: entitlement.expiresAtMillis, origin: entitlement.origin, rankId: entitlement.rankId, rankOrder: entitlement.rankOrder, revision: entitlement.revision, state: entitlement.state } : null,
    visibility: visibility.exists && visibility.data()?.publicDisplay === false ? 'hidden' : 'public',
    histories: {
      contributions: contributions.docs.map((doc) => sanitizeDoc(doc, ['kind', 'pointDelta', 'settlementState', 'occurredAt', 'policyVersion'])),
      transitions: transitions.docs.map((doc) => sanitizeDoc(doc, ['kind', 'fromLevelId', 'toLevelId', 'pointsBefore', 'pointsAfter', 'createdAt'])),
      aristocracy: transactions.docs.map((doc) => sanitizeDoc(doc, ['kind', 'rankId', 'rankOrder', 'amountCoins', 'createdAt', 'expiresAt'])),
      commands: commands.docs.map((doc) => sanitizeDoc(doc, ['action', 'createdAt', 'result'])),
      quotes: quotes.docs.map((doc) => sanitizeDoc(doc, ['operation', 'targetRankId', 'amountCoins', 'state', 'issuedAt', 'expiresAt'])),
    },
  } };
}

async function proposeStatusOperation({ db, decodedToken, fieldValue, input }) {
  const normalized = normalizeStatusOperationProposal(input);
  if (!normalized.ok || !activeAdminToken(decodedToken, ['owner', 'catalog-manager'])) return { errorCode: normalized.ok ? 'PERMISSION_DENIED' : normalized.code };
  const proposalRef = db.doc(`statusAdminProposals/${normalized.value.requestId}`);
  return db.runTransaction(async (transaction) => {
    const [existing, actor] = await Promise.all([transaction.get(proposalRef), transaction.get(db.doc(`adminProfiles/${decodedToken.uid}`))]);
    if (!activeAdminProfile(actor.data(), decodedToken, ['owner', 'catalog-manager'])) return { errorCode: 'PERMISSION_DENIED' };
    if (existing.exists) return sameJson(existing.data()?.input, normalized.value) && existing.data()?.initiatedBy === decodedToken.uid
      ? { result: { proposalId: proposalRef.id, state: existing.data().state } }
      : { errorCode: 'REQUEST_CONFLICT' };
    const timestamp = fieldValue.serverTimestamp();
    transaction.create(proposalRef, {
      schemaVersion: STATUS_SCHEMA_VERSION, proposalId: proposalRef.id, kind: 'status-operations', input: normalized.value,
      initiatedBy: decodedToken.uid, initiatedByRole: decodedToken.adminRole, state: 'pending-approval', createdAt: timestamp,
    });
    transaction.create(db.doc(`adminAuditEvents/status_proposal_${proposalRef.id}`), {
      action: `status-propose-${normalized.value.operation}`, actorUid: decodedToken.uid, createdAt: timestamp,
      evidenceRef: normalized.value.evidenceRef, kind: 'economy', note: normalized.value.reason,
      status: 'pending-approval', targetUid: normalized.value.targetUid || '', entityType: 'economy', entityId: proposalRef.id,
    });
    return { result: { proposalId: proposalRef.id, state: 'pending-approval' } };
  });
}

async function approveStatusOperation({ clock = systemClock(), db, decodedToken, fieldValue, requestId }) {
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId || '') || !activeAdminToken(decodedToken, ['owner'])) return { errorCode: 'PERMISSION_DENIED' };
  return db.runTransaction(async (transaction) => {
    const proposalRef = db.doc(`statusAdminProposals/${requestId}`);
    const [proposalSnapshot, approver] = await Promise.all([transaction.get(proposalRef), transaction.get(db.doc(`adminProfiles/${decodedToken.uid}`))]);
    if (!activeAdminProfile(approver.data(), decodedToken, ['owner'])) return { errorCode: 'PERMISSION_DENIED' };
    const proposal = proposalSnapshot.data();
    if (!proposalSnapshot.exists || proposal?.kind !== 'status-operations') return { errorCode: 'PROPOSAL_NOT_FOUND' };
    if (proposal.state === 'completed' && proposal.result) return { result: proposal.result };
    if (proposal.state !== 'pending-approval') return { errorCode: 'PROPOSAL_NOT_PENDING' };
    if (proposal.initiatedBy === decodedToken.uid) return { errorCode: 'SELF_APPROVAL_FORBIDDEN' };
    const initiator = await transaction.get(db.doc(`adminProfiles/${proposal.initiatedBy}`));
    if (!initiator.exists || initiator.data()?.status !== 'active' || !['owner', 'catalog-manager'].includes(initiator.data()?.role)) return { errorCode: 'INITIATOR_INACTIVE' };
    const normalized = normalizeStatusOperationProposal(proposal.input);
    if (!normalized.ok) return { errorCode: 'INVALID_PROPOSAL' };
    const timestamp = fieldValue.serverTimestamp();
    const result = normalized.value.operation === 'vip-point-correction'
      ? await applyVipCorrection({ db, fieldValue, input: normalized.value, timestamp, transaction })
      : normalized.value.operation === 'activate-catalog'
        ? await applyCatalogActivation({ db, input: normalized.value, timestamp, transaction })
        : normalized.value.operation === 'set-feature-flags'
          ? await applyFeatureFlags({ clock, db, input: normalized.value, timestamp, transaction })
          : normalized.value.operation === 'set-signoffs'
            ? await applySignoffs({ db, input: normalized.value, timestamp, transaction })
            : applyMigrationState({ db, input: normalized.value, timestamp, transaction });
    if (result.errorCode) return result;
    transaction.update(proposalRef, { approvedAt: timestamp, approvedBy: decodedToken.uid, result: result.result, state: 'completed' });
    transaction.create(db.doc(`adminAuditEvents/status_approval_${requestId}`), {
      action: `status-approve-${normalized.value.operation}`, actorUid: decodedToken.uid, approverUid: decodedToken.uid,
      initiatorUid: proposal.initiatedBy, createdAt: timestamp, evidenceRef: normalized.value.evidenceRef,
      kind: 'economy', note: normalized.value.reason, status: 'completed', targetUid: normalized.value.targetUid || '',
      entityType: 'economy', entityId: requestId, result: result.result,
    });
    return result;
  });
}

async function emergencyFreezeStatus({ db, decodedToken, fieldValue, input }) {
  const normalized = normalizeEmergencyFreeze(input);
  if (!normalized.ok || !activeAdminToken(decodedToken, ['owner'])) return { errorCode: normalized.ok ? 'PERMISSION_DENIED' : normalized.code };
  return db.runTransaction(async (transaction) => {
    const featureRef = db.doc('appConfig/statusFeatures');
    const auditRef = db.doc(`adminAuditEvents/status_freeze_${normalized.value.requestId}`);
    const [feature, audit, actor] = await Promise.all([transaction.get(featureRef), transaction.get(auditRef), transaction.get(db.doc(`adminProfiles/${decodedToken.uid}`))]);
    if (!activeAdminProfile(actor.data(), decodedToken, ['owner'])) return { errorCode: 'PERMISSION_DENIED' };
    if (audit.exists) return audit.data()?.result ? { result: audit.data().result } : { errorCode: 'REQUEST_CONFLICT' };
    const previous = mapStatusFeatureFlags(feature.data());
    const next = { ...previous, ...normalized.value.flags, updatedAt: fieldValue.serverTimestamp() };
    const result = { flags: normalized.value.flags, previous: Object.fromEntries(Object.keys(normalized.value.flags).map((key) => [key, previous[key]])) };
    transaction.set(featureRef, next);
    transaction.create(auditRef, { action: 'status-emergency-freeze', actorUid: decodedToken.uid, createdAt: fieldValue.serverTimestamp(), kind: 'economy', note: normalized.value.reason, status: 'completed', entityType: 'system', entityId: 'statusFeatures', result });
    return { result };
  });
}

async function runStatusReconciliation({ clock = systemClock(), db, decodedToken, documentIdField, fieldValue, input }) {
  const normalized = normalizeReconciliationRequest(input);
  if (!normalized.ok || !activeAdminToken(decodedToken, ['owner', 'auditor'])) return { errorCode: normalized.ok ? 'PERMISSION_DENIED' : normalized.code };
  const runRef = db.doc(`statusReconciliationRuns/${normalized.value.requestId}`);
  const existingRun = await runRef.get();
  if (existingRun.exists && existingRun.data()?.result) return { result: existingRun.data().result };
  const [vip, aristocracy, previous] = await Promise.all([
    reconcileVipProgression({ db, documentIdField }),
    reconcileAristocracyEconomy({ db, documentIdField }),
    db.doc('statusOperations/reconciliation').get(),
  ]);
  const vipDirty = !vip.ok || vip.value.clean !== true;
  const aristocracyDirty = !aristocracy.ok || aristocracy.value.clean !== true;
  const dirty = vipDirty || aristocracyDirty;
  const previousDirty = previous.data()?.dirty === true;
  const previousConsecutiveDriftRuns = readCount(previous.data()?.consecutiveDriftRuns);
  const decision = deriveAlertDecision(dirty, previousDirty, previousConsecutiveDriftRuns);
  const consecutiveDriftRuns = dirty ? previousConsecutiveDriftRuns + 1 : 0;
  const result = {
    runId: normalized.value.requestId, dirty, consecutiveDriftRuns,
    vip: vip.ok ? summarizeVipReconciliation(vip.value) : { clean: false, code: vip.code },
    aristocracy: aristocracy.ok ? summarizeAristocracyReconciliation(aristocracy.value) : { clean: false, code: aristocracy.code },
    alert: decision,
    completedAtMillis: clock.nowMillis(),
  };
  const batch = db.batch();
  const timestamp = fieldValue.serverTimestamp();
  batch.set(db.doc('statusOperations/reconciliation'), { ...result, updatedAt: timestamp });
  batch.create(runRef, { schemaVersion: STATUS_SCHEMA_VERSION, ...result, result, reason: normalized.value.reason, actorUid: decodedToken.uid, createdAt: timestamp });
  if (decision.create) {
    const alertId = `drift_${normalized.value.requestId}`;
    batch.create(db.doc(`statusOpsAlerts/${alertId}`), { schemaVersion: STATUS_SCHEMA_VERSION, alertId, code: decision.code, severity: decision.severity, state: 'open', runId: normalized.value.requestId, createdAt: timestamp });
  }
  batch.create(db.doc(`adminAuditEvents/status_reconcile_${normalized.value.requestId}`), { action: 'status-reconciliation', actorUid: decodedToken.uid, createdAt: timestamp, kind: 'economy', note: normalized.value.reason, status: dirty ? 'failed' : 'completed', entityType: 'system', entityId: normalized.value.requestId, result });
  await batch.commit();
  return { result };
}

async function applyVipCorrection({ db, input, timestamp, transaction }) {
  const pointer = await transaction.get(db.doc('statusCatalogPointers/vip-svip'));
  const catalogVersion = activeCatalogVersion(pointer.data(), 'vip-svip');
  const catalogSnapshot = catalogVersion ? await transaction.get(db.doc(`vipTierCatalogVersions/${catalogVersion}`)) : null;
  const catalog = normalizeVipCatalogVersion(catalogSnapshot?.data());
  if (!catalog.ok || catalog.value.state !== 'published') return { errorCode: 'CATALOG_UNAVAILABLE' };
  const accountRef = db.doc(`vipAccounts/${input.targetUid}`);
  const account = await transaction.get(accountRef);
  const eventId = `admin_${input.requestId}`;
  const mutation = buildVipProgressionMutation({ account: account.exists ? account.data() : null, catalog: catalog.value, eventId, pointDelta: input.pointDelta, timestamp, uid: input.targetUid });
  if (!mutation.ok) return { errorCode: mutation.code };
  transaction.create(db.doc(`vipContributions/${eventId}`), { schemaVersion: STATUS_SCHEMA_VERSION, eventId, uid: input.targetUid, sourceId: input.evidenceRef, policyVersion: catalogVersion, kind: 'admin-correction', pointDelta: input.pointDelta, settlementState: 'settled', amount: Math.abs(input.pointDelta), currency: 'points', occurredAt: timestamp, createdAt: timestamp });
  transaction.set(accountRef, mutation.value.account);
  if (mutation.value.transition) transaction.create(db.doc(`vipTransitions/${input.targetUid}/items/${eventId}`), mutation.value.transition);
  queueProjection({ db, eventId, timestamp, transaction, uid: input.targetUid });
  return { result: { operation: input.operation, eventId, targetUid: input.targetUid, pointsBefore: mutation.value.pointsBefore, pointsAfter: mutation.value.pointsAfter } };
}

async function applyCatalogActivation({ db, input, timestamp, transaction }) {
  const isVip = input.catalogKind === 'vip-svip';
  const catalogRef = db.doc(`${isVip ? 'vipTierCatalogVersions' : 'aristocracyCatalogVersions'}/${input.catalogVersion}`);
  const snapshot = await transaction.get(catalogRef);
  const normalized = isVip ? normalizeVipCatalogVersion(snapshot.data()) : normalizeAristocracyCatalogVersion(snapshot.data());
  if (!normalized.ok || normalized.value.state !== 'published') return { errorCode: 'CATALOG_UNAVAILABLE' };
  const pointerRef = db.doc(`statusCatalogPointers/${input.catalogKind}`);
  const pointer = await transaction.get(pointerRef);
  const previousCatalogVersion = activeCatalogVersion(pointer.data(), input.catalogKind);
  transaction.set(pointerRef, { schemaVersion: STATUS_SCHEMA_VERSION, kind: input.catalogKind, activeCatalogVersion: input.catalogVersion, previousCatalogVersion, updatedAt: timestamp });
  return { result: { operation: input.operation, catalogKind: input.catalogKind, catalogVersion: input.catalogVersion, previousCatalogVersion } };
}

async function applyFeatureFlags({ clock, db, input, timestamp, transaction }) {
  const featureRef = db.doc('appConfig/statusFeatures');
  const snapshot = await transaction.get(featureRef);
  const previous = mapStatusFeatureFlags(snapshot.data());
  const enabling = Object.entries(input.flags).some(([key, value]) => value === true && previous[key] !== true);
  if (enabling) {
    const [operations, vipPointer, aristocracyPointer, reconciliation, migration, sourceDead, projectionDead, sourceQueued, projectionQueued] = await Promise.all([
      transaction.get(db.doc('appRuntime/statusOperations')),
      transaction.get(db.doc('statusCatalogPointers/vip-svip')),
      transaction.get(db.doc('statusCatalogPointers/aristocracy')),
      transaction.get(db.doc('statusOperations/reconciliation')),
      transaction.get(db.doc('statusOperations/migration')),
      transaction.get(db.collection('statusSourceOutbox').where('state', '==', 'dead-letter').limit(1)),
      transaction.get(db.collection('statusPresentationJobs').where('state', '==', 'dead-letter').limit(1)),
      transaction.get(db.collection('statusSourceOutbox').where('state', '==', 'queued').orderBy('nextAttemptAt', 'asc').limit(1)),
      transaction.get(db.collection('statusPresentationJobs').where('state', '==', 'queued').orderBy('nextAttemptAt', 'asc').limit(1)),
    ]);
    const signoffs = sanitizeSignoffs(operations.data()?.signoffs);
    if (Object.values(signoffs).some((value) => value !== true)) return { errorCode: 'SIGNOFFS_INCOMPLETE' };
    const readiness = deriveOperationsReadiness({
      vip: { activeCatalogVersion: activeCatalogVersion(vipPointer.data(), 'vip-svip') },
      aristocracy: { activeCatalogVersion: activeCatalogVersion(aristocracyPointer.data(), 'aristocracy') },
      flags: previous,
      migrations: sanitizeMigration(migration.data()),
      queues: {
        deadLetterCount: sourceDead.size + projectionDead.size,
        oldestQueuedAgeMs: queueAgeFromSnapshots([sourceQueued, projectionQueued], clock.nowMillis()),
        sampled: false,
      },
      reconciliation: { assessed: Number.isSafeInteger(reconciliation.data()?.completedAtMillis) && reconciliation.data().completedAtMillis > 0, consecutiveDriftRuns: readCount(reconciliation.data()?.consecutiveDriftRuns) },
      signoffs,
    });
    if (!readiness.canActivate) return { errorCode: 'ACTIVATION_NOT_READY' };
  }
  transaction.set(featureRef, { ...previous, ...input.flags, updatedAt: timestamp });
  return { result: { operation: input.operation, flags: input.flags, previous: Object.fromEntries(Object.keys(input.flags).map((key) => [key, previous[key]])) } };
}

function applyMigrationState({ db, input, timestamp, transaction }) {
  const result = { ...input.migration, assessed: true };
  transaction.set(db.doc('statusOperations/migration'), { schemaVersion: STATUS_SCHEMA_VERSION, ...result, updatedAt: timestamp });
  return { result: { operation: input.operation, migration: result } };
}

async function applySignoffs({ db, input, timestamp, transaction }) {
  const operationsRef = db.doc('appRuntime/statusOperations');
  const snapshot = await transaction.get(operationsRef);
  const previous = sanitizeSignoffs(snapshot.data()?.signoffs);
  const signoffs = { ...previous, ...input.signoffs };
  transaction.set(operationsRef, {
    signoffs,
    signoffsUpdatedAt: timestamp,
  }, { merge: true });
  return { result: { operation: input.operation, signoffs, previous } };
}

function queueProjection({ db, eventId, timestamp, transaction, uid }) { const jobId = `status_admin_${eventId}`; transaction.create(db.doc(`statusPresentationJobs/${jobId}`), { schemaVersion: STATUS_SCHEMA_VERSION, jobId, uid, sourceEventId: eventId, state: 'queued', attempts: 0, createdAt: timestamp, nextAttemptAt: timestamp, updatedAt: timestamp }); }
function summarizeVipReconciliation(value) { return { clean: value.clean === true, truncated: value.truncated === true, accountCount: readCount(value.accountCount), contributionCount: readCount(value.contributionCount), signedPointTotal: safeNumber(value.signedPointTotal), mismatchCount: Array.isArray(value.mismatches) ? value.mismatches.length : 0, errorCount: Array.isArray(value.errors) ? value.errors.length : 0 }; }
function summarizeAristocracyReconciliation(value) { return { clean: value.clean === true, truncated: value.truncated === true, transactionCount: readCount(value.transactionCount), walletLedgerCount: readCount(value.walletLedgerCount), entitlementCount: readCount(value.entitlementCount), paidAmountCoins: safeNumber(value.paidAmountCoins), errorCount: Array.isArray(value.errors) ? value.errors.length : 0 }; }
function sanitizeProposal(doc) { const data = doc.data(); return { proposalId: doc.id, kind: cleanString(data?.kind, 40), operation: cleanString(data?.input?.operation || data?.action, 40), initiatedBy: cleanString(data?.initiatedBy, 128), targetUid: cleanString(data?.input?.targetUid || data?.targetUid, 128), createdAtMillis: timestampMillis(data?.createdAt) || 0 }; }
function sanitizeAlert(doc) { const data = doc.data(); return { alertId: doc.id, code: cleanString(data?.code, 80), severity: cleanString(data?.severity, 20), state: cleanString(data?.state, 20), createdAtMillis: timestampMillis(data?.createdAt) || 0 }; }
function sanitizeReconciliation(data) { return { dirty: data?.dirty === true, consecutiveDriftRuns: readCount(data?.consecutiveDriftRuns), completedAtMillis: safeNumber(data?.completedAtMillis), vip: data?.vip || null, aristocracy: data?.aristocracy || null }; }
function sanitizeMigration(data) { return { assessed: data?.assessed === true, required: data?.required === true, verified: data?.verified === true, userCount: readCount(data?.userCount), snapshotHash: cleanString(data?.snapshotHash, 64), catalogVersion: cleanString(data?.catalogVersion, 80) }; }
function sanitizeSignoffs(data) { return Object.fromEntries(['product', 'economy', 'security', 'support', 'qa'].map((key) => [key, data?.[key] === true])); }
function sanitizeDoc(doc, keys) { const data = doc.data(); const value = { id: doc.id }; for (const key of keys) { const candidate = data?.[key]; const millis = timestampMillis(candidate); value[key] = Number.isFinite(millis) ? millis : candidate; } return value; }
function oldestMillis(docs, field) { if (!docs.length) return Number.POSITIVE_INFINITY; return Math.min(...docs.map((doc) => timestampMillis(doc.data()?.[field])).filter(Number.isFinite)); }
function countBy(docs, selector) { const counts = {}; for (const doc of docs) { const key = selector(doc); counts[key] = (counts[key] || 0) + 1; } return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right))); }
function queueAgeFromSnapshots(snapshots, nowMillis) { const oldest = oldestMillis(snapshots.flatMap((snapshot) => snapshot.docs), 'createdAt'); return Number.isFinite(oldest) ? Math.max(0, nowMillis - oldest) : 0; }
function timestampMillis(value) { if (value && typeof value.toMillis === 'function') return value.toMillis(); if (value && typeof value.toDate === 'function') return value.toDate().getTime(); return Number.NaN; }
function safeNumber(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function readCount(value) { return Number.isSafeInteger(value) && value >= 0 ? value : 0; }
function cleanString(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function sameJson(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function activeAdminToken(token, roles) { return token?.admin === true && roles.includes(token.adminRole) && typeof token.uid === 'string'; }
function activeAdminProfile(profile, token, roles) { return profile?.uid === token?.uid && profile?.status === 'active' && profile?.role === token?.adminRole && roles.includes(profile.role); }
function systemClock() { return { nowMillis: () => Date.now() }; }

module.exports = {
  approveAnyStatusOperation,
  approveStatusOperation,
  emergencyFreezeStatus,
  getStatusOperationsOverview,
  inspectStatusUser,
  proposeAnyStatusOperation,
  proposeStatusOperation,
  runStatusReconciliation,
};
