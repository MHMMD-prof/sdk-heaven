import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  mapRepresentativeAdminTransfer,
  mapRepresentativeOverrideLimits,
  mapRepresentativePolicy,
  normalizeAdminRepresentativeOverrideInput,
  normalizeAdminRepresentativePinResetInput,
  normalizeAdminRepresentativePolicyInput,
  normalizeRepresentativeOperationsQuery,
} = require('./representativeAdminCore');

const limits = {
  coins: { maxPerDay: 5_000, maxPerTransfer: 1_000, maxTransfersPerHour: 10 },
  diamonds: { maxPerDay: 500, maxPerTransfer: 100, maxTransfersPerHour: 5 },
};

describe('representativeAdminCore', () => {
  it('normalizes receipt queries and rejects malformed public references', () => {
    expect(normalizeRepresentativeOperationsQuery({ publicReference: ' rpt-0123456789abcdef ' }))
      .toEqual({ ok: true, value: { publicReference: 'RPT-0123456789ABCDEF' } });
    expect(normalizeRepresentativeOperationsQuery({ publicReference: 'receipt-1' }))
      .toMatchObject({ ok: false });
  });

  it('requires a reason, request ID, and current revision for policy mutations', () => {
    expect(normalizeAdminRepresentativePolicyInput({
      expectedUpdatedAt: 'missing',
      limits,
      reason: 'Initial rollout limits',
      requestId: 'policy_request_123',
    })).toMatchObject({ ok: true, value: { expectedUpdatedAt: 'missing', limits } });
    expect(normalizeAdminRepresentativePolicyInput({
      limits,
      reason: 'Initial rollout limits',
      requestId: 'policy_request_123',
    })).toMatchObject({ ok: false });
    expect(normalizeAdminRepresentativePolicyInput({
      expectedUpdatedAt: 'missing',
      limits: { ...limits, coins: { ...limits.coins, maxPerDay: 10 } },
      reason: 'Invalid limits',
      requestId: 'policy_request_123',
    })).toMatchObject({ ok: false });
  });

  it('accepts partial per-representative overrides and validates PIN reset governance', () => {
    expect(normalizeAdminRepresentativeOverrideInput({
      expectedUpdatedAt: '1970-01-01T00:00:00.001Z',
      limits: { coins: limits.coins },
      reason: 'Temporary risk limit',
      requestId: 'override_request_123',
      targetUid: 'representative-1',
    })).toMatchObject({ ok: true, value: { limits: { coins: limits.coins } } });
    expect(normalizeAdminRepresentativeOverrideInput({
      expectedUpdatedAt: 'missing',
      limits: { unsupported: limits.coins },
      reason: 'Invalid override',
      requestId: 'override_request_123',
      targetUid: 'representative-1',
    })).toMatchObject({ ok: false });
    expect(normalizeAdminRepresentativePinResetInput({
      expectedUpdatedAt: '1970-01-01T00:00:00.001Z',
      reason: 'Representative reported compromise',
      requestId: 'pin_reset_request_1',
      targetUid: 'representative-1',
    })).toMatchObject({ ok: true });
    expect(mapRepresentativeOverrideLimits({
      coins: limits.coins,
      diamonds: { maxPerDay: 1, maxPerTransfer: 2, maxTransfersPerHour: 1 },
      unsupported: limits.coins,
    })).toEqual({ coins: limits.coins });
  });

  it('maps configured policy revisions and conservative reversal eligibility', () => {
    expect(mapRepresentativePolicy({ limits, updatedAt: timestamp(1) })).toEqual({
      configured: true,
      limits,
      updatedAt: '1970-01-01T00:00:00.001Z',
    });
    expect(mapRepresentativePolicy(undefined)).toEqual({
      configured: false,
      limits: undefined,
      updatedAt: 'missing',
    });

    const transfer = {
      amount: 50,
      createdAt: timestamp(1_000),
      currency: 'coins',
      publicReference: 'RPT-0123456789ABCDEF',
      recipientUid: 'recipient',
      representativeUid: 'representative',
      status: 'completed',
    };
    expect(mapRepresentativeAdminTransfer('transfer-1', transfer, undefined, 50, 2_000))
      .toMatchObject({ eligibleForReversal: true, status: 'completed' });
    expect(mapRepresentativeAdminTransfer('transfer-1', transfer, undefined, 49, 2_000))
      .toMatchObject({ eligibleForReversal: false, status: 'completed' });
    expect(mapRepresentativeAdminTransfer('transfer-1', transfer, {
      createdAt: timestamp(1_500),
      publicReference: transfer.publicReference,
      reason: 'Duplicate settlement',
      status: 'completed',
      transferId: 'transfer-1',
    }, 50, 2_000)).toMatchObject({
      eligibleForReversal: false,
      reversalReason: 'Duplicate settlement',
      status: 'reversed',
    });
  });
});

function timestamp(value) {
  return { toMillis: () => value };
}
