'use strict';

const { buildVipMigrationDryRun } = require('../statusProgressionCore');
const { activeCatalogVersion } = require('../statusMembershipService');
const { buildVipMigrationWrites, migrationBatches, parseVipMigrationApplyOptions } = require('../statusMigrationCore');
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
  const parsed = parseVipMigrationApplyOptions(args);
  if (!parsed.ok) throw new Error(parsed.code);
  const options = parsed.value;
  const db = admin.firestore();
  const catalogVersion = options.catalogVersion || await readActiveCatalogVersion(db);
  const catalog = await db.doc(`vipTierCatalogVersions/${catalogVersion}`).get();
  if (!catalog.exists) throw new Error(`VIP/SVIP catalog not found: ${catalogVersion}`);
  const [transfers, reversals] = await Promise.all([
    readCollectionRows({ admin, collectionName: 'representativeTransfers', db, maxDocs: options.maxDocs, pageSize: options.pageSize }),
    readCollectionRows({ admin, collectionName: 'representativeTransferReversals', db, maxDocs: options.maxDocs, pageSize: options.pageSize }),
  ]);
  if (transfers.truncated || reversals.truncated) throw new Error('MIGRATION_INPUT_TRUNCATED');
  const report = buildVipMigrationDryRun({ catalog: catalog.data(), transfers: transfers.rows, reversals: reversals.rows });
  if (!report.ok) throw new Error(report.code);
  const summary = {
    mode: options.apply ? 'apply' : 'dry-run', catalogVersion, clean: report.value.clean,
    snapshotHash: report.value.snapshotHash, eventCount: report.value.eventCount, userCount: report.value.userCount,
    errorCount: report.value.errors.length,
  };
  if (!options.apply) {
    console.info(JSON.stringify({ ...summary, instruction: `Re-run with --apply --expected-hash=${report.value.snapshotHash}` }, null, 2));
    return summary;
  }
  const planned = buildVipMigrationWrites(report.value, options.expectedHash);
  if (!planned.ok) throw new Error(planned.code);
  let created = 0;
  let existing = 0;
  for (const writes of migrationBatches(planned.value, options.batchSize)) {
    const refs = writes.map((write) => db.doc(`statusSourceOutbox/${write.id}`));
    const snapshots = await db.getAll(...refs);
    const batch = db.batch();
    for (let index = 0; index < writes.length; index += 1) {
      const write = writes[index];
      const snapshot = snapshots[index];
      if (snapshot.exists) {
        const existingData = snapshot.data();
        if (existingData?.eventId !== write.data.eventId || existingData?.uid !== write.data.uid
          || existingData?.sourceId !== write.data.sourceId || existingData?.sourceKind !== write.data.sourceKind
          || existingData?.amount !== write.data.amount || existingData?.currency !== write.data.currency
          || (existingData?.reversalOf || '') !== (write.data.reversalOf || '')) {
          throw new Error(`MIGRATION_WRITE_CONFLICT:${write.id}`);
        }
        existing += 1;
      } else {
        batch.create(refs[index], {
          schemaVersion: write.data.schemaVersion,
          eventId: write.data.eventId,
          uid: write.data.uid,
          sourceId: write.data.sourceId,
          sourceKind: write.data.sourceKind,
          amount: write.data.amount,
          currency: write.data.currency,
          ...(write.data.reversalOf ? { reversalOf: write.data.reversalOf } : {}),
          state: write.data.state,
          attempts: write.data.attempts,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          nextAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        created += 1;
      }
    }
    await batch.commit();
  }
  await db.doc('statusOperations/migration').set({
    schemaVersion: 1, assessed: true, catalogVersion, snapshotHash: options.expectedHash, required: true,
    verified: false, userCount: report.value.userCount, eventCount: report.value.eventCount,
    created, existing, appliedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.info(JSON.stringify({ ...summary, created, existing, reconciliationRequired: true }, null, 2));
  return { ...summary, created, existing };
}

async function readActiveCatalogVersion(db) {
  const pointer = await db.doc('statusCatalogPointers/vip-svip').get();
  const version = activeCatalogVersion(pointer.data(), 'vip-svip');
  if (!version) throw new Error('CATALOG_UNAVAILABLE');
  return version;
}

module.exports = { main };
