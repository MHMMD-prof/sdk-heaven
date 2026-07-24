const crypto = require('node:crypto');

const REPRESENTATIVE_PORTAL_CONTRACT_VERSION = 1;
const REPRESENTATIVE_TRANSFER_FEATURE_FLAG = 'representativeTransfers';
const REPRESENTATIVE_BOOTSTRAP_TICKET_BYTES = 32;
const REPRESENTATIVE_BOOTSTRAP_TICKET_TTL_SECONDS = 60;
const REPRESENTATIVE_PORTAL_SESSION_TTL_SECONDS = 15 * 60;
const REPRESENTATIVE_FRESH_AUTH_TTL_SECONDS = 5 * 60;
const REPRESENTATIVE_FEATURE_STATUS_POLL_SECONDS = 15;
const REPRESENTATIVE_RECIPIENT_PROOF_TTL_SECONDS = 60;
const REPRESENTATIVE_PIN_LENGTH = 6;
const REPRESENTATIVE_PIN_MAX_ATTEMPTS = 5;
const REPRESENTATIVE_PIN_LOCK_SECONDS = 15 * 60;
const REPRESENTATIVE_REVERSAL_WINDOW_SECONDS = 24 * 60 * 60;
const REPRESENTATIVE_RECIPIENT_LOOKUP_LIMIT = 20;
const REPRESENTATIVE_RECIPIENT_LOOKUP_WINDOW_SECONDS = 60;
const REPRESENTATIVE_PUBLIC_REFERENCE_BYTES = 10;
const REPRESENTATIVE_PUBLIC_REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const REPRESENTATIVE_PORTAL_STATES = Object.freeze([
  'bootstrapping',
  'recipient-entry',
  'verifying',
  'verified',
  'review',
  'pin-challenge',
  'submitting',
  'completed',
  'failed',
  'locked',
  'unavailable',
]);

const REPRESENTATIVE_PORTAL_TRANSITIONS = Object.freeze({
  bootstrapping: Object.freeze(['recipient-entry', 'failed', 'unavailable']),
  'recipient-entry': Object.freeze(['verifying']),
  verifying: Object.freeze(['recipient-entry', 'verified', 'failed', 'unavailable']),
  verified: Object.freeze(['recipient-entry', 'review', 'unavailable']),
  review: Object.freeze(['recipient-entry', 'verified', 'pin-challenge', 'unavailable']),
  'pin-challenge': Object.freeze(['review', 'submitting', 'locked', 'unavailable']),
  submitting: Object.freeze(['completed', 'failed', 'unavailable']),
  completed: Object.freeze(['recipient-entry', 'unavailable']),
  failed: Object.freeze(['bootstrapping', 'recipient-entry', 'unavailable']),
  locked: Object.freeze(['bootstrapping', 'unavailable']),
  unavailable: Object.freeze(['bootstrapping']),
});

function canTransitionRepresentativePortal(from, to) {
  return REPRESENTATIVE_PORTAL_TRANSITIONS[from]?.includes(to) === true;
}

function areRepresentativeTransfersEnabled(featureData) {
  return featureData?.wallet === true && featureData?.[REPRESENTATIVE_TRANSFER_FEATURE_FLAG] === true;
}

function normalizeRepresentativePortalOrigin(input, options = {}) {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) return { ok: false, code: 'INVALID_PORTAL_ORIGIN' };

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, code: 'INVALID_PORTAL_ORIGIN' };
  }

  const isLocalDevelopmentOrigin = options.allowLocalhost === true
    && parsed.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  const isSecureOrigin = parsed.protocol === 'https:';
  const isOriginOnly = parsed.username === '' && parsed.password === ''
    && (parsed.pathname === '' || parsed.pathname === '/')
    && parsed.search === '' && parsed.hash === '';

  if ((!isSecureOrigin && !isLocalDevelopmentOrigin) || !isOriginOnly) {
    return { ok: false, code: 'INVALID_PORTAL_ORIGIN' };
  }

  return { ok: true, value: parsed.origin };
}

function normalizeRepresentativeTransferPolicy(input, options = {}) {
  if (!isPlainObject(input)) return { ok: false, code: 'INVALID_TRANSFER_POLICY' };
  const allowPartial = options.allowPartial === true;
  const supportedKeys = ['coins', 'diamonds'];
  if (Object.keys(input).some((key) => !supportedKeys.includes(key))) {
    return { ok: false, code: 'INVALID_TRANSFER_POLICY' };
  }

  const value = {};
  for (const currency of supportedKeys) {
    if (input[currency] === undefined && allowPartial) continue;
    const normalized = normalizeRepresentativeCurrencyLimits(input[currency]);
    if (!normalized.ok) return normalized;
    value[currency] = normalized.value;
  }

  if (!allowPartial && supportedKeys.some((currency) => value[currency] === undefined)) {
    return { ok: false, code: 'INVALID_TRANSFER_POLICY' };
  }
  if (allowPartial && Object.keys(value).length === 0) {
    return { ok: false, code: 'INVALID_TRANSFER_POLICY' };
  }

  return { ok: true, value };
}

function normalizeRepresentativeCurrencyLimits(input) {
  if (!isPlainObject(input)) return { ok: false, code: 'INVALID_TRANSFER_POLICY' };
  const supportedKeys = ['maxPerTransfer', 'maxPerDay', 'maxTransfersPerHour'];
  if (Object.keys(input).some((key) => !supportedKeys.includes(key))) {
    return { ok: false, code: 'INVALID_TRANSFER_POLICY' };
  }

  const { maxPerDay, maxPerTransfer, maxTransfersPerHour } = input;
  if (!isPositiveSafeInteger(maxPerTransfer) || !isPositiveSafeInteger(maxPerDay)
    || !isPositiveSafeInteger(maxTransfersPerHour) || maxPerDay < maxPerTransfer) {
    return { ok: false, code: 'INVALID_TRANSFER_POLICY' };
  }

  return { ok: true, value: { maxPerDay, maxPerTransfer, maxTransfersPerHour } };
}

function isValidRepresentativeTransferPin(value) {
  return typeof value === 'string' && new RegExp(`^[0-9]{${REPRESENTATIVE_PIN_LENGTH}}$`).test(value);
}

function isValidRepresentativePublicReference(value) {
  return typeof value === 'string' && /^RPT-[0-9A-HJKMNP-TV-Z]{16}$/.test(value);
}

function createRepresentativePublicReference(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(REPRESENTATIVE_PUBLIC_REFERENCE_BYTES);
  if (!Buffer.isBuffer(bytes) || bytes.length !== REPRESENTATIVE_PUBLIC_REFERENCE_BYTES) throw new Error('Secure random bytes are required.');
  let value = BigInt(`0x${bytes.toString('hex')}`);
  let encoded = '';
  for (let index = 0; index < 16; index += 1) {
    encoded = REPRESENTATIVE_PUBLIC_REFERENCE_ALPHABET[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return `RPT-${encoded}`;
}

function createRepresentativeOpaqueToken(randomBytes = crypto.randomBytes) {
  return randomBytes(REPRESENTATIVE_BOOTSTRAP_TICKET_BYTES).toString('base64url');
}

function hashRepresentativeOpaqueToken(value) {
  if (!isValidRepresentativeOpaqueToken(value)) return '';
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function isValidRepresentativeOpaqueToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function normalizeRepresentativePortalRequest(input) {
  if (!isPlainObject(input)) return { ok: false, code: 'INVALID_REQUEST' };
  const action = typeof input.action === 'string' ? input.action.trim() : '';
  const allowedKeys = {
    exchange: ['action', 'ticket'],
    history: ['action', 'currency', 'cursor', 'from', 'limit', 'status', 'to'],
    'receipt-lookup': ['action', 'publicReference'],
    status: ['action'],
    'recipient-preview': ['action', 'recipientPublicId'],
    'pin-setup': ['action', 'pin'],
    transfer: ['action', 'amount', 'currency', 'pin', 'proof', 'requestId'],
  }[action];
  if (!allowedKeys || Object.keys(input).some((key) => !allowedKeys.includes(key))) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  if (action === 'exchange') {
    return isValidRepresentativeOpaqueToken(input.ticket)
      ? { ok: true, value: { action, ticket: input.ticket } }
      : { ok: false, code: 'INVALID_REQUEST' };
  }
  if (action === 'recipient-preview') {
    const recipientPublicId = typeof input.recipientPublicId === 'string' ? input.recipientPublicId.trim() : '';
    return /^[1-9][0-9]{6}$/.test(recipientPublicId)
      ? { ok: true, value: { action, recipientPublicId } }
      : { ok: false, code: 'INVALID_REQUEST' };
  }
  if (action === 'receipt-lookup') {
    const publicReference = typeof input.publicReference === 'string' ? input.publicReference.trim() : '';
    return isValidRepresentativePublicReference(publicReference)
      ? { ok: true, value: { action, publicReference } }
      : { ok: false, code: 'INVALID_REQUEST' };
  }
  if (action === 'history') {
    const currency = input.currency === undefined || input.currency === '' ? '' : input.currency;
    const status = input.status === undefined || input.status === '' ? '' : input.status;
    const cursor = input.cursor === undefined || input.cursor === '' ? '' : input.cursor;
    const from = normalizeOptionalIsoDate(input.from);
    const to = normalizeOptionalIsoDate(input.to);
    const limit = input.limit === undefined ? 20 : Number(input.limit);
    if (!['', 'coins', 'diamonds'].includes(currency)
      || !['', 'completed', 'reversed'].includes(status)
      || (cursor && !isValidRepresentativeOpaqueToken(cursor))
      || from === undefined || to === undefined
      || (from && to && Date.parse(from) > Date.parse(to))
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
      return { ok: false, code: 'INVALID_REQUEST' };
    }
    return { ok: true, value: { action, currency, cursor, from, limit, status, to } };
  }
  if (action === 'pin-setup') {
    return isValidRepresentativeTransferPin(input.pin)
      ? { ok: true, value: { action, pin: input.pin } }
      : { ok: false, code: 'INVALID_REQUEST' };
  }
  if (action === 'transfer') {
    const amount = Number(input.amount);
    const currency = input.currency;
    const requestId = typeof input.requestId === 'string' ? input.requestId.trim() : '';
    if (!Number.isSafeInteger(amount) || amount < 1 || !['coins', 'diamonds'].includes(currency)
      || !isValidRepresentativeTransferPin(input.pin) || !isValidRepresentativeOpaqueToken(input.proof)
      || !/^[A-Za-z0-9_-]{12,80}$/.test(requestId)) return { ok: false, code: 'INVALID_REQUEST' };
    return { ok: true, value: { action, amount, currency, pin: input.pin, proof: input.proof, requestId } };
  }
  return { ok: true, value: { action } };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeOptionalIsoDate(value) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

module.exports = {
  REPRESENTATIVE_BOOTSTRAP_TICKET_BYTES,
  REPRESENTATIVE_BOOTSTRAP_TICKET_TTL_SECONDS,
  REPRESENTATIVE_FEATURE_STATUS_POLL_SECONDS,
  REPRESENTATIVE_FRESH_AUTH_TTL_SECONDS,
  REPRESENTATIVE_PIN_LENGTH,
  REPRESENTATIVE_PIN_LOCK_SECONDS,
  REPRESENTATIVE_PIN_MAX_ATTEMPTS,
  REPRESENTATIVE_PORTAL_CONTRACT_VERSION,
  REPRESENTATIVE_PORTAL_SESSION_TTL_SECONDS,
  REPRESENTATIVE_PORTAL_STATES,
  REPRESENTATIVE_PORTAL_TRANSITIONS,
  REPRESENTATIVE_RECIPIENT_PROOF_TTL_SECONDS,
  REPRESENTATIVE_RECIPIENT_LOOKUP_LIMIT,
  REPRESENTATIVE_RECIPIENT_LOOKUP_WINDOW_SECONDS,
  REPRESENTATIVE_REVERSAL_WINDOW_SECONDS,
  REPRESENTATIVE_TRANSFER_FEATURE_FLAG,
  areRepresentativeTransfersEnabled,
  canTransitionRepresentativePortal,
  createRepresentativeOpaqueToken,
  createRepresentativePublicReference,
  hashRepresentativeOpaqueToken,
  isValidRepresentativeOpaqueToken,
  isValidRepresentativePublicReference,
  isValidRepresentativeTransferPin,
  normalizeRepresentativePortalOrigin,
  normalizeRepresentativePortalRequest,
  normalizeRepresentativeTransferPolicy,
};
