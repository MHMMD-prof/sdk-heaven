'use strict';

/**
 * Seed default VIP tier catalog at vipTier/{id}.
 *
 * Usage:
 *   node scripts/seedVipTierCatalog.js
 *   node scripts/seedVipTierCatalog.js --apply --actor-uid UID
 */

const admin = require('firebase-admin');
const { DEFAULT_VIP_TIERS, listDefaultVipCatalog } = require('../growthVipCore');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const apply = process.argv.includes('--apply');
  const actorUid = readArgument('--actor-uid');
  const catalog = listDefaultVipCatalog();
  console.info(JSON.stringify({
    apply,
    actorUid: actorUid || '',
    tiers: catalog.map((tier) => ({
      id: tier.id,
      minLifetimeCreditCoins: tier.minLifetimeCreditCoins,
      rank: tier.rank,
    })),
  }, null, 2));

  if (!apply) return;
  if (!actorUid) throw new Error('--actor-uid is required with --apply.');

  const db = admin.firestore();
  await requirePlatformOwner(db, actorUid);
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  for (const tier of DEFAULT_VIP_TIERS) {
    batch.set(db.doc(`vipTier/${tier.id}`), {
      accentColor: tier.accentColor,
      id: tier.id,
      minLifetimeCreditCoins: tier.minLifetimeCreditCoins,
      nameAr: tier.nameAr,
      rank: tier.rank,
      updatedAt: timestamp,
      updatedBy: actorUid,
    }, { merge: true });
  }
  await batch.commit();
  console.info(JSON.stringify({
    applied: true,
    paths: DEFAULT_VIP_TIERS.map((tier) => `vipTier/${tier.id}`),
  }, null, 2));
}

function readArgument(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

async function requirePlatformOwner(db, actorUid) {
  const profile = await db.doc(`adminProfiles/${actorUid}`).get();
  const role = profile.exists ? profile.data()?.role : '';
  if (role === 'owner') return;
  const user = await admin.auth().getUser(actorUid);
  if (user.customClaims?.admin !== true || user.customClaims?.adminRole !== 'owner') {
    throw new Error('Only a platform owner may seed the VIP tier catalog.');
  }
}
