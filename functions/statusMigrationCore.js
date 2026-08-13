'use strict';

const MIGRATION_SCHEMA_VERSION = 1;

function parseVipMigrationApplyOptions(args = []) {
  if (!Array.isArray(args)) return invalid('INVALID_ARGUMENTS');
  const apply = args.includes('--apply');
  const expectedHash = readArgument(args, '--expected-hash').toLowerCase();
  const catalogVersion = readArgument(args, '--catalog-version').toLowerCase();
  const batchSize = boundedInteger(readArgument(args, '--batch-size') || '200', 1, 400);
  const maxDocs = boundedInteger(readArgument(args, '--max-docs') || '100000', 1, 1_000_000);
  const pageSize = boundedInteger(readArgument(args, '--page-size') || '500', 1, 1_000);
  if (!batchSize || !maxDocs || !pageSize) return invalid('INVALID_BOUND');
  if (catalogVersion && !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(catalogVersion)) return invalid('INVALID_CATALOG_VERSION');
  if (apply && !/^[a-f0-9]{64}$/.test(expectedHash)) return invalid('EXPECTED_HASH_REQUIRED');
  if (!apply && expectedHash) return invalid('EXPECTED_HASH_WITHOUT_APPLY');
  const unknown = args.filter((argument) => argument !== '--apply'
    && !['--expected-hash=', '--catalog-version=', '--batch-size=', '--max-docs=', '--page-size=']
      .some((prefix) => argument.startsWith(prefix)));
  return unknown.length ? invalid('UNKNOWN_ARGUMENT') : {
    ok: true,
    value: { apply, batchSize, catalogVersion, expectedHash, maxDocs, pageSize },
  };
}

function buildVipMigrationWrites(report, expectedHash) {
  if (!report?.clean || !/^[a-f0-9]{64}$/.test(report.snapshotHash || '')
    || report.snapshotHash !== expectedHash || !Array.isArray(report.events)) return invalid('SNAPSHOT_MISMATCH');
  const writes = report.events.map((event) => {
    if (!validEvent(event)) return null;
    return {
      id: event.eventId,
      data: {
        schemaVersion: MIGRATION_SCHEMA_VERSION,
        eventId: event.eventId,
        uid: event.uid,
        sourceId: event.sourceId,
        sourceKind: event.sourceKind,
        amount: event.amount,
        currency: event.currency,
        occurredAtMillis: event.occurredAtMillis,
        ...(event.reversalOf ? { reversalOf: event.reversalOf } : {}),
        state: 'queued',
        attempts: 0,
      },
    };
  });
  if (writes.some((write) => !write)) return invalid('INVALID_EVENT');
  return { ok: true, snapshotHash: expectedHash, value: writes };
}

function verifyVipMigrationApplyState({ accountCount, contributionCount, expectedEventCount, expectedUserCount, reconciliation }) {
  if (![accountCount, contributionCount, expectedEventCount, expectedUserCount].every((value) => Number.isSafeInteger(value) && value >= 0)
    || !reconciliation || reconciliation.clean !== true || reconciliation.truncated === true
    || !Array.isArray(reconciliation.errors) || !Array.isArray(reconciliation.mismatches)) return invalid('RECONCILIATION_INVALID');
  if (reconciliation.errors.length || reconciliation.mismatches.length
    || contributionCount !== expectedEventCount || accountCount !== expectedUserCount
    || reconciliation.contributionCount !== expectedEventCount || reconciliation.accountCount !== expectedUserCount) {
    return invalid('MIGRATION_DRIFT');
  }
  return { ok: true, value: { accountCount, contributionCount, verified: true } };
}

function migrationBatches(writes, batchSize) {
  if (!Array.isArray(writes) || !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 400) return [];
  const batches = [];
  for (let index = 0; index < writes.length; index += batchSize) batches.push(writes.slice(index, index + batchSize));
  return batches;
}

function validEvent(event) {
  return event && typeof event.eventId === 'string' && event.eventId.length >= 3 && !event.eventId.includes('/')
    && typeof event.uid === 'string' && event.uid.length >= 1 && !event.uid.includes('/')
    && typeof event.sourceId === 'string' && event.sourceId.length >= 3 && !event.sourceId.includes('/')
    && ['representative-recharge', 'representative-reversal'].includes(event.sourceKind)
    && Number.isSafeInteger(event.amount) && event.amount > 0 && event.currency === 'coins'
    && Number.isSafeInteger(event.occurredAtMillis) && event.occurredAtMillis > 0
    && (!event.reversalOf || (typeof event.reversalOf === 'string' && !event.reversalOf.includes('/')));
}

function boundedInteger(value, min, max) { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : 0; }
function readArgument(args, name) { const prefix = `${name}=`; const found = args.find((value) => typeof value === 'string' && value.startsWith(prefix)); return found ? found.slice(prefix.length).trim() : ''; }
function invalid(code) { return { ok: false, code }; }

module.exports = { buildVipMigrationWrites, migrationBatches, parseVipMigrationApplyOptions, verifyVipMigrationApplyState };
