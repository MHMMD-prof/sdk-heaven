const OPERATIONS = Object.freeze([
  'approve-settlement',
  'reject-settlement',
  'resolve-alert',
]);

function cleanId(value) {
  const result = typeof value === 'string' ? value.trim() : '';
  return result && result.length <= 160 && !result.includes('/') ? result : '';
}

function normalizeAdminWeeklyIncentiveIntegrityMutation(body = {}) {
  const operation = typeof body.operation === 'string' ? body.operation.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const assessmentId = cleanId(body.assessmentId);
  const alertId = cleanId(body.alertId);
  const settlementId = cleanId(body.settlementId);
  if (!OPERATIONS.includes(operation)) return invalid('A valid integrity operation is required.');
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) return invalid('A valid requestId is required.');
  if (reason.length < 4) return invalid('An audit reason with at least 4 characters is required.');
  if (operation === 'resolve-alert' && !alertId) return invalid('A valid alertId is required.');
  if (operation !== 'resolve-alert' && (!assessmentId || !settlementId)) {
    return invalid('A valid assessmentId and settlementId are required.');
  }
  return { ok: true, value: { alertId, assessmentId, operation, reason, requestId, settlementId } };
}

function normalizeAdminWeeklyIncentiveReconciliation(body = {}) {
  const apply = body.apply === true;
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const giftCursor = cleanCursor(body.giftCursor);
  const settlementCursor = cleanCursor(body.settlementCursor);
  const limit = Number.isSafeInteger(body.limit) ? Math.min(Math.max(body.limit, 1), 100) : 50;
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) return invalid('A valid requestId is required.');
  if (apply && reason.length < 4) return invalid('Applying reconciliation requires an audit reason.');
  return { ok: true, value: { apply, giftCursor, limit, reason, requestId, settlementCursor } };
}

function cleanCursor(value) {
  const result = typeof value === 'string' ? value.trim() : '';
  return result.length <= 512 ? result : '';
}

function invalid(error) {
  return { error, ok: false, status: 400 };
}

module.exports = {
  normalizeAdminWeeklyIncentiveIntegrityMutation,
  normalizeAdminWeeklyIncentiveReconciliation,
};
