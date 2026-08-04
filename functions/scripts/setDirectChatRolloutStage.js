const admin = require('firebase-admin');

const { mapDirectChatFlags } = require('../directChatCore');
const {
  resolveDirectChatRolloutStage,
  resolveDirectChatStageFromFlags,
  validateDirectChatStageTransition,
} = require('../directChatRolloutCore');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const requested = resolveDirectChatRolloutStage(options.stageId);
  if (!requested) throw new Error('--stage must be 0, 1, 2, or 3.');
  const db = admin.firestore();
  const configRef = db.doc('appConfig/socialFeatures');
  const rolloutRef = db.doc('appRuntime/directChatRollout');
  const [configSnapshot, rolloutSnapshot] = await db.getAll(configRef, rolloutRef);
  const currentFlags = mapDirectChatFlags(configSnapshot.exists ? configSnapshot.data() : undefined);
  const resolvedCurrent = resolveDirectChatStageFromFlags(currentFlags);
  if (!resolvedCurrent) throw new Error('DIRECT_CHAT_FLAGS_UNSUPPORTED');
  const recordedStageId = rolloutSnapshot.data()?.stageId;
  const currentStageId = resolvedCurrent.stageId;
  const validation = validateDirectChatStageTransition({
    currentStageId,
    nextStageId: options.stageId,
  });
  console.info(JSON.stringify({
    actorUid: options.actorUid,
    apply: options.apply,
    currentFlags,
    currentStageId,
    recordedStageId: Number.isInteger(recordedStageId) ? recordedStageId : null,
    requested,
  }, null, 2));
  if (!validation.ok) throw new Error(validation.code);
  if (!options.apply || currentStageId === options.stageId) return;
  if (!options.actorUid) throw new Error('--actor-uid is required with --apply.');
  await requirePlatformOwner(db, options.actorUid);
  const auditRef = db.collection('adminAuditEvents').doc();
  await db.runTransaction(async (transaction) => {
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    transaction.set(configRef, {
      ...requested.flags,
      updatedAt: timestamp,
      updatedBy: options.actorUid,
    }, { merge: true });
    transaction.set(rolloutRef, {
      flags: requested.flags,
      previousStageId: currentStageId,
      stageId: requested.stageId,
      stageName: requested.name,
      updatedAt: timestamp,
      updatedBy: options.actorUid,
    }, { merge: true });
    transaction.create(auditRef, {
      action: requested.stageId === 0 ? 'direct-chat-rollback-dark' : 'direct-chat-rollout-stage',
      actorUid: options.actorUid,
      after: requested.flags,
      before: currentFlags,
      createdAt: timestamp,
      entityId: String(requested.stageId),
      entityType: 'system',
      kind: 'direct-chat-rollout',
      previousStageId: currentStageId,
      stageId: requested.stageId,
      status: 'completed',
    });
  });
  console.info(JSON.stringify({ applied: true, auditEventId: auditRef.id, stageId: requested.stageId }));
}

function parseOptions(args) {
  const stageValue = readArgument(args, '--stage');
  const stageId = Number(stageValue);
  if (!stageValue || !Number.isInteger(stageId)) throw new Error('--stage is required.');
  return {
    actorUid: readArgument(args, '--actor-uid'),
    apply: args.includes('--apply'),
    stageId,
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
