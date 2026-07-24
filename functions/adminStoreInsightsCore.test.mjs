import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { buildEconomyCsv, buildStoreItemInsights, mapStoreOwnership, mapStoreTransaction } = require('./adminStoreInsightsCore');
const timestamp = (iso) => ({ toDate: () => new Date(iso) });

describe('adminStoreInsightsCore', () => {
  it('maps valid store transactions and ownerships defensively', () => {
    expect(mapStoreTransaction('purchase-1', { amount: 50, createdAt: timestamp('2026-07-20T10:00:00Z'), currency: 'coins', itemId: 'royal_car', kind: 'purchase', uid: 'user-1' })).toMatchObject({ amount: 50, kind: 'purchase', uid: 'user-1' });
    expect(mapStoreTransaction('broken', { amount: -1, currency: 'coins', itemId: 'royal_car', kind: 'purchase' })).toBeNull();
    expect(mapStoreOwnership('royal_car', { acquiredAt: timestamp('2026-07-20T10:00:00Z'), equipped: true, itemId: 'royal_car', kind: 'store-ownership', state: 'active', uid: 'user-1' })).toMatchObject({ equipped: true, state: 'active' });
    expect(mapStoreOwnership('royal_car', { itemId: 'royal_car', kind: 'other', uid: 'user-1' })).toBeNull();
  });

  it('builds item metrics and a newest-first combined timeline', () => {
    const purchase = mapStoreTransaction('purchase-1', { amount: 50, createdAt: timestamp('2026-07-20T10:00:00Z'), currency: 'coins', itemId: 'royal_car', kind: 'purchase', uid: 'user-1' });
    const gift = mapStoreTransaction('gift-1', { amount: 3, createdAt: timestamp('2026-07-21T10:00:00Z'), currency: 'diamonds', itemId: 'royal_car', kind: 'gift', recipientUid: 'user-2', senderUid: 'user-1' });
    const ownership = mapStoreOwnership('royal_car', { acquiredAt: timestamp('2026-07-20T10:00:00Z'), equipped: true, itemId: 'royal_car', kind: 'store-ownership', state: 'active', uid: 'user-1' });
    const result = buildStoreItemInsights({ auditEvents: [{ actorUid: 'admin-1', createdAt: '2026-07-19T10:00:00.000Z', id: 'audit-1' }], ownerships: [ownership], transactions: [purchase, gift] });
    expect(result.metrics).toEqual({ activeOwnerships: 1, equippedOwnerships: 1, expiredOwnerships: 0, gifts: 1, ownerships: 1, purchases: 1, revenueCoins: 50, revenueDiamonds: 3 });
    expect(result.history.map((entry) => entry.kind)).toEqual(['gift', 'purchase', 'catalog-change']);
  });

  it('escapes spreadsheet formulas and reports export metadata', () => {
    const result = buildEconomyCsv([{ actorUid: '', amount: 5, balanceAfter: 10, createdAt: '2026-07-21T10:00:00Z', currency: 'coins', displayName: '=IMPORTXML("bad")', id: 'tx-1', note: '@unsafe', publicId: '1001', referenceId: 'item-1', source: 'store-purchase', specialId: '', type: 'purchase', uid: 'user-1' }]);
    expect(result.count).toBe(1);
    expect(result.csv).toContain("'=IMPORTXML");
    expect(result.csv).toContain("'@unsafe");
    expect(result.filename).toMatch(/^store-ledger-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
