'use strict';

const { MAX_WALLET_AMOUNT } = require('./socialWalletCore');
const {
  STATUS_SCHEMA_VERSION,
  mapAristocracyEntitlement,
  normalizeAristocracyCatalogVersion,
} = require('./statusMembershipCore');

const ARISTOCRACY_QUOTE_TTL_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
const MAX_COMPLIMENTARY_DAYS = 90;

function normalizeAristocracyQuoteInput(input) {
  if (!isRecord(input) || !hasOnly(input, ['catalogVersion', 'targetRankId'])) return invalid('INVALID_REQUEST');
  const catalogVersion = normalizeId(input.catalogVersion, 80);
  const targetRankId = normalizeId(input.targetRankId, 40);
  return catalogVersion && targetRankId
    ? { ok: true, value: { catalogVersion, targetRankId } }
    : invalid('INVALID_REQUEST');
}

function normalizeAristocracyPurchaseInput(input) {
  if (!isRecord(input) || !hasOnly(input, ['quoteId'])) return invalid('INVALID_REQUEST');
  const quoteId = cleanString(input.quoteId, 80);
  return /^[A-Za-z0-9_-]{24,80}$/.test(quoteId)
    ? { ok: true, value: { quoteId } }
    : invalid('INVALID_REQUEST');
}

function calculateAristocracyQuote({ catalog, entitlement, nowMillis, targetRankId }) {
  const normalized = normalizeAristocracyCatalogVersion(catalog);
  if (!normalized.ok || normalized.value.state !== 'published') return invalid('CATALOG_UNAVAILABLE');
  if (!Number.isSafeInteger(nowMillis) || nowMillis < 0) return invalid('INVALID_SERVER_TIME');
  const target = normalized.value.ranks.find((rank) => rank.id === targetRankId);
  if (!target) return invalid('RANK_UNAVAILABLE');
  const durationMs = normalized.value.durationDays * DAY_MS;
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) return invalid('CATALOG_UNAVAILABLE');
  const mapped = entitlement == null ? null : mapAristocracyEntitlement(entitlement, entitlement.uid, nowMillis);
  if (entitlement != null && !mapped) return invalid('ARISTOCRACY_AUTHORITY_INVALID');
  if (mapped && ['frozen', 'review'].includes(mapped.state)) return invalid('ENTITLEMENT_RESTRICTED');
  if (mapped && entitlement.origin === 'complimentary' && mapped.state === 'active') return invalid('COMPLIMENTARY_ACTIVE');

  const active = mapped?.state === 'active';
  if (active && mapped.catalogVersion !== normalized.value.catalogVersion) return invalid('CATALOG_CHANGED');
  const current = active ? normalized.value.ranks.find((rank) => rank.id === mapped.rankId) : null;
  if (active && !current) return invalid('CATALOG_CHANGED');
  let operation = 'purchase';
  let amountCoins = target.priceCoins;
  let resultingExpiryMillis = nowMillis + durationMs;
  if (active) {
    if (target.order < current.order) return invalid('DOWNGRADE_NOT_ALLOWED');
    if (target.order === current.order) {
      operation = 'renewal';
      resultingExpiryMillis = Math.max(nowMillis, mapped.expiresAtMillis) + durationMs;
    } else {
      operation = 'upgrade';
      const remainingMs = Math.max(0, mapped.expiresAtMillis - nowMillis);
      const difference = target.priceCoins - current.priceCoins;
      amountCoins = ceilMultiplyDivide(difference, remainingMs, durationMs);
      resultingExpiryMillis = mapped.expiresAtMillis;
    }
  }
  if (!Number.isSafeInteger(amountCoins) || amountCoins < 1 || amountCoins > MAX_WALLET_AMOUNT
    || !Number.isSafeInteger(resultingExpiryMillis) || resultingExpiryMillis <= nowMillis) {
    return invalid('QUOTE_UNAVAILABLE');
  }
  return {
    ok: true,
    value: {
      schemaVersion: STATUS_SCHEMA_VERSION,
      catalogVersion: normalized.value.catalogVersion,
      operation,
      amountCoins,
      durationDays: normalized.value.durationDays,
      targetRankId: target.id,
      targetRankOrder: target.order,
      sourceRankId: active ? current.id : null,
      sourceRankOrder: active ? current.order : null,
      sourceExpiryMillis: active ? mapped.expiresAtMillis : null,
      sourceRevision: active ? readRevision(entitlement?.revision) : 0,
      sourceTransactionId: active && typeof entitlement?.latestTransactionId === 'string'
        ? entitlement.latestTransactionId : '',
      resultingExpiryMillis,
    },
  };
}

function buildAristocracyQuoteDocument({ calculated, expiresAt, issuedAt, quoteId, requestId, uid }) {
  if (!calculated?.ok || !safeUid(uid) || !validQuoteId(quoteId) || !validRequestId(requestId) || !issuedAt || !expiresAt) return null;
  return {
    ...calculated.value,
    quoteId,
    requestId,
    uid,
    state: 'open',
    issuedAt,
    expiresAt,
  };
}

function mapAristocracyQuote(data, quoteId) {
  if (!isRecord(data) || data.schemaVersion !== STATUS_SCHEMA_VERSION || data.quoteId !== quoteId
    || !validQuoteId(quoteId) || !safeUid(data.uid) || !normalizeId(data.catalogVersion, 80)
    || !['purchase', 'renewal', 'upgrade'].includes(data.operation)
    || !positiveInteger(data.amountCoins, MAX_WALLET_AMOUNT)
    || !positiveInteger(data.durationDays, 365) || !normalizeId(data.targetRankId, 40)
    || !positiveInteger(data.targetRankOrder, 20) || !['open', 'consumed', 'expired', 'revoked'].includes(data.state)
    || !validRequestId(data.requestId)) return null;
  const issuedAtMillis = timestampMillis(data.issuedAt);
  const expiresAtMillis = timestampMillis(data.expiresAt);
  if (!Number.isFinite(issuedAtMillis) || !Number.isFinite(expiresAtMillis) || expiresAtMillis <= issuedAtMillis
    || expiresAtMillis - issuedAtMillis > ARISTOCRACY_QUOTE_TTL_MS) return null;
  const sourceRankId = data.sourceRankId === null ? null : normalizeId(data.sourceRankId, 40);
  const sourceRankOrder = data.sourceRankOrder === null ? null : data.sourceRankOrder;
  const sourceExpiryMillis = data.sourceExpiryMillis === null ? null : data.sourceExpiryMillis;
  if ((sourceRankId === null) !== (sourceRankOrder === null) || (sourceRankId === null) !== (sourceExpiryMillis === null)
    || (sourceRankOrder !== null && !positiveInteger(sourceRankOrder, 20))
    || (sourceExpiryMillis !== null && (!Number.isSafeInteger(sourceExpiryMillis) || sourceExpiryMillis <= issuedAtMillis))
    || !nonNegativeInteger(data.sourceRevision, Number.MAX_SAFE_INTEGER)
    || !Number.isSafeInteger(data.resultingExpiryMillis) || data.resultingExpiryMillis <= issuedAtMillis) return null;
  return {
    schemaVersion: STATUS_SCHEMA_VERSION,
    quoteId,
    requestId: data.requestId,
    uid: data.uid,
    catalogVersion: data.catalogVersion,
    operation: data.operation,
    amountCoins: data.amountCoins,
    durationDays: data.durationDays,
    targetRankId: data.targetRankId,
    targetRankOrder: data.targetRankOrder,
    sourceRankId,
    sourceRankOrder,
    sourceExpiryMillis,
    sourceRevision: data.sourceRevision,
    sourceTransactionId: typeof data.sourceTransactionId === 'string' ? data.sourceTransactionId : '',
    resultingExpiryMillis: data.resultingExpiryMillis,
    state: data.state,
    issuedAtMillis,
    expiresAtMillis,
  };
}

function quoteMatchesCalculation(quote, calculated) {
  if (!quote || !calculated?.ok) return false;
  const expected = calculated.value;
  return quote.catalogVersion === expected.catalogVersion
    && quote.operation === expected.operation
    && quote.amountCoins === expected.amountCoins
    && quote.durationDays === expected.durationDays
    && quote.targetRankId === expected.targetRankId
    && quote.targetRankOrder === expected.targetRankOrder
    && quote.sourceRankId === expected.sourceRankId
    && quote.sourceRankOrder === expected.sourceRankOrder
    && quote.sourceExpiryMillis === expected.sourceExpiryMillis
    && quote.sourceRevision === expected.sourceRevision
    && quote.sourceTransactionId === expected.sourceTransactionId
    && quote.resultingExpiryMillis === expected.resultingExpiryMillis;
}

function buildPaidAristocracyEntitlement({ existing, quote, timestamp, transactionId, uid, expiresAt }) {
  const revision = readRevision(existing?.revision) + 1;
  const highestEverRankOrder = Math.max(readRevision(existing?.highestEverRankOrder), quote.targetRankOrder);
  return {
    schemaVersion: STATUS_SCHEMA_VERSION,
    uid,
    catalogVersion: quote.catalogVersion,
    rankId: quote.targetRankId,
    rankOrder: quote.targetRankOrder,
    state: 'active',
    origin: 'paid',
    revision,
    highestEverRankOrder,
    acquiredAt: quote.operation === 'purchase' ? timestamp : (existing?.acquiredAt || timestamp),
    ...(quote.operation === 'renewal' ? { renewedAt: timestamp } : {}),
    ...(quote.operation === 'upgrade' ? { upgradedAt: timestamp } : {}),
    expiresAt,
    latestTransactionId: transactionId,
    updatedAt: timestamp,
    createdAt: existing?.createdAt || timestamp,
  };
}

function buildAristocracyTransaction({ actorUid, amountCoins, catalogVersion, createdAt, expiresAt, kind, rankId, rankOrder, requestId, transactionId, uid, walletTransactionId = '' }) {
  if (!safeUid(actorUid) || !safeUid(uid) || !normalizeId(catalogVersion, 80) || !normalizeId(rankId, 40)
    || !positiveInteger(rankOrder, 20) || !validRequestId(requestId) || !transactionId || !createdAt || !expiresAt
    || !['purchase', 'renewal', 'upgrade', 'complimentary-grant', 'admin-revoke', 'freeze', 'unfreeze', 'expiry'].includes(kind)
    || !nonNegativeInteger(amountCoins, MAX_WALLET_AMOUNT)) return null;
  if (['purchase', 'renewal', 'upgrade'].includes(kind) && (amountCoins < 1 || !walletTransactionId)) return null;
  if (!['purchase', 'renewal', 'upgrade'].includes(kind) && amountCoins !== 0) return null;
  return {
    schemaVersion: STATUS_SCHEMA_VERSION,
    transactionId,
    uid,
    actorUid,
    kind,
    catalogVersion,
    rankId,
    rankOrder,
    amountCoins,
    currency: 'coins',
    requestId,
    createdAt,
    expiresAt,
    ...(walletTransactionId ? { walletTransactionId } : {}),
  };
}

function normalizeAristocracyAdminProposal(input) {
  if (!isRecord(input) || !hasOnly(input, [
    'action', 'targetUid', 'catalogVersion', 'rankId', 'durationDays', 'reason', 'evidenceRef', 'requestId',
  ])) return invalid('INVALID_REQUEST');
  const action = input.action;
  const targetUid = cleanString(input.targetUid, 128);
  const catalogVersion = normalizeId(input.catalogVersion, 80);
  const rankId = normalizeId(input.rankId, 40);
  const durationDays = input.durationDays;
  const reason = cleanString(input.reason, 300);
  const evidenceRef = cleanString(input.evidenceRef, 200);
  const requestId = cleanString(input.requestId, 80);
  if (!['complimentary-grant', 'revoke', 'freeze', 'unfreeze'].includes(action) || !safeUid(targetUid)
    || !validRequestId(requestId) || reason.length < 8 || evidenceRef.length < 3) return invalid('INVALID_REQUEST');
  if (action === 'complimentary-grant') {
    if (!catalogVersion || !rankId || !positiveInteger(durationDays, MAX_COMPLIMENTARY_DAYS)) return invalid('INVALID_REQUEST');
  } else if (input.catalogVersion !== undefined || input.rankId !== undefined || input.durationDays !== undefined) {
    return invalid('INVALID_REQUEST');
  }
  return { ok: true, value: { action, targetUid, requestId, reason, evidenceRef, ...(action === 'complimentary-grant' ? { catalogVersion, rankId, durationDays } : {}) } };
}

function ceilMultiplyDivide(left, middle, divisor) {
  if (![left, middle, divisor].every((value) => Number.isSafeInteger(value) && value >= 0) || divisor < 1) return Number.NaN;
  const numerator = BigInt(left) * BigInt(middle);
  const result = (numerator + BigInt(divisor) - 1n) / BigInt(divisor);
  return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : Number.NaN;
}

function readRevision(value) { return nonNegativeInteger(value, Number.MAX_SAFE_INTEGER) ? value : 0; }
function timestampMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  return Number.NaN;
}
function isRecord(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function hasOnly(value, keys) { return Object.keys(value).every((key) => keys.includes(key)); }
function cleanString(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function normalizeId(value, max) { const id = cleanString(value, max).toLowerCase(); return /^[a-z0-9][a-z0-9_-]{2,79}$/.test(id) ? id : ''; }
function safeUid(value) { return typeof value === 'string' && value.length >= 1 && value.length <= 128 && !/[\/\u0000-\u001F\u007F]/.test(value); }
function validQuoteId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{24,80}$/.test(value); }
function validRequestId(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(value); }
function positiveInteger(value, max) { return Number.isSafeInteger(value) && value >= 1 && value <= max; }
function nonNegativeInteger(value, max) { return Number.isSafeInteger(value) && value >= 0 && value <= max; }
function invalid(code) { return { ok: false, code }; }

module.exports = {
  ARISTOCRACY_QUOTE_TTL_MS,
  DAY_MS,
  MAX_COMPLIMENTARY_DAYS,
  buildAristocracyQuoteDocument,
  buildAristocracyTransaction,
  buildPaidAristocracyEntitlement,
  calculateAristocracyQuote,
  ceilMultiplyDivide,
  mapAristocracyQuote,
  normalizeAristocracyAdminProposal,
  normalizeAristocracyPurchaseInput,
  normalizeAristocracyQuoteInput,
  quoteMatchesCalculation,
  timestampMillis,
};
