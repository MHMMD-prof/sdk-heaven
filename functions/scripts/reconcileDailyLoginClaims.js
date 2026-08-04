const admin = require('firebase-admin');

const { reconcileDailyLoginClaim } = require('../dailyLoginService');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const db = admin.firestore();
  if (options.apply) {
    if (!options.actorUid) throw new Error('--actor-uid is required with --apply.');
    await requirePlatformOwner(db, options.actorUid);
  }
  const claims = options.uid && options.dayId
    ? [{ dayId: options.dayId, uid: options.uid }]
    : await listClaims(db, options.limit);
  const results = [];
  for (const claim of claims) {
    results.push(await reconcileDailyLoginClaim({ db, ...claim }));
  }
  const summary = {
    balanced: results.filter((result) => result.balanced === true).length,
    discrepancies: results.flatMap((result) => result.discrepancies || []).length,
    errors: results.filter((result) => result.errorCode).length,
    scanned: results.length,
  };
  console.info(JSON.stringify({ apply: options.apply, results, summary }));
  if (!options.apply) return;
  await db.collection('adminAuditEvents').add({
    action: 'daily-login-reconciliation',
    actorUid: options.actorUid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    entityId: 'daily-login',
    entityType: 'economy',
    kind: 'daily-login-reconciliation',
    status: summary.discrepancies === 0 && summary.errors === 0 ? 'completed' : 'attention-required',
    summary,
  });
}

async function listClaims(db, limit) {
  const snapshot = await db.collectionGroup('days')
    .where('kind', '==', 'daily-login-claim')
    .limit(limit)
    .get();
  return snapshot.docs.flatMap((document) => {
    const parts = document.ref.path.split('/');
    return parts.length === 4 && parts[0] === 'dailyLoginClaims' && parts[2] === 'days'
      ? [{ dayId: parts[3], uid: parts[1] }]
      : [];
  });
}

function parseOptions(args) {
  const limitValue = Number(readArgument(args, '--limit') || 100);
  if (!Number.isSafeInteger(limitValue) || limitValue < 1 || limitValue > 500) {
    throw new Error('--limit must be an integer from 1 through 500.');
  }
  const uid = readArgument(args, '--uid');
  const dayId = readArgument(args, '--day-id');
  if (Boolean(uid) !== Boolean(dayId)) throw new Error('--uid and --day-id must be provided together.');
  if (uid && (uid.length > 128 || uid.includes('/'))) throw new Error('--uid is invalid.');
  if (dayId && !/^day_\d{4}-\d{2}-\d{2}_asia-baghdad$/.test(dayId)) {
    throw new Error('--day-id is invalid.');
  }
  return {
    actorUid: readArgument(args, '--actor-uid'),
    apply: args.includes('--apply'),
    dayId,
    limit: limitValue,
    uid,
  };
}

async function requirePlatformOwner(db, actorUid) {
  const snapshot = await db.doc(`adminProfiles/${actorUid}`).get();
  const profile = snapshot.exists ? snapshot.data() : undefined;
  if (!profile || profile.uid !== actorUid || profile.role !== 'owner' || profile.status !== 'active') {
    throw new Error('The actor must be an active Platform Owner.');
  }
}

function readArgument(args, name) {
  const prefix = `${name}=`;
  const candidate = args.find((value) => value.startsWith(prefix));
  return candidate ? candidate.slice(prefix.length).trim() : '';
}

module.exports = { listClaims, parseOptions };
