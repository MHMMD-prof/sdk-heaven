import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  analyzeWeeklyIncentiveRisk,
  createIntegrityDocumentId,
  reconcileGiftEconomyShape,
  retentionDeadlineMillis,
} = require('./weeklyIncentiveIntegrityCore');

describe('weekly incentive integrity core', () => {
  it('detects circular gifting and rapid pass-through without deleting evidence', () => {
    const result = analyzeWeeklyIncentiveRisk({
      cycleId: 'weekly-1',
      facts: [
        fact('a', 'user-1', 'user-2', 2_000, 1_000),
        fact('b', 'user-2', 'user-1', 1_800, 2_000),
        fact('c', 'user-1', 'user-3', 1_500, 2_500),
      ],
      uid: 'user-1',
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        hold: true,
        state: 'held',
        signals: expect.arrayContaining([
          expect.objectContaining({ code: 'CIRCULAR_GIFTING', severity: 'high' }),
          expect.objectContaining({ code: 'RAPID_PASS_THROUGH', severity: 'high' }),
        ]),
      },
    });
  });

  it('detects device, churn, mute cycling, refunds, and reward stacking', () => {
    const result = analyzeWeeklyIncentiveRisk({
      cycleId: 'weekly-1',
      facts: [],
      muteGraceCycling: { flagged: true, resetCount: 4, windowMillis: 60_000 },
      refundCount: 1,
      relatedInstallationCount: 2,
      retainedCommissionCoins: 100,
      reversalCount: 1,
      rosterChangeCount: 6,
      stackedLiabilityCoins: 101,
      uid: 'user-1',
    });
    expect(result.value.riskScore).toBe(100);
    expect(result.value.signals.map((signal) => signal.code)).toEqual([
      'REFUND_REVERSAL_PATTERN',
      'RELATED_ACCOUNT_CLUSTER',
      'SELECTED_MEMBER_CHURN',
      'MUTE_GRACE_CYCLING',
      'ABNORMAL_REWARD_STACKING',
    ]);
  });

  it('reconciles sender debit, recipient credit, and platform commission', () => {
    const event = {
      eventId: 'event-1',
      platformShare: 100,
      price: 1_000,
      recipientCredit: 900,
      recipientUid: 'recipient',
      senderUid: 'sender',
      status: 'committed',
    };
    expect(reconcileGiftEconomyShape({
      event,
      platformLedger: ledger('platform', 100, 'coins', 'event-1'),
      recipientLedger: ledger('recipient', 900, 'giftEarnings', 'event-1'),
      senderLedger: { ...ledger('sender', 1_000, 'coins', 'event-1'), type: 'purchase' },
    })).toEqual({ balanced: true, discrepancies: [] });
    expect(reconcileGiftEconomyShape({
      event,
      platformLedger: undefined,
      recipientLedger: ledger('recipient', 800, 'giftEarnings', 'event-1'),
      senderLedger: undefined,
    }).discrepancies).toEqual([
      'SENDER_DEBIT_LEDGER',
      'RECIPIENT_CREDIT_LEDGER',
      'PLATFORM_COMMISSION_LEDGER',
    ]);
  });

  it('derives stable opaque report IDs and distinct retention windows', () => {
    expect(createIntegrityDocumentId('wir', ['cycle', 'user'])).toMatch(/^wir_[a-f0-9]{40}$/);
    expect(retentionDeadlineMillis('roomSupportLeaderboards', 0)).toBe(90 * 86_400_000);
    expect(retentionDeadlineMillis('rewardSettlements', 0)).toBe(2555 * 86_400_000);
  });
});

function fact(eventId, senderUid, recipientUid, debitedCoins, occurredAtMillis) {
  return { debitedCoins, eventId, occurredAtMillis, recipientUid, senderUid };
}

function ledger(uid, amount, currency, referenceId) {
  return { amount, currency, referenceId, type: 'credit', uid };
}
