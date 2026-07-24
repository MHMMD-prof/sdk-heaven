import { describe, expect, it } from 'vitest';
import type { PortalStatus, RecipientPreview } from './contracts';
import { canOpenReview, initialPortalState, normalizeAmountInput, portalReducer, type PortalState } from './machine';

const now = 1_000_000;
const preview: RecipientPreview = {
  expiresAt: new Date(now + 60_000).toISOString(),
  proof: 'P'.repeat(43),
  recipient: { avatarUrl: '', displayName: 'المستلم', publicId: '2222222' },
};

describe('representative portal state machine', () => {
  it('clears the verified proof and amount whenever the recipient ID is edited', () => {
    const state = readyState({ amountInput: '100', preview, recipientInput: '2222222', step: 'verified' });
    const next = portalReducer(state, { type: 'RECIPIENT_EDITED', value: '3333333' });
    expect(next).toMatchObject({ amountInput: '', preview: undefined, recipientInput: '3333333', step: 'recipient-entry' });
  });

  it('does not jump from recipient entry to submission and ignores duplicate submit taps', () => {
    const entry = readyState({ step: 'recipient-entry' });
    expect(portalReducer(entry, { type: 'SUBMIT_STARTED' })).toBe(entry);
    const challenge = readyState({ amountInput: '100', preview, step: 'pin-challenge' });
    const submitting = portalReducer(challenge, { type: 'SUBMIT_STARTED' });
    expect(submitting).toMatchObject({ busy: true, step: 'submitting' });
    expect(portalReducer(submitting, { type: 'SUBMIT_STARTED' })).toBe(submitting);
  });

  it('requires an unexpired proof, sufficient funds, and backend limits before review', () => {
    const valid = readyState({ amountInput: '100', preview, step: 'verified' });
    expect(canOpenReview(valid, now)).toBe(true);
    expect(canOpenReview({ ...valid, amountInput: '101' }, now)).toBe(false);
    expect(canOpenReview({ ...valid, preview: { ...preview, expiresAt: new Date(now).toISOString() } }, now)).toBe(false);
    expect(canOpenReview({ ...valid, status: status({ dailyAllowance: { coins: 50 } }) }, now)).toBe(false);
  });

  it('handles PIN errors, lockout, proof expiry, session expiry, and feature shutdown explicitly', () => {
    const submitting = readyState({ amountInput: '10', busy: true, preview, step: 'submitting' });
    expect(portalReducer(submitting, { code: 'PIN_INVALID', message: 'خطأ', type: 'SUBMIT_FAILED' })).toMatchObject({ busy: false, error: 'خطأ', step: 'pin-challenge' });
    expect(portalReducer(submitting, { code: 'PIN_LOCKED', message: 'مقفل', type: 'SUBMIT_FAILED' })).toMatchObject({ busy: false, step: 'locked' });
    expect(portalReducer(submitting, { code: 'PROOF_INVALID', message: 'انتهى', type: 'SUBMIT_FAILED' })).toMatchObject({ preview: undefined, step: 'recipient-entry' });
    expect(portalReducer(submitting, { code: 'PORTAL_SESSION_INVALID', message: '', type: 'SUBMIT_FAILED' })).toMatchObject({ step: 'failed' });
    expect(portalReducer(submitting, { type: 'FEATURE_DISABLED' })).toMatchObject({ preview: undefined, step: 'unavailable' });
  });

  it('normalizes keyboard amount input to a positive integer string', () => {
    expect(normalizeAmountInput('٠١٢٣abc')).toBe('');
    expect(normalizeAmountInput('000123')).toBe('123');
    expect(normalizeAmountInput('12.50')).toBe('');
    expect(normalizeAmountInput('')).toBe('');
  });
});

function readyState(overrides: Partial<PortalState> = {}): PortalState {
  return {
    ...initialPortalState,
    currency: 'coins',
    online: true,
    status: status(),
    step: 'verified',
    ...overrides,
  };
}

function status(overrides: Partial<PortalStatus> = {}): PortalStatus {
  return {
    dailyAllowance: { coins: 100, diamonds: 50 },
    feature: { available: true, enabled: true, policyConfigured: true, portalConfigured: true },
    limits: {
      configured: true,
      effective: {
        coins: { maxPerDay: 100, maxPerTransfer: 100, maxTransfersPerHour: 10 },
        diamonds: { maxPerDay: 50, maxPerTransfer: 50, maxTransfersPerHour: 5 },
      },
      overrideCurrencies: [],
    },
    pin: { state: 'ready' },
    privilege: { active: true, currencies: { coins: true, diamonds: true } },
    recentTransfers: [],
    wallet: { balances: { coins: 100, diamonds: 50 } },
    ...overrides,
  };
}
