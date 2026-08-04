const {
  isValidRepresentativePublicReference,
  normalizeRepresentativeCurrencyLimits,
  normalizeRepresentativeTransferPolicy,
  REPRESENTATIVE_REVERSAL_WINDOW_SECONDS,
} = require('./representativePortalCore');

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{12,80}$/;

function normalizeRepresentativeOperationsQuery(input = {}) {
  const publicReference = typeof input.publicReference === 'string' ? input.publicReference.trim().toUpperCase() : '';
  if (publicReference && !isValidRepresentativePublicReference(publicReference)) {
    return { ok: false, error: 'A valid public reference is required.' };
  }
  return { ok: true, value: { publicReference } };
}

function normalizeAdminRepresentativePolicyInput(input = {}) {
  const expectedUpdatedAt = normalizeExpectedTimestamp(input.expectedUpdatedAt);
  const limits = normalizeRepresentativeTransferPolicy(input.limits);
  const reason = normalizeReason(input.reason);
  const requestId = normalizeRequestId(input.requestId);
  if (!expectedUpdatedAt || !limits.ok || !reason || !requestId) {
    return { ok: false, error: 'Valid limits, current revision, reason, and request ID are required.' };
  }
  return { ok: true, value: { expectedUpdatedAt, limits: limits.value, reason, requestId } };
}

function normalizeAdminRepresentativeOverrideInput(input = {}) {
  const expectedUpdatedAt = normalizeExpectedTimestamp(input.expectedUpdatedAt);
  const targetUid = typeof input.targetUid === 'string' ? input.targetUid.trim().slice(0, 128) : '';
  const reason = normalizeReason(input.reason);
  const requestId = normalizeRequestId(input.requestId);
  const rawLimits = input.limits && typeof input.limits === 'object' && !Array.isArray(input.limits) ? input.limits : undefined;
  if (!rawLimits || Object.keys(rawLimits).some((key) => !['coins', 'diamonds'].includes(key))) {
    return { ok: false, error: 'Valid representative override limits are required.' };
  }
  const limits = {};
  for (const currency of ['coins', 'diamonds']) {
    if (rawLimits[currency] === null || rawLimits[currency] === undefined) continue;
    const normalized = normalizeRepresentativeCurrencyLimits(rawLimits[currency]);
    if (!normalized.ok) return { ok: false, error: 'Valid representative override limits are required.' };
    limits[currency] = normalized.value;
  }
  if (!expectedUpdatedAt || !targetUid || !reason || !requestId) {
    return { ok: false, error: 'Valid target, current revision, reason, and request ID are required.' };
  }
  return { ok: true, value: { expectedUpdatedAt, limits, reason, requestId, targetUid } };
}

function normalizeAdminRepresentativePinResetInput(input = {}) {
  const expectedUpdatedAt = normalizeExpectedTimestamp(input.expectedUpdatedAt);
  const targetUid = typeof input.targetUid === 'string' ? input.targetUid.trim().slice(0, 128) : '';
  const reason = normalizeReason(input.reason);
  const requestId = normalizeRequestId(input.requestId);
  if (!expectedUpdatedAt || !targetUid || !reason || !requestId) {
    return { ok: false, error: 'Valid target, current PIN revision, reason, and request ID are required.' };
  }
  return { ok: true, value: { expectedUpdatedAt, reason, requestId, targetUid } };
}

function mapRepresentativePolicy(data) {
  const normalized = normalizeRepresentativeTransferPolicy(data?.limits);
  return {
    configured: normalized.ok,
    limits: normalized.ok ? normalized.value : undefined,
    updatedAt: timestampIso(data?.updatedAt) || 'missing',
  };
}

function mapRepresentativeOverrideLimits(data) {
  const limits = {};
  for (const currency of ['coins', 'diamonds']) {
    if (data?.[currency] === undefined) continue;
    const normalized = normalizeRepresentativeCurrencyLimits(data[currency]);
    if (normalized.ok) limits[currency] = normalized.value;
  }
  return limits;
}

function mapRepresentativeAdminTransfer(id, data, reversalData, recipientBalance, nowMillis = Date.now()) {
  if (!data || !Number.isSafeInteger(data.amount) || data.amount < 1
    || !['coins', 'diamonds'].includes(data.currency)
    || !isValidRepresentativePublicReference(data.publicReference)
    || typeof data.recipientUid !== 'string' || !data.recipientUid
    || typeof data.representativeUid !== 'string' || !data.representativeUid) return undefined;
  const createdAtMillis = timestampMillis(data.createdAt);
  if (!createdAtMillis) return undefined;
  const reversed = reversalData?.status === 'completed'
    && reversalData?.transferId === id
    && reversalData?.publicReference === data.publicReference;
  const withinWindow = nowMillis - createdAtMillis <= REPRESENTATIVE_REVERSAL_WINDOW_SECONDS * 1000;
  return {
    amount: data.amount,
    createdAt: new Date(createdAtMillis).toISOString(),
    currency: data.currency,
    eligibleForReversal: !reversed && withinWindow
      && Number.isSafeInteger(recipientBalance) && recipientBalance >= data.amount,
    publicReference: data.publicReference,
    recipientDisplayName: safeText(data.recipientDisplayName, 80),
    recipientPublicId: safeText(data.recipientPublicId, 7),
    recipientUid: data.recipientUid,
    representativeDisplayName: safeText(data.representativeDisplayName, 80),
    representativePublicId: safeText(data.representativePublicId, 7),
    representativeUid: data.representativeUid,
    reversalReason: reversed ? safeText(reversalData.reason, 300) : '',
    reversedAt: reversed ? timestampIso(reversalData.createdAt) : '',
    status: reversed ? 'reversed' : withinWindow ? 'completed' : 'expired',
    transferId: id,
  };
}

function mapRepresentativeOperationalEvent(id, data) {
  if (!data || typeof data !== 'object') return undefined;
  return {
    actorUid: safeText(data.actorUid, 128),
    amount: Number.isSafeInteger(data.amount) ? data.amount : 0,
    createdAt: timestampIso(data.createdAt),
    currency: ['coins', 'diamonds'].includes(data.currency) ? data.currency : '',
    id,
    kind: safeText(data.kind || data.action, 100),
    publicReference: isValidRepresentativePublicReference(data.publicReference) ? data.publicReference : '',
    representativeUid: safeText(data.representativeUid || data.targetUid, 128),
    status: safeText(data.status, 40),
  };
}

function normalizeExpectedTimestamp(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === 'missing') return 'missing';
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : '';
}

function normalizeReason(value) {
  const text = typeof value === 'string' ? value.trim().slice(0, 300) : '';
  return text.length >= 3 ? text : '';
}

function normalizeRequestId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return REQUEST_ID_PATTERN.test(text) ? text : '';
}

function safeText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function timestampMillis(value) {
  return value && typeof value.toMillis === 'function' ? value.toMillis() : 0;
}

function timestampIso(value) {
  const millis = timestampMillis(value);
  return millis ? new Date(millis).toISOString() : '';
}

module.exports = {
  mapRepresentativeAdminTransfer,
  mapRepresentativeOperationalEvent,
  mapRepresentativeOverrideLimits,
  mapRepresentativePolicy,
  normalizeAdminRepresentativeOverrideInput,
  normalizeAdminRepresentativePinResetInput,
  normalizeAdminRepresentativePolicyInput,
  normalizeRepresentativeOperationsQuery,
};
