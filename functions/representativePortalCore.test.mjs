import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  REPRESENTATIVE_BOOTSTRAP_TICKET_BYTES,
  REPRESENTATIVE_BOOTSTRAP_TICKET_TTL_SECONDS,
  REPRESENTATIVE_FEATURE_STATUS_POLL_SECONDS,
  REPRESENTATIVE_FRESH_AUTH_TTL_SECONDS,
  REPRESENTATIVE_PIN_LOCK_SECONDS,
  REPRESENTATIVE_PIN_MAX_ATTEMPTS,
  REPRESENTATIVE_PORTAL_CONTRACT_VERSION,
  REPRESENTATIVE_PORTAL_SESSION_TTL_SECONDS,
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
} = require('./representativePortalCore');

describe('representativePortalCore', () => {
  it('pins the versioned security constants', () => {
    expect(REPRESENTATIVE_PORTAL_CONTRACT_VERSION).toBe(1);
    expect(REPRESENTATIVE_TRANSFER_FEATURE_FLAG).toBe('representativeTransfers');
    expect(REPRESENTATIVE_BOOTSTRAP_TICKET_BYTES).toBe(32);
    expect(REPRESENTATIVE_BOOTSTRAP_TICKET_TTL_SECONDS).toBe(60);
    expect(REPRESENTATIVE_PORTAL_SESSION_TTL_SECONDS).toBe(900);
    expect(REPRESENTATIVE_FEATURE_STATUS_POLL_SECONDS).toBe(15);
    expect(REPRESENTATIVE_FRESH_AUTH_TTL_SECONDS).toBe(300);
    expect(REPRESENTATIVE_RECIPIENT_PROOF_TTL_SECONDS).toBe(60);
    expect(REPRESENTATIVE_RECIPIENT_LOOKUP_LIMIT).toBe(20);
    expect(REPRESENTATIVE_RECIPIENT_LOOKUP_WINDOW_SECONDS).toBe(60);
    expect(REPRESENTATIVE_PIN_MAX_ATTEMPTS).toBe(5);
    expect(REPRESENTATIVE_PIN_LOCK_SECONDS).toBe(900);
    expect(REPRESENTATIVE_REVERSAL_WINDOW_SECONDS).toBe(86_400);
  });

  it('fails closed unless both wallet and representative flags are explicitly true', () => {
    expect(areRepresentativeTransfersEnabled({ wallet: true, representativeTransfers: true })).toBe(true);
    expect(areRepresentativeTransfersEnabled({ wallet: true })).toBe(false);
    expect(areRepresentativeTransfersEnabled({ representativeTransfers: true })).toBe(false);
    expect(areRepresentativeTransfersEnabled({ wallet: 1, representativeTransfers: true })).toBe(false);
    expect(areRepresentativeTransfersEnabled(undefined)).toBe(false);
  });

  it('allows only explicit state-machine transitions', () => {
    expect(canTransitionRepresentativePortal('bootstrapping', 'recipient-entry')).toBe(true);
    expect(canTransitionRepresentativePortal('recipient-entry', 'submitting')).toBe(false);
    expect(canTransitionRepresentativePortal('verified', 'review')).toBe(true);
    expect(canTransitionRepresentativePortal('pin-challenge', 'submitting')).toBe(true);
    expect(canTransitionRepresentativePortal('completed', 'submitting')).toBe(false);
    expect(canTransitionRepresentativePortal('unavailable', 'bootstrapping')).toBe(true);
    expect(canTransitionRepresentativePortal('unknown', 'failed')).toBe(false);
  });

  it('accepts only an origin-only HTTPS portal URL outside explicit local development', () => {
    expect(normalizeRepresentativePortalOrigin('https://representative.example.com')).toEqual({ ok: true, value: 'https://representative.example.com' });
    expect(normalizeRepresentativePortalOrigin('https://representative.example.com/')).toEqual({ ok: true, value: 'https://representative.example.com' });
    expect(normalizeRepresentativePortalOrigin('https://representative.example.com/path')).toMatchObject({ ok: false });
    expect(normalizeRepresentativePortalOrigin('https://representative.example.com?token=secret')).toMatchObject({ ok: false });
    expect(normalizeRepresentativePortalOrigin('http://representative.example.com')).toMatchObject({ ok: false });
    expect(normalizeRepresentativePortalOrigin('http://localhost:5174')).toMatchObject({ ok: false });
    expect(normalizeRepresentativePortalOrigin('http://localhost:5174', { allowLocalhost: true })).toEqual({ ok: true, value: 'http://localhost:5174' });
  });

  it('requires complete, positive, coherent global limits for both currencies', () => {
    const policy = {
      coins: { maxPerTransfer: 100_000, maxPerDay: 1_000_000, maxTransfersPerHour: 20 },
      diamonds: { maxPerTransfer: 10_000, maxPerDay: 100_000, maxTransfersPerHour: 10 },
    };
    expect(normalizeRepresentativeTransferPolicy(policy)).toEqual({ ok: true, value: policy });
    expect(normalizeRepresentativeTransferPolicy({ coins: policy.coins })).toMatchObject({ ok: false });
    expect(normalizeRepresentativeTransferPolicy({ ...policy, coins: { ...policy.coins, maxPerDay: 99_999 } })).toMatchObject({ ok: false });
    expect(normalizeRepresentativeTransferPolicy({ ...policy, coins: { ...policy.coins, maxPerTransfer: '100000' } })).toMatchObject({ ok: false });
    expect(normalizeRepresentativeTransferPolicy({ ...policy, diamonds: { ...policy.diamonds, extra: true } })).toMatchObject({ ok: false });
  });

  it('allows a non-empty partial policy only for an explicit representative override', () => {
    expect(normalizeRepresentativeTransferPolicy({
      coins: { maxPerTransfer: 50_000, maxPerDay: 200_000, maxTransfersPerHour: 5 },
    }, { allowPartial: true })).toMatchObject({ ok: true, value: { coins: { maxPerTransfer: 50_000 } } });
    expect(normalizeRepresentativeTransferPolicy({}, { allowPartial: true })).toMatchObject({ ok: false });
  });

  it('validates PIN and public receipt reference formats without coercion', () => {
    expect(isValidRepresentativeTransferPin('012345')).toBe(true);
    expect(isValidRepresentativeTransferPin(123456)).toBe(false);
    expect(isValidRepresentativeTransferPin('12345')).toBe(false);
    expect(isValidRepresentativeTransferPin('12345A')).toBe(false);
    expect(isValidRepresentativePublicReference('RPT-0123456789ABCDEF')).toBe(true);
    expect(isValidRepresentativePublicReference('RPT-0123456789ABCDEI')).toBe(false);
    expect(isValidRepresentativePublicReference('representative_transfer_1')).toBe(false);
  });

  it('creates, validates, and hashes fixed-width opaque credentials', () => {
    const token = createRepresentativeOpaqueToken((size) => Buffer.alloc(size, 7));
    expect(token).toHaveLength(43);
    expect(isValidRepresentativeOpaqueToken(token)).toBe(true);
    expect(hashRepresentativeOpaqueToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashRepresentativeOpaqueToken(`${token}x`)).toBe('');
  });

  it('creates a random public receipt reference', () => {
    const reference = createRepresentativePublicReference((size) => Buffer.alloc(size, 7));
    expect(reference).toMatch(/^RPT-[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(isValidRepresentativePublicReference(reference)).toBe(true);
  });

  it('accepts only exact portal request shapes', () => {
    const token = createRepresentativeOpaqueToken((size) => Buffer.alloc(size, 9));
    expect(normalizeRepresentativePortalRequest({ action: 'exchange', ticket: token })).toMatchObject({ ok: true });
    expect(normalizeRepresentativePortalRequest({ action: 'exchange', extra: true, ticket: token })).toMatchObject({ ok: false });
    expect(normalizeRepresentativePortalRequest({ action: 'status' })).toEqual({ ok: true, value: { action: 'status' } });
    expect(normalizeRepresentativePortalRequest({ action: 'recipient-preview', recipientPublicId: '2222222' })).toMatchObject({ ok: true });
    expect(normalizeRepresentativePortalRequest({ action: 'recipient-preview', recipientPublicId: '0222222' })).toMatchObject({ ok: false });
    expect(normalizeRepresentativePortalRequest({ action: 'pin-setup', pin: '012345' })).toMatchObject({ ok: true });
    expect(normalizeRepresentativePortalRequest({ action: 'pin-setup', pin: 123456 })).toMatchObject({ ok: false });
    expect(normalizeRepresentativePortalRequest({ action: 'transfer', amount: 5, currency: 'coins', pin: '012345', proof: token, requestId: 'portal_request_123' })).toMatchObject({ ok: true });
    expect(normalizeRepresentativePortalRequest({ action: 'transfer', amount: 5, currency: 'coins', pin: '012345', proof: token, requestId: 'short' })).toMatchObject({ ok: false });
  });

  it('normalizes safe receipt lookup and filtered history requests', () => {
    expect(normalizeRepresentativePortalRequest({
      action: 'receipt-lookup',
      publicReference: 'RPT-0123456789ABCDEF',
    })).toMatchObject({ ok: true });
    expect(normalizeRepresentativePortalRequest({
      action: 'history',
      currency: 'coins',
      from: '2026-07-01T00:00:00.000Z',
      limit: 25,
      status: 'reversed',
      to: '2026-07-24T00:00:00.000Z',
    })).toMatchObject({
      ok: true,
      value: { currency: 'coins', limit: 25, status: 'reversed' },
    });
    expect(normalizeRepresentativePortalRequest({
      action: 'history',
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-07-01T00:00:00.000Z',
    })).toMatchObject({ ok: false });
  });
});
