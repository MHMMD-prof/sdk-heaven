const MAX_WALLET_AMOUNT = 1_000_000_000;
const STORE_LIMIT = 50;
const { isValidSpecialId } = require('./socialProfileCore');
const { isStoreCurrency } = require('./storeCore');

function normalizeSpecialIdPurchaseInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => key !== 'specialId')) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const specialId = typeof input.specialId === 'string' ? input.specialId.trim() : '';
  return isValidSpecialId(specialId)
    ? { ok: true, value: { specialId } }
    : { ok: false, code: 'INVALID_REQUEST' };
}

function normalizeAdminWalletCreditInput(input) {
  const targetUid = typeof input?.targetUid === 'string' ? input.targetUid.trim() : '';
  const amount = Number(input?.amount);
  const currency = input?.currency === undefined ? 'coins' : input.currency;
  const expectedUpdatedAt = typeof input?.expectedUpdatedAt === 'string' ? input.expectedUpdatedAt.trim().slice(0, 80) : '';
  const note = typeof input?.note === 'string' ? input.note.trim().slice(0, 160) : '';
  const requestId = normalizeAdminRequestId(input?.requestId);
  if (!targetUid || targetUid.length > 128 || !requestId || !isStoreCurrency(currency) || !Number.isSafeInteger(amount) || amount < 1 || amount > MAX_WALLET_AMOUNT) {
    return { ok: false, error: 'Valid targetUid, requestId, currency, and positive integer amount are required.' };
  }
  return { ok: true, value: { amount, currency, expectedUpdatedAt, note, requestId, targetUid } };
}

function normalizeAdminWalletAdjustmentInput(input) {
  const normalized = normalizeAdminWalletCreditInput(input);
  const mutationType = input?.mutationType;
  if (!normalized.ok || !['credit', 'debit'].includes(mutationType)) {
    return { ok: false, error: 'Valid target, request, currency, adjustment type, reason, and positive integer amount are required.' };
  }
  if (normalized.value.note.length < 2) return { ok: false, error: 'An adjustment reason is required.' };
  return { ok: true, value: { ...normalized.value, mutationType } };
}

function normalizeAdminSpecialIdInput(input) {
  const expectedUpdatedAt = typeof input?.expectedUpdatedAt === 'string' ? input.expectedUpdatedAt.trim().slice(0, 80) : '';
  const specialId = typeof input?.specialId === 'string' ? input.specialId.trim() : '';
  const price = Number(input?.price);
  const reason = typeof input?.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
  const requestId = normalizeAdminRequestId(input?.requestId);
  const status = input?.status;
  if (!requestId || reason.length < 2 || !['available', 'disabled'].includes(status) || !isValidSpecialId(specialId) || !Number.isSafeInteger(price) || price < 1 || price > MAX_WALLET_AMOUNT) {
    return { ok: false, error: 'Valid requestId, numeric specialId, and positive integer price are required.' };
  }
  return { ok: true, value: { expectedUpdatedAt, price, reason, requestId, specialId, status } };
}

function normalizeAdminRequestId(value) {
  const requestId = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{12,80}$/.test(requestId) ? requestId : '';
}

function mapWalletSummary(data, uid) {
  const balances = mapCurrencyAmounts(data?.balances, { coins: data?.balance });
  const lifetimeCredit = mapCurrencyAmounts(data?.lifetimeCredit, { coins: data?.lifetimeCredit });
  const lifetimeDebit = mapCurrencyAmounts(data?.lifetimeDebit, { coins: data?.lifetimeDebit });
  return {
    balances,
    lifetimeCredit,
    lifetimeDebit,
    uid,
    updatedAt: data?.updatedAt,
  };
}

function applyWalletMutation(wallet, { amount, currency, type }) {
  if (!isStoreCurrency(currency) || !Number.isSafeInteger(amount) || amount < 1 || !['credit', 'debit'].includes(type)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const current = wallet.balances[currency];
  if (type === 'debit' && current < amount) return { ok: false, code: 'INSUFFICIENT_FUNDS' };
  const balanceAfter = type === 'credit' ? current + amount : current - amount;
  if (!Number.isSafeInteger(balanceAfter) || balanceAfter > MAX_WALLET_AMOUNT) return { ok: false, code: 'CONFLICT' };
  const lifetimeAfter = type === 'credit'
    ? wallet.lifetimeCredit[currency] + amount
    : wallet.lifetimeDebit[currency] + amount;
  if (!Number.isSafeInteger(lifetimeAfter)) return { ok: false, code: 'CONFLICT' };
  return {
    ok: true,
    value: {
      balanceAfter,
      wallet: {
        ...wallet,
        balances: { ...wallet.balances, [currency]: balanceAfter },
        lifetimeCredit: type === 'credit'
          ? { ...wallet.lifetimeCredit, [currency]: lifetimeAfter }
          : wallet.lifetimeCredit,
        lifetimeDebit: type === 'debit'
          ? { ...wallet.lifetimeDebit, [currency]: lifetimeAfter }
          : wallet.lifetimeDebit,
      },
    },
  };
}

function buildWalletDocument(wallet, { createdAt, updatedAt }) {
  return {
    balances: { ...wallet.balances },
    createdAt,
    lifetimeCredit: { ...wallet.lifetimeCredit },
    lifetimeDebit: { ...wallet.lifetimeDebit },
    uid: wallet.uid,
    updatedAt,
  };
}

function buildWalletTransaction({ actorUid, amount, balanceAfter, createdAt, currency, note = '', referenceId = '', source, type, uid }) {
  if (!isStoreCurrency(currency) || !Number.isSafeInteger(amount) || amount < 1 || !Number.isSafeInteger(balanceAfter) || balanceAfter < 0) return undefined;
  if (!['credit', 'debit', 'purchase', 'transfer'].includes(type)) return undefined;
  return {
    actorUid,
    amount,
    balanceAfter,
    createdAt,
    currency,
    ...(note ? { note } : {}),
    ...(referenceId ? { referenceId } : {}),
    source,
    type,
    uid,
  };
}

function isDualCurrencyWalletDocument(data, uid) {
  return Boolean(
    data
    && typeof data === 'object'
    && data.uid === uid
    && isCurrencyAmounts(data.balances, MAX_WALLET_AMOUNT)
    && isCurrencyAmounts(data.lifetimeCredit)
    && isCurrencyAmounts(data.lifetimeDebit)
    && !('balance' in data)
  );
}

function analyzeWalletDocument(data, uid) {
  if (isDualCurrencyWalletDocument(data, uid)) return { ok: true, status: 'ready', wallet: mapWalletSummary(data, uid) };
  if (!data || typeof data !== 'object' || data.uid !== uid || !isLegacyAmount(data.balance, MAX_WALLET_AMOUNT)) {
    return { ok: false, code: 'INVALID_WALLET' };
  }
  if (
    data.lifetimeCredit !== undefined && !isLegacyAmount(data.lifetimeCredit)
    || data.lifetimeDebit !== undefined && !isLegacyAmount(data.lifetimeDebit)
  ) return { ok: false, code: 'INVALID_WALLET' };
  return { ok: true, status: 'legacy', wallet: mapWalletSummary(data, uid) };
}

function mapCurrencyAmounts(value, legacy = {}) {
  const candidate = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    coins: readAmount(candidate.coins ?? legacy.coins),
    diamonds: readAmount(candidate.diamonds ?? legacy.diamonds),
  };
}

function isCurrencyAmounts(value, max = Number.MAX_SAFE_INTEGER) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === 2
    && readAmount(value.coins) === value.coins
    && readAmount(value.diamonds) === value.diamonds
    && value.coins <= max
    && value.diamonds <= max
  );
}

function isLegacyAmount(value, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function mapSpecialIdCatalogItem(data) {
  if (!data || !isValidSpecialId(data.specialId) || !Number.isSafeInteger(data.price) || data.price < 1) return undefined;
  if (!['available', 'sold', 'disabled'].includes(data.status)) return undefined;
  return { price: data.price, specialId: data.specialId, status: data.status };
}

function readAmount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

module.exports = {
  MAX_WALLET_AMOUNT,
  STORE_LIMIT,
  applyWalletMutation,
  analyzeWalletDocument,
  buildWalletDocument,
  buildWalletTransaction,
  isDualCurrencyWalletDocument,
  mapCurrencyAmounts,
  mapSpecialIdCatalogItem,
  mapWalletSummary,
  normalizeAdminSpecialIdInput,
  normalizeAdminWalletAdjustmentInput,
  normalizeAdminWalletCreditInput,
  normalizeSpecialIdPurchaseInput,
  readAmount,
};
