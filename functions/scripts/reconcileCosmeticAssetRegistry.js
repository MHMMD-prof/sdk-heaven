'use strict';

/**
 * Owner script for cosmetic asset registry reconciliation.
 * Defaults to dry-run. `--apply --actor-uid` may disable invalid renderingEnabled assets.
 * Scheduled counterpart logs only (apply=false) and never mutates.
 */

const admin = require('firebase-admin');
const { reconcileCosmeticAssetRegistryBatch } = require('../adminCosmeticsAssetService');

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
  const result = await reconcileCosmeticAssetRegistryBatch({
    apply: options.apply,
    db,
    fieldValue: admin.firestore.FieldValue,
    limit: options.limit,
  });
  console.info(JSON.stringify({
    actorUid: options.actorUid || '',
    dryRun: !options.apply,
    ...result,
  }, null, 2));
}

function parseOptions(argv) {
  const apply = argv.includes('--apply');
  const actorUid = readArg(argv, '--actor-uid');
  if (apply && !actorUid) throw new Error('--actor-uid is required with --apply.');
  return {
    actorUid,
    apply,
    limit: positiveInt(readArg(argv, '--limit'), 100),
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
