import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildRepresentativeRechargeOutbox,
  buildRepresentativeReversalOutbox,
  buildVipMigrationDryRun,
  buildVipProgressionMutation,
  buildVipReconciliationReport,
  calculateVipPointDelta,
  representativeRechargeEventId,
} = require('./statusProgressionCore');

describe('statusProgressionCore Wave 2', () => {
  it('creates deterministic coin-only recharge and linked reversal evidence', () => {
    const timestamp = { toMillis: () => 100 };
    expect(buildRepresentativeRechargeOutbox({
      amount: 25, currency: 'coins', recipientUid: 'user-1', timestamp, transferId: 'rep_request_1',
    })).toMatchObject({
      refId: 'representative_rep_request_1',
      data: { amount: 25, sourceKind: 'representative-recharge', uid: 'user-1' },
    });
    expect(buildRepresentativeReversalOutbox({
      amount: 25, currency: 'coins', recipientUid: 'user-1', timestamp, transferId: 'rep_request_1',
    })).toMatchObject({
      data: { reversalOf: 'representative_rep_request_1', sourceKind: 'representative-reversal' },
    });
    expect(buildRepresentativeRechargeOutbox({
      amount: 25, currency: 'diamonds', recipientUid: 'user-1', timestamp, transferId: 'rep_request_1',
    })).toBeNull();
  });

  it('uses exact integer arithmetic with a documented floor and signed reversals', () => {
    const policy = { pointsPerCoinNumerator: 3, pointsPerCoinDenominator: 2 };
    expect(calculateVipPointDelta(5, 'representative-recharge', policy)).toEqual({ ok: true, value: 7 });
    expect(calculateVipPointDelta(5, 'representative-reversal', policy)).toEqual({ ok: true, value: -7 });
    expect(calculateVipPointDelta(1, 'representative-recharge', { pointsPerCoinNumerator: 1, pointsPerCoinDenominator: 2 }))
      .toEqual({ ok: false, code: 'ZERO_POINT_EVENT' });
  });

  it('promotes and demotes by net points while retaining the highest reached level', () => {
    const timestamp = { toMillis: () => 100 };
    const promoted = buildVipProgressionMutation({
      account: null, catalog: vipCatalog(), eventId: 'event_1', pointDelta: 120, timestamp, uid: 'user-1',
    });
    expect(promoted).toMatchObject({
      ok: true,
      value: { account: { points: 120, levelId: 'svip-1', highestLevelOrder: 2 }, transition: { kind: 'promotion' } },
    });
    const demoted = buildVipProgressionMutation({
      account: promoted.value.account, catalog: vipCatalog(), eventId: 'event_2', pointDelta: -115, timestamp, uid: 'user-1',
    });
    expect(demoted).toMatchObject({
      ok: true,
      value: { account: { points: 5, levelId: null, highestLevelOrder: 2 }, transition: { kind: 'demotion' } },
    });
    expect(buildVipProgressionMutation({
      account: demoted.value.account, catalog: vipCatalog(), eventId: 'event_3', pointDelta: -6, timestamp, uid: 'user-1',
    })).toEqual({ ok: false, code: 'OVER_REVERSED' });
  });

  it('builds a deterministic, hashable migration preview from transfer facts only', () => {
    const input = {
      catalog: vipCatalog(),
      transfers: [
        { id: 'transfer_1', data: transfer({ amount: 30, recipientUid: 'user-1' }) },
        { id: 'transfer_2', data: transfer({ amount: 20, recipientUid: 'user-2' }) },
        { id: 'diamond_1', data: transfer({ amount: 999, currency: 'diamonds', recipientUid: 'user-1' }) },
      ],
      reversals: [{ id: 'transfer_1', data: reversal({ amount: 30, recipientUid: 'user-1', transferId: 'transfer_1' }) }],
    };
    const first = buildVipMigrationDryRun(input);
    const second = buildVipMigrationDryRun(input);
    expect(first).toMatchObject({
      ok: true,
      value: { clean: true, eventCount: 3, positiveEventCount: 2, reversalEventCount: 1, signedPointTotal: 20, pointsByUid: { 'user-1': 0, 'user-2': 20 } },
    });
    expect(first.value.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.value.snapshotHash).toBe(first.value.snapshotHash);
  });

  it('reports unmatched and mismatched reversals instead of guessing', () => {
    const result = buildVipMigrationDryRun({
      catalog: vipCatalog(),
      transfers: [{ id: 'transfer_1', data: transfer({ amount: 30, recipientUid: 'user-1' }) }],
      reversals: [
        { id: 'missing_1', data: reversal({ amount: 30, recipientUid: 'user-1', transferId: 'missing_1' }) },
        { id: 'transfer_1', data: reversal({ amount: 29, recipientUid: 'user-1', transferId: 'transfer_1' }) },
      ],
    });
    expect(result.value.clean).toBe(false);
    expect(result.value.errors.map((error) => error.kind)).toEqual(['reversal-mismatch', 'unmatched-reversal']);
  });

  it('finds account drift by recomputing only immutable contributions', () => {
    const positiveId = representativeRechargeEventId('transfer_1');
    const clean = buildVipReconciliationReport({
      catalog: vipCatalog(),
      contributions: [{ id: positiveId, data: contribution({ eventId: positiveId, pointDelta: 20 }) }],
      accounts: [{ id: 'user-1', data: account({ points: 20, levelId: 'vip-1', order: 1 }) }],
    });
    expect(clean.value).toMatchObject({ clean: true, signedPointTotal: 20, mismatches: [] });
    const drifted = buildVipReconciliationReport({
      catalog: vipCatalog(),
      contributions: [{ id: positiveId, data: contribution({ eventId: positiveId, pointDelta: 20 }) }],
      accounts: [{ id: 'user-1', data: account({ points: 999, levelId: 'svip-1', order: 2 }) }],
    });
    expect(drifted.value.clean).toBe(false);
    expect(drifted.value.mismatches).toHaveLength(1);
    expect(drifted.value.mismatches[0].expected).toMatchObject({ points: 20, levelId: 'vip-1' });
  });

  it('dry-runs a representative recharge load without count or point drift', () => {
    const transfers = Array.from({ length: 2_000 }, (_, index) => ({
      id: `load_transfer_${String(index).padStart(4, '0')}`,
      data: transfer({ amount: (index % 25) + 1, recipientUid: `user-${index % 200}` }),
    }));
    const reversals = transfers.filter((_, index) => index % 10 === 0).map((row) => ({
      id: row.id,
      data: reversal({
        amount: row.data.amount,
        recipientUid: row.data.recipientUid,
        transferId: row.id,
      }),
    }));
    const result = buildVipMigrationDryRun({ catalog: vipCatalog(), transfers, reversals });
    const gross = transfers.reduce((sum, row) => sum + row.data.amount, 0);
    const reversed = reversals.reduce((sum, row) => sum + row.data.amount, 0);
    expect(result.value).toMatchObject({
      clean: true,
      eventCount: transfers.length + reversals.length,
      positiveEventCount: transfers.length,
      reversalEventCount: reversals.length,
      userCount: 200,
      signedPointTotal: gross - reversed,
    });
  });
});

function vipCatalog() {
  return {
    schemaVersion: 1, catalogVersion: 'vip-wave2-test', kind: 'vip-svip', state: 'published',
    authoredBy: 'economy-admin', approvedBy: 'platform-owner', reason: 'Wave 2 tests',
    pointPolicy: {
      currency: 'coins', eligibleSources: ['representative-transfer'], pointsPerCoinNumerator: 1,
      pointsPerCoinDenominator: 1, reversalMode: 'linked-net', spendingMode: 'no-effect',
    },
    tiers: [
      { id: 'vip-1', band: 'vip', level: 1, order: 1, minPoints: 10, name: { ar: 'VIP 1', en: 'VIP 1' }, accentColor: '#D4AF37', benefits: [], assets: {} },
      { id: 'svip-1', band: 'svip', level: 1, order: 2, minPoints: 100, name: { ar: 'SVIP 1', en: 'SVIP 1' }, accentColor: '#22A978', benefits: [], assets: {} },
    ],
  };
}

function transfer(overrides = {}) {
  return { amount: 20, createdAt: { toMillis: () => 1 }, currency: 'coins', recipientUid: 'user-1', status: 'completed', ...overrides };
}
function reversal(overrides = {}) {
  return { amount: 20, createdAt: { toMillis: () => 2 }, currency: 'coins', recipientUid: 'user-1', status: 'completed', transferId: 'transfer_1', ...overrides };
}
function contribution(overrides = {}) {
  return {
    schemaVersion: 1, eventId: 'representative_transfer_1', uid: 'user-1', sourceId: 'transfer_1',
    policyVersion: 'vip-wave2-test', kind: 'representative-recharge', pointDelta: 20, settlementState: 'settled',
    ...overrides,
  };
}
function account(overrides = {}) {
  return {
    schemaVersion: 1, uid: 'user-1', catalogVersion: 'vip-wave2-test', points: 20,
    levelId: 'vip-1', band: 'vip', level: 1, order: 1, highestLevelOrder: 1, state: 'active',
    ...overrides,
  };
}
