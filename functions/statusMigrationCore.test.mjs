import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { buildVipMigrationWrites, migrationBatches, parseVipMigrationApplyOptions, verifyVipMigrationApplyState } = require('./statusMigrationCore');

describe('Wave 6 VIP migration apply contract', () => {
  it('defaults to a bounded non-writing preview', () => {
    expect(parseVipMigrationApplyOptions([])).toEqual({
      ok: true,
      value: { apply: false, batchSize: 200, catalogVersion: '', expectedHash: '', maxDocs: 100_000, pageSize: 500 },
    });
  });

  it('requires an exact dry-run hash before apply', () => {
    expect(parseVipMigrationApplyOptions(['--apply']).code).toBe('EXPECTED_HASH_REQUIRED');
    expect(parseVipMigrationApplyOptions(['--apply', `--expected-hash=${'a'.repeat(64)}`, '--batch-size=400']).value)
      .toMatchObject({ apply: true, batchSize: 400, expectedHash: 'a'.repeat(64) });
    expect(parseVipMigrationApplyOptions(['--unexpected']).code).toBe('UNKNOWN_ARGUMENT');
  });

  it('creates deterministic outbox writes only for the accepted snapshot', () => {
    const hash = 'b'.repeat(64);
    const report = { clean: true, snapshotHash: hash, events: [{
      eventId: 'representative_recharge_transfer-1', uid: 'user-1', sourceId: 'transfer-1',
      sourceKind: 'representative-recharge', amount: 1000, currency: 'coins', occurredAtMillis: 1700000000000,
    }] };
    expect(buildVipMigrationWrites(report, 'c'.repeat(64)).code).toBe('SNAPSHOT_MISMATCH');
    const writes = buildVipMigrationWrites(report, hash);
    expect(writes).toMatchObject({ ok: true, snapshotHash: hash, value: [{ id: 'representative_recharge_transfer-1', data: { state: 'queued' } }] });
    expect(migrationBatches([...writes.value, ...writes.value, ...writes.value], 2)).toHaveLength(2);
  });

  it('marks migration verified only after exact clean account and contribution reconciliation', () => {
    const reconciliation = { clean: true, truncated: false, accountCount: 2, contributionCount: 3, errors: [], mismatches: [] };
    expect(verifyVipMigrationApplyState({ accountCount: 2, contributionCount: 3, expectedEventCount: 3, expectedUserCount: 2, reconciliation }))
      .toMatchObject({ ok: true, value: { verified: true } });
    expect(verifyVipMigrationApplyState({ accountCount: 2, contributionCount: 2, expectedEventCount: 3, expectedUserCount: 2, reconciliation }).code)
      .toBe('MIGRATION_DRIFT');
  });
});
