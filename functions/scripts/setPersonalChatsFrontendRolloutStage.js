const admin = require('firebase-admin');

const {
  mapPersonalChatsFrontendRollout,
  resolvePersonalChatsFrontendStage,
  validatePersonalChatsFrontendTransition,
} = require('../personalChatsFrontendRolloutCore');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const requested = resolvePersonalChatsFrontendStage(options.stage, options);
  if (!requested) throw new Error('ROLLOUT_CONFIGURATION_INVALID');
  const db = admin.firestore();
  const rolloutRef = db.doc('appConfig/personalChatsFrontendRollout');
  const socialRef = db.doc('appConfig/socialFeatures');
  const [rolloutSnapshot, socialSnapshot] = await db.getAll(rolloutRef, socialRef);
  const current = mapPersonalChatsFrontendRollout(rolloutSnapshot.exists ? rolloutSnapshot.data() : undefined);
  const currentMasterEnabled = socialSnapshot.data()?.personalChatsFrontendV2 === true;
  const validation = validatePersonalChatsFrontendTransition({ currentStageId: current.stageId, nextStageId: requested.rollout.stageId });
  if (!validation.ok) throw new Error(validation.code);
  console.info(JSON.stringify({ actorUid: options.actorUid, apply: options.apply, current, currentMasterEnabled, requested }, null, 2));
  const unchanged = current.stageId === requested.rollout.stageId
    && current.percentage === requested.rollout.percentage
    && current.salt === requested.rollout.salt
    && currentMasterEnabled === requested.masterEnabled;
  if (!options.apply || unchanged) return;
  if (!options.actorUid) throw new Error('--actor-uid is required with --apply.');
  await requirePlatformOwner(db, options.actorUid);
  const auditRef = db.collection('adminAuditEvents').doc();
  await db.runTransaction(async (transaction) => {
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    transaction.set(rolloutRef, { ...requested.rollout, updatedAt: timestamp, updatedBy: options.actorUid });
    transaction.set(socialRef, { personalChatsFrontendV2: requested.masterEnabled, updatedAt: timestamp, updatedBy: options.actorUid }, { merge: true });
    transaction.create(auditRef, {
      action: requested.rollout.stage === 'off' ? 'personal-chats-frontend-rollback' : 'personal-chats-frontend-rollout',
      actorUid: options.actorUid,
      after: requested.rollout,
      before: current,
      createdAt: timestamp,
      entityId: requested.rollout.stage,
      entityType: 'system',
      kind: 'personal-chats-frontend-rollout',
      status: 'completed',
    });
  });
  console.info(JSON.stringify({ applied: true, auditEventId: auditRef.id, stage: requested.rollout.stage }));
}

function parseOptions(args) {
  const stage = readArgument(args, '--stage');
  const percentageValue = readArgument(args, '--percentage');
  return {
    actorUid: readArgument(args, '--actor-uid'),
    apply: args.includes('--apply'),
    percentage: percentageValue ? Number(percentageValue) : 0,
    salt: readArgument(args, '--salt'),
    stage,
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

module.exports = { parseOptions };
