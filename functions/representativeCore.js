const { isValidPublicId } = require('./socialProfileCore');
const { isStoreCurrency } = require('./storeCore');
const { MAX_WALLET_AMOUNT } = require('./socialWalletCore');
const {
  isValidRepresentativeOpaqueToken,
  isValidRepresentativePublicReference,
  isValidRepresentativeTransferPin,
} = require('./representativePortalCore');

function normalizeRepresentativeTransferInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'INVALID_REQUEST' };
  if (Object.keys(input).some((key) => !['amount', 'currency', 'pin', 'proof'].includes(key))) return { ok: false, code: 'INVALID_REQUEST' };
  const amount = Number(input.amount);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_WALLET_AMOUNT || !isStoreCurrency(input.currency)
    || !isValidRepresentativeTransferPin(input.pin) || !isValidRepresentativeOpaqueToken(input.proof)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  return { ok: true, value: { amount, currency: input.currency, pin: input.pin, proof: input.proof } };
}

function normalizeAdminRepresentativeInput(input) {
  const targetUid = typeof input?.targetUid === 'string' ? input.targetUid.trim() : '';
  const requestId = typeof input?.requestId === 'string' ? input.requestId.trim() : '';
  const active = input?.active;
  const coins = input?.coins;
  const diamonds = input?.diamonds;
  const expectedUpdatedAt = typeof input?.expectedUpdatedAt === 'string' ? input.expectedUpdatedAt.trim().slice(0, 80) : '';
  if (!targetUid || targetUid.length > 128 || !/^[A-Za-z0-9_-]{12,80}$/.test(requestId)
    || typeof active !== 'boolean' || typeof coins !== 'boolean' || typeof diamonds !== 'boolean'
    || (active && !coins && !diamonds)) {
    return { ok: false, error: 'Valid target, request ID, active state, and at least one currency permission are required.' };
  }
  return { ok: true, value: { active, currencies: { coins, diamonds }, expectedUpdatedAt, requestId, targetUid } };
}

function normalizeAdminRepresentativeReversalInput(input) {
  const amount = Number(input?.expectedAmount);
  const currency = input?.expectedCurrency;
  const publicReference = typeof input?.publicReference === 'string' ? input.publicReference.trim() : '';
  const reason = typeof input?.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
  const requestId = typeof input?.requestId === 'string' ? input.requestId.trim() : '';
  if (!Number.isSafeInteger(amount) || amount < 1 || !isStoreCurrency(currency)
    || !isValidRepresentativePublicReference(publicReference)
    || reason.length < 3 || !/^[A-Za-z0-9_-]{12,80}$/.test(requestId)) {
    return { ok: false, error: 'Valid reference, expected value, request ID, and reversal reason are required.' };
  }
  return {
    ok: true,
    value: {
      expectedAmount: amount,
      expectedCurrency: currency,
      publicReference,
      reason,
      requestId,
    },
  };
}

function mapRepresentativePrivilege(data, uid) {
  return {
    active: data?.active === true,
    currencies: {
      coins: data?.currencies?.coins === true,
      diamonds: data?.currencies?.diamonds === true,
    },
    uid,
  };
}

function mapRepresentativeTransferReceipt(data, receiptId) {
  if (!data || typeof data !== 'object' || !Number.isSafeInteger(data.amount) || data.amount < 1) return undefined;
  if (!isStoreCurrency(data.currency) || !isValidPublicId(data.recipientPublicId) || typeof data.recipientUid !== 'string' || !data.recipientUid) return undefined;
  if (data.status !== 'completed' || !data.createdAt || typeof data.createdAt.toMillis !== 'function') return undefined;
  const balanceAfter = readPositiveOrZero(data.balanceAfter);
  const balanceBefore = readPositiveOrZero(data.balanceBefore);
  const publicReference = isValidRepresentativePublicReference(data.publicReference) ? data.publicReference : '';
  const recipientDisplayName = readDisplayName(data.recipientDisplayName);
  return {
    amount: data.amount,
    ...(balanceAfter !== undefined ? { balanceAfter } : {}),
    ...(balanceBefore !== undefined ? { balanceBefore } : {}),
    createdAt: new Date(data.createdAt.toMillis()).toISOString(),
    currency: data.currency,
    ...(publicReference ? { publicReference } : {}),
    ...(recipientDisplayName ? { recipientDisplayName } : {}),
    recipientPublicId: data.recipientPublicId,
    recipientUid: data.recipientUid,
    status: 'completed',
    transferId: receiptId,
  };
}

function mapRepresentativeHistoryReceipt(data) {
  if (!data || typeof data !== 'object' || !Number.isSafeInteger(data.amount) || data.amount < 1) return undefined;
  if (!isStoreCurrency(data.currency) || !isValidPublicId(data.recipientPublicId)) return undefined;
  if (!['completed', 'reversed'].includes(data.status) || !data.createdAt || typeof data.createdAt.toMillis !== 'function') return undefined;
  if (!isValidRepresentativePublicReference(data.publicReference)) return undefined;
  const balanceAfter = readPositiveOrZero(data.balanceAfter);
  const balanceBefore = readPositiveOrZero(data.balanceBefore);
  const recipientDisplayName = readDisplayName(data.recipientDisplayName);
  return {
    amount: data.amount,
    ...(balanceAfter !== undefined ? { balanceAfter } : {}),
    ...(balanceBefore !== undefined ? { balanceBefore } : {}),
    createdAt: new Date(data.createdAt.toMillis()).toISOString(),
    currency: data.currency,
    kind: data.status === 'reversed' ? 'reversal' : 'transfer',
    publicReference: data.publicReference,
    ...(recipientDisplayName ? { recipientDisplayName } : {}),
    recipientPublicId: data.recipientPublicId,
    status: data.status,
  };
}

function mapWalletRechargeReceipt(data, receiptId) {
  if (!data || typeof data !== 'object' || !Number.isSafeInteger(data.amount) || data.amount < 1) return undefined;
  if (!isStoreCurrency(data.currency) || !isValidPublicId(data.representativePublicId) || typeof data.representativeUid !== 'string' || !data.representativeUid) return undefined;
  if (data.status !== 'completed' || !data.createdAt || typeof data.createdAt.toMillis !== 'function') return undefined;
  const balanceAfter = readPositiveOrZero(data.balanceAfter);
  const balanceBefore = readPositiveOrZero(data.balanceBefore);
  const publicReference = isValidRepresentativePublicReference(data.publicReference) ? data.publicReference : '';
  const representativeDisplayName = readDisplayName(data.representativeDisplayName);
  return {
    amount: data.amount,
    ...(balanceAfter !== undefined ? { balanceAfter } : {}),
    ...(balanceBefore !== undefined ? { balanceBefore } : {}),
    createdAt: new Date(data.createdAt.toMillis()).toISOString(),
    currency: data.currency,
    ...(publicReference ? { publicReference } : {}),
    ...(representativeDisplayName ? { representativeDisplayName } : {}),
    representativePublicId: data.representativePublicId,
    representativeUid: data.representativeUid,
    status: 'completed',
    transferId: receiptId,
  };
}

function readDisplayName(value) { return typeof value === 'string' ? value.trim().slice(0, 40) : ''; }
function readPositiveOrZero(value) { return Number.isSafeInteger(value) && value >= 0 ? value : undefined; }

module.exports = {
  mapRepresentativePrivilege,
  mapRepresentativeHistoryReceipt,
  mapRepresentativeTransferReceipt,
  mapWalletRechargeReceipt,
  normalizeAdminRepresentativeInput,
  normalizeAdminRepresentativeReversalInput,
  normalizeRepresentativeTransferInput,
};
