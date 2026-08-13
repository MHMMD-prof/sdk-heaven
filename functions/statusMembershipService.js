'use strict';

const {
  STATUS_SCHEMA_VERSION,
  buildStatusPresentation,
  mapAristocracyEntitlement,
  mapStatusFeatureFlags,
  mapStatusPresentation,
  mapVipAccount,
  mapVipContribution,
  normalizeAristocracyCatalogVersion,
  normalizeProjectionJob,
  normalizeVipCatalogVersion,
  sanitizeAristocracyCatalogForClient,
  sanitizeVipCatalogForClient,
} = require('./statusMembershipCore');

const STATUS_PROJECTION_BATCH_LIMIT = 50;
const STATUS_PROJECTION_MAX_ATTEMPTS = 10;
const STATUS_HISTORY_LIMIT = 20;

async function getStatusOverview({ clock = systemClock(), db, ownerView = false, uid }) {
  const safeUid = typeof uid === 'string' ? uid.trim() : '';
  if (!safeUid) return { errorCode: 'INVALID_REQUEST' };
  const flagsSnapshot = await db.doc('appConfig/statusFeatures').get();
  const flags = mapStatusFeatureFlags(flagsSnapshot.exists ? flagsSnapshot.data() : undefined);
  if (!ownerView && !flags.vipProgression && !flags.aristocracyShop && !flags.statusPresentation) {
    return { result: emptyStatusOverview(flags) };
  }
  const refs = {
    vipAccount: db.doc(`vipAccounts/${safeUid}`),
    aristocracy: db.doc(`aristocracyEntitlements/${safeUid}`),
    vipPointer: db.doc('statusCatalogPointers/vip-svip'),
    aristocracyPointer: db.doc('statusCatalogPointers/aristocracy'),
  };
  const [accountSnapshot, entitlementSnapshot, vipPointer, aristocracyPointer] = await db.getAll(...Object.values(refs));
  const catalogRefs = resolveCatalogRefs(db, vipPointer.data(), aristocracyPointer.data());
  const [vipCatalogSnapshot, aristocracyCatalogSnapshot] = await readCatalogSnapshots(db, catalogRefs);
  const vipCatalog = vipCatalogSnapshot?.exists ? sanitizeVipCatalogForClient(vipCatalogSnapshot.data()) : null;
  const aristocracyCatalog = aristocracyCatalogSnapshot?.exists ? sanitizeAristocracyCatalogForClient(aristocracyCatalogSnapshot.data()) : null;
  const vip = accountSnapshot.exists ? mapVipAccount(accountSnapshot.data(), safeUid) : null;
  const aristocracy = entitlementSnapshot.exists
    ? mapAristocracyEntitlement(entitlementSnapshot.data(), safeUid, clock.nowMillis())
    : null;
  if (accountSnapshot.exists && !vip) return { errorCode: 'VIP_AUTHORITY_INVALID' };
  if (entitlementSnapshot.exists && !aristocracy) return { errorCode: 'ARISTOCRACY_AUTHORITY_INVALID' };
  return {
    result: {
      schemaVersion: STATUS_SCHEMA_VERSION,
      flags,
      vip: vip && (ownerView || flags.vipProgression || flags.statusPresentation) ? {
        band: vip.band,
        catalogVersion: vip.catalogVersion,
        highestLevelOrder: vip.highestLevelOrder,
        level: vip.level,
        levelId: vip.levelId,
        order: vip.order,
        points: vip.points,
        state: vip.state,
      } : null,
      aristocracy: aristocracy && (ownerView || flags.aristocracyShop || flags.statusPresentation) ? {
        catalogVersion: aristocracy.catalogVersion,
        expiresAtMillis: aristocracy.expiresAtMillis,
        rankId: aristocracy.rankId,
        rankOrder: aristocracy.rankOrder,
        state: aristocracy.state,
      } : null,
      catalogs: {
        vip: ownerView || flags.vipProgression ? vipCatalog : null,
        aristocracy: ownerView || flags.aristocracyShop ? aristocracyCatalog : null,
      },
    },
  };
}

async function getStatusCenter({ clock = systemClock(), db, uid }) {
  const overview = await getStatusOverview({ clock, db, ownerView: true, uid });
  if (overview.errorCode) return overview;
  const safeUid = typeof uid === 'string' ? uid.trim() : '';
  if (!safeUid) return { errorCode: 'INVALID_REQUEST' };
  const [visibilitySnapshot, vipSnapshot, aristocracySnapshot] = await Promise.all([
    db.doc(`statusVisibility/${safeUid}`).get(),
    db.collection('vipContributions').where('uid', '==', safeUid).orderBy('occurredAt', 'desc').limit(STATUS_HISTORY_LIMIT).get(),
    db.collection('aristocracyTransactions').where('uid', '==', safeUid).orderBy('createdAt', 'desc').limit(STATUS_HISTORY_LIMIT).get(),
  ]);
  return {
    result: {
      ...overview.result,
      history: {
        vip: vipSnapshot.docs.map(sanitizeVipHistory).filter(Boolean),
        aristocracy: aristocracySnapshot.docs.map((document) => sanitizeAristocracyHistory(document, safeUid)).filter(Boolean),
      },
      visibility: visibilitySnapshot.exists && visibilitySnapshot.data()?.publicDisplay === false ? 'hidden' : 'public',
    },
  };
}

async function updateStatusVisibility({ db, fieldValue, input, requestId, uid }) {
  const safeUid = typeof uid === 'string' ? uid.trim() : '';
  if (!safeUid || !/^[A-Za-z0-9_-]{16,80}$/.test(requestId || '') || typeof input?.publicDisplay !== 'boolean') {
    return { errorCode: 'INVALID_REQUEST' };
  }
  return db.runTransaction(async (transaction) => {
    const commandRef = db.doc(`statusCommandRequests/${safeUid}/requests/${requestId}`);
    const visibilityRef = db.doc(`statusVisibility/${safeUid}`);
    const command = await transaction.get(commandRef);
    if (command.exists) {
      const previous = command.data();
      return previous?.action === 'update-status-visibility' && previous.publicDisplay === input.publicDisplay && previous.result
        ? { result: previous.result }
        : { errorCode: 'REQUEST_CONFLICT' };
    }
    const timestamp = fieldValue.serverTimestamp();
    const result = { visibility: input.publicDisplay ? 'public' : 'hidden', syncState: 'pending' };
    transaction.set(visibilityRef, {
      schemaVersion: STATUS_SCHEMA_VERSION,
      uid: safeUid,
      publicDisplay: input.publicDisplay,
      updatedAt: timestamp,
    }, { merge: true });
    const jobId = `visibility_${requestId}`;
    transaction.create(db.doc(`statusPresentationJobs/${jobId}`), {
      schemaVersion: STATUS_SCHEMA_VERSION,
      jobId,
      uid: safeUid,
      sourceEventId: requestId,
      state: 'queued',
      attempts: 0,
      createdAt: timestamp,
      nextAttemptAt: timestamp,
      updatedAt: timestamp,
    });
    transaction.create(commandRef, {
      schemaVersion: STATUS_SCHEMA_VERSION,
      action: 'update-status-visibility',
      uid: safeUid,
      requestId,
      publicDisplay: input.publicDisplay,
      createdAt: timestamp,
      result,
    });
    return { result };
  });
}

function sanitizeVipHistory(document) {
  const mapped = mapVipContribution(document.data(), document.id);
  const occurredAtMillis = timestampMillis(document.data()?.occurredAt);
  if (!mapped || !Number.isFinite(occurredAtMillis)) return null;
  return {
    eventId: mapped.eventId,
    kind: mapped.kind,
    pointDelta: mapped.pointDelta,
    settlementState: mapped.settlementState,
    occurredAtMillis,
  };
}

function sanitizeAristocracyHistory(document, uid) {
  const data = document.data();
  const createdAtMillis = timestampMillis(data?.createdAt);
  const expiresAtMillis = timestampMillis(data?.expiresAt);
  if (!data || data.schemaVersion !== STATUS_SCHEMA_VERSION || data.transactionId !== document.id || data.uid !== uid
    || !['purchase', 'renewal', 'upgrade', 'complimentary-grant', 'admin-revoke', 'freeze', 'unfreeze', 'expiry'].includes(data.kind)
    || typeof data.rankId !== 'string' || !/^[a-z0-9][a-z0-9_-]{2,39}$/.test(data.rankId)
    || !Number.isSafeInteger(data.rankOrder) || data.rankOrder < 1 || data.rankOrder > 20
    || !Number.isSafeInteger(data.amountCoins) || data.amountCoins < 0
    || !Number.isFinite(createdAtMillis) || !Number.isFinite(expiresAtMillis)) return null;
  return {
    transactionId: document.id,
    kind: data.kind,
    rankId: data.rankId,
    rankOrder: data.rankOrder,
    amountCoins: data.amountCoins,
    createdAtMillis,
    expiresAtMillis,
  };
}

function timestampMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  return Number.NaN;
}

function emptyStatusOverview(flags) {
  return {
    schemaVersion: STATUS_SCHEMA_VERSION,
    flags,
    vip: null,
    aristocracy: null,
    catalogs: { vip: null, aristocracy: null },
  };
}

async function processStatusProjectionJobs({ clock = systemClock(), db, fieldValue, limit = STATUS_PROJECTION_BATCH_LIMIT }) {
  const flagsSnapshot = await db.doc('appConfig/statusFeatures').get();
  const flags = mapStatusFeatureFlags(flagsSnapshot.exists ? flagsSnapshot.data() : undefined);
  if (!flags.statusPresentation || !flags.statusProjectionRepair) {
    return { processed: 0, reason: 'feature-disabled', repaired: 0, scanned: 0 };
  }
  const safeLimit = Number.isSafeInteger(limit) && limit >= 1
    ? Math.min(limit, STATUS_PROJECTION_BATCH_LIMIT)
    : STATUS_PROJECTION_BATCH_LIMIT;
  const now = clock.timestampFromMillis(clock.nowMillis());
  const snapshot = await db.collection('statusPresentationJobs')
    .where('state', '==', 'queued')
    .where('nextAttemptAt', '<=', now)
    .orderBy('nextAttemptAt', 'asc')
    .limit(safeLimit)
    .get();
  let processed = 0;
  let repaired = 0;
  const failures = [];
  for (const document of snapshot.docs) {
    const job = normalizeProjectionJob(document.data(), document.id);
    if (!job) {
      failures.push({ jobId: document.id, errorCode: 'INVALID_JOB' });
      await document.ref.update({
        lastError: 'INVALID_JOB',
        state: 'dead-letter',
        updatedAt: fieldValue.serverTimestamp(),
      });
      continue;
    }
    try {
      const result = await projectStatusForUser({ clock, db, fieldValue, job, jobRef: document.ref });
      processed += 1;
      if (result.changed) repaired += 1;
    } catch (error) {
      const errorCode = safeErrorCode(error);
      failures.push({ jobId: document.id, errorCode });
      await recordProjectionFailure({ clock, fieldValue, job, jobRef: document.ref, errorCode });
    }
  }
  return { failures, processed, repaired, scanned: snapshot.size };
}

async function projectStatusForUser({ clock = systemClock(), db, fieldValue, job, jobRef }) {
  const pointerRefs = {
    vip: db.doc('statusCatalogPointers/vip-svip'),
    aristocracy: db.doc('statusCatalogPointers/aristocracy'),
  };
  const [vipPointer, aristocracyPointer] = await db.getAll(pointerRefs.vip, pointerRefs.aristocracy);
  const catalogRefs = resolveCatalogRefs(db, vipPointer.data(), aristocracyPointer.data());
  return db.runTransaction(async (transaction) => {
    const refs = {
      account: db.doc(`vipAccounts/${job.uid}`),
      entitlement: db.doc(`aristocracyEntitlements/${job.uid}`),
      profile: db.doc(`publicProfiles/${job.uid}`),
      visibility: db.doc(`statusVisibility/${job.uid}`),
      ...(catalogRefs.vip ? { vipCatalog: catalogRefs.vip } : {}),
      ...(catalogRefs.aristocracy ? { aristocracyCatalog: catalogRefs.aristocracy } : {}),
    };
    const snapshots = {};
    for (const [key, ref] of Object.entries(refs)) snapshots[key] = await transaction.get(ref);
    if (!snapshots.profile.exists) throw statusError('PROFILE_NOT_FOUND');
    const account = snapshots.account.exists ? mapVipAccount(snapshots.account.data(), job.uid) : null;
    const entitlement = snapshots.entitlement.exists
      ? mapAristocracyEntitlement(snapshots.entitlement.data(), job.uid, clock.nowMillis())
      : null;
    if (snapshots.account.exists && !account) throw statusError('VIP_AUTHORITY_INVALID');
    if (snapshots.entitlement.exists && !entitlement) throw statusError('ARISTOCRACY_AUTHORITY_INVALID');
    const vipCatalog = snapshots.vipCatalog?.exists ? normalizeVipCatalogVersion(snapshots.vipCatalog.data()) : null;
    const aristocracyCatalog = snapshots.aristocracyCatalog?.exists
      ? normalizeAristocracyCatalogVersion(snapshots.aristocracyCatalog.data())
      : null;
    if (account && (!vipCatalog?.ok || vipCatalog.value.state !== 'published')) throw statusError('VIP_CATALOG_UNAVAILABLE');
    if (entitlement && (!aristocracyCatalog?.ok || aristocracyCatalog.value.state !== 'published')) {
      throw statusError('ARISTOCRACY_CATALOG_UNAVAILABLE');
    }
    const visibility = snapshots.visibility.exists && snapshots.visibility.data()?.publicDisplay === false ? 'hidden' : 'public';
    const projection = buildStatusPresentation({
      account,
      aristocracy: entitlement,
      aristocracyCatalog: aristocracyCatalog?.value,
      nowMillis: clock.nowMillis(),
      visibility,
      vipCatalog: vipCatalog?.value,
    });
    if (!projection.ok) throw statusError(projection.code);
    const current = mapStatusPresentation(snapshots.profile.data()?.statusPresentation);
    const changed = !sameProjection(current, projection.value);
    const timestamp = fieldValue.serverTimestamp();
    if (changed) transaction.update(refs.profile, { statusPresentation: projection.value, updatedAt: timestamp });
    transaction.update(jobRef, {
      completedAt: timestamp,
      lastError: fieldValue.delete(),
      processedProjection: projection.value,
      state: 'completed',
      updatedAt: timestamp,
    });
    return { changed, projection: projection.value };
  });
}

async function recordProjectionFailure({ clock, fieldValue, job, jobRef, errorCode }) {
  const attempts = job.attempts + 1;
  const deadLetter = attempts >= STATUS_PROJECTION_MAX_ATTEMPTS;
  const delayMinutes = Math.min(2 ** Math.min(attempts, 8), 240);
  await jobRef.update({
    attempts,
    lastError: errorCode,
    nextAttemptAt: clock.timestampFromMillis(clock.nowMillis() + delayMinutes * 60_000),
    state: deadLetter ? 'dead-letter' : 'queued',
    updatedAt: fieldValue.serverTimestamp(),
  });
}

function resolveCatalogRefs(db, vipPointer, aristocracyPointer) {
  const vipVersion = activeCatalogVersion(vipPointer, 'vip-svip');
  const aristocracyVersion = activeCatalogVersion(aristocracyPointer, 'aristocracy');
  return {
    vip: vipVersion ? db.doc(`vipTierCatalogVersions/${vipVersion}`) : null,
    aristocracy: aristocracyVersion ? db.doc(`aristocracyCatalogVersions/${aristocracyVersion}`) : null,
  };
}

async function readCatalogSnapshots(db, refs) {
  const present = [refs.vip, refs.aristocracy].filter(Boolean);
  if (!present.length) return [null, null];
  const snapshots = await db.getAll(...present);
  let index = 0;
  const vip = refs.vip ? snapshots[index++] : null;
  const aristocracy = refs.aristocracy ? snapshots[index] : null;
  return [vip, aristocracy];
}

function activeCatalogVersion(pointer, kind) {
  if (!pointer || pointer.schemaVersion !== STATUS_SCHEMA_VERSION || pointer.kind !== kind) return '';
  const value = typeof pointer.activeCatalogVersion === 'string' ? pointer.activeCatalogVersion.trim().toLowerCase() : '';
  return /^[a-z0-9][a-z0-9_-]{2,79}$/.test(value) ? value : '';
}

function sameProjection(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
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

module.exports = {
  STATUS_PROJECTION_BATCH_LIMIT,
  STATUS_PROJECTION_MAX_ATTEMPTS,
  activeCatalogVersion,
  emptyStatusOverview,
  getStatusCenter,
  getStatusOverview,
  processStatusProjectionJobs,
  projectStatusForUser,
  resolveCatalogRefs,
  sameProjection,
  updateStatusVisibility,
};
