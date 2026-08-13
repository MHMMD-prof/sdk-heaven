'use strict';

const { STATUS_FEATURE_FLAGS } = require('./statusMembershipCore');

const STATUS_OPERATION_TYPES = Object.freeze([
  'vip-point-correction',
  'activate-catalog',
  'set-feature-flags',
  'set-signoffs',
  'set-migration-state',
]);
const ACTIVATION_FLAGS = Object.freeze([...STATUS_FEATURE_FLAGS]);
const PUBLIC_ACTIVATION_FLAGS = Object.freeze(STATUS_FEATURE_FLAGS.filter((flag) => flag !== 'statusProjectionRepair'));
const SIGNOFF_KEYS = Object.freeze(['product', 'economy', 'security', 'support', 'qa']);

function normalizeStatusOperationProposal(input = {}) {
  if (!isRecord(input) || !hasOnly(input, [
    'operation', 'targetUid', 'pointDelta', 'catalogKind', 'catalogVersion', 'flags', 'signoffs', 'migration',
    'reason', 'evidenceRef', 'requestId',
  ])) return invalid('INVALID_REQUEST');
  const operation = cleanString(input.operation, 40);
  const requestId = cleanString(input.requestId, 80);
  const reason = cleanString(input.reason, 300);
  const evidenceRef = cleanString(input.evidenceRef, 200);
  if (!STATUS_OPERATION_TYPES.includes(operation) || !validRequestId(requestId)
    || reason.length < 8 || evidenceRef.length < 3) return invalid('INVALID_REQUEST');
  if (operation === 'vip-point-correction') {
    const targetUid = cleanUid(input.targetUid);
    if (!targetUid || !Number.isSafeInteger(input.pointDelta) || input.pointDelta === 0
      || Math.abs(input.pointDelta) > 1_000_000 || input.catalogKind !== undefined
      || input.catalogVersion !== undefined || input.flags !== undefined || input.signoffs !== undefined || input.migration !== undefined) return invalid('INVALID_REQUEST');
    return { ok: true, value: { operation, targetUid, pointDelta: input.pointDelta, reason, evidenceRef, requestId } };
  }
  if (operation === 'activate-catalog') {
    const catalogKind = ['vip-svip', 'aristocracy'].includes(input.catalogKind) ? input.catalogKind : '';
    const catalogVersion = cleanId(input.catalogVersion, 80);
    if (!catalogKind || !catalogVersion || input.targetUid !== undefined || input.pointDelta !== undefined
      || input.flags !== undefined || input.signoffs !== undefined || input.migration !== undefined) return invalid('INVALID_REQUEST');
    return { ok: true, value: { operation, catalogKind, catalogVersion, reason, evidenceRef, requestId } };
  }
  if (operation === 'set-feature-flags') {
    const flags = normalizeFeatureFlagChanges(input.flags);
    if (!flags || input.targetUid !== undefined || input.pointDelta !== undefined
      || input.catalogKind !== undefined || input.catalogVersion !== undefined || input.signoffs !== undefined || input.migration !== undefined) return invalid('INVALID_REQUEST');
    return { ok: true, value: { operation, flags, reason, evidenceRef, requestId } };
  }
  if (operation === 'set-signoffs') {
    const signoffs = normalizeSignoffChanges(input.signoffs);
    if (!signoffs || input.targetUid !== undefined || input.pointDelta !== undefined
      || input.catalogKind !== undefined || input.catalogVersion !== undefined || input.flags !== undefined || input.migration !== undefined) return invalid('INVALID_REQUEST');
    return { ok: true, value: { operation, signoffs, reason, evidenceRef, requestId } };
  }
  const migration = normalizeMigrationState(input.migration);
  if (!migration || input.targetUid !== undefined || input.pointDelta !== undefined
    || input.catalogKind !== undefined || input.catalogVersion !== undefined || input.flags !== undefined || input.signoffs !== undefined) return invalid('INVALID_REQUEST');
  return { ok: true, value: { operation, migration, reason, evidenceRef, requestId } };
}

function normalizeEmergencyFreeze(input = {}) {
  if (!isRecord(input) || !hasOnly(input, ['flags', 'reason', 'requestId'])) return invalid('INVALID_REQUEST');
  const flags = normalizeFeatureFlagChanges(input.flags);
  const reason = cleanString(input.reason, 300);
  const requestId = cleanString(input.requestId, 80);
  if (!flags || Object.values(flags).some((value) => value !== false) || reason.length < 8 || !validRequestId(requestId)) {
    return invalid('INVALID_REQUEST');
  }
  return { ok: true, value: { flags, reason, requestId } };
}

function normalizeStatusUserInspection(input = {}) {
  if (!isRecord(input) || !hasOnly(input, ['targetUid'])) return invalid('INVALID_REQUEST');
  const targetUid = cleanUid(input.targetUid);
  return targetUid ? { ok: true, value: { targetUid } } : invalid('INVALID_REQUEST');
}

function normalizeReconciliationRequest(input = {}) {
  if (!isRecord(input) || !hasOnly(input, ['requestId', 'reason'])) return invalid('INVALID_REQUEST');
  const requestId = cleanString(input.requestId, 80);
  const reason = cleanString(input.reason, 300);
  return validRequestId(requestId) && reason.length >= 8
    ? { ok: true, value: { requestId, reason } }
    : invalid('INVALID_REQUEST');
}

function deriveOperationsReadiness({ aristocracy, flags, migrations, queues, reconciliation, signoffs, vip }) {
  const blockers = [];
  if (!vip?.activeCatalogVersion) blockers.push('VIP_CATALOG_MISSING');
  if (!aristocracy?.activeCatalogVersion) blockers.push('ARISTOCRACY_CATALOG_MISSING');
  if (queues?.sampled === true) blockers.push('QUEUE_SCAN_TRUNCATED');
  if (queues?.deadLetterCount > 0) blockers.push('DEAD_LETTERS_PRESENT');
  if (queues?.oldestQueuedAgeMs > 300_000) blockers.push('QUEUE_SLO_BREACH');
  if (reconciliation?.assessed !== true) blockers.push('RECONCILIATION_NOT_RUN');
  else if (reconciliation?.consecutiveDriftRuns > 0) blockers.push('RECONCILIATION_DRIFT');
  if (migrations?.assessed !== true) blockers.push('MIGRATION_NOT_ASSESSED');
  else if (migrations?.verified !== true) blockers.push('MIGRATION_NOT_VERIFIED');
  for (const gate of ['product', 'economy', 'security', 'support', 'qa']) {
    if (signoffs?.[gate] !== true) blockers.push(`${gate.toUpperCase()}_SIGNOFF_MISSING`);
  }
  const allPublicOff = PUBLIC_ACTIVATION_FLAGS.every((flag) => flags?.[flag] !== true);
  return {
    blockers,
    canActivate: blockers.length === 0,
    directActivationEligible: blockers.length === 0 && migrations?.userCount === 0,
    publicFeaturesCurrentlyOff: allPublicOff,
  };
}

function deriveAlertDecision(currentDirty, previousDirty, previousConsecutiveDriftRuns = previousDirty ? 1 : 0) {
  return currentDirty && previousDirty && previousConsecutiveDriftRuns === 1
    ? { create: true, severity: 'critical', code: 'STATUS_RECONCILIATION_DRIFT_CONFIRMED' }
    : { create: false, severity: currentDirty ? 'warning' : 'none', code: currentDirty ? 'STATUS_RECONCILIATION_DRIFT_FIRST_PASS' : 'STATUS_RECONCILIATION_CLEAN' };
}

function normalizeFeatureFlagChanges(value) {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (!keys.length || keys.some((key) => !ACTIVATION_FLAGS.includes(key))
    || keys.some((key) => typeof value[key] !== 'boolean')) return null;
  return Object.fromEntries(keys.sort().map((key) => [key, value[key]]));
}

function normalizeSignoffChanges(value) {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (!keys.length || keys.some((key) => !SIGNOFF_KEYS.includes(key))
    || keys.some((key) => typeof value[key] !== 'boolean')) return null;
  return Object.fromEntries(keys.sort().map((key) => [key, value[key]]));
}

function normalizeMigrationState(value) {
  if (!isRecord(value) || !hasOnly(value, ['required', 'verified', 'userCount', 'snapshotHash', 'catalogVersion'])
    || typeof value.required !== 'boolean' || typeof value.verified !== 'boolean'
    || !Number.isSafeInteger(value.userCount) || value.userCount < 0 || value.userCount > 1_000_000) return null;
  const catalogVersion = cleanId(value.catalogVersion, 80);
  const snapshotHash = cleanString(value.snapshotHash, 64).toLowerCase();
  if (!catalogVersion || (value.userCount > 0 && !/^[a-f0-9]{64}$/.test(snapshotHash))
    || (value.userCount === 0 && snapshotHash) || (value.required !== (value.userCount > 0))
    || (value.required === false && value.verified !== true)) return null;
  return { required: value.required, verified: value.verified, userCount: value.userCount, snapshotHash, catalogVersion };
}

function cleanUid(value) { const uid = cleanString(value, 128); return uid && !/[\/\u0000-\u001F\u007F]/.test(uid) ? uid : ''; }
function cleanId(value, max) { const id = cleanString(value, max).toLowerCase(); return /^[a-z0-9][a-z0-9_-]{2,79}$/.test(id) ? id : ''; }
function validRequestId(value) { return /^[A-Za-z0-9_-]{16,80}$/.test(value); }
function cleanString(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function isRecord(value) { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function hasOnly(value, keys) { return Object.keys(value).every((key) => keys.includes(key)); }
function invalid(code) { return { ok: false, code }; }

module.exports = {
  ACTIVATION_FLAGS,
  SIGNOFF_KEYS,
  STATUS_OPERATION_TYPES,
  deriveAlertDecision,
  deriveOperationsReadiness,
  normalizeEmergencyFreeze,
  normalizeReconciliationRequest,
  normalizeStatusOperationProposal,
  normalizeStatusUserInspection,
};
