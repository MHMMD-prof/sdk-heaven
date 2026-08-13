'use strict';

const crypto = require('node:crypto');
const { inspectPublicProfile, isTimestampLike } = require('./socialProfileCore');
const {
  applyWalletMutation,
  buildWalletDocument,
  buildWalletTransaction,
  mapWalletSummary,
} = require('./socialWalletCore');
const {
  STATUS_SCHEMA_VERSION,
  mapAristocracyEntitlement,
  mapStatusFeatureFlags,
  normalizeAristocracyCatalogVersion,
} = require('./statusMembershipCore');
const { activeCatalogVersion } = require('./statusMembershipService');
const { readAllRows } = require('./statusProgressionService');
const {
  ARISTOCRACY_QUOTE_TTL_MS,
  DAY_MS,
  buildAristocracyQuoteDocument,
  buildAristocracyTransaction,
  buildPaidAristocracyEntitlement,
  calculateAristocracyQuote,
  mapAristocracyQuote,
  normalizeAristocracyAdminProposal,
  normalizeAristocracyPurchaseInput,
  normalizeAristocracyQuoteInput,
  quoteMatchesCalculation,
  timestampMillis,
} = require('./aristocracyEconomyCore');

const ARISTOCRACY_QUOTE_HOURLY_LIMIT = 30;
const ARISTOCRACY_EXPIRY_BATCH_LIMIT = 100;
const ARISTOCRACY_RECONCILIATION_LIMIT = 100_000;

async function quoteAristocracy({ clock = systemClock(), createQuoteId = randomQuoteId, db, fieldValue, input, requestId, uid }) {
  const normalized = normalizeAristocracyQuoteInput(input);
  if (!normalized.ok || !validRequestId(requestId) || !uid) return { errorCode: 'INVALID_REQUEST' };
  const quoteId = createQuoteId();
  if (!/^[A-Za-z0-9_-]{24,80}$/.test(quoteId)) return { errorCode: 'INTERNAL' };
  const nowMillis = clock.nowMillis();
  const issuedAt = clock.timestampFromMillis(nowMillis);
  const expiresAt = clock.timestampFromMillis(nowMillis + ARISTOCRACY_QUOTE_TTL_MS);
  const hourBucket = new Date(nowMillis).toISOString().slice(0, 13);
  return db.runTransaction(async (transaction) => {
    const refs = {
      command: db.doc(`statusCommandRequests/${uid}/requests/${requestId}`),
      entitlement: db.doc(`aristocracyEntitlements/${uid}`),
      feature: db.doc('appConfig/statusFeatures'),
      pointer: db.doc('statusCatalogPointers/aristocracy'),
      profile: db.doc(`publicProfiles/${uid}`),
      quote: db.doc(`aristocracyQuotes/${uid}/items/${quoteId}`),
      rate: db.doc(`statusRateLimits/${uid}/hours/${hourBucket}`),
      wallet: db.doc(`walletSummaries/${uid}`),
    };
    const [command, feature, pointer, profile, wallet, entitlement, rate] = await Promise.all([
      transaction.get(refs.command), transaction.get(refs.feature), transaction.get(refs.pointer), transaction.get(refs.profile),
      transaction.get(refs.wallet), transaction.get(refs.entitlement), transaction.get(refs.rate),
    ]);
    if (command.exists) return mapIdempotentCommand(command.data(), 'quote-aristocracy', normalized.value);
    const flags = mapStatusFeatureFlags(feature.data());
    if (!flags.aristocracyShop) return { errorCode: 'FEATURE_DISABLED' };
    const readiness = await validateProfileInTransaction({ db, profile, transaction, uid });
    if (readiness) return { errorCode: readiness };
    const catalogVersion = activeCatalogVersion(pointer.data(), 'aristocracy');
    if (!catalogVersion || catalogVersion !== normalized.value.catalogVersion) return { errorCode: 'CATALOG_CHANGED' };
    const catalogSnapshot = await transaction.get(db.doc(`aristocracyCatalogVersions/${catalogVersion}`));
    const catalog = normalizeAristocracyCatalogVersion(catalogSnapshot.data());
    if (!catalog.ok || catalog.value.state !== 'published') return { errorCode: 'CATALOG_UNAVAILABLE' };
    const calculated = calculateAristocracyQuote({
      catalog: catalog.value,
      entitlement: entitlement.exists ? entitlement.data() : null,
      nowMillis,
      targetRankId: normalized.value.targetRankId,
    });
    if (!calculated.ok) return { errorCode: calculated.code };
    const walletValue = mapWalletSummary(wallet.data(), uid);
    if (walletValue.balances.coins < calculated.value.amountCoins) return { errorCode: 'INSUFFICIENT_FUNDS' };
    const quoteCount = Number.isSafeInteger(rate.data()?.aristocracyQuotes) ? rate.data().aristocracyQuotes : 0;
    if (quoteCount >= ARISTOCRACY_QUOTE_HOURLY_LIMIT) return { errorCode: 'RATE_LIMITED' };
    const quote = buildAristocracyQuoteDocument({ calculated, expiresAt, issuedAt, quoteId, requestId, uid });
    if (!quote) return { errorCode: 'INTERNAL' };
    const result = {
      quoteId,
      catalogVersion,
      operation: quote.operation,
      amountCoins: quote.amountCoins,
      balanceBefore: walletValue.balances.coins,
      balanceAfter: walletValue.balances.coins - quote.amountCoins,
      durationDays: quote.durationDays,
      expiresAtMillis: quote.expiresAt.toMillis(),
      resultingExpiryMillis: quote.resultingExpiryMillis,
      targetRankId: quote.targetRankId,
      targetRankOrder: quote.targetRankOrder,
      autoRenew: false,
    };
    const timestamp = fieldValue.serverTimestamp();
    transaction.create(refs.quote, quote);
    transaction.set(refs.rate, {
      ...(rate.data() || {}), uid, hourBucket, aristocracyQuotes: quoteCount + 1, updatedAt: timestamp,
    });
    transaction.create(refs.command, {
      schemaVersion: STATUS_SCHEMA_VERSION,
      action: 'quote-aristocracy',
      uid,
      requestId,
      catalogVersion: normalized.value.catalogVersion,
      targetRankId: normalized.value.targetRankId,
      createdAt: timestamp,
      result,
    });
    return { result };
  });
}

async function purchaseAristocracy({ clock = systemClock(), db, fieldValue, input, requestId, uid }) {
  const normalized = normalizeAristocracyPurchaseInput(input);
  if (!normalized.ok || !validRequestId(requestId) || !uid) return { errorCode: 'INVALID_REQUEST' };
  const nowMillis = clock.nowMillis();
  return db.runTransaction(async (transaction) => {
    const refs = {
      command: db.doc(`statusCommandRequests/${uid}/requests/${requestId}`),
      entitlement: db.doc(`aristocracyEntitlements/${uid}`),
      feature: db.doc('appConfig/statusFeatures'),
      pointer: db.doc('statusCatalogPointers/aristocracy'),
      profile: db.doc(`publicProfiles/${uid}`),
      quote: db.doc(`aristocracyQuotes/${uid}/items/${normalized.value.quoteId}`),
      transaction: db.doc(`aristocracyTransactions/${uid}_${requestId}`),
      wallet: db.doc(`walletSummaries/${uid}`),
      walletTransaction: db.doc(`walletTransactions/aristocracy_${uid}_${requestId}`),
    };
    const [command, quoteSnapshot, feature, pointer, profile, walletSnapshot, entitlementSnapshot] = await Promise.all([
      transaction.get(refs.command), transaction.get(refs.quote), transaction.get(refs.feature), transaction.get(refs.pointer),
      transaction.get(refs.profile), transaction.get(refs.wallet), transaction.get(refs.entitlement),
    ]);
    if (command.exists) return mapIdempotentCommand(command.data(), 'purchase-aristocracy', normalized.value);
    const flags = mapStatusFeatureFlags(feature.data());
    if (!flags.aristocracyShop) return { errorCode: 'FEATURE_DISABLED' };
    const readiness = await validateProfileInTransaction({ db, profile, transaction, uid });
    if (readiness) return { errorCode: readiness };
    const quote = quoteSnapshot.exists ? mapAristocracyQuote(quoteSnapshot.data(), normalized.value.quoteId) : null;
    if (!quote || quote.uid !== uid) return { errorCode: 'QUOTE_INVALID' };
    if (quote.state !== 'open') return { errorCode: 'QUOTE_USED' };
    if (quote.expiresAtMillis <= nowMillis) return { errorCode: 'QUOTE_EXPIRED' };
    const catalogVersion = activeCatalogVersion(pointer.data(), 'aristocracy');
    if (!catalogVersion || catalogVersion !== quote.catalogVersion) return { errorCode: 'CATALOG_CHANGED' };
    const catalogSnapshot = await transaction.get(db.doc(`aristocracyCatalogVersions/${catalogVersion}`));
    const catalog = normalizeAristocracyCatalogVersion(catalogSnapshot.data());
    if (!catalog.ok || catalog.value.state !== 'published') return { errorCode: 'CATALOG_UNAVAILABLE' };
    const existing = entitlementSnapshot.exists ? entitlementSnapshot.data() : null;
    const calculated = calculateAristocracyQuote({
      catalog: catalog.value,
      entitlement: existing,
      nowMillis,
      targetRankId: quote.targetRankId,
    });
    if (!calculated.ok || !quoteMatchesCalculation(quote, calculated)) return { errorCode: 'QUOTE_STALE' };
    const wallet = mapWalletSummary(walletSnapshot.data(), uid);
    const debit = applyWalletMutation(wallet, { amount: quote.amountCoins, currency: 'coins', type: 'debit' });
    if (!debit.ok) return { errorCode: debit.code };
    const timestamp = fieldValue.serverTimestamp();
    const resultingExpiry = clock.timestampFromMillis(quote.resultingExpiryMillis);
    const transactionId = refs.transaction.id;
    const entitlement = buildPaidAristocracyEntitlement({
      existing,
      quote,
      timestamp,
      transactionId,
      uid,
      expiresAt: resultingExpiry,
    });
    const history = buildAristocracyTransaction({
      actorUid: uid,
      amountCoins: quote.amountCoins,
      catalogVersion,
      createdAt: timestamp,
      expiresAt: resultingExpiry,
      kind: quote.operation,
      rankId: quote.targetRankId,
      rankOrder: quote.targetRankOrder,
      requestId,
      transactionId,
      uid,
      walletTransactionId: refs.walletTransaction.id,
    });
    if (!history) return { errorCode: 'INTERNAL' };
    const result = {
      transactionId,
      operation: quote.operation,
      amountCoins: quote.amountCoins,
      balanceAfter: debit.value.balanceAfter,
      catalogVersion,
      rankId: quote.targetRankId,
      rankOrder: quote.targetRankOrder,
      expiresAtMillis: quote.resultingExpiryMillis,
      autoRenew: false,
    };
    transaction.set(refs.wallet, buildWalletDocument(debit.value.wallet, {
      createdAt: walletSnapshot.exists && isTimestampLike(walletSnapshot.data()?.createdAt) ? walletSnapshot.data().createdAt : timestamp,
      updatedAt: timestamp,
    }));
    transaction.create(refs.walletTransaction, buildWalletTransaction({
      actorUid: uid,
      amount: quote.amountCoins,
      balanceAfter: debit.value.balanceAfter,
      createdAt: timestamp,
      currency: 'coins',
      referenceId: transactionId,
      source: 'aristocracy',
      type: 'purchase',
      uid,
    }));
    transaction.create(refs.transaction, history);
    transaction.set(refs.entitlement, entitlement);
    transaction.update(refs.quote, {
      consumedAt: timestamp,
      consumedByRequestId: requestId,
      state: 'consumed',
      transactionId,
    });
    queueAristocracyProjection({ db, fieldValue, requestId, timestamp, transaction, uid });
    transaction.create(refs.command, {
      schemaVersion: STATUS_SCHEMA_VERSION,
      action: 'purchase-aristocracy',
      uid,
      requestId,
      quoteId: quote.quoteId,
      createdAt: timestamp,
      result,
    });
    return { result };
  });
}

async function expireAristocracyEntitlements({ clock = systemClock(), db, fieldValue, limit = ARISTOCRACY_EXPIRY_BATCH_LIMIT }) {
  const nowMillis = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMillis);
  const safeLimit = Number.isSafeInteger(limit) && limit >= 1 ? Math.min(limit, ARISTOCRACY_EXPIRY_BATCH_LIMIT) : ARISTOCRACY_EXPIRY_BATCH_LIMIT;
  const snapshot = await db.collection('aristocracyEntitlements')
    .where('state', '==', 'active').where('expiresAt', '<=', now).orderBy('expiresAt', 'asc').limit(safeLimit).get();
  let expired = 0;
  for (const document of snapshot.docs) {
    const changed = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(document.ref);
      const data = current.data();
      if (!current.exists || data?.state !== 'active' || timestampMillis(data.expiresAt) > nowMillis) return false;
      const expiryKey = crypto.createHash('sha256').update(`${document.id}:${data.revision || 0}`).digest('hex').slice(0, 32);
      const requestId = `expiry_${expiryKey}`;
      const transactionId = `expiry_${expiryKey}`;
      const timestamp = fieldValue.serverTimestamp();
      transaction.update(document.ref, {
        latestTransactionId: transactionId,
        revision: (data.revision || 0) + 1,
        state: 'expired',
        updatedAt: timestamp,
      });
      transaction.create(db.doc(`aristocracyTransactions/${transactionId}`), buildAristocracyTransaction({
        actorUid: 'system', amountCoins: 0, catalogVersion: data.catalogVersion, createdAt: timestamp,
        expiresAt: data.expiresAt, kind: 'expiry', rankId: data.rankId, rankOrder: data.rankOrder,
        requestId, transactionId, uid: document.id,
      }));
      queueAristocracyProjection({ db, fieldValue, requestId, timestamp, transaction, uid: document.id });
      return true;
    });
    if (changed) expired += 1;
  }
  return { scanned: snapshot.size, expired };
}

async function inspectAdminAristocracy({ db, targetUid }) {
  if (!targetUid || targetUid.length > 128 || targetUid.includes('/')) return { errorCode: 'INVALID_REQUEST' };
  const [entitlement, wallet, history] = await Promise.all([
    db.doc(`aristocracyEntitlements/${targetUid}`).get(),
    db.doc(`walletSummaries/${targetUid}`).get(),
    db.collection('aristocracyTransactions').where('uid', '==', targetUid).orderBy('createdAt', 'desc').limit(50).get(),
  ]);
  return {
    result: {
      entitlement: entitlement.exists ? entitlement.data() : null,
      wallet: mapWalletSummary(wallet.data(), targetUid),
      history: history.docs.map((document) => ({ id: document.id, ...document.data() })),
    },
  };
}

async function setAristocracyShopAvailability({ db, decodedToken, enabled, fieldValue, reason, requestId }) {
  const safeReason = typeof reason === 'string' ? reason.trim().slice(0, 300) : '';
  if (decodedToken?.admin !== true || decodedToken?.adminRole !== 'owner' || !validRequestId(requestId)
    || typeof enabled !== 'boolean' || safeReason.length < 8) return { errorCode: 'PERMISSION_DENIED' };
  return db.runTransaction(async (transaction) => {
    const featureRef = db.doc('appConfig/statusFeatures');
    const auditRef = db.doc(`adminAuditEvents/aristocracy_shop_${requestId}`);
    const [feature, audit, actor] = await Promise.all([
      transaction.get(featureRef), transaction.get(auditRef), transaction.get(db.doc(`adminProfiles/${decodedToken.uid}`)),
    ]);
    if (!isActiveStoredAdmin(actor.data(), decodedToken, ['owner'])) return { errorCode: 'PERMISSION_DENIED' };
    if (audit.exists) {
      const previous = audit.data();
      return previous.action === 'aristocracy-shop-availability' && previous.actorUid === decodedToken.uid
        && previous.enabled === enabled && previous.note === safeReason && previous.result
        ? { result: previous.result } : { errorCode: 'REQUEST_CONFLICT' };
    }
    if (enabled) {
      const pointer = await transaction.get(db.doc('statusCatalogPointers/aristocracy'));
      const catalogVersion = activeCatalogVersion(pointer.data(), 'aristocracy');
      if (!catalogVersion) return { errorCode: 'CATALOG_UNAVAILABLE' };
      const catalog = await transaction.get(db.doc(`aristocracyCatalogVersions/${catalogVersion}`));
      const normalized = normalizeAristocracyCatalogVersion(catalog.data());
      if (!normalized.ok || normalized.value.state !== 'published') return { errorCode: 'CATALOG_UNAVAILABLE' };
    }
    const flags = mapStatusFeatureFlags(feature.data());
    const timestamp = fieldValue.serverTimestamp();
    const next = { ...flags, aristocracyShop: enabled, updatedAt: timestamp };
    const result = { enabled, previousEnabled: flags.aristocracyShop };
    transaction.set(featureRef, next);
    transaction.create(auditRef, {
      action: 'aristocracy-shop-availability', actorUid: decodedToken.uid, createdAt: timestamp,
      enabled, kind: 'economy', note: safeReason, previousEnabled: flags.aristocracyShop,
      result, status: 'completed',
    });
    return { result };
  });
}

async function proposeAristocracyAdminOperation({ db, decodedToken, fieldValue, input }) {
  const normalized = normalizeAristocracyAdminProposal(input);
  if (!normalized.ok || !isStatusEconomyAdmin(decodedToken)) return { errorCode: normalized.ok ? 'PERMISSION_DENIED' : normalized.code };
  const proposalRef = db.doc(`statusAdminProposals/${normalized.value.requestId}`);
  return db.runTransaction(async (transaction) => {
    const [existing, actor] = await Promise.all([
      transaction.get(proposalRef),
      transaction.get(db.doc(`adminProfiles/${decodedToken.uid}`)),
    ]);
    if (!isActiveStoredAdmin(actor.data(), decodedToken, ['owner', 'catalog-manager'])) return { errorCode: 'PERMISSION_DENIED' };
    if (existing.exists) {
      const previous = existing.data();
      return sameAdminProposal(previous, normalized.value, decodedToken.uid)
        ? { result: { proposalId: proposalRef.id, state: previous.state } }
        : { errorCode: 'REQUEST_CONFLICT' };
    }
    const timestamp = fieldValue.serverTimestamp();
    transaction.create(proposalRef, {
      schemaVersion: STATUS_SCHEMA_VERSION,
      proposalId: proposalRef.id,
      kind: 'aristocracy-admin-operation',
      ...normalized.value,
      initiatedBy: decodedToken.uid,
      initiatedByRole: decodedToken.adminRole,
      state: 'pending-approval',
      createdAt: timestamp,
    });
    return { result: { proposalId: proposalRef.id, state: 'pending-approval' } };
  });
}

async function approveAristocracyAdminOperation({ clock = systemClock(), db, decodedToken, fieldValue, requestId }) {
  if (!validRequestId(requestId) || decodedToken?.admin !== true || decodedToken?.adminRole !== 'owner') return { errorCode: 'PERMISSION_DENIED' };
  return db.runTransaction(async (transaction) => {
    const proposalRef = db.doc(`statusAdminProposals/${requestId}`);
    const [proposalSnapshot, approverSnapshot] = await Promise.all([
      transaction.get(proposalRef),
      transaction.get(db.doc(`adminProfiles/${decodedToken.uid}`)),
    ]);
    if (!isActiveStoredAdmin(approverSnapshot.data(), decodedToken, ['owner'])) return { errorCode: 'PERMISSION_DENIED' };
    const proposal = proposalSnapshot.data();
    if (!proposalSnapshot.exists || proposal?.kind !== 'aristocracy-admin-operation') return { errorCode: 'PROPOSAL_NOT_FOUND' };
    if (proposal.state === 'completed' && proposal.result) return { result: proposal.result };
    if (proposal.state !== 'pending-approval') return { errorCode: 'PROPOSAL_NOT_PENDING' };
    if (proposal.initiatedBy === decodedToken.uid) return { errorCode: 'SELF_APPROVAL_FORBIDDEN' };
    const initiatorSnapshot = await transaction.get(db.doc(`adminProfiles/${proposal.initiatedBy}`));
    if (!initiatorSnapshot.exists || initiatorSnapshot.data()?.uid !== proposal.initiatedBy
      || initiatorSnapshot.data()?.status !== 'active'
      || !['owner', 'catalog-manager'].includes(initiatorSnapshot.data()?.role)) return { errorCode: 'INITIATOR_INACTIVE' };
    const entitlementRef = db.doc(`aristocracyEntitlements/${proposal.targetUid}`);
    const [entitlementSnapshot, profileSnapshot] = await Promise.all([
      transaction.get(entitlementRef),
      transaction.get(db.doc(`publicProfiles/${proposal.targetUid}`)),
    ]);
    if (!profileSnapshot.exists) return { errorCode: 'PROFILE_NOT_FOUND' };
    if (proposal.action === 'complimentary-grant' && profileSnapshot.data()?.moderationStatus !== 'active') {
      return { errorCode: 'PERMISSION_DENIED' };
    }
    const existing = entitlementSnapshot.exists ? entitlementSnapshot.data() : null;
    const timestamp = fieldValue.serverTimestamp();
    const transactionId = `admin_${requestId}`;
    let next;
    let expiresAt;
    let catalogVersion = existing?.catalogVersion;
    let rankId = existing?.rankId;
    let rankOrder = existing?.rankOrder;
    if (proposal.action === 'complimentary-grant') {
      const catalogSnapshot = await transaction.get(db.doc(`aristocracyCatalogVersions/${proposal.catalogVersion}`));
      const catalog = normalizeAristocracyCatalogVersion(catalogSnapshot.data());
      const rank = catalog.ok && catalog.value.state === 'published'
        ? catalog.value.ranks.find((candidate) => candidate.id === proposal.rankId)
        : null;
      const mapped = existing ? mapAristocracyEntitlement(existing, proposal.targetUid, clock.nowMillis()) : null;
      if (existing && !mapped) return { errorCode: 'ARISTOCRACY_AUTHORITY_INVALID' };
      if (!rank) return { errorCode: 'CATALOG_UNAVAILABLE' };
      if (mapped?.state === 'active') return { errorCode: 'ENTITLEMENT_ACTIVE' };
      expiresAt = clock.timestampFromMillis(clock.nowMillis() + proposal.durationDays * DAY_MS);
      catalogVersion = catalog.value.catalogVersion;
      rankId = rank.id;
      rankOrder = rank.order;
      next = {
        schemaVersion: STATUS_SCHEMA_VERSION, uid: proposal.targetUid, catalogVersion, rankId, rankOrder,
        state: 'active', origin: 'complimentary', revision: (existing?.revision || 0) + 1,
        highestEverRankOrder: Math.max(existing?.highestEverRankOrder || 0, rankOrder), acquiredAt: timestamp,
        expiresAt, latestTransactionId: transactionId, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp,
      };
    } else {
      const mapped = existing ? mapAristocracyEntitlement(existing, proposal.targetUid, clock.nowMillis()) : null;
      if (existing && !mapped) return { errorCode: 'ARISTOCRACY_AUTHORITY_INVALID' };
      if (!mapped) return { errorCode: 'ENTITLEMENT_NOT_FOUND' };
      expiresAt = existing.expiresAt;
      const state = proposal.action === 'freeze' ? 'frozen'
        : proposal.action === 'unfreeze' ? (mapped.expiresAtMillis > clock.nowMillis() ? 'active' : 'expired')
          : 'expired';
      next = { ...existing, state, revision: (existing.revision || 0) + 1, latestTransactionId: transactionId, updatedAt: timestamp };
      if (proposal.action === 'revoke') next.expiresAt = clock.timestampFromMillis(clock.nowMillis());
      expiresAt = next.expiresAt;
    }
    const kind = proposal.action === 'revoke' ? 'admin-revoke' : proposal.action;
    const history = buildAristocracyTransaction({
      actorUid: decodedToken.uid, amountCoins: 0, catalogVersion, createdAt: timestamp, expiresAt, kind,
      rankId, rankOrder, requestId, transactionId, uid: proposal.targetUid,
    });
    if (!history) return { errorCode: 'INTERNAL' };
    const result = { action: proposal.action, targetUid: proposal.targetUid, transactionId, state: next.state };
    transaction.set(entitlementRef, next);
    transaction.create(db.doc(`aristocracyTransactions/${transactionId}`), history);
    queueAristocracyProjection({ db, fieldValue, requestId, timestamp, transaction, uid: proposal.targetUid });
    transaction.update(proposalRef, { approvedAt: timestamp, approvedBy: decodedToken.uid, result, state: 'completed' });
    transaction.create(db.doc(`adminAuditEvents/aristocracy_${requestId}`), {
      action: `aristocracy-${proposal.action}`, actorUid: decodedToken.uid, approverUid: decodedToken.uid,
      initiatorUid: proposal.initiatedBy, createdAt: timestamp, evidenceRef: proposal.evidenceRef, kind: 'economy',
      note: proposal.reason, status: 'completed', targetUid: proposal.targetUid, transactionId,
    });
    return { result };
  });
}

async function reconcileAristocracyEconomy({
  db,
  documentIdField = defaultDocumentIdField(),
  limit = ARISTOCRACY_RECONCILIATION_LIMIT,
  pageSize = 500,
}) {
  const safeLimit = Number.isSafeInteger(limit) && limit >= 1 ? Math.min(limit, ARISTOCRACY_RECONCILIATION_LIMIT) : ARISTOCRACY_RECONCILIATION_LIMIT;
  const safePageSize = Number.isSafeInteger(pageSize) && pageSize >= 1 ? Math.min(pageSize, 1_000) : 500;
  const [history, ledgers, entitlements] = await Promise.all([
    readAllRows({ collection: db.collection('aristocracyTransactions'), documentIdField, maxDocs: safeLimit, pageSize: safePageSize }),
    readAllRows({ collection: db.collection('walletTransactions').where('source', '==', 'aristocracy'), documentIdField, maxDocs: safeLimit, pageSize: safePageSize }),
    readAllRows({ collection: db.collection('aristocracyEntitlements'), documentIdField, maxDocs: safeLimit, pageSize: safePageSize }),
  ]);
  const truncated = history.truncated || ledgers.truncated || entitlements.truncated;
  const ledgerById = new Map(ledgers.rows.map((row) => [row.id, row.data]));
  const historyById = new Map(history.rows.map((row) => [row.id, row.data]));
  const errors = [];
  let paidAmountCoins = 0;
  for (const [id, row] of historyById) {
    if (row?.schemaVersion !== STATUS_SCHEMA_VERSION || row.transactionId !== id || typeof row.uid !== 'string'
      || typeof row.catalogVersion !== 'string' || typeof row.rankId !== 'string' || !Number.isSafeInteger(row.rankOrder)
      || !['purchase', 'renewal', 'upgrade', 'complimentary-grant', 'admin-revoke', 'freeze', 'unfreeze', 'expiry'].includes(row.kind)) {
      errors.push({ kind: 'invalid-transaction', id });
      continue;
    }
    if (!['purchase', 'renewal', 'upgrade'].includes(row.kind)) continue;
    if (!Number.isSafeInteger(row.amountCoins) || row.amountCoins < 1 || typeof row.walletTransactionId !== 'string') {
      errors.push({ kind: 'invalid-paid-transaction', id });
      continue;
    }
    const ledger = ledgerById.get(row.walletTransactionId);
    if (!ledger || ledger.uid !== row.uid || ledger.amount !== row.amountCoins || ledger.currency !== 'coins'
      || ledger.type !== 'purchase' || ledger.referenceId !== id) errors.push({ kind: 'ledger-mismatch', id });
    else paidAmountCoins += row.amountCoins;
  }
  for (const [id, ledger] of ledgerById) {
    if (!historyById.has(ledger.referenceId)) errors.push({ kind: 'orphan-wallet-ledger', id });
  }
  for (const document of entitlements.rows) {
    const row = document.data;
    if (!mapAristocracyEntitlement(row, document.id)) {
      errors.push({ kind: 'invalid-entitlement', id: document.id });
      continue;
    }
    const latest = historyById.get(row.latestTransactionId);
    if (!latest || latest.uid !== document.id || latest.rankId !== row.rankId || latest.catalogVersion !== row.catalogVersion) {
      errors.push({ kind: 'entitlement-history-mismatch', id: document.id });
    }
  }
  return {
    ok: true,
    value: {
      clean: !truncated && errors.length === 0,
      truncated,
      transactionCount: history.rows.length,
      walletLedgerCount: ledgers.rows.length,
      entitlementCount: entitlements.rows.length,
      paidAmountCoins,
      errors,
    },
  };
}

function queueAristocracyProjection({ db, requestId, timestamp, transaction, uid }) {
  const jobId = `aristocracy_${uid}_${requestId}`;
  transaction.create(db.doc(`statusPresentationJobs/${jobId}`), {
    schemaVersion: STATUS_SCHEMA_VERSION, jobId, uid, state: 'queued', attempts: 0,
    createdAt: timestamp, nextAttemptAt: timestamp, updatedAt: timestamp,
  });
}

async function validateProfileInTransaction({ db, profile, transaction, uid }) {
  const data = profile.data();
  const reservation = data?.publicId ? await transaction.get(db.doc(`publicIds/${data.publicId}`)) : null;
  if (!profile.exists || !inspectPublicProfile(data, reservation?.data(), uid).ok) return 'PROFILE_INCOMPLETE';
  return data.moderationStatus === 'active' ? '' : 'PERMISSION_DENIED';
}

function mapIdempotentCommand(data, action, input) {
  if (data?.action !== action || !data.result) return { errorCode: 'REQUEST_CONFLICT' };
  if (action === 'quote-aristocracy' && (data.catalogVersion !== input.catalogVersion || data.targetRankId !== input.targetRankId)) {
    return { errorCode: 'REQUEST_CONFLICT' };
  }
  if (action === 'purchase-aristocracy' && data.quoteId !== input.quoteId) return { errorCode: 'REQUEST_CONFLICT' };
  return { result: data.result };
}

function isStatusEconomyAdmin(token) {
  return token?.admin === true && ['owner', 'catalog-manager'].includes(token.adminRole) && typeof token.uid === 'string';
}
function isActiveStoredAdmin(profile, token, roles) {
  return profile?.uid === token?.uid && profile?.status === 'active' && profile?.role === token?.adminRole
    && roles.includes(profile.role);
}
function sameAdminProposal(left, right, actorUid) {
  return left?.kind === 'aristocracy-admin-operation' && left.initiatedBy === actorUid
    && JSON.stringify({ action: left.action, targetUid: left.targetUid, catalogVersion: left.catalogVersion,
      rankId: left.rankId, durationDays: left.durationDays, reason: left.reason, evidenceRef: left.evidenceRef })
      === JSON.stringify({ action: right.action, targetUid: right.targetUid, catalogVersion: right.catalogVersion,
        rankId: right.rankId, durationDays: right.durationDays, reason: right.reason, evidenceRef: right.evidenceRef });
}
function validRequestId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(value); }
function randomQuoteId() { return crypto.randomBytes(24).toString('base64url'); }
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
  ARISTOCRACY_EXPIRY_BATCH_LIMIT,
  ARISTOCRACY_QUOTE_HOURLY_LIMIT,
  approveAristocracyAdminOperation,
  expireAristocracyEntitlements,
  inspectAdminAristocracy,
  proposeAristocracyAdminOperation,
  purchaseAristocracy,
  quoteAristocracy,
  reconcileAristocracyEconomy,
  setAristocracyShopAvailability,
};
