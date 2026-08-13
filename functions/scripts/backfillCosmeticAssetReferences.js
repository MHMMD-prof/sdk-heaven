'use strict';

const admin = require('firebase-admin');
const {
  MIGRATION_COLLECTIONS,
  buildApprovedRegistryIndex,
  buildCosmeticMigrationPatches,
  planCosmeticAssetReferenceMigration,
} = require('../cosmeticsMigrationCore');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const db = admin.firestore();
  if (options.apply) {
    await requirePlatformOwner(db, options.actorUid);
  }

  const registry = await loadApprovedRegistry(db, options.registryLimit);
  const documents = await loadMigrationDocuments(db, options);
  const plan = planCosmeticAssetReferenceMigration({ documents, registry });
  const patchResult = buildCosmeticMigrationPatches(plan, { apply: options.apply });

  console.info(JSON.stringify({
    actorUid: options.actorUid || '',
    apply: options.apply,
    dryRun: !options.apply,
    policy: 'dual-read-add-canonical-only; never delete immutable history or strip legacy URLs',
    registrySize: registry.byRef.size,
    summary: plan.summary,
    wouldWrite: patchResult.wouldWrite,
  }, null, 2));

  if (!options.apply) {
    console.info(JSON.stringify({
      samplePatches: patchResult.patches.slice(0, 25),
    }, null, 2));
    return;
  }

  const grouped = new Map();
  for (const item of patchResult.patches) {
    const key = `${item.collection}/${item.documentId}`;
    const existing = grouped.get(key) || {
      collection: item.collection,
      documentId: item.documentId,
      patch: {},
    };
    existing.patch = { ...existing.patch, ...item.patch };
    grouped.set(key, existing);
  }

  let written = 0;
  for (const item of grouped.values()) {
    const ref = db.collection(item.collection).doc(item.documentId);
    const snapshot = await ref.get();
    if (!snapshot.exists) continue;
    // Dotted update paths preserve sibling legacy URL fields (no top-level replace).
    const update = {
      cosmeticMigrationUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      cosmeticMigrationUpdatedBy: options.actorUid,
      ...item.patch,
    };
    await ref.update(update);
    written += 1;
    console.info(JSON.stringify({
      collection: item.collection,
      documentId: item.documentId,
      fields: Object.keys(item.patch),
      status: 'patched',
    }));
  }
  console.info(JSON.stringify({ applied: true, written }));
}

async function loadApprovedRegistry(db, limit) {
  const snapshot = await db.collection('cosmeticAssets')
    .where('publicationStatus', '==', 'published')
    .where('moderationStatus', '==', 'approved')
    .where('renderingEnabled', '==', true)
    .limit(limit)
    .get();
  const records = [];
  for (const document of snapshot.docs) {
    const summary = document.data();
    const versionId = String(summary.publishedVersionId || '');
    if (!versionId) continue;
    const [versionSnap, approvalSnap] = await Promise.all([
      document.ref.collection('versions').doc(versionId).get(),
      db.doc(`cosmeticAssetApprovals/${document.id}__${versionId}`).get(),
    ]);
    if (!versionSnap.exists || !approvalSnap.exists) continue;
    const version = versionSnap.data();
    const approval = approvalSnap.data();
    records.push({
      approvalChecksum: approval.checksum,
      approvalDecision: approval.decision,
      approvalId: summary.approvalId,
      approvedVersionId: summary.approvedVersionId,
      assetId: document.id,
      assetVersionId: versionId,
      moderationStatus: summary.moderationStatus,
      publicationStatus: summary.publicationStatus,
      publishedVersionId: summary.publishedVersionId,
      renderingEnabled: summary.renderingEnabled,
      sha256: version.sha256,
      storagePath: version.storagePath,
    });
  }
  return buildApprovedRegistryIndex(records);
}

async function loadMigrationDocuments(db, options) {
  const collections = options.collections;
  const documents = [];
  for (const collection of collections) {
    let query = db.collection(collection).orderBy(admin.firestore.FieldPath.documentId()).limit(options.batchSize);
    if (options.startAfter && collection === options.startCollection) {
      query = query.startAfter(options.startAfter);
    }
    const snapshot = await query.get();
    snapshot.docs.forEach((document) => {
      documents.push({
        collection,
        data: document.data(),
        id: document.id,
      });
    });
  }
  return documents.slice(0, options.limit);
}

function parseOptions(argv) {
  const apply = argv.includes('--apply');
  const actorUid = readArg(argv, '--actor-uid');
  if (apply && !actorUid) throw new Error('--actor-uid is required with --apply.');
  const collectionsArg = readArg(argv, '--collections');
  const collections = collectionsArg
    ? collectionsArg.split(',').map((value) => value.trim()).filter(Boolean)
    : [...MIGRATION_COLLECTIONS];
  for (const collection of collections) {
    if (!MIGRATION_COLLECTIONS.includes(collection)) {
      throw new Error(`Unsupported collection: ${collection}`);
    }
  }
  return {
    actorUid,
    apply,
    batchSize: positiveInt(readArg(argv, '--batch-size'), 100),
    collections,
    limit: positiveInt(readArg(argv, '--limit'), 500),
    registryLimit: positiveInt(readArg(argv, '--registry-limit'), 500),
    startAfter: readArg(argv, '--start-after'),
    startCollection: readArg(argv, '--start-collection') || collections[0],
  };
}

async function requirePlatformOwner(db, actorUid) {
  const snapshot = await db.doc(`adminProfiles/${actorUid}`).get();
  const profile = snapshot.exists ? snapshot.data() : null;
  if (!profile || profile.uid !== actorUid || profile.role !== 'owner' || profile.status !== 'active') {
    throw new Error('The actor must be an active Platform Owner.');
  }
}

function readArg(argv, name) {
  const index = argv.indexOf(name);
  if (index >= 0) return String(argv[index + 1] || '').trim();
  const prefix = `${name}=`;
  const match = argv.find((value) => String(value).startsWith(prefix));
  return match ? String(match).slice(prefix.length).trim() : '';
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
