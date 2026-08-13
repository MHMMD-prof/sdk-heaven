'use strict';

const { buildVipMigrationDryRun, buildVipReconciliationReport } = require('../statusProgressionCore');
const { activeCatalogVersion } = require('../statusMembershipService');
const { verifyVipMigrationApplyState } = require('../statusMigrationCore');
const { readCollectionRows } = require('./dryRunVipContributionMigration');

if (require.main === module) {
  const admin = require('firebase-admin');
  admin.initializeApp();
  void main({ admin }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

async function main({ admin, args = process.argv.slice(2) }) {
  const options = parseOptions(args);
  const db = admin.firestore();
  const migration = await db.doc('statusOperations/migration').get();
  const evidence = migration.data();
  if (!migration.exists || evidence?.assessed !== true || evidence?.required !== true
    || !/^[a-f0-9]{64}$/.test(evidence?.snapshotHash || '')) throw new Error('MIGRATION_EVIDENCE_MISSING');
  const pointer = await db.doc('statusCatalogPointers/vip-svip').get();
  const catalogVersion = activeCatalogVersion(pointer.data(), 'vip-svip');
  if (!catalogVersion || catalogVersion !== evidence.catalogVersion) throw new Error('CATALOG_CHANGED');
  const catalog = await db.doc(`vipTierCatalogVersions/${catalogVersion}`).get();
  const [transfers, reversals, contributions, accounts] = await Promise.all([
    readCollectionRows({ admin, collectionName: 'representativeTransfers', db, maxDocs: options.maxDocs, pageSize: options.pageSize }),
    readCollectionRows({ admin, collectionName: 'representativeTransferReversals', db, maxDocs: options.maxDocs, pageSize: options.pageSize }),
    readCollectionRows({ admin, collectionName: 'vipContributions', db, maxDocs: options.maxDocs, pageSize: options.pageSize }),
    readCollectionRows({ admin, collectionName: 'vipAccounts', db, maxDocs: options.maxDocs, pageSize: options.pageSize }),
  ]);
  const truncated = [transfers, reversals, contributions, accounts].some((result) => result.truncated);
  if (truncated) throw new Error('MIGRATION_INPUT_TRUNCATED');
  const dryRun = buildVipMigrationDryRun({ catalog: catalog.data(), transfers: transfers.rows, reversals: reversals.rows });
  if (!dryRun.ok || !dryRun.value.clean || dryRun.value.snapshotHash !== evidence.snapshotHash) throw new Error('SNAPSHOT_MISMATCH');
  const reconciliation = buildVipReconciliationReport({ accounts: accounts.rows, catalog: catalog.data(), contributions: contributions.rows });
  if (!reconciliation.ok) throw new Error(reconciliation.code);
  const verified = verifyVipMigrationApplyState({
    accountCount: accounts.rows.length,
    contributionCount: contributions.rows.length,
    expectedEventCount: dryRun.value.eventCount,
    expectedUserCount: dryRun.value.userCount,
    reconciliation: reconciliation.value,
  });
  if (!verified.ok) throw new Error(verified.code);
  const report = { catalogVersion, snapshotHash: evidence.snapshotHash, ...verified.value };
  console.info(JSON.stringify({ mode: options.apply ? 'verify-and-record' : 'verify-only', ...report }, null, 2));
  if (options.apply) await db.doc('statusOperations/migration').set({ verified: true, verifiedAt: admin.firestore.FieldValue.serverTimestamp(), verification: report }, { merge: true });
  return report;
}

function parseOptions(args) {
  const apply = args.includes('--apply');
  const pageSize = bounded(readArgument(args, '--page-size') || '500', 1, 1_000, '--page-size');
  const maxDocs = bounded(readArgument(args, '--max-docs') || '100000', 1, 1_000_000, '--max-docs');
  const unknown = args.filter((argument) => argument !== '--apply' && !argument.startsWith('--page-size=') && !argument.startsWith('--max-docs='));
  if (unknown.length) throw new Error('UNKNOWN_ARGUMENT');
  return { apply, maxDocs, pageSize };
}

function bounded(value, min, max, label) { const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`INVALID_${label}`); return parsed; }
function readArgument(args, name) { const prefix = `${name}=`; return args.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim() || ''; }

module.exports = { main, parseOptions };
