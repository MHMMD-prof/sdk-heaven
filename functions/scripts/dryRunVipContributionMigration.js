'use strict';

const { buildVipMigrationDryRun } = require('../statusProgressionCore');
const { activeCatalogVersion } = require('../statusMembershipService');

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
  const catalogVersion = options.catalogVersion || await readActiveCatalogVersion(db);
  const catalogSnapshot = await db.doc(`vipTierCatalogVersions/${catalogVersion}`).get();
  if (!catalogSnapshot.exists) throw new Error(`VIP/SVIP catalog not found: ${catalogVersion}`);
  const [transfers, reversals] = await Promise.all([
    readCollectionRows({ admin, collectionName: 'representativeTransfers', db, maxDocs: options.maxDocs, pageSize: options.pageSize }),
    readCollectionRows({ admin, collectionName: 'representativeTransferReversals', db, maxDocs: options.maxDocs, pageSize: options.pageSize }),
  ]);
  if (transfers.truncated || reversals.truncated) {
    throw new Error('Migration input exceeded --max-docs; increase the bound and rerun the complete dry-run.');
  }
  const report = buildVipMigrationDryRun({
    catalog: catalogSnapshot.data(),
    transfers: transfers.rows,
    reversals: reversals.rows,
  });
  if (!report.ok) throw new Error(report.code);
  const output = {
    mode: 'dry-run-only',
    schemaVersion: report.value.schemaVersion,
    catalogVersion: report.value.catalogVersion,
    clean: report.value.clean,
    snapshotHash: report.value.snapshotHash,
    transferRecords: transfers.rows.length,
    reversalRecords: reversals.rows.length,
    eventCount: report.value.eventCount,
    positiveEventCount: report.value.positiveEventCount,
    reversalEventCount: report.value.reversalEventCount,
    userCount: report.value.userCount,
    signedPointTotal: report.value.signedPointTotal,
    errorCount: report.value.errors.length,
    errors: report.value.errors.slice(0, 100),
  };
  console.info(JSON.stringify(output, null, 2));
  if (!report.value.clean) process.exitCode = 2;
  return output;
}

async function readActiveCatalogVersion(db) {
  const pointer = await db.doc('statusCatalogPointers/vip-svip').get();
  const catalogVersion = activeCatalogVersion(pointer.data(), 'vip-svip');
  if (!catalogVersion) throw new Error('No active published VIP/SVIP catalog pointer is configured.');
  return catalogVersion;
}

async function readCollectionRows({ admin, collectionName, db, maxDocs, pageSize }) {
  const rows = [];
  let cursor = null;
  let truncated = false;
  while (rows.length <= maxDocs) {
    const remaining = maxDocs + 1 - rows.length;
    let query = db.collection(collectionName)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(Math.min(pageSize, remaining));
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    for (const document of snapshot.docs) rows.push({ id: document.id, data: document.data() });
    cursor = snapshot.docs.at(-1);
    if (snapshot.size < Math.min(pageSize, remaining)) break;
  }
  if (rows.length > maxDocs) {
    rows.length = maxDocs;
    truncated = true;
  }
  return { rows, truncated };
}

function parseOptions(args) {
  if (args.includes('--apply')) throw new Error('Wave 2 migration is dry-run-only. Applying data is a later approved rollout operation.');
  const pageSize = parseBoundedInteger(readArgument(args, '--page-size') || '500', '--page-size', 1, 1_000);
  const maxDocs = parseBoundedInteger(readArgument(args, '--max-docs') || '100000', '--max-docs', 1, 1_000_000);
  const catalogVersion = readArgument(args, '--catalog-version').toLowerCase();
  if (catalogVersion && !/^[a-z0-9][a-z0-9_-]{2,79}$/.test(catalogVersion)) {
    throw new Error('--catalog-version is invalid.');
  }
  return { catalogVersion, maxDocs, pageSize };
}

function parseBoundedInteger(value, name, min, max) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} through ${max}.`);
  }
  return parsed;
}

function readArgument(args, name) {
  const prefix = `${name}=`;
  const candidate = args.find((value) => value.startsWith(prefix));
  return candidate ? candidate.slice(prefix.length).trim() : '';
}

module.exports = { main, parseOptions, readCollectionRows };
