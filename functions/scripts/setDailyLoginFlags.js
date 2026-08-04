const admin = require('firebase-admin');

const DAILY_LOGIN_FLAGS = Object.freeze({
  daily_login_reward_items: false,
  daily_login_rewards: false,
});

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const patch = {
    daily_login_reward_items: options.items,
    daily_login_rewards: options.rewards,
  };
  console.info(JSON.stringify({
    actorUid: options.actorUid,
    apply: options.apply,
    patch,
  }));
  if (!options.apply) return;
  if (!options.actorUid) throw new Error('--actor-uid is required with --apply.');
  const db = admin.firestore();
  await requirePlatformOwner(db, options.actorUid);
  const configRef = db.doc('appConfig/dailyLoginFeatures');
  const auditRef = db.collection('adminAuditEvents').doc();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(configRef);
    const before = snapshot.exists
      ? {
          daily_login_reward_items: snapshot.data()?.daily_login_reward_items === true,
          daily_login_rewards: snapshot.data()?.daily_login_rewards === true,
        }
      : DAILY_LOGIN_FLAGS;
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    transaction.set(configRef, {
      ...patch,
      updatedAt: timestamp,
      updatedBy: options.actorUid,
    }, { merge: true });
    transaction.create(auditRef, {
      action: 'daily-login-feature-flags-update',
      actorUid: options.actorUid,
      after: patch,
      before,
      createdAt: timestamp,
      entityId: 'dailyLoginFeatures',
      entityType: 'system',
      kind: 'daily-login-config',
      status: 'completed',
    });
  });
  console.info(JSON.stringify({ applied: true, auditEventId: auditRef.id }));
}

function parseOptions(args) {
  return {
    actorUid: readArgument(args, '--actor-uid'),
    apply: args.includes('--apply'),
    items: readBooleanArgument(args, '--items', false),
    rewards: readBooleanArgument(args, '--rewards', false),
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

function readBooleanArgument(args, name, fallback) {
  const value = readArgument(args, name);
  if (!value) return fallback;
  if (!['true', 'false'].includes(value)) throw new Error(`${name} must be true or false.`);
  return value === 'true';
}

module.exports = { DAILY_LOGIN_FLAGS, parseOptions };
