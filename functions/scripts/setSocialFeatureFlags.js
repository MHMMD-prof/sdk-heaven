const admin = require('firebase-admin');

const { mergeSocialFeatureFlags, SOCIAL_FEATURE_FLAGS } = require('../socialProfileCore');

admin.initializeApp();

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));

  if (!options.actorUid) {
    throw new Error('--actor-uid is required.');
  }

  if (Object.keys(options.flags).length === 0) {
    throw new Error('At least one social feature flag must be provided.');
  }

  const actor = await admin.auth().getUser(options.actorUid);

  if (actor.customClaims?.admin !== true) {
    throw new Error('The selected actor must have the admin custom claim.');
  }

  const db = admin.firestore();
  const configRef = db.doc('appConfig/socialFeatures');

  if (options.dryRun) {
    const snapshot = await configRef.get();
    const before = mergeSocialFeatureFlags(snapshot.exists ? snapshot.data() : {});
    const flags = mergeSocialFeatureFlags(before, options.flags);
    console.info(JSON.stringify({ before, dryRun: true, flags }));
    return;
  }

  const auditRef = db.collection('adminAuditEvents').doc();
  const flags = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(configRef);
    const before = mergeSocialFeatureFlags(snapshot.exists ? snapshot.data() : {});
    const after = mergeSocialFeatureFlags(before, options.flags);
    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    transaction.set(configRef, { ...after, updatedAt: timestamp, updatedBy: actor.uid });
    transaction.create(auditRef, {
      action: 'set-social-feature-flags',
      actorEmail: actor.email || '',
      actorUid: actor.uid,
      before,
      changedFlags: Object.keys(options.flags),
      createdAt: timestamp,
      flags: after,
      kind: 'feature-flags',
      status: 'updated',
    });

    return after;
  });
  console.info(JSON.stringify({ auditId: auditRef.id, flags }));
}

function parseOptions(args) {
  const values = Object.fromEntries(args.filter((arg) => arg.startsWith('--') && arg.includes('='))
    .map((arg) => arg.slice(2).split(/=(.*)/s, 2)));
  const flags = {};

  for (const flag of SOCIAL_FEATURE_FLAGS) {
    if (!(flag in values)) {
      continue;
    }

    if (!['true', 'false'].includes(values[flag])) {
      throw new Error(`--${flag} must be true or false.`);
    }

    flags[flag] = values[flag] === 'true';
  }

  return {
    actorUid: values['actor-uid'] || '',
    dryRun: args.includes('--dry-run'),
    flags,
  };
}
