'use strict';

const {
  STATUS_SCHEMA_VERSION,
  mapStatusFeatureFlags,
  mapVipContribution,
  normalizeStatusSourceOutbox,
  normalizeVipCatalogVersion,
} = require('./statusMembershipCore');
const {
  STATUS_SOURCE_KINDS,
  buildVipProgressionMutation,
  buildVipReconciliationReport,
  calculateVipPointDelta,
  validCompletedReversal,
  validCompletedTransfer,
} = require('./statusProgressionCore');
const { activeCatalogVersion } = require('./statusMembershipService');

const STATUS_SOURCE_BATCH_LIMIT = 100;
const STATUS_SOURCE_MAX_ATTEMPTS = 12;
const VIP_RECONCILIATION_PAGE_SIZE = 500;
const VIP_RECONCILIATION_MAX_DOCS = 1_000_000;

async function processStatusSourceOutbox({ clock = systemClock(), db, fieldValue, limit = STATUS_SOURCE_BATCH_LIMIT }) {
  const flagsSnapshot = await db.doc('appConfig/statusFeatures').get();
  const flags = mapStatusFeatureFlags(flagsSnapshot.exists ? flagsSnapshot.data() : undefined);
  if (!flags.vipProgression && !flags.statusProjectionRepair) return emptyProcessingResult('feature-disabled');
  const activeCatalog = await readActiveVipCatalog(db);
  if (!activeCatalog.ok) return emptyProcessingResult(activeCatalog.code.toLowerCase().replaceAll('_', '-'));
  const safeLimit = Number.isSafeInteger(limit) && limit >= 1 ? Math.min(limit, STATUS_SOURCE_BATCH_LIMIT) : STATUS_SOURCE_BATCH_LIMIT;
  const now = clock.timestampFromMillis(clock.nowMillis());
  const snapshot = await db.collection('statusSourceOutbox')
    .where('state', '==', 'queued')
    .where('nextAttemptAt', '<=', now)
    .orderBy('nextAttemptAt', 'asc')
    .limit(safeLimit)
    .get();
  const result = { scanned: snapshot.size, processed: 0, replayed: 0, promoted: 0, demoted: 0, failures: [] };
  for (const document of snapshot.docs) {
    const event = normalizeStatusSourceOutbox(document.data(), document.id);
    if (!event) {
      result.failures.push({ eventId: document.id, errorCode: 'INVALID_SOURCE_EVENT' });
      await document.ref.update({
        lastError: 'INVALID_SOURCE_EVENT',
        state: 'dead-letter',
        updatedAt: fieldValue.serverTimestamp(),
      });
      continue;
    }
    try {
      const processed = await processStatusSourceEvent({ clock, db, event, fieldValue });
      result.processed += 1;
      if (processed.replayed) result.replayed += 1;
      if (processed.transitionKind === 'promotion') result.promoted += 1;
      if (processed.transitionKind === 'demotion') result.demoted += 1;
    } catch (error) {
      const errorCode = safeErrorCode(error);
      result.failures.push({ eventId: event.eventId, errorCode });
      await recordSourceFailure({ clock, event, eventRef: document.ref, errorCode, fieldValue });
    }
  }
  return result;
}

async function processStatusSourceEvent({ clock = systemClock(), db, event, fieldValue }) {
  const inputEvent = normalizeStatusSourceOutbox(event, event?.eventId);
  if (!inputEvent) throw statusError('INVALID_SOURCE_EVENT');
  event = inputEvent;
  return db.runTransaction(async (transaction) => {
    const refs = {
      event: db.doc(`statusSourceOutbox/${event.eventId}`),
      contribution: db.doc(`vipContributions/${event.eventId}`),
      account: db.doc(`vipAccounts/${event.uid}`),
      pointer: db.doc('statusCatalogPointers/vip-svip'),
      source: db.doc(event.sourceKind === STATUS_SOURCE_KINDS.recharge
        ? `representativeTransfers/${event.sourceId}`
        : `representativeTransferReversals/${event.sourceId}`),
      ...(event.reversalOf ? { originalContribution: db.doc(`vipContributions/${event.reversalOf}`) } : {}),
    };
    const eventSnapshot = await transaction.get(refs.event);
    const currentEvent = normalizeStatusSourceOutbox(eventSnapshot.data(), event.eventId);
    if (!currentEvent) throw statusError('INVALID_SOURCE_EVENT');
    if (currentEvent.state === 'completed') return { replayed: true, transitionKind: null };
    if (currentEvent.state !== 'queued' && currentEvent.state !== 'processing') throw statusError('SOURCE_EVENT_NOT_PROCESSABLE');
    const pointer = await transaction.get(refs.pointer);
    const catalogVersion = activeCatalogVersion(pointer.data(), 'vip-svip');
    if (!catalogVersion) throw statusError('CATALOG_UNAVAILABLE');
    const catalogRef = db.doc(`vipTierCatalogVersions/${catalogVersion}`);
    const [catalogSnapshot, sourceSnapshot, contributionSnapshot, accountSnapshot] = await Promise.all([
      transaction.get(catalogRef),
      transaction.get(refs.source),
      transaction.get(refs.contribution),
      transaction.get(refs.account),
    ]);
    const normalizedCatalog = normalizeVipCatalogVersion(catalogSnapshot.data());
    if (!normalizedCatalog.ok || normalizedCatalog.value.state !== 'published'
      || normalizedCatalog.value.catalogVersion !== catalogVersion) throw statusError('CATALOG_UNAVAILABLE');
    verifyAuthoritativeSource(currentEvent, sourceSnapshot.data());
    const pointDelta = calculateVipPointDelta(currentEvent.amount, currentEvent.sourceKind, normalizedCatalog.value.pointPolicy);
    if (!pointDelta.ok) throw statusError(pointDelta.code);
    if (contributionSnapshot.exists) {
      const existing = mapVipContribution(contributionSnapshot.data(), currentEvent.eventId);
      if (!sameContribution(existing, currentEvent, catalogVersion, pointDelta.value)) throw statusError('CONTRIBUTION_CONFLICT');
      transaction.update(refs.event, {
        lastError: fieldValue.delete(),
        processedAt: fieldValue.serverTimestamp(),
        state: 'completed',
        updatedAt: fieldValue.serverTimestamp(),
      });
      return { replayed: true, transitionKind: null };
    }
    if (currentEvent.sourceKind === STATUS_SOURCE_KINDS.reversal) {
      const originalSnapshot = await transaction.get(refs.originalContribution);
      const original = originalSnapshot.exists ? mapVipContribution(originalSnapshot.data(), currentEvent.reversalOf) : null;
      if (!original) throw statusError('ORIGINAL_CONTRIBUTION_PENDING');
      if (original.kind !== STATUS_SOURCE_KINDS.recharge || original.uid !== currentEvent.uid
        || original.sourceId !== currentEvent.sourceId || original.policyVersion !== catalogVersion
        || original.pointDelta !== Math.abs(pointDelta.value)) throw statusError('REVERSAL_LINK_MISMATCH');
    }
    const timestamp = fieldValue.serverTimestamp();
    const mutation = buildVipProgressionMutation({
      account: accountSnapshot.exists ? accountSnapshot.data() : null,
      catalog: normalizedCatalog.value,
      eventId: currentEvent.eventId,
      pointDelta: pointDelta.value,
      timestamp,
      uid: currentEvent.uid,
    });
    if (!mutation.ok) throw statusError(mutation.code);
    const contribution = {
      schemaVersion: STATUS_SCHEMA_VERSION,
      eventId: currentEvent.eventId,
      uid: currentEvent.uid,
      sourceId: currentEvent.sourceId,
      policyVersion: catalogVersion,
      kind: currentEvent.sourceKind,
      pointDelta: pointDelta.value,
      settlementState: currentEvent.sourceKind === STATUS_SOURCE_KINDS.reversal ? 'reversed' : 'settled',
      amount: currentEvent.amount,
      currency: 'coins',
      occurredAt: sourceSnapshot.data().createdAt,
      createdAt: timestamp,
      ...(currentEvent.reversalOf ? { reversalOf: currentEvent.reversalOf } : {}),
    };
    transaction.create(refs.contribution, contribution);
    transaction.set(refs.account, mutation.value.account);
    if (mutation.value.transition) {
      transaction.create(db.doc(`vipTransitions/${currentEvent.uid}/items/${currentEvent.eventId}`), mutation.value.transition);
    }
    const jobId = `vip_${currentEvent.eventId}`;
    transaction.create(db.doc(`statusPresentationJobs/${jobId}`), {
      schemaVersion: STATUS_SCHEMA_VERSION,
      jobId,
      uid: currentEvent.uid,
      sourceEventId: currentEvent.eventId,
      state: 'queued',
      attempts: 0,
      createdAt: timestamp,
      nextAttemptAt: timestamp,
      updatedAt: timestamp,
    });
    transaction.update(refs.event, {
      lastError: fieldValue.delete(),
      processedAt: timestamp,
      state: 'completed',
      updatedAt: timestamp,
    });
    return { replayed: false, transitionKind: mutation.value.transition?.kind || null };
  });
}

async function reconcileVipProgression({
  db,
  documentIdField = defaultDocumentIdField(),
  maxDocs = VIP_RECONCILIATION_MAX_DOCS,
  pageSize = VIP_RECONCILIATION_PAGE_SIZE,
}) {
  const safePageSize = Number.isSafeInteger(pageSize) && pageSize >= 1
    ? Math.min(pageSize, 1_000)
    : VIP_RECONCILIATION_PAGE_SIZE;
  const safeMaxDocs = Number.isSafeInteger(maxDocs) && maxDocs >= 1
    ? Math.min(maxDocs, VIP_RECONCILIATION_MAX_DOCS)
    : VIP_RECONCILIATION_MAX_DOCS;
  const catalog = await readActiveVipCatalog(db);
  if (!catalog.ok) return catalog;
  const [contributions, accounts] = await Promise.all([
    readAllRows({ collection: db.collection('vipContributions'), documentIdField, maxDocs: safeMaxDocs, pageSize: safePageSize }),
    readAllRows({ collection: db.collection('vipAccounts'), documentIdField, maxDocs: safeMaxDocs, pageSize: safePageSize }),
  ]);
  return buildVipReconciliationReport({
    catalog: catalog.value,
    contributions: contributions.rows,
    accounts: accounts.rows,
    truncated: contributions.truncated || accounts.truncated,
  });
}

async function readAllRows({ collection, documentIdField, maxDocs, pageSize }) {
  const rows = [];
  let cursor = null;
  let truncated = false;
  while (rows.length <= maxDocs) {
    const requested = Math.min(pageSize, maxDocs + 1 - rows.length);
    let query = collection.orderBy(documentIdField).limit(requested);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    for (const document of snapshot.docs) rows.push({ id: document.id, data: document.data() });
    cursor = snapshot.docs.at(-1);
    if (snapshot.size < requested) break;
  }
  if (rows.length > maxDocs) {
    rows.length = maxDocs;
    truncated = true;
  }
  return { rows, truncated };
}

async function readActiveVipCatalog(db) {
  const pointer = await db.doc('statusCatalogPointers/vip-svip').get();
  const catalogVersion = activeCatalogVersion(pointer.data(), 'vip-svip');
  if (!catalogVersion) return { ok: false, code: 'CATALOG_UNAVAILABLE' };
  const catalog = await db.doc(`vipTierCatalogVersions/${catalogVersion}`).get();
  const normalized = normalizeVipCatalogVersion(catalog.data());
  if (!normalized.ok || normalized.value.state !== 'published' || normalized.value.catalogVersion !== catalogVersion) {
    return { ok: false, code: 'CATALOG_UNAVAILABLE' };
  }
  return { ok: true, value: normalized.value };
}

function verifyAuthoritativeSource(event, source) {
  const valid = event.sourceKind === STATUS_SOURCE_KINDS.recharge
    ? validCompletedTransfer(source)
    : validCompletedReversal(source);
  if (!valid || source.amount !== event.amount || source.currency !== 'coins' || source.recipientUid !== event.uid) {
    throw statusError('SOURCE_MISMATCH');
  }
  if (event.sourceKind === STATUS_SOURCE_KINDS.reversal && source.transferId !== event.sourceId) {
    throw statusError('SOURCE_MISMATCH');
  }
}

function sameContribution(contribution, event, policyVersion, pointDelta) {
  return Boolean(contribution
    && contribution.eventId === event.eventId
    && contribution.uid === event.uid
    && contribution.sourceId === event.sourceId
    && contribution.policyVersion === policyVersion
    && contribution.kind === event.sourceKind
    && contribution.pointDelta === pointDelta
    && (contribution.reversalOf || '') === (event.reversalOf || ''));
}

async function recordSourceFailure({ clock, event, eventRef, errorCode, fieldValue }) {
  const attempts = event.attempts + 1;
  const permanent = ['CONTRIBUTION_CONFLICT', 'INVALID_SOURCE_EVENT', 'OVER_REVERSED', 'REVERSAL_LINK_MISMATCH', 'SOURCE_MISMATCH'].includes(errorCode);
  const deadLetter = permanent || attempts >= STATUS_SOURCE_MAX_ATTEMPTS;
  const delayMinutes = Math.min(2 ** Math.min(attempts, 8), 240);
  await eventRef.update({
    attempts,
    lastError: errorCode,
    nextAttemptAt: clock.timestampFromMillis(clock.nowMillis() + delayMinutes * 60_000),
    state: deadLetter ? 'dead-letter' : 'queued',
    updatedAt: fieldValue.serverTimestamp(),
  });
}

function emptyProcessingResult(reason) {
  return { scanned: 0, processed: 0, replayed: 0, promoted: 0, demoted: 0, failures: [], reason };
}

function safeErrorCode(error) {
  const code = typeof error?.statusCode === 'string' ? error.statusCode : '';
  return /^[A-Z0-9_]{3,80}$/.test(code) ? code : 'INTERNAL';
}

function statusError(statusCode) {
  return Object.assign(new Error(statusCode), { statusCode });
}

function systemClock() {
  return {
    nowMillis: () => Date.now(),
    timestampFromMillis: (value) => {
      const { Timestamp } = require('firebase-admin/firestore');
      return Timestamp.fromMillis(value);
    },
  };
}

function defaultDocumentIdField() {
  const { FieldPath } = require('firebase-admin/firestore');
  return FieldPath.documentId();
}

module.exports = {
  STATUS_SOURCE_BATCH_LIMIT,
  STATUS_SOURCE_MAX_ATTEMPTS,
  VIP_RECONCILIATION_MAX_DOCS,
  VIP_RECONCILIATION_PAGE_SIZE,
  processStatusSourceEvent,
  processStatusSourceOutbox,
  readActiveVipCatalog,
  readAllRows,
  reconcileVipProgression,
  sameContribution,
  verifyAuthoritativeSource,
};
