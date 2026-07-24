import { describe, expect, it } from 'vitest';
import { createSafeReceiptText, receiptFromTransfer } from './receipt';

describe('safe representative receipts', () => {
  it('builds a public receipt without balances, internal UIDs, PIN state, or external-payment claims', () => {
    const receipt = {
      ...receiptFromTransfer({
        amount: 250,
        balances: { coins: 1, diamonds: 2 },
        currency: 'coins' as const,
        publicReference: 'RPT-0123456789ABCDEF',
        recipient: { displayName: 'المستلم', publicId: '2222222' },
      }, '2026-07-24T09:00:00.000Z'),
      balanceAfter: 750,
      balanceBefore: 1_000,
      recipientUid: 'internal-recipient',
      representativeUid: 'internal-sender',
    };
    const text = createSafeReceiptText(receipt);
    expect(text).toContain('RPT-0123456789ABCDEF');
    expect(text).toContain('2222222');
    expect(text).toContain('الرصيد الافتراضي فقط');
    expect(text).not.toContain('750');
    expect(text).not.toContain('1,000');
    expect(text).not.toContain('internal');
    expect(text).not.toContain('تم استلام المبلغ');
  });

  it('sanitizes display-name line breaks in shared text', () => {
    const text = createSafeReceiptText({
      amount: 1,
      createdAt: '2026-07-24T09:00:00.000Z',
      currency: 'diamonds',
      publicReference: 'RPT-0123456789ABCDEF',
      recipientDisplayName: 'اسم\nحقن',
      recipientPublicId: '2222222',
    });
    expect(text).toContain('اسم حقن');
    expect(text.split('\n')).toHaveLength(7);
  });
});
