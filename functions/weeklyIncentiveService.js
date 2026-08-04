const { mapStoreCatalogItem } = require('./storeCore');
const { buildStoreOwnership, durationToMilliseconds, mapStoreOwnership } = require('./storePurchaseCore');
const {
  applyWalletMutation,
  buildWalletDocument,
  buildWalletTransaction,
  mapWalletSummary,
} = require('./socialWalletCore');
const {
  createSettlementFingerprint,
  createSettlementId,
  createWeeklyCycle,
  createWeeklyCycleDocumentId,
  normalizeRewardBundle,
  normalizeSettlementWorkerOptions,
  normalizeWeeklyCycle,
  timestampToMillis,
} = require('./weeklyIncentiveCore');
const { retentionDeadlineMillis } = require('./weeklyIncentiveIntegrityCore');

const FEATURE_PAYOUT_FLAGS = Object.freeze({
  'owner-targets': 'voice_room_owner_target_payouts',
  payroll: 'voice_room_payroll_payouts',
  'rocket-rewards': 'voice_room_rocket_rewards',
});
const REWARDABLE_STORE_CATEGORIES = Object.freeze(['avatar-frames', 'cars', 'game-items']);

async function settleWeeklyIncentiveReward({ clock, db, fieldValue, input, mode = 'commit' }) {
  const validation = normalizeSettlementInput(input);
  if (!validation.ok || !['commit', 'preview'].includes(mode)) {
    return { errorCode: validation.code || 'INVALID_REQUEST' };
  }
  const value = validation.value;
  return db.runTransaction(async (transaction) => {
    const refs = {
      profile: db.doc(`publicProfiles/${value.uid}`),
      settlement: db.doc(`rewardSettlements/${value.settlementId}`),
      wallet: db.doc(`walletSummaries/${value.uid}`),
    };
    const itemRefs = value.rewardBundle.items.map((item) => ({
      catalog: db.doc(`storeCatalog/${item.itemId}`),
      ownership: db.doc(`storeOwnerships/${value.uid}/items/${item.itemId}`),
      reward: item,
    }));
    const [settlementSnapshot, profileSnapshot, walletSnapshot, ...itemSnapshots] = await Promise.all([
      transaction.get(refs.settlement),
      transaction.get(refs.profile),
      transaction.get(refs.wallet),
      ...itemRefs.flatMap((item) => [transaction.get(item.catalog), transaction.get(item.ownership)]),
    ]);
    if (settlementSnapshot.exists) {
      const previous = settlementSnapshot.data();
      if (previous.fingerprint !== value.fingerprint) return { errorCode: 'SETTLEMENT_CONFLICT' };
      if (previous.state === 'paid') return { replayed: true, result: previous.result };
      if (!['eligible', 'failed', 'held', 'paying', 'preview'].includes(previous.state)) {
        return { errorCode: 'SETTLEMENT_FINAL' };
      }
    }

    const profile = profileSnapshot.exists ? profileSnapshot.data() : undefined;
    if (!profile || profile.uid !== value.uid || profile.moderationStatus !== 'active') {
      return holdSettlement({
        fieldValue,
        mode,
        reason: !profile ? 'PROFILE_MISSING' : 'PROFILE_NOT_ACTIVE',
        transaction,
        value,
        settlementRef: refs.settlement,
      });
    }

    const catalogs = [];
    const ownerships = [];
    for (let index = 0; index < itemRefs.length; index += 1) {
      const catalogSnapshot = itemSnapshots[index * 2];
      const ownershipSnapshot = itemSnapshots[index * 2 + 1];
      const itemId = itemRefs[index].reward.itemId;
      const catalog = catalogSnapshot.exists ? mapStoreCatalogItem(catalogSnapshot.data(), itemId) : undefined;
      const ownership = ownershipSnapshot.exists ? mapStoreOwnership(ownershipSnapshot.data(), itemId) : undefined;
      if (
        !catalog
        || catalog.availability !== 'available'
        || !REWARDABLE_STORE_CATEGORIES.includes(catalog.category)
        || (catalog.stock.kind === 'limited' && catalog.stock.remaining === 0)
      ) {
        return holdSettlement({
          fieldValue,
          mode,
          reason: 'ITEM_NOT_REWARDABLE',
          transaction,
          value,
          settlementRef: refs.settlement,
        });
      }
      if (ownershipSnapshot.exists && !ownership) {
        return holdSettlement({
          fieldValue,
          mode,
          reason: 'OWNERSHIP_INVALID',
          transaction,
          value,
          settlementRef: refs.settlement,
        });
      }
      if (ownership && ownership.category !== catalog.category) {
        return holdSettlement({
          fieldValue,
          mode,
          reason: 'OWNERSHIP_CATALOG_MISMATCH',
          transaction,
          value,
          settlementRef: refs.settlement,
        });
      }
      if (ownership && catalog.duration.kind === 'permanent' && !itemRefs[index].reward.duplicateFallback) {
        return holdSettlement({
          fieldValue,
          mode,
          reason: 'DUPLICATE_FALLBACK_REQUIRED',
          transaction,
          value,
          settlementRef: refs.settlement,
        });
      }
      catalogs.push(catalog);
      ownerships.push(ownership);
    }

    const currencyCredits = {
      coins: value.rewardBundle.coins,
      diamonds: value.rewardBundle.diamonds,
    };
    const itemResults = [];
    for (let index = 0; index < itemRefs.length; index += 1) {
      const reward = itemRefs[index].reward;
      const catalog = catalogs[index];
      const ownership = ownerships[index];
      if (ownership && catalog.duration.kind === 'permanent') {
        currencyCredits[reward.duplicateFallback.currency] += reward.duplicateFallback.amount;
        itemResults.push({
          fallback: reward.duplicateFallback,
          itemId: reward.itemId,
          outcome: 'duplicate-fallback',
        });
      } else {
        itemResults.push({
          itemId: reward.itemId,
          outcome: ownership ? 'extended' : 'granted',
        });
      }
    }

    let wallet = mapWalletSummary(walletSnapshot.exists ? walletSnapshot.data() : undefined, value.uid);
    const walletResults = [];
    for (const currency of ['coins', 'diamonds']) {
      const amount = currencyCredits[currency];
      if (amount === 0) continue;
      const credit = applyWalletMutation(wallet, { amount, currency, type: 'credit' });
      if (!credit.ok) {
        return holdSettlement({
          fieldValue,
          mode,
          reason: 'WALLET_LIMIT',
          transaction,
          value,
          settlementRef: refs.settlement,
        });
      }
      wallet = credit.value.wallet;
      walletResults.push({ amount, balanceAfter: credit.value.balanceAfter, currency });
    }

    const result = {
      items: itemResults,
      settlementId: value.settlementId,
      walletCredits: walletResults,
    };
    if (mode === 'preview') return { preview: true, result };

    const timestamp = fieldValue.serverTimestamp();
    const nowMillis = clock.nowMillis();
    if (walletResults.length > 0) {
      transaction.set(refs.wallet, buildWalletDocument(wallet, {
        createdAt: walletSnapshot.exists && walletSnapshot.data()?.createdAt
          ? walletSnapshot.data().createdAt
          : timestamp,
        updatedAt: timestamp,
      }), { merge: true });
      for (const credit of walletResults) {
        const ledgerRef = db.doc(`walletTransactions/${value.settlementId}_${credit.currency}`);
        transaction.create(ledgerRef, {
          ...buildWalletTransaction({
            actorUid: 'system',
            amount: credit.amount,
            balanceAfter: credit.balanceAfter,
            createdAt: timestamp,
            currency: credit.currency,
            note: 'Weekly room incentive reward',
            referenceId: value.settlementId,
            source: `weekly-incentive:${value.feature}`,
            type: 'credit',
            uid: value.uid,
          }),
          purgeAfter: clock.timestampFromMillis(retentionDeadlineMillis('walletTransactions', nowMillis)),
        });
      }
    }

    for (let index = 0; index < itemRefs.length; index += 1) {
      const itemRef = itemRefs[index];
      const catalog = catalogs[index];
      const ownership = ownerships[index];
      const entitlementLedger = db.doc(`rewardEntitlementTransactions/${value.settlementId}_${catalog.itemId}`);
      if (ownership && catalog.duration.kind === 'permanent') {
        transaction.create(entitlementLedger, {
          createdAt: timestamp,
          fallback: itemRef.reward.duplicateFallback,
          itemId: catalog.itemId,
          outcome: 'duplicate-fallback',
          settlementId: value.settlementId,
          uid: value.uid,
          purgeAfter: clock.timestampFromMillis(retentionDeadlineMillis(
            'rewardEntitlementTransactions',
            nowMillis,
          )),
        });
        continue;
      }
      const durationMs = durationToMilliseconds(catalog.duration);
      const existingExpiry = ownership?.expiresAt?.toMillis?.() || 0;
      const expiresAt = durationMs
        ? clock.timestampFromMillis(Math.max(nowMillis, existingExpiry) + durationMs)
        : undefined;
      if (ownership) {
        transaction.update(itemRef.ownership, {
          equipped: ownership.equipped,
          expiresAt,
          state: 'active',
          updatedAt: timestamp,
        });
      } else {
        transaction.create(itemRef.ownership, {
          ...buildStoreOwnership({
            acquiredAt: timestamp,
            expiresAt,
            item: catalog,
            ownershipId: catalog.itemId,
            uid: value.uid,
          }),
          equipped: false,
          source: `weekly-incentive:${value.feature}`,
        });
      }
      transaction.create(entitlementLedger, {
        createdAt: timestamp,
        ...(expiresAt ? { expiresAt } : {}),
        itemId: catalog.itemId,
        outcome: ownership ? 'extended' : 'granted',
        settlementId: value.settlementId,
        uid: value.uid,
        purgeAfter: clock.timestampFromMillis(retentionDeadlineMillis(
          'rewardEntitlementTransactions',
          nowMillis,
        )),
      });
      if (catalog.stock.kind === 'limited') {
        transaction.update(itemRef.catalog, {
          stock: { kind: 'limited', remaining: catalog.stock.remaining - 1 },
          updatedAt: timestamp,
        });
      }
    }

    transaction.set(refs.settlement, {
      cycleId: value.cycleId,
      feature: value.feature,
      fingerprint: value.fingerprint,
      paidAt: timestamp,
      rewardBundle: value.rewardBundle,
      result,
      schemaVersion: 1,
      settlementId: value.settlementId,
      source: value.source,
      state: 'paid',
      uid: value.uid,
      updatedAt: timestamp,
      purgeAfter: clock.timestampFromMillis(retentionDeadlineMillis('rewardSettlements', nowMillis)),
    });
    return { replayed: false, result };
  });
}

async function enqueueWeeklyIncentiveSettlement({ db, fieldValue, input }) {
  const validation = normalizeSettlementInput(input);
  if (!validation.ok) return { errorCode: validation.code };
  const value = validation.value;
  return db.runTransaction(async (transaction) => {
    const ref = db.doc(`rewardSettlementJobs/${value.settlementId}`);
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      return snapshot.data()?.fingerprint === value.fingerprint
        ? { replayed: true, settlementId: value.settlementId }
        : { errorCode: 'SETTLEMENT_CONFLICT' };
    }
    const timestamp = fieldValue.serverTimestamp();
    transaction.create(ref, {
      ...value,
      createdAt: timestamp,
      eligibleAt: timestamp,
      schemaVersion: 1,
      state: 'eligible',
      updatedAt: timestamp,
    });
    return { replayed: false, settlementId: value.settlementId };
  });
}

async function getOrCreateWeeklyIncentiveCycle({
  clock,
  db,
  fieldValue,
  feature,
  scopeId,
  templateVersion,
  timeZone,
}) {
  const cycle = createWeeklyCycle({
    nowMillis: clock.nowMillis(),
    templateVersion,
    ...(timeZone ? { timeZone } : {}),
  });
  if (!cycle.ok) return { errorCode: cycle.code };
  const cycleDocumentId = createWeeklyCycleDocumentId({
    cycleId: cycle.value.cycleId,
    feature,
    scopeId,
  });
  if (!cycleDocumentId) return { errorCode: 'INVALID_CYCLE_SCOPE' };
  return db.runTransaction(async (transaction) => {
    const ref = db.doc(`weeklyIncentiveCycles/${cycleDocumentId}`);
    const snapshot = await transaction.get(ref);
    if (snapshot.exists) {
      const data = snapshot.data();
      const mapped = normalizeWeeklyCycle({
        cycleId: data.cycleId,
        endAtMillis: timestampToMillis(data.endAt),
        schemaVersion: data.schemaVersion,
        startAtMillis: timestampToMillis(data.startAt),
        state: data.state,
        templateVersion: data.templateVersion,
        timeZone: data.timeZone,
      });
      if (!mapped.ok || data.feature !== feature || data.scopeId !== scopeId) return { errorCode: 'CYCLE_CONFLICT' };
      return { cycle: mapped.value, cycleDocumentId, replayed: true };
    }
    const timestamp = fieldValue.serverTimestamp();
    transaction.create(ref, {
      createdAt: timestamp,
      cycleId: cycle.value.cycleId,
      endAt: clock.timestampFromMillis(cycle.value.endAtMillis),
      feature,
      schemaVersion: cycle.value.schemaVersion,
      scopeId,
      startAt: clock.timestampFromMillis(cycle.value.startAtMillis),
      state: cycle.value.state,
      templateVersion: cycle.value.templateVersion,
      timeZone: cycle.value.timeZone,
      updatedAt: timestamp,
    });
    return { cycle: cycle.value, cycleDocumentId, replayed: false };
  });
}

async function processWeeklyIncentiveSettlementBatch({ clock, db, fieldValue, options }) {
  const validation = normalizeSettlementWorkerOptions(options);
  if (!validation.ok) return { errorCode: validation.code };
  const { cursor, dryRun, leaseMillis, limit, workerId } = validation.value;
  if (!dryRun) {
    await recoverExpiredSettlementLeases({ clock, db, fieldValue, limit });
  }
  const featureFlags = await db.doc('appConfig/voiceRoomFeatures').get();
  let query = db.collection('rewardSettlementJobs')
    .where('state', '==', 'eligible')
    .orderBy('settlementId');
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.limit(limit).get();
  const results = [];
  for (const document of snapshot.docs) {
    const job = document.data();
    const payoutFlag = FEATURE_PAYOUT_FLAGS[job.feature];
    if (!payoutFlag || featureFlags.data()?.[payoutFlag] !== true) {
      results.push({ settlementId: document.id, state: 'disabled' });
      continue;
    }
    const integrity = job.integrityOverride === 'approved'
      ? { hold: false, override: true }
      : await require('./weeklyIncentiveIntegrityService').evaluateWeeklyIncentiveSettlementRisk({
          clock,
          db,
          fieldValue,
          job,
          persist: !dryRun,
        });
    if (integrity.errorCode) {
      results.push({ errorCode: integrity.errorCode, settlementId: document.id, state: 'failed' });
      continue;
    }
    if (integrity.hold) {
      if (!dryRun) {
        await document.ref.set({
          failureCode: 'INTEGRITY_HOLD',
          integrityAssessmentId: integrity.assessmentId,
          integrityRiskScore: integrity.riskScore,
          state: 'held',
          updatedAt: fieldValue.serverTimestamp(),
        }, { merge: true });
      }
      results.push({
        assessmentId: integrity.assessmentId,
        riskScore: integrity.riskScore,
        settlementId: document.id,
        signals: integrity.signals,
        state: dryRun ? 'held-preview' : 'held',
      });
      continue;
    }
    if (dryRun) {
      const preview = await settleWeeklyIncentiveReward({
        clock,
        db,
        fieldValue,
        input: job,
        mode: 'preview',
      });
      results.push({ settlementId: document.id, state: preview.errorCode ? 'failed' : 'preview', ...preview });
      continue;
    }
    const leased = await acquireSettlementLease({
      clock,
      db,
      fieldValue,
      leaseMillis,
      ref: document.ref,
      workerId,
    });
    if (!leased) continue;
    let settlement;
    try {
      settlement = await settleWeeklyIncentiveReward({ clock, db, fieldValue, input: job });
    } catch (error) {
      settlement = { errorCode: 'UNEXPECTED_FAILURE', error };
    }
    const state = settlement.errorCode
      ? (['PROFILE_MISSING', 'PROFILE_NOT_ACTIVE', 'ITEM_NOT_REWARDABLE', 'OWNERSHIP_INVALID', 'OWNERSHIP_CATALOG_MISMATCH', 'DUPLICATE_FALLBACK_REQUIRED', 'WALLET_LIMIT'].includes(settlement.errorCode) ? 'held' : 'failed')
      : 'paid';
    await document.ref.set({
      ...(settlement.errorCode ? { failureCode: settlement.errorCode } : {}),
      leaseExpiresAt: fieldValue.delete(),
      leasedBy: fieldValue.delete(),
      state,
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true });
    results.push({ settlementId: document.id, state, ...settlement });
  }
  return {
    nextCursor: snapshot.docs.length === limit ? snapshot.docs.at(-1).id : '',
    processed: results.length,
    results,
    scanned: snapshot.size,
  };
}

async function acquireSettlementLease({ clock, db, fieldValue, leaseMillis, ref, workerId }) {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data()?.state !== 'eligible') return false;
    transaction.update(ref, {
      leaseExpiresAt: clock.timestampFromMillis(clock.nowMillis() + leaseMillis),
      leasedBy: workerId,
      state: 'paying',
      updatedAt: fieldValue.serverTimestamp(),
    });
    return true;
  });
}

async function recoverExpiredSettlementLeases({ clock, db, fieldValue, limit = 200 }) {
  const snapshot = await db.collection('rewardSettlementJobs')
    .where('state', '==', 'paying')
    .limit(Math.min(limit, 200))
    .get();
  let recovered = 0;
  for (const document of snapshot.docs) {
    const changed = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(document.ref);
      const data = current.exists ? current.data() : undefined;
      if (data?.state !== 'paying' || timestampToMillis(data.leaseExpiresAt) > clock.nowMillis()) return false;
      transaction.update(document.ref, {
        leaseExpiresAt: fieldValue.delete(),
        leasedBy: fieldValue.delete(),
        state: 'eligible',
        updatedAt: fieldValue.serverTimestamp(),
      });
      return true;
    });
    if (changed) recovered += 1;
  }
  return { recovered, scanned: snapshot.size };
}

async function reconcileWeeklyIncentiveSettlement({ db, settlementId }) {
  if (!/^ris_[a-f0-9]{40}$/.test(settlementId)) return { errorCode: 'INVALID_REQUEST' };
  const settlementSnapshot = await db.doc(`rewardSettlements/${settlementId}`).get();
  if (!settlementSnapshot.exists) return { errorCode: 'NOT_FOUND' };
  const settlement = settlementSnapshot.data();
  if (settlement.state !== 'paid' || settlement.settlementId !== settlementId || !settlement.result) {
    return { balanced: false, discrepancies: ['SETTLEMENT_NOT_PAID'], settlementId };
  }
  const discrepancies = [];
  for (const credit of settlement.result.walletCredits || []) {
    const ledger = await db.doc(`walletTransactions/${settlementId}_${credit.currency}`).get();
    const data = ledger.exists ? ledger.data() : undefined;
    if (
      !data
      || data.uid !== settlement.uid
      || data.amount !== credit.amount
      || data.balanceAfter !== credit.balanceAfter
      || data.currency !== credit.currency
      || data.referenceId !== settlementId
    ) discrepancies.push(`WALLET_LEDGER_${String(credit.currency).toUpperCase()}`);
  }
  for (const item of settlement.result.items || []) {
    const entitlementLedger = await db.doc(`rewardEntitlementTransactions/${settlementId}_${item.itemId}`).get();
    const ledgerData = entitlementLedger.exists ? entitlementLedger.data() : undefined;
    if (
      !ledgerData
      || ledgerData.uid !== settlement.uid
      || ledgerData.itemId !== item.itemId
      || ledgerData.outcome !== item.outcome
      || ledgerData.settlementId !== settlementId
    ) discrepancies.push(`ITEM_LEDGER_${item.itemId}`);
    if (!['granted', 'extended'].includes(item.outcome)) continue;
    const ownership = await db.doc(`storeOwnerships/${settlement.uid}/items/${item.itemId}`).get();
    const data = ownership.exists ? ownership.data() : undefined;
    if (!data || data.uid !== settlement.uid || data.itemId !== item.itemId || data.state !== 'active') {
      discrepancies.push(`ITEM_ENTITLEMENT_${item.itemId}`);
    }
  }
  return { balanced: discrepancies.length === 0, discrepancies, settlementId };
}

function normalizeSettlementInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'INVALID_REQUEST' };
  const reward = normalizeRewardBundle(input.rewardBundle);
  const source = normalizeSettlementSource(input.source);
  const expectedId = createSettlementId({
    cycleId: input.cycleId,
    feature: input.feature,
    planId: source?.planId,
    rank: source?.rank,
    roomId: source?.roomId,
    uid: input.uid,
  });
  if (!reward.ok || !source || !expectedId || input.settlementId !== expectedId) return { ok: false, code: 'INVALID_REQUEST' };
  const fingerprint = createSettlementFingerprint({
    cycleId: input.cycleId,
    feature: input.feature,
    rewardBundle: reward.value,
    source,
    uid: input.uid,
  });
  return {
    ok: true,
    value: {
      cycleId: input.cycleId,
      feature: input.feature,
      fingerprint,
      rewardBundle: reward.value,
      settlementId: expectedId,
      source,
      uid: input.uid,
    },
  };
}

function normalizeSettlementSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined;
  if (Object.keys(source).some((key) => !['planId', 'rank', 'roomId'].includes(key))) return undefined;
  const planId = typeof source.planId === 'string' ? source.planId.trim() : '';
  const roomId = typeof source.roomId === 'string' ? source.roomId.trim() : '';
  const rank = source.rank === undefined ? 0 : source.rank;
  if ((planId && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(planId)) || (roomId && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(roomId)) || !Number.isSafeInteger(rank) || rank < 0 || rank > 1000) return undefined;
  return { planId, rank, roomId };
}

function holdSettlement({ fieldValue, mode, reason, transaction, value, settlementRef }) {
  if (mode === 'commit') {
    const timestamp = fieldValue.serverTimestamp();
    transaction.set(settlementRef, {
      cycleId: value.cycleId,
      feature: value.feature,
      fingerprint: value.fingerprint,
      holdReason: reason,
      rewardBundle: value.rewardBundle,
      schemaVersion: 1,
      settlementId: value.settlementId,
      source: value.source,
      state: 'held',
      uid: value.uid,
      updatedAt: timestamp,
    });
  }
  return { errorCode: reason, held: true };
}

module.exports = {
  FEATURE_PAYOUT_FLAGS,
  REWARDABLE_STORE_CATEGORIES,
  acquireSettlementLease,
  enqueueWeeklyIncentiveSettlement,
  getOrCreateWeeklyIncentiveCycle,
  normalizeSettlementInput,
  processWeeklyIncentiveSettlementBatch,
  reconcileWeeklyIncentiveSettlement,
  recoverExpiredSettlementLeases,
  settleWeeklyIncentiveReward,
};
