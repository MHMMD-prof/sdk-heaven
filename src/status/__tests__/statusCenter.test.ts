import { describe, expect, it } from 'vitest';

import { mapAristocracyQuote, mapStatusCenter } from '../statusCenter';

describe('Wave 5 Status Center client contract', () => {
  it('maps the strict owner response and keeps only typed history', () => {
    const result = mapStatusCenter(center());
    expect(result?.visibility).toBe('hidden');
    expect(result?.catalogs.vip?.tiers[0]).toMatchObject({ id: 'vip-1', benefits: ['profile-badge'] });
    expect(result?.history.vip[0]).toMatchObject({ pointDelta: 1_000 });
  });

  it('fails closed when a catalog or history row is malformed', () => {
    const malformed = center();
    malformed.catalogs.vip.tiers[0].minPoints = -1;
    expect(mapStatusCenter(malformed)).toBeUndefined();
    const unsafeHistory = center();
    unsafeHistory.history.vip[0].pointDelta = 0;
    expect(mapStatusCenter(unsafeHistory)).toBeUndefined();
  });

  it('requires server truth for wallet before/after and no auto renewal', () => {
    const quote = {
      quoteId: 'quote_123456789012345678901234', catalogVersion: 'noble-2026-01', targetRankId: 'knight',
      targetRankOrder: 1, operation: 'purchase', amountCoins: 1_000, balanceBefore: 4_000, balanceAfter: 3_000,
      durationDays: 30, expiresAtMillis: 2_000, resultingExpiryMillis: 3_000, autoRenew: false,
    };
    expect(mapAristocracyQuote(quote)).toMatchObject({ autoRenew: false, balanceAfter: 3_000 });
    expect(mapAristocracyQuote({ ...quote, autoRenew: true })).toBeUndefined();
    expect(mapAristocracyQuote({ ...quote, balanceAfter: -1 })).toBeUndefined();
  });
});

function center() {
  return {
    schemaVersion: 1,
    flags: { vipProgression: true, aristocracyShop: true, statusPresentation: true },
    visibility: 'hidden',
    vip: { catalogVersion: 'vip-2026-01', points: 1_000, levelId: 'vip-1', band: 'vip', level: 1, order: 1, state: 'active' },
    aristocracy: { catalogVersion: 'noble-2026-01', rankId: 'knight', rankOrder: 1, expiresAtMillis: 4_000, state: 'active' },
    catalogs: {
      vip: { catalogVersion: 'vip-2026-01', tiers: [{ id: 'vip-1', band: 'vip', level: 1, order: 1, minPoints: 1_000, name: { ar: 'VIP 1', en: 'VIP 1' }, accentColor: '#D4AF37', benefits: ['profile-badge'] }] },
      aristocracy: { catalogVersion: 'noble-2026-01', durationDays: 30, ranks: [{ id: 'knight', order: 1, priceCoins: 1_000, durationDays: 30, name: { ar: 'فارس', en: 'Knight' }, accentColor: '#D4AF37', benefits: ['avatar-frame'] }] },
    },
    history: {
      vip: [{ eventId: 'recharge_1', kind: 'representative-recharge', pointDelta: 1_000, settlementState: 'settled', occurredAtMillis: 1_000 }],
      aristocracy: [{ transactionId: 'tx_1', kind: 'purchase', rankId: 'knight', rankOrder: 1, amountCoins: 1_000, createdAtMillis: 1_000, expiresAtMillis: 4_000 }],
    },
  };
}
