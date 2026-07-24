const admin = require('firebase-admin');

const {
  analyzeWalletDocument,
  buildWalletDocument,
} = require('../socialWalletCore');
const { isTimestampLike } = require('../socialProfileCore');

admin.initializeApp();

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (!options.actorUid) throw new Error('--actor-uid is required.');
  const actor = await admin.auth().getUser(options.actorUid);
  if (actor.customClaims?.admin !== true) throw new Error('The selected actor must have the admin custom claim.');

  const db = admin.firestore();
  const documents = await scanWallets(db, options);
  const analyses = documents.map((document) => ({
    analysis: analyzeWalletDocument(document.data(), document.id),
    document,
  }));
  const invalid = analyses.filter(({ analysis }) => !analysis.ok);
  invalid.forEach(({ analysis, document }) => console.warn(JSON.stringify({
    code: analysis.code,
    status: 'invalid-wallet',
    uid: document.id,
  })));
  if (!options.dryRun && invalid.length > 0) {
    throw new Error('Wallet preflight failed. Resolve every invalid wallet before using --apply.');
  }

  let migrated = 0;
  let ready = 0;
  for (const { analysis, document } of analyses) {
    if (!analysis.ok) continue;
    if (analysis.status === 'ready') {
      ready += 1;
      console.info(JSON.stringify({ status: 'ready', uid: document.id }));
      continue;
    }
    if (options.dryRun) {
      migrated += 1;
      console.info(JSON.stringify({ balances: analysis.wallet.balances, status: 'would-migrate', uid: document.id }));
      continue;
    }
    const result = await migrateWallet(db, actor, document.id);
    if (result === 'migrated') migrated += 1;
    else ready += 1;
    console.info(JSON.stringify({ status: result, uid: document.id }));
  }

  console.info(JSON.stringify({
    cursor: documents.at(-1)?.id || options.startAfter,
    dryRun: options.dryRun,
    invalid: invalid.length,
    migrated,
    ready,
    scanned: documents.length,
  }));
}

async function scanWallets(db, options) {
  const documents = [];
  let cursor = options.startAfter;
  while (documents.length < options.limit) {
    const remaining = options.limit - documents.length;
    let query = db.collection('walletSummaries')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(Math.min(options.batchSize, remaining));
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    documents.push(...snapshot.docs);
    cursor = snapshot.docs.at(-1).id;
    if (snapshot.size < Math.min(options.batchSize, remaining)) break;
  }
  return documents;
}

async function migrateWallet(db, actor, uid) {
  return db.runTransaction(async (transaction) => {
    const walletRef = db.doc(`walletSummaries/${uid}`);
    const auditRef = db.doc(`adminAuditEvents/wallet_schema_${uid}`);
    const [walletSnapshot, auditSnapshot] = await Promise.all([
      transaction.get(walletRef),
      transaction.get(auditRef),
    ]);
    if (auditSnapshot.exists) return 'ready';
    if (!walletSnapshot.exists) return 'ready';
    const analysis = analyzeWalletDocument(walletSnapshot.data(), uid);
    if (!analysis.ok) throw new Error(`Wallet ${uid} became invalid after preflight.`);
    if (analysis.status === 'ready') return 'ready';
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    transaction.set(walletRef, buildWalletDocument(analysis.wallet, {
      createdAt: isTimestampLike(walletSnapshot.data().createdAt) ? walletSnapshot.data().createdAt : timestamp,
      updatedAt: timestamp,
    }));
    transaction.create(auditRef, {
      action: 'wallet-schema-migrate',
      actorEmail: actor.email || '',
      actorUid: actor.uid,
      balances: analysis.wallet.balances,
      createdAt: timestamp,
      kind: 'economy',
      status: 'completed',
      targetUid: uid,
    });
    return 'migrated';
  });
}

function parseOptions(args) {
  if (args.includes('--apply') && args.includes('--dry-run')) throw new Error('Choose either --apply or --dry-run, not both.');
  const values = Object.fromEntries(args.filter((argument) => argument.startsWith('--') && argument.includes('='))
    .map((argument) => argument.slice(2).split(/=(.*)/s, 2)));
  const limit = Number(values.limit || 500);
  const batchSize = Number(values['batch-size'] || 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('--limit must be an integer from 1 to 10000.');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error('--batch-size must be an integer from 1 to 100.');
  return {
    actorUid: values['actor-uid'] || '',
    batchSize,
    dryRun: !args.includes('--apply'),
    limit,
    startAfter: values['start-after'] || '',
  };
}
