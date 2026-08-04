import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  normalizeAdminWeeklyIncentiveIntegrityMutation,
  normalizeAdminWeeklyIncentiveReconciliation,
} = require('./adminWeeklyIncentiveIntegrityCore');
const { canAdminPerformAction } = require('./adminClaimsCore');

describe('weekly incentive integrity admin boundary', () => {
  it('requires exact IDs, idempotency, and a review reason', () => {
    expect(normalizeAdminWeeklyIncentiveIntegrityMutation({
      assessmentId: 'assessment-1',
      operation: 'approve-settlement',
      reason: 'Reviewed against source ledgers',
      requestId: 'request_123456789',
      settlementId: 'settlement-1',
    })).toMatchObject({ ok: true });
    expect(normalizeAdminWeeklyIncentiveIntegrityMutation({
      operation: 'resolve-alert',
      reason: 'ok',
      requestId: 'short',
    })).toMatchObject({ ok: false, status: 400 });
  });

  it('keeps dry runs easy while requiring reasons for apply', () => {
    expect(normalizeAdminWeeklyIncentiveReconciliation({
      apply: false,
      requestId: 'request_123456789',
    })).toMatchObject({ ok: true, value: { apply: false } });
    expect(normalizeAdminWeeklyIncentiveReconciliation({
      apply: true,
      requestId: 'request_123456789',
    })).toMatchObject({ ok: false });
  });

  it('permits read-only auditors but reserves mutations for incentive managers', () => {
    expect(canAdminPerformAction('auditor', 'weekly-incentive-integrity')).toBe(true);
    expect(canAdminPerformAction('auditor', 'weekly-incentive-integrity-mutate')).toBe(false);
    expect(canAdminPerformAction('owner', 'weekly-incentive-integrity-mutate')).toBe(true);
    expect(canAdminPerformAction('owner', 'weekly-incentive-reconcile')).toBe(true);
  });
});
