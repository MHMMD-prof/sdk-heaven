const admin = require('firebase-admin');
const {
  resolveWeeklyIncentiveRolloutStage,
  validateWeeklyIncentiveStageTransition,
} = require('../weeklyIncentiveRolloutCore');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const stageId = Number(readArgument('--stage'));
  const actorUid = readArgument('--actor-uid');
  const apply = process.argv.includes('--apply');
  const acknowledgeEconomicImpact = process.argv.includes('--acknowledge-economic-impact');
  const requested = resolveWeeklyIncentiveRolloutStage(stageId);
  if (!requested) throw new Error('--stage must be 0 through 7.');
  const db = admin.firestore();
  const rolloutRef = db.doc('appRuntime/weeklyIncentiveRollout');
  const currentSnapshot = await rolloutRef.get();
  const currentStageId = Number.isInteger(currentSnapshot.data()?.stageId) ? currentSnapshot.data().stageId : 0;
  const validation = validateWeeklyIncentiveStageTransition({
    acknowledgeEconomicImpact,
    currentStageId,
    nextStageId: stageId,
  });
  if (!validation.ok) throw new Error(validation.code);
  console.info(JSON.stringify({ apply, currentStageId, requested }, null, 2));
  if (!apply) return;
  if (!actorUid) throw new Error('--actor-uid is required with --apply.');
  const owner = await db.doc(`adminProfiles/${actorUid}`).get();
  if (!owner.exists || owner.data()?.role !== 'owner' || owner.data()?.status !== 'active') {
    throw new Error('The actor must be an active Platform Owner.');
  }
  const requestId = `weekly_rollout_${currentStageId}_${stageId}_${Date.now()}`;
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(db.doc('appConfig/voiceRoomFeatures'), {
    ...requested.flags,
    updatedAt: timestamp,
    updatedBy: actorUid,
  }, { merge: true });
  batch.set(rolloutRef, {
    economic: requested.economic,
    previousStageId: currentStageId,
    stageId,
    stageName: requested.name,
    updatedAt: timestamp,
    updatedBy: actorUid,
  }, { merge: true });
  batch.create(db.doc(`adminAuditEvents/${requestId}`), {
    action: stageId === 0 ? 'weekly-incentive-rollback-dark' : 'weekly-incentive-rollout-stage',
    actorUid,
    createdAt: timestamp,
    entityId: String(stageId),
    entityType: 'system',
    id: requestId,
    kind: 'weekly-incentive-rollout',
    previousStageId: currentStageId,
    stageId,
    status: 'completed',
  });
  await batch.commit();
  console.info(JSON.stringify({ applied: true, stageId, stageName: requested.name }));
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}
