import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  mapRepresentativeTransferReceipt,
  mapRepresentativeHistoryReceipt,
  mapWalletRechargeReceipt,
  normalizeAdminRepresentativeInput,
  normalizeAdminRepresentativeReversalInput,
  normalizeRepresentativeTransferInput,
} = require('./representativeCore');

describe('representativeCore', () => {
  it('requires a positive integer amount, six-digit PIN, and opaque recipient proof', () => {
    const proof = Buffer.alloc(32, 1).toString('base64url');
    expect(normalizeRepresentativeTransferInput({ amount: 50, currency: 'coins', pin: '012345', proof })).toMatchObject({ ok: true });
    expect(normalizeRepresentativeTransferInput({ amount: 50, currency: 'coins', pin: '12345', proof })).toMatchObject({ ok: false });
    expect(normalizeRepresentativeTransferInput({ amount: 1.5, currency: 'coins', pin: '012345', proof })).toMatchObject({ ok: false });
  });

  it('allows either currency permission or both, but not an active empty privilege', () => {
    expect(normalizeAdminRepresentativeInput({ active: true, coins: true, diamonds: false, requestId: 'representative_123', targetUid: 'u1' })).toMatchObject({ ok: true });
    expect(normalizeAdminRepresentativeInput({ active: true, coins: false, diamonds: false, requestId: 'representative_123', targetUid: 'u1' })).toMatchObject({ ok: false });
    expect(normalizeAdminRepresentativeInput({ active: false, coins: false, diamonds: false, requestId: 'representative_123', targetUid: 'u1' })).toMatchObject({ ok: true });
  });

  it('normalizes full-reversal requests against the reviewed transfer value', () => {
    expect(normalizeAdminRepresentativeReversalInput({
      expectedAmount: 20,
      expectedCurrency: 'coins',
      publicReference: 'RPT-0123456789ABCDEF',
      reason: 'Duplicate external settlement',
      requestId: 'reversal_request_1',
    })).toMatchObject({
      ok: true,
      value: { expectedAmount: 20, expectedCurrency: 'coins' },
    });
    expect(normalizeAdminRepresentativeReversalInput({
      expectedAmount: 20,
      expectedCurrency: 'diamonds',
      publicReference: 'invalid',
      reason: 'x',
      requestId: 'short',
    })).toMatchObject({ ok: false });
  });

  it('maps only valid completed transfer receipts', () => {
    expect(mapRepresentativeTransferReceipt({ amount: 20, balanceAfter: 80, balanceBefore: 100, createdAt: { toMillis: () => 1000 }, currency: 'coins', publicReference: 'RPT-0123456789ABCDEF', recipientDisplayName: 'Recipient', recipientPublicId: '2222222', recipientUid: 'recipient', status: 'completed' }, 'receipt-1')).toMatchObject({ balanceAfter: 80, balanceBefore: 100, createdAt: '1970-01-01T00:00:01.000Z', publicReference: 'RPT-0123456789ABCDEF', recipientDisplayName: 'Recipient', transferId: 'receipt-1' });
    expect(mapRepresentativeTransferReceipt({ amount: 20, currency: 'coins' }, 'receipt-2')).toBeUndefined();
  });

  it('maps recipient recharge receipts with the representative normal ID', () => {
    expect(mapWalletRechargeReceipt({ amount: 4, balanceAfter: 5, balanceBefore: 1, createdAt: { toMillis: () => 2000 }, currency: 'diamonds', representativePublicId: '1111111', representativeUid: 'sender', status: 'completed' }, 'receipt-3')).toMatchObject({ balanceAfter: 5, balanceBefore: 1, currency: 'diamonds', representativePublicId: '1111111' });
    expect(mapWalletRechargeReceipt({ amount: 4, createdAt: { toMillis: () => 2000 }, currency: 'diamonds', representativePublicId: '0111111', representativeUid: 'sender', status: 'completed' }, 'receipt-4')).toBeUndefined();
  });

  it('maps safe transfer and reversal history without internal identifiers', () => {
    expect(mapRepresentativeHistoryReceipt({
      amount: 20,
      balanceAfter: 100,
      balanceBefore: 80,
      createdAt: { toMillis: () => 3000 },
      currency: 'coins',
      publicReference: 'RPT-0123456789ABCDEF',
      recipientDisplayName: 'Recipient',
      recipientPublicId: '2222222',
      recipientUid: 'internal-recipient',
      reversalOf: 'internal-transfer',
      status: 'reversed',
    })).toEqual({
      amount: 20,
      balanceAfter: 100,
      balanceBefore: 80,
      createdAt: '1970-01-01T00:00:03.000Z',
      currency: 'coins',
      kind: 'reversal',
      publicReference: 'RPT-0123456789ABCDEF',
      recipientDisplayName: 'Recipient',
      recipientPublicId: '2222222',
      status: 'reversed',
    });
  });
});
