'use strict';

const admin = require('firebase-admin');
const { buildCosmeticAssetInventory } = require('../cosmeticsAssetMigrationCore');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  if (process.argv.includes('--apply') || process.argv.includes('--write')) {
    throw new Error('This Wave 1 command is inventory-only and never writes data.');
  }
  const db = admin.firestore();
  const collections = ['storeCatalog', 'giftCatalog', 'roomThemes', 'roomRocketCampaigns'];
  const snapshots = await Promise.all(collections.map((name) => db.collection(name).get()));
  const documents = snapshots.flatMap((snapshot, index) => snapshot.docs.map((document) => ({
    collection: collections[index],
    data: document.data(),
    id: document.id,
  })));
  const report = buildCosmeticAssetInventory(documents);
  console.info(JSON.stringify({ dryRun: true, ...report }, null, 2));
}
