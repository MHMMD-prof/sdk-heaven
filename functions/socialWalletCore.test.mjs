import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const {
  applyWalletMutation,
  analyzeWalletDocument,
  buildWalletDocument,
  buildWalletTransaction,
  isDualCurrencyWalletDocument,
  mapWalletSummary,
  normalizeAdminSpecialIdInput,
  normalizeAdminWalletAdjustmentInput,
  normalizeAdminWalletCreditInput,
  normalizeSpecialIdPurchaseInput,
} = require('./socialWalletCore');

describe('socialWalletCore', () => {
  it('accepts numeric special IDs without introducing handles', () => {
    expect(normalizeSpecialIdPurchaseInput({ specialId: '0000777' })).toEqual({ ok: true, value: { specialId: '0000777' } });
    expect(normalizeSpecialIdPurchaseInput({ specialId: '777' })).toMatchObject({ ok: false });
    expect(normalizeSpecialIdPurchaseInput({ specialId: '@vip' })).toMatchObject({ ok: false });
  });
  it('requires bounded integer admin credits', () => {
    expect(normalizeAdminWalletCreditInput({ amount: 500, requestId: 'admin_123456789', targetUid: 'u1' })).toMatchObject({ ok: true, value: { currency: 'coins' } });
    expect(normalizeAdminWalletCreditInput({ amount: 5, currency: 'diamonds', requestId: 'admin_diamonds_01', targetUid: 'u1' })).toMatchObject({ ok: true });
    expect(normalizeAdminWalletCreditInput({ amount: 5, currency: 'cash', requestId: 'admin_currency_01', targetUid: 'u1' })).toMatchObject({ ok: false });
    expect(normalizeAdminWalletCreditInput({ amount: -1, requestId: 'admin_123456789', targetUid: 'u1' })).toMatchObject({ ok: false });
    expect(normalizeAdminWalletCreditInput({ amount: 500, targetUid: 'u1' })).toMatchObject({ ok: false });
  });
  it('requires a reason and a supported mutation for admin wallet adjustments', () => {
    expect(normalizeAdminWalletAdjustmentInput({ amount: 25, currency: 'coins', mutationType: 'debit', note: 'chargeback', requestId: 'admin_debit_0001', targetUid: 'u1' })).toMatchObject({ ok: true, value: { mutationType: 'debit', note: 'chargeback' } });
    expect(normalizeAdminWalletAdjustmentInput({ amount: 25, currency: 'coins', mutationType: 'debit', note: '', requestId: 'admin_debit_0002', targetUid: 'u1' })).toMatchObject({ ok: false });
    expect(normalizeAdminWalletAdjustmentInput({ amount: 25, currency: 'coins', mutationType: 'set', note: 'manual', requestId: 'admin_debit_0003', targetUid: 'u1' })).toMatchObject({ ok: false });
  });
  it('maps legacy wallets into coins and initializes diamonds safely', () => {
    expect(mapWalletSummary({ balance: 40, lifetimeCredit: 50, lifetimeDebit: 10 }, 'u1')).toMatchObject({
      balances: { coins: 40, diamonds: 0 },
      lifetimeCredit: { coins: 50, diamonds: 0 },
      lifetimeDebit: { coins: 10, diamonds: 0 },
    });
  });
  it('applies currency-specific credits and debits without changing the other balance', () => {
    const wallet = mapWalletSummary({
      balances: { coins: 100, diamonds: 7 },
      lifetimeCredit: { coins: 100, diamonds: 7 },
      lifetimeDebit: { coins: 0, diamonds: 0 },
    }, 'u1');
    const debit = applyWalletMutation(wallet, { amount: 25, currency: 'coins', type: 'debit' });
    expect(debit).toMatchObject({ ok: true, value: { balanceAfter: 75, wallet: { balances: { coins: 75, diamonds: 7 } } } });
    expect(applyWalletMutation(wallet, { amount: 8, currency: 'diamonds', type: 'debit' })).toEqual({ ok: false, code: 'INSUFFICIENT_FUNDS' });
  });
  it('builds the canonical wallet and immutable currency-aware ledger shapes', () => {
    const wallet = mapWalletSummary({ balance: 100, lifetimeCredit: 100 }, 'u1');
    const document = buildWalletDocument(wallet, { createdAt: 'created', updatedAt: 'updated' });
    expect(isDualCurrencyWalletDocument(document, 'u1')).toBe(true);
    expect(buildWalletTransaction({
      actorUid: 'u1', amount: 10, balanceAfter: 90, createdAt: 'now', currency: 'coins', source: 'store', type: 'purchase', uid: 'u1',
    })).toMatchObject({ currency: 'coins', type: 'purchase' });
  });
  it('preflights legacy wallet migration without accepting malformed balances', () => {
    expect(analyzeWalletDocument({ balance: 100, lifetimeCredit: 100, lifetimeDebit: 0, uid: 'u1' }, 'u1')).toMatchObject({
      ok: true,
      status: 'legacy',
    });
    expect(analyzeWalletDocument({ balance: -1, uid: 'u1' }, 'u1')).toEqual({ ok: false, code: 'INVALID_WALLET' });
    expect(analyzeWalletDocument({ balance: 10, uid: 'other' }, 'u1')).toEqual({ ok: false, code: 'INVALID_WALLET' });
  });
  it('rejects unsupported admin catalog states', () => {
    expect(normalizeAdminSpecialIdInput({
      price: 500,
      reason: 'إضافة رقم جديد',
      requestId: 'admin_123456789',
      specialId: '0000777',
      status: 'available',
    })).toMatchObject({ ok: true });
    expect(normalizeAdminSpecialIdInput({
      price: 500,
      requestId: 'admin_123456789',
      specialId: '0000777',
      status: 'sold',
    })).toMatchObject({ ok: false });
  });
});
