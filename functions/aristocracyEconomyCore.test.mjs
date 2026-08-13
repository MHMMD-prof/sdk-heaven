import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  ARISTOCRACY_QUOTE_TTL_MS,
  DAY_MS,
  buildAristocracyQuoteDocument,
  calculateAristocracyQuote,
  ceilMultiplyDivide,
  mapAristocracyQuote,
  normalizeAristocracyAdminProposal,
  normalizeAristocracyPurchaseInput,
  normalizeAristocracyQuoteInput,
  quoteMatchesCalculation,
} = require('./aristocracyEconomyCore');

const now = Date.parse('2026-08-13T00:00:00.000Z');

describe('aristocracyEconomyCore Wave 3', () => {
  it('creates a full-price, fixed-duration, manual purchase quote', () => {
    const result = calculateAristocracyQuote({ catalog: catalog(), entitlement: null, nowMillis: now, targetRankId: 'knight' });
    expect(result).toMatchObject({
      ok: true,
      value: {
        operation: 'purchase', amountCoins: 1_000, targetRankId: 'knight', sourceRankId: null,
        resultingExpiryMillis: now + 30 * DAY_MS,
      },
    });
  });

  it('renews manually at full price from the existing expiry', () => {
    const expiresAt = now + 7 * DAY_MS;
    const result = calculateAristocracyQuote({
      catalog: catalog(), entitlement: entitlement({ expiresAt: timestamp(expiresAt) }), nowMillis: now, targetRankId: 'knight',
    });
    expect(result).toMatchObject({
      ok: true,
      value: { operation: 'renewal', amountCoins: 1_000, resultingExpiryMillis: expiresAt + 30 * DAY_MS },
    });
  });

  it('treats an expired entitlement as a new full-price purchase', () => {
    const result = calculateAristocracyQuote({
      catalog: catalog(), entitlement: entitlement({ expiresAt: timestamp(now - 1) }), nowMillis: now, targetRankId: 'baron',
    });
    expect(result).toMatchObject({ ok: true, value: { operation: 'purchase', amountCoins: 5_000, sourceRankId: null } });
  });

  it('quotes an active upgrade with ceiling-rounded prorated difference and unchanged expiry', () => {
    const expiresAt = now + 15 * DAY_MS;
    const result = calculateAristocracyQuote({
      catalog: catalog(), entitlement: entitlement({ expiresAt: timestamp(expiresAt) }), nowMillis: now, targetRankId: 'baron',
    });
    expect(result).toMatchObject({
      ok: true,
      value: { operation: 'upgrade', amountCoins: 2_000, sourceRankId: 'knight', resultingExpiryMillis: expiresAt },
    });
    expect(ceilMultiplyDivide(4_000, 1, 30 * DAY_MS)).toBe(1);
    expect(ceilMultiplyDivide(4_000, 30 * DAY_MS - 1, 30 * DAY_MS)).toBe(4_000);
  });

  it('rejects downgrade, catalog crossover, restricted status, and complimentary overlap', () => {
    expect(calculateAristocracyQuote({
      catalog: catalog(), entitlement: entitlement({ rankId: 'baron', rankOrder: 2 }), nowMillis: now, targetRankId: 'knight',
    }).code).toBe('DOWNGRADE_NOT_ALLOWED');
    expect(calculateAristocracyQuote({
      catalog: catalog(), entitlement: entitlement({ catalogVersion: 'old-catalog' }), nowMillis: now, targetRankId: 'baron',
    }).code).toBe('CATALOG_CHANGED');
    expect(calculateAristocracyQuote({
      catalog: catalog(), entitlement: entitlement({ state: 'frozen' }), nowMillis: now, targetRankId: 'baron',
    }).code).toBe('ENTITLEMENT_RESTRICTED');
    expect(calculateAristocracyQuote({
      catalog: catalog(), entitlement: entitlement({ origin: 'complimentary' }), nowMillis: now, targetRankId: 'baron',
    }).code).toBe('COMPLIMENTARY_ACTIVE');
  });

  it('binds quotes to the entire entitlement and price calculation', () => {
    const calculated = calculateAristocracyQuote({ catalog: catalog(), entitlement: null, nowMillis: now, targetRankId: 'knight' });
    const quoteId = 'q'.repeat(32);
    const document = buildAristocracyQuoteDocument({
      calculated, expiresAt: timestamp(now + ARISTOCRACY_QUOTE_TTL_MS), issuedAt: timestamp(now),
      quoteId, requestId: 'quote_request_000001', uid: 'user-1',
    });
    const mapped = mapAristocracyQuote(document, quoteId);
    expect(mapped).toMatchObject({ uid: 'user-1', amountCoins: 1_000, state: 'open' });
    expect(quoteMatchesCalculation(mapped, calculated)).toBe(true);
    expect(quoteMatchesCalculation({ ...mapped, amountCoins: 1 }, calculated)).toBe(false);
    expect(mapAristocracyQuote({ ...document, expiresAt: timestamp(now + ARISTOCRACY_QUOTE_TTL_MS + 1) }, quoteId)).toBeNull();
  });

  it('accepts only bounded client and dual-control admin inputs', () => {
    expect(normalizeAristocracyQuoteInput({ catalogVersion: 'noble-2026-01', targetRankId: 'knight' }).ok).toBe(true);
    expect(normalizeAristocracyQuoteInput({ catalogVersion: 'noble-2026-01', targetRankId: 'knight', price: 1 }).ok).toBe(false);
    expect(normalizeAristocracyPurchaseInput({ quoteId: 'q'.repeat(32) }).ok).toBe(true);
    expect(normalizeAristocracyPurchaseInput({ quoteId: 'short' }).ok).toBe(false);
    expect(normalizeAristocracyAdminProposal({
      action: 'complimentary-grant', targetUid: 'user-1', catalogVersion: 'noble-2026-01', rankId: 'knight',
      durationDays: 30, reason: 'Approved customer recovery', evidenceRef: 'ticket-123', requestId: 'admin_request_0001',
    }).ok).toBe(true);
    expect(normalizeAristocracyAdminProposal({
      action: 'complimentary-grant', targetUid: 'user-1', catalogVersion: 'noble-2026-01', rankId: 'knight',
      durationDays: 365, reason: 'Too long grant request', evidenceRef: 'ticket-123', requestId: 'admin_request_0001',
    }).ok).toBe(false);
  });
});

function catalog() {
  return {
    schemaVersion: 1, catalogVersion: 'noble-2026-01', kind: 'aristocracy', state: 'published',
    authoredBy: 'admin-1', approvedBy: 'admin-2', reason: 'Wave 3 tests', durationDays: 30,
    upgradePolicy: {
      mode: 'prorated-difference', rounding: 'ceil', expiryMode: 'unchanged-on-upgrade',
      renewalMode: 'manual-full-price', downgradeMode: 'after-expiry', autoRenew: false, gifting: false,
    },
    ranks: [rank('knight', 1, 1_000), rank('baron', 2, 5_000)],
  };
}
function rank(id, order, priceCoins) {
  return { id, order, priceCoins, durationDays: 30, name: { ar: id, en: id }, accentColor: '#D4AF37', benefits: [], assets: {} };
}
function entitlement(overrides = {}) {
  return {
    schemaVersion: 1, uid: 'user-1', catalogVersion: 'noble-2026-01', rankId: 'knight', rankOrder: 1,
    state: 'active', origin: 'paid', revision: 2, latestTransactionId: 'old-transaction', expiresAt: timestamp(now + 30 * DAY_MS),
    ...overrides,
  };
}
function timestamp(value) { return { toDate: () => new Date(value), toMillis: () => value }; }
