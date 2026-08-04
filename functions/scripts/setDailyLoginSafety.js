const admin = require('firebase-admin');

const OPERATIONS = Object.freeze([
  'emergency-disable',
  'emergency-enable',
  'hold-user',
  'release-user',
]);

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const db = admin.firestore();
  await requirePlatformOwner(db, options.actorUid);
  const auditRef = db.collection('adminAuditEvents').doc();
  await db.runTransaction(async (transaction) => {
    const actorRef = db.doc(`adminProfiles/${options.actorUid}`);
    const actorSnapshot = await transaction.get(actorRef);
    const actor = actorSnapshot.exists ? actorSnapshot.data() : undefined;
    if (!actor || actor.uid !== options.actorUid || actor.role !== 'owner' || actor.status !== 'active') {
      throw new Error('The actor must remain an active Platform Owner.');
    }
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    if (options.operation === 'emergency-disable' || options.operation === 'emergency-enable') {
      const campaignRef = db.doc('dailyLoginCampaign/current');
      const campaignSnapshot = await transaction.get(campaignRef);
      if (!campaignSnapshot.exists) throw new Error('The daily login campaign pointer does not exist.');
      const before = campaignSnapshot.data()?.emergencyDisabled === true;
      const emergencyDisabled = options.operation === 'emergency-disable';
      transaction.update(campaignRef, {
        emergencyDisabled,
        updatedAt: timestamp,
        updatedBy: options.actorUid,
      });
      transaction.create(auditRef, {
        action: `daily-login-${options.operation}`,
        actorUid: options.actorUid,
        after: { emergencyDisabled },
        before: { emergencyDisabled: before },
        createdAt: timestamp,
        entityId: 'current',
        entityType: 'system',
        kind: 'daily-login-campaign',
        reason: options.reason,
        requestId: options.requestId,
        status: 'completed',
      });
      return;
    }
    const restrictionRef = db.doc(`economyRestrictions/${options.targetUid}`);
    const restrictionSnapshot = await transaction.get(restrictionRef);
    const before = restrictionSnapshot.exists ? restrictionSnapshot.data() : {};
    const blocked = options.operation === 'hold-user';
    transaction.set(restrictionRef, {
      dailyLoginRewardsBlocked: blocked,
      dailyLoginRewardsReason: blocked ? options.reason : '',
      dailyLoginRewardsUpdatedAt: timestamp,
      dailyLoginRewardsUpdatedBy: options.actorUid,
      uid: options.targetUid,
    }, { merge: true });
    transaction.create(auditRef, {
      action: `daily-login-${options.operation}`,
      actorUid: options.actorUid,
      after: { blocked },
      before: { blocked: before.dailyLoginRewardsBlocked === true },
      createdAt: timestamp,
      entityId: options.targetUid,
      entityType: 'user',
      kind: 'daily-login-manual-hold',
      reason: options.reason,
      requestId: options.requestId,
      status: 'completed',
      targetUid: options.targetUid,
    });
  });
  console.info(JSON.stringify({
    applied: true,
    auditEventId: auditRef.id,
    operation: options.operation,
    targetUid: options.targetUid,
  }));
}

function parseOptions(args) {
  const operation = readArgument(args, '--operation');
  const actorUid = readArgument(args, '--actor-uid');
  const reason = readArgument(args, '--reason');
  const requestId = readArgument(args, '--request-id');
  const targetUid = readArgument(args, '--target-uid');
  if (!OPERATIONS.includes(operation)) throw new Error(`--operation must be one of: ${OPERATIONS.join(', ')}.`);
  if (!actorUid || actorUid.length > 128 || actorUid.includes('/')) throw new Error('--actor-uid is required.');
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(requestId)) throw new Error('--request-id must be 12-80 safe characters.');
  if (reason.length < 3 || reason.length > 300) throw new Error('--reason must be 3-300 characters.');
  const userOperation = operation === 'hold-user' || operation === 'release-user';
  if (userOperation && (!targetUid || targetUid.length > 128 || targetUid.includes('/'))) {
    throw new Error('--target-uid is required for user hold operations.');
  }
  if (!userOperation && targetUid) throw new Error('--target-uid is not used for emergency operations.');
  return { actorUid, operation, reason, requestId, targetUid };
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

module.exports = { OPERATIONS, parseOptions };
