'use strict';

/**
 * Apply Competitive Social Growth rollout stage (Wave 0 + Wave 1 flags).
 *
 * Writes:
 * - appRuntime/growthRollout (stage metadata)
 * - appConfig/growthFeatures (Wave 1+ flags; match/lucky bag from closed-beta)
 * - patches appConfig/socialFeatures and appConfig/voiceRoomFeatures for the
 *   bounded enablement set (push, gifts, rankings, shared music)
 *
 * Usage:
 *   node scripts/setGrowthRolloutStage.js --stage dark
 *   node scripts/setGrowthRolloutStage.js --stage closed-beta --actor-uid UID --apply
 */

const admin = require('firebase-admin');
const {
  buildGrowthStageFlagPatches,
  parseGrowthRolloutStageArguments,
  resolveGrowthRolloutStageByName,
  validateGrowthRolloutStageTransition,
} = require('../growthRolloutCore');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const parsed = parseGrowthRolloutStageArguments(process.argv.slice(2));
  if (!parsed.ok) throw new Error(parsed.error);
  const { actorUid, apply, stage } = parsed.value;
  const db = admin.firestore();
  const rolloutRef = db.doc('appRuntime/growthRollout');
  const rolloutSnapshot = await rolloutRef.get();
  const recordedName = typeof rolloutSnapshot.data()?.stageName === 'string'
    ? rolloutSnapshot.data().stageName
    : 'dark';
  const current = resolveGrowthRolloutStageByName(recordedName) || { id: 0, name: 'dark' };
  const validation = validateGrowthRolloutStageTransition({
    currentStageId: current.id,
    nextStageId: stage.id,
  });
  const patches = buildGrowthStageFlagPatches(stage);
  console.info(JSON.stringify({
    actorUid: actorUid || '',
    apply,
    currentStageId: current.id,
    currentStageName: current.name,
    patches,
    requested: { id: stage.id, name: stage.name },
  }, null, 2));
  if (!validation.ok) throw new Error(validation.code);
  if (!apply || validation.noop) return;

  await requirePlatformOwner(db, actorUid);
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const auditRef = db.collection('adminAuditEvents').doc();
  await db.runTransaction(async (transaction) => {
    transaction.set(rolloutRef, {
      previousStageId: current.id,
      previousStageName: current.name,
      stageId: stage.id,
      stageName: stage.name,
      updatedAt: timestamp,
      updatedBy: actorUid,
      writesFeatureFlags: true,
    }, { merge: true });
    transaction.set(db.doc('appConfig/growthFeatures'), {
      ...patches.growthFeatures,
      updatedAt: timestamp,
      updatedBy: actorUid,
    }, { merge: true });
    transaction.set(db.doc('appConfig/socialFeatures'), {
      ...patches.socialFeatures,
      updatedAt: timestamp,
      updatedBy: actorUid,
    }, { merge: true });
    transaction.set(db.doc('appConfig/voiceRoomFeatures'), {
      ...patches.voiceRoomFeatures,
      updatedAt: timestamp,
      updatedBy: actorUid,
    }, { merge: true });
    transaction.create(auditRef, {
      action: 'growth-rollout-stage',
      actorUid,
      createdAt: timestamp,
      entityId: String(stage.id),
      entityType: 'system',
      kind: 'growth-rollout',
      note: `Growth stage ${current.name} -> ${stage.name}`,
      previousStageId: current.id,
      stageId: stage.id,
      stageName: stage.name,
      status: 'completed',
      targetUid: 'appRuntime/growthRollout',
    });
  });
  console.info(JSON.stringify({ applied: true, stageId: stage.id, stageName: stage.name }, null, 2));
}

async function requirePlatformOwner(db, actorUid) {
  const profile = await db.doc(`adminProfiles/${actorUid}`).get();
  const role = profile.exists ? profile.data()?.role : '';
  if (role !== 'owner') {
    // Fall back to Auth claims when adminProfiles is sparse.
    const user = await admin.auth().getUser(actorUid);
    if (user.customClaims?.admin !== true || user.customClaims?.adminRole !== 'owner') {
      throw new Error('Only a platform owner may apply growth rollout stages.');
    }
  }
}
