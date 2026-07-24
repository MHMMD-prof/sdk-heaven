const admin = require('firebase-admin');
const { ROOM_COUNTRY_CODES } = require('../roomCommandCore');

admin.initializeApp();

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const [actor, target] = await Promise.all([
    admin.auth().getUser(options.actorUid),
    admin.auth().getUser(options.targetUid),
  ]);
  if (actor.customClaims?.admin !== true || (actor.customClaims?.adminRole && actor.customClaims.adminRole !== 'owner')) {
    throw new Error('The actor must be a platform owner.');
  }
  if (target.customClaims?.admin !== true || target.customClaims?.adminRole !== 'super-moderator') {
    throw new Error('The target must already have the super-moderator custom claim.');
  }

  const result = {
    actorUid: actor.uid,
    dryRun: options.dryRun,
    regionCodes: options.regionCodes,
    status: options.regionCodes.length > 0 ? 'active' : 'pending',
    targetUid: target.uid,
  };
  if (options.dryRun) {
    console.info(JSON.stringify({ ...result, outcome: 'would-update' }));
    return;
  }

  const db = admin.firestore();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const requestId = `super_scope_${target.uid}_${Date.now()}`;
  const batch = db.batch();
  batch.set(db.doc(`adminProfiles/${target.uid}`), {
    regionCodes: options.regionCodes,
    role: 'super-moderator',
    status: result.status,
    uid: target.uid,
    updatedAt: timestamp,
    updatedBy: actor.uid,
  }, { merge: true });
  batch.create(db.doc(`adminAuditEvents/${requestId}`), {
    action: 'super-moderator-scope-update',
    actorEmail: actor.email || '',
    actorUid: actor.uid,
    after: { regionCodes: options.regionCodes, status: result.status },
    createdAt: timestamp,
    kind: 'administrator-security',
    source: 'operator-cli',
    status: 'completed',
    targetUid: target.uid,
  });
  await batch.commit();
  console.info(JSON.stringify({ ...result, outcome: 'updated', requestId }));
}

function parseOptions(args) {
  if (args.includes('--apply') && args.includes('--dry-run')) throw new Error('Choose either --apply or --dry-run.');
  const values = Object.fromEntries(args.filter((argument) => argument.startsWith('--') && argument.includes('='))
    .map((argument) => argument.slice(2).split(/=(.*)/s, 2)));
  const regionCodes = [...new Set(String(values.regions || '').split(',').map((value) => value.trim().toUpperCase()).filter(Boolean))];
  if (!values['actor-uid'] || !values['target-uid']) throw new Error('--actor-uid and --target-uid are required.');
  if (regionCodes.some((code) => !ROOM_COUNTRY_CODES.includes(code))) throw new Error('--regions contains an unsupported country code.');
  return {
    actorUid: values['actor-uid'],
    dryRun: !args.includes('--apply'),
    regionCodes,
    targetUid: values['target-uid'],
  };
}
