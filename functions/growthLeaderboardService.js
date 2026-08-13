'use strict';

const { mapGrowthFeatures } = require('./growthRolloutCore');
const { incrementGrowthTelemetry } = require('./growthTelemetryCore');
const {
  listDefaultVipCatalog,
  mapVipProjection,
  mapVipTier,
  resolveVipTierForCredit,
} = require('./growthVipCore');
const {
  FAMILY_LEADERBOARD_KINDS,
  LEADERBOARD_FALLBACK_SCAN_LIMIT,
  LEADERBOARD_KINDS,
  LEADERBOARD_LIMIT,
  LEADERBOARD_WINDOWS,
  buildBoardId,
  buildPeriodId,
  compareLeaderboardEntries,
  isBoardFresh,
  isFamilyLeaderboardKind,
  isLeaderboardIndexError,
  mapLeaderboardDocument,
  mapLeaderboardEntry,
  mapLeaderboardFamilyScore,
  mapLeaderboardUserScore,
  normalizeGetLeaderboardInput,
  normalizeLeaderboardScope,
  rankEntries,
  scoreFieldForKind,
} = require('./growthLeaderboardCore');

async function readGrowthFeatureFlags(db) {
  const snapshot = await db.doc('appConfig/growthFeatures').get();
  return mapGrowthFeatures(snapshot.exists ? snapshot.data() : {});
}

async function applyGiftLeaderboardContribution({
  db,
  fieldValue,
  contribution,
  skipTelemetry = false,
}) {
  const flags = await readGrowthFeatureFlags(db);
  if (flags.leaderboards !== true) {
    return { ok: true, skipped: true, reason: 'FEATURE_DISABLED' };
  }

  const normalized = normalizeGiftContribution(contribution);
  if (!normalized.ok) return { ok: false, code: normalized.code };

  const {
    eventId,
    nowMs,
    priceCoins,
    recipientCountryCode,
    recipientDisplayName,
    recipientPublicId,
    recipientUid,
    scoreValue,
    senderCountryCode,
    senderDisplayName,
    senderPublicId,
    senderUid,
  } = normalized.value;

  const factRef = db.doc(`leaderboardGiftFacts/${eventId}`);
  const periodIds = [];
  for (const window of LEADERBOARD_WINDOWS) {
    const period = buildPeriodId({ window, nowMs });
    if (!period.ok) return { ok: false, code: period.code || 'INVALID_PERIOD' };
    periodIds.push({ periodId: period.value, window });
  }

  const weeklyPeriod = periodIds.find((row) => row.window === 'weekly');
  const familiesEnabled = flags.families === true;

  let skippedDuplicate = false;
  let familyContribution = null;
  try {
    await db.runTransaction(async (transaction) => {
      const factSnap = await transaction.get(factRef);
      if (factSnap.exists) {
        skippedDuplicate = true;
        return;
      }

      const userRefs = [];
      for (const { periodId } of periodIds) {
        userRefs.push({
          periodId,
          recipientRef: db.doc(`leaderboardPeriods/${periodId}/users/${recipientUid}`),
          senderRef: db.doc(`leaderboardPeriods/${periodId}/users/${senderUid}`),
        });
      }

      const membershipReads = familiesEnabled && weeklyPeriod
        ? await Promise.all([
          transaction.get(db.doc(`familyMemberships/${senderUid}`)),
          transaction.get(db.doc(`familyMemberships/${recipientUid}`)),
        ])
        : [null, null];
      const senderFamilyId = membershipReads[0]?.exists
        ? (typeof membershipReads[0].data()?.familyId === 'string' ? membershipReads[0].data().familyId : '')
        : '';
      const recipientFamilyId = membershipReads[1]?.exists
        ? (typeof membershipReads[1].data()?.familyId === 'string' ? membershipReads[1].data().familyId : '')
        : '';

      const familyTargetById = new Map();
      if (weeklyPeriod && senderFamilyId) {
        familyTargetById.set(senderFamilyId, {
          charm: false,
          familyId: senderFamilyId,
          wealth: true,
        });
      }
      if (weeklyPeriod && recipientFamilyId) {
        const existing = familyTargetById.get(recipientFamilyId) || {
          charm: false,
          familyId: recipientFamilyId,
          wealth: false,
        };
        existing.charm = true;
        familyTargetById.set(recipientFamilyId, existing);
      }

      const familyTargets = [...familyTargetById.values()];
      const familyDocs = familyTargets.length
        ? await Promise.all(
          familyTargets.map((row) => transaction.get(
            db.doc(`leaderboardPeriods/${weeklyPeriod.periodId}/families/${row.familyId}`),
          )),
        )
        : [];
      const familyMeta = familyTargets.length
        ? await Promise.all(
          familyTargets.map((row) => transaction.get(db.doc(`families/${row.familyId}`))),
        )
        : [];

      const reads = await Promise.all(
        userRefs.flatMap(({ recipientRef, senderRef }) => [
          transaction.get(senderRef),
          transaction.get(recipientRef),
        ]),
      );

      const timestamp = fieldValue.serverTimestamp();
      transaction.create(factRef, {
        createdAt: timestamp,
        eventId,
        nowMs,
        priceCoins,
        recipientUid,
        scoreValue,
        senderUid,
      });

      let readIndex = 0;
      for (const { periodId, recipientRef, senderRef } of userRefs) {
        const senderSnap = reads[readIndex++];
        const recipientSnap = reads[readIndex++];
        const senderPrev = mapLeaderboardUserScore(
          senderSnap.exists ? { uid: senderUid, ...senderSnap.data() } : { uid: senderUid },
        );
        const recipientPrev = mapLeaderboardUserScore(
          recipientSnap.exists ? { uid: recipientUid, ...recipientSnap.data() } : { uid: recipientUid },
        );

        transaction.set(senderRef, {
          countryCode: senderCountryCode || senderPrev?.countryCode || '',
          displayName: senderDisplayName || senderPrev?.displayName || '',
          firstContributionAtMs: senderPrev?.firstContributionAtMs
            ? Math.min(senderPrev.firstContributionAtMs, nowMs)
            : nowMs,
          lastContributionAtMs: nowMs,
          periodId,
          publicId: senderPublicId || senderPrev?.publicId || '',
          uid: senderUid,
          updatedAt: timestamp,
          wealthCoins: fieldValue.increment(priceCoins),
        }, { merge: true });

        transaction.set(recipientRef, {
          charmScore: fieldValue.increment(scoreValue),
          countryCode: recipientCountryCode || recipientPrev?.countryCode || '',
          displayName: recipientDisplayName || recipientPrev?.displayName || '',
          firstContributionAtMs: recipientPrev?.firstContributionAtMs
            ? Math.min(recipientPrev.firstContributionAtMs, nowMs)
            : nowMs,
          lastContributionAtMs: nowMs,
          periodId,
          publicId: recipientPublicId || recipientPrev?.publicId || '',
          uid: recipientUid,
          updatedAt: timestamp,
        }, { merge: true });
      }

      for (let index = 0; index < familyTargets.length; index += 1) {
        const row = familyTargets[index];
        const prevSnap = familyDocs[index];
        const meta = familyMeta[index]?.exists ? familyMeta[index].data() : null;
        const prev = mapLeaderboardFamilyScore(
          prevSnap.exists
            ? { familyId: row.familyId, ...prevSnap.data() }
            : { familyId: row.familyId },
        );
        const displayName = typeof meta?.nameAr === 'string'
          ? meta.nameAr.trim().slice(0, 80)
          : (prev?.displayName || '');
        const payload = {
          displayName,
          familyId: row.familyId,
          firstContributionAtMs: prev?.firstContributionAtMs
            ? Math.min(prev.firstContributionAtMs, nowMs)
            : nowMs,
          lastContributionAtMs: nowMs,
          periodId: weeklyPeriod.periodId,
          updatedAt: timestamp,
        };
        if (row.wealth) payload.wealthCoins = fieldValue.increment(priceCoins);
        if (row.charm) payload.charmScore = fieldValue.increment(scoreValue);
        transaction.set(
          db.doc(`leaderboardPeriods/${weeklyPeriod.periodId}/families/${row.familyId}`),
          payload,
          { merge: true },
        );
      }

      if (familyTargets.length) {
        familyContribution = {
          recipientFamilyId,
          senderFamilyId,
        };
      }
    });
  } catch (error) {
    console.error(
      '[growthLeaderboard] applyGiftLeaderboardContribution failed',
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, code: 'INTERNAL' };
  }

  if (skippedDuplicate) {
    return { ok: true, skipped: true, reason: 'DUPLICATE_EVENT' };
  }

  await enqueueLeaderboardRefreshQueue({
    db,
    fieldValue,
    nowMs,
    recipientCountryCode,
    senderCountryCode,
  });

  if (familyContribution) {
    await enqueueFamilyLeaderboardRefreshQueue({
      db,
      fieldValue,
      nowMs,
    });
  }

  if (!skipTelemetry && priceCoins > 0) {
    await incrementGrowthTelemetry({
      db,
      fieldValue,
      input: { amount: priceCoins, key: 'giftGmvCoins' },
    }).catch(() => undefined);
  }

  return { ok: true, skipped: false };
}

async function enqueueLeaderboardRefreshQueue({
  db,
  fieldValue,
  nowMs,
  recipientCountryCode,
  senderCountryCode,
}) {
  const scopesByKind = {
    charm: uniqueScopes(['global', recipientCountryCode]),
    wealth: uniqueScopes(['global', senderCountryCode]),
  };
  const timestamp = fieldValue.serverTimestamp();
  const batch = db.batch();
  let writes = 0;
  for (const kind of LEADERBOARD_KINDS) {
    for (const window of LEADERBOARD_WINDOWS) {
      for (const scope of scopesByKind[kind]) {
        const boardId = buildBoardId({ kind, window, scope });
        if (!boardId) continue;
        batch.set(db.doc(`leaderboardRefreshQueue/${boardId}`), {
          boardId,
          enqueuedAt: timestamp,
          enqueuedAtMs: nowMs,
          kind,
          scope,
          window,
        }, { merge: true });
        writes += 1;
      }
    }
  }
  if (writes > 0) await batch.commit();
}

async function enqueueFamilyLeaderboardRefreshQueue({ db, fieldValue, nowMs }) {
  const timestamp = fieldValue.serverTimestamp();
  const batch = db.batch();
  let writes = 0;
  for (const kind of FAMILY_LEADERBOARD_KINDS) {
    const boardId = buildBoardId({ kind, window: 'weekly', scope: 'global' });
    if (!boardId) continue;
    batch.set(db.doc(`leaderboardRefreshQueue/${boardId}`), {
      boardId,
      enqueuedAt: timestamp,
      enqueuedAtMs: nowMs,
      kind,
      scope: 'global',
      window: 'weekly',
    }, { merge: true });
    writes += 1;
  }
  if (writes > 0) await batch.commit();
}

function uniqueScopes(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const scope = normalizeLeaderboardScope(value);
    if (!scope || seen.has(scope)) continue;
    seen.add(scope);
    out.push(scope);
  }
  return out;
}

function normalizeGiftContribution(contribution = {}) {
  if (!contribution || typeof contribution !== 'object' || Array.isArray(contribution)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const senderUid = typeof contribution.senderUid === 'string' ? contribution.senderUid.trim() : '';
  const recipientUid = typeof contribution.recipientUid === 'string' ? contribution.recipientUid.trim() : '';
  const eventId = typeof contribution.eventId === 'string' ? contribution.eventId.trim() : '';
  const priceCoins = Number(contribution.priceCoins);
  const scoreValue = Number(contribution.scoreValue);
  const nowMs = Number.isSafeInteger(contribution.nowMs) ? contribution.nowMs : Date.now();
  if (!senderUid || !recipientUid || !eventId || senderUid === recipientUid) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  if (!Number.isSafeInteger(priceCoins) || priceCoins < 1) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  if (!Number.isSafeInteger(scoreValue) || scoreValue < 0) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  return {
    ok: true,
    value: {
      eventId,
      nowMs,
      priceCoins,
      recipientCountryCode: normalizeLeaderboardScope(contribution.recipientCountryCode) === 'global'
        ? ''
        : normalizeLeaderboardScope(contribution.recipientCountryCode),
      recipientDisplayName: typeof contribution.recipientDisplayName === 'string'
        ? contribution.recipientDisplayName.trim().slice(0, 80)
        : '',
      recipientPublicId: stringifyPublicId(contribution.recipientPublicId),
      recipientUid,
      scoreValue,
      senderCountryCode: normalizeLeaderboardScope(contribution.senderCountryCode) === 'global'
        ? ''
        : normalizeLeaderboardScope(contribution.senderCountryCode),
      senderDisplayName: typeof contribution.senderDisplayName === 'string'
        ? contribution.senderDisplayName.trim().slice(0, 80)
        : '',
      senderPublicId: stringifyPublicId(contribution.senderPublicId),
      senderUid,
    },
  };
}

function stringifyPublicId(value) {
  if (typeof value === 'string') return value.trim().slice(0, 32);
  if (Number.isSafeInteger(value)) return String(value);
  return '';
}

async function materializeLeaderboard({
  db,
  fieldValue,
  kind,
  window,
  scope,
  force = false,
  nowMs = Date.now(),
}) {
  const normalized = normalizeGetLeaderboardInput({ kind, window, scope });
  if (!normalized.ok) return { ok: false, code: normalized.code };

  const { boardId, kind: safeKind, scope: safeScope, window: safeWindow } = normalized.value;
  const period = buildPeriodId({ window: safeWindow, nowMs });
  if (!period.ok) return { ok: false, code: period.code || 'INVALID_PERIOD' };

  const runtimeSnap = await db.doc('appRuntime/growthLeaderboards').get();
  const frozen = runtimeSnap.exists && runtimeSnap.data()?.frozen === true;
  if (frozen && force !== true) {
    return { ok: true, skipped: true, reason: 'FROZEN' };
  }

  const boardRef = db.doc(`leaderboards/${boardId}`);
  const existingSnap = await boardRef.get();
  const existing = existingSnap.exists
    ? mapLeaderboardDocument({ boardId, ...existingSnap.data() })
    : null;
  if (existing && isBoardFresh(existing, nowMs) && force !== true) {
    return { ok: true, skipped: true, reason: 'FRESH', board: existing };
  }

  const scoreField = scoreFieldForKind(safeKind);
  let candidates = [];
  try {
    candidates = await queryPeriodScores({
      db,
      kind: safeKind,
      periodId: period.value,
      scoreField,
      scope: safeScope,
    });
  } catch (error) {
    console.error(
      '[growthLeaderboard] materialize query failed',
      error instanceof Error ? error.message : String(error),
    );
    return { ok: false, code: 'INTERNAL' };
  }

  const entries = rankEntries(
    candidates
      .map((row) => mapLeaderboardEntry(row, { kind: safeKind }))
      .filter(Boolean),
  ).slice(0, LEADERBOARD_LIMIT);

  const timestamp = fieldValue.serverTimestamp();
  const payload = {
    boardId,
    entries,
    frozen: false,
    kind: safeKind,
    periodId: period.value,
    scope: safeScope,
    updatedAt: timestamp,
    updatedAtMs: nowMs,
    window: safeWindow,
  };
  await boardRef.set(payload, { merge: true });
  return {
    ok: true,
    skipped: false,
    board: mapLeaderboardDocument(payload),
  };
}

async function queryPeriodScores({ db, periodId, scoreField, scope, kind }) {
  const collectionPath = isFamilyLeaderboardKind(kind)
    ? `leaderboardPeriods/${periodId}/families`
    : `leaderboardPeriods/${periodId}/users`;
  const collection = db.collection(collectionPath);
  try {
    let query = collection.orderBy(scoreField, 'desc').limit(LEADERBOARD_LIMIT);
    if (!isFamilyLeaderboardKind(kind) && scope !== 'global') {
      query = collection
        .where('countryCode', '==', scope)
        .orderBy(scoreField, 'desc')
        .limit(LEADERBOARD_LIMIT);
    }
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => (
      isFamilyLeaderboardKind(kind)
        ? { familyId: doc.id, ...doc.data() }
        : { uid: doc.id, ...doc.data() }
    ));
  } catch (error) {
    if (!isLeaderboardIndexError(error)) throw error;
    const snapshot = await collection.limit(LEADERBOARD_FALLBACK_SCAN_LIMIT).get();
    return snapshot.docs
      .map((doc) => (
        isFamilyLeaderboardKind(kind)
          ? { familyId: doc.id, ...doc.data() }
          : { uid: doc.id, ...doc.data() }
      ))
      .filter((row) => (
        isFamilyLeaderboardKind(kind)
          || scope === 'global'
          || normalizeLeaderboardScope(row.countryCode) === scope
      ))
      .map((row) => {
        if (isFamilyLeaderboardKind(kind)) {
          const mapped = mapLeaderboardFamilyScore(row);
          if (!mapped) return null;
          return {
            ...mapped,
            score: scoreField === 'charmScore' ? mapped.charmScore : mapped.wealthCoins,
          };
        }
        const mapped = mapLeaderboardUserScore(row);
        if (!mapped) return null;
        return {
          ...mapped,
          score: scoreField === 'charmScore' ? mapped.charmScore : mapped.wealthCoins,
        };
      })
      .filter(Boolean)
      .sort(compareLeaderboardEntries)
      .slice(0, LEADERBOARD_LIMIT);
  }
}

async function getLeaderboard({ db, fieldValue, input, uid }) {
  const flags = await readGrowthFeatureFlags(db);
  if (flags.leaderboards !== true) {
    return { errorCode: 'FEATURE_DISABLED' };
  }

  const normalized = normalizeGetLeaderboardInput(input);
  if (!normalized.ok) return { errorCode: normalized.code };
  if (isFamilyLeaderboardKind(normalized.value.kind) && flags.families !== true) {
    return { errorCode: 'FEATURE_DISABLED' };
  }

  const nowMs = Date.now();
  const materialized = await materializeLeaderboard({
    db,
    fieldValue,
    force: false,
    kind: normalized.value.kind,
    nowMs,
    scope: normalized.value.scope,
    window: normalized.value.window,
  });
  if (!materialized.ok) return { errorCode: materialized.code || 'INTERNAL' };

  let board = materialized.board;
  if (!board) {
    const snap = await db.doc(`leaderboards/${normalized.value.boardId}`).get();
    board = snap.exists
      ? mapLeaderboardDocument({ boardId: normalized.value.boardId, ...snap.data() })
      : null;
  }
  if (!board) return { errorCode: 'NOT_FOUND' };

  const period = buildPeriodId({ window: normalized.value.window, nowMs });
  let viewer = null;
  const safeUid = typeof uid === 'string' ? uid.trim() : '';
  if (safeUid && period.ok) {
    if (isFamilyLeaderboardKind(normalized.value.kind)) {
      const membershipSnap = await db.doc(`familyMemberships/${safeUid}`).get();
      const familyId = membershipSnap.exists
        && typeof membershipSnap.data()?.familyId === 'string'
        ? membershipSnap.data().familyId
        : '';
      if (familyId) {
        const scoreSnap = await db.doc(
          `leaderboardPeriods/${period.value}/families/${familyId}`,
        ).get();
        if (scoreSnap.exists) {
          const scoreDoc = mapLeaderboardFamilyScore({ familyId, ...scoreSnap.data() });
          const entry = mapLeaderboardEntry(scoreDoc, { kind: normalized.value.kind });
          if (entry) {
            const onBoard = board.entries.find((row) => row.uid === familyId);
            viewer = onBoard || { ...entry, rank: null };
          }
        }
      }
    } else {
      const scoreSnap = await db.doc(`leaderboardPeriods/${period.value}/users/${safeUid}`).get();
      if (scoreSnap.exists) {
        const scoreDoc = mapLeaderboardUserScore({ uid: safeUid, ...scoreSnap.data() });
        const entry = mapLeaderboardEntry(scoreDoc, { kind: normalized.value.kind });
        if (entry) {
          const onBoard = board.entries.find((row) => row.uid === safeUid);
          viewer = onBoard || { ...entry, rank: null };
        }
      }
    }
  }

  return {
    result: {
      board,
      viewer,
    },
  };
}

async function getVipStatus({ db, fieldValue, uid }) {
  const flags = await readGrowthFeatureFlags(db);
  if (flags.vipTiers !== true) {
    return { errorCode: 'FEATURE_DISABLED' };
  }
  const safeUid = typeof uid === 'string' ? uid.trim() : '';
  if (!safeUid) return { errorCode: 'INVALID_REQUEST' };

  const [walletSnap, catalogSnap] = await Promise.all([
    db.doc(`walletSummaries/${safeUid}`).get(),
    db.collection('vipTier').get().catch(() => null),
  ]);

  const lifetimeCreditCoins = readLifetimeCreditCoins(walletSnap.exists ? walletSnap.data() : {});
  const catalog = catalogSnap && !catalogSnap.empty
    ? catalogSnap.docs
      .map((doc) => mapVipTier({ id: doc.id, ...doc.data() }))
      .filter(Boolean)
      .sort((left, right) => left.rank - right.rank)
    : listDefaultVipCatalog();

  const resolved = resolveVipTierForCredit(lifetimeCreditCoins, catalog);
  await syncVipProjection({
    db,
    fieldValue,
    tier: resolved.tier,
    uid: safeUid,
  });

  return {
    result: {
      catalog,
      lifetimeCreditCoins: resolved.lifetimeCreditCoins,
      nextTier: resolved.nextTier,
      tier: resolved.tier,
    },
  };
}

async function syncVipProjection({ db, fieldValue, uid, tier }) {
  const safeUid = typeof uid === 'string' ? uid.trim() : '';
  if (!safeUid) return { ok: false, code: 'INVALID_REQUEST' };

  let nextTier = tier;
  if (nextTier === undefined) {
    const [walletSnap, catalogSnap] = await Promise.all([
      db.doc(`walletSummaries/${safeUid}`).get(),
      db.collection('vipTier').get().catch(() => null),
    ]);
    const catalog = catalogSnap && !catalogSnap.empty
      ? catalogSnap.docs
        .map((doc) => mapVipTier({ id: doc.id, ...doc.data() }))
        .filter(Boolean)
      : listDefaultVipCatalog();
    const lifetimeCreditCoins = readLifetimeCreditCoins(walletSnap.exists ? walletSnap.data() : {});
    nextTier = resolveVipTierForCredit(lifetimeCreditCoins, catalog).tier;
  }

  const profileRef = db.doc(`publicProfiles/${safeUid}`);
  const profileSnap = await profileRef.get();
  const current = mapVipProjection(profileSnap.exists ? profileSnap.data() : {});
  const desired = nextTier
    ? {
        accentColor: nextTier.accentColor,
        id: nextTier.id,
        nameAr: nextTier.nameAr,
        rank: nextTier.rank,
      }
    : null;

  if (projectionsEqual(current, desired)) {
    return { ok: true, changed: false, vipTier: desired };
  }

  await profileRef.set({
    updatedAt: fieldValue.serverTimestamp(),
    vipTier: desired,
  }, { merge: true });

  return { ok: true, changed: true, vipTier: desired };
}

function projectionsEqual(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.id === right.id
    && left.rank === right.rank
    && left.nameAr === right.nameAr
    && left.accentColor === right.accentColor;
}

function readLifetimeCreditCoins(wallet = {}) {
  const credit = wallet?.lifetimeCredit;
  if (Number.isSafeInteger(credit) && credit >= 0) return credit;
  if (credit && typeof credit === 'object') {
    const coins = Number(credit.coins);
    if (Number.isSafeInteger(coins) && coins >= 0) return coins;
  }
  return 0;
}

async function processLeaderboardRefreshQueue({ db, fieldValue, limit = 20 }) {
  const safeLimit = Number.isSafeInteger(limit) && limit >= 1 && limit <= 100 ? limit : 20;
  const snapshot = await db.collection('leaderboardRefreshQueue').limit(safeLimit).get();
  if (snapshot.empty) {
    return { ok: true, processed: 0, results: [] };
  }

  const nowMs = Date.now();
  const results = [];
  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const kind = typeof data.kind === 'string' ? data.kind : '';
    const window = typeof data.window === 'string' ? data.window : '';
    const scope = typeof data.scope === 'string' ? data.scope : 'global';
    const materialized = await materializeLeaderboard({
      db,
      fieldValue,
      force: true,
      kind,
      nowMs,
      scope,
      window,
    });
    if (materialized.ok) {
      await doc.ref.delete().catch(() => undefined);
    }
    results.push({
      boardId: doc.id,
      ok: materialized.ok === true,
      reason: materialized.reason || materialized.code || null,
      skipped: materialized.skipped === true,
    });
  }
  return {
    ok: true,
    processed: results.length,
    results,
  };
}

module.exports = {
  applyGiftLeaderboardContribution,
  getLeaderboard,
  getVipStatus,
  listDefaultVipCatalog,
  materializeLeaderboard,
  processLeaderboardRefreshQueue,
  syncVipProjection,
};
