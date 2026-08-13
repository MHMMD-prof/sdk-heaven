'use strict';

/**
 * Records Wave 10 cosmetics rollout stage metadata only.
 *
 * MUST NOT flip appConfig/cosmeticsFeatures presentation flags.
 * Enablement remains a later ops gate. Production-safe flag writes in this
 * pass are limited to setCosmeticsRendererFlags (force false).
 */

const admin = require('firebase-admin');
const {
  parseCosmeticsRolloutStageArguments,
  resolveCosmeticsRolloutStageByName,
  validateCosmeticsRolloutStageMetadataTransition,
} = require('../cosmeticsRolloutCore');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const parsed = parseCosmeticsRolloutStageArguments(process.argv.slice(2));
  if (!parsed.ok) throw new Error(parsed.error);
  const { actorUid, apply, stage } = parsed.value;
  const db = admin.firestore();
  const rolloutRef = db.doc('appRuntime/cosmeticsRollout');
  const rolloutSnapshot = await rolloutRef.get();
  const recordedName = typeof rolloutSnapshot.data()?.stageName === 'string'
    ? rolloutSnapshot.data().stageName
    : 'dark';
  const current = resolveCosmeticsRolloutStageByName(recordedName)
    || { stageId: 0, name: 'dark' };
  const validation = validateCosmeticsRolloutStageMetadataTransition({
    currentStageId: current.stageId,
    nextStageId: stage.stageId,
  });
  console.info(JSON.stringify({
    actorUid: actorUid || '',
    apply,
    currentStageId: current.stageId,
    currentStageName: current.name,
    requested: { name: stage.name, stageId: stage.stageId },
    writesCosmeticsFeatures: false,
  }, null, 2));
  if (!validation.ok) throw new Error(validation.code);
  if (!apply || current.stageId === stage.stageId) return;
  await requirePlatformOwner(db, actorUid);
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const auditRef = db.collection('adminAuditEvents').doc();
  await db.runTransaction(async (transaction) => {
    transaction.set(rolloutRef, {
      previousStageId: current.stageId,
      previousStageName: current.name,
      stageId: stage.stageId,
      stageName: stage.name,
      updatedAt: timestamp,
      updatedBy: actorUid,
      // Explicit: metadata only; presentation flags are not written here.
      writesCosmeticsFeatures: false,
    }, { merge: true });
    transaction.create(auditRef, {
      action: 'cosmetics-rollout-stage-metadata',
      actorUid,
      createdAt: timestamp,
      entityId: String(stage.stageId),
      entityType: 'system',
      kind: 'cosmetics-rollout',
      note: 'Metadata only; cosmeticsFeatures unchanged',
      previousStageId: current.stageId,
      stageId: stage.stageId,
      stageName: stage.name,
      status: 'completed',
      writesCosmeticsFeatures: false,
    });
  });
  console.info(JSON.stringify({
    applied: true,
    auditEventId: auditRef.id,
    stageId: stage.stageId,
    stageName: stage.name,
    writesCosmeticsFeatures: false,
  }));
}

async function requirePlatformOwner(db, actorUid) {
  const snapshot = await db.doc(`adminProfiles/${actorUid}`).get();
  const profile = snapshot.exists ? snapshot.data() : null;
  if (!profile || profile.uid !== actorUid || profile.role !== 'owner' || profile.status !== 'active') {
    throw new Error('The actor must be an active Platform Owner.');
  }
}

module.exports = { parseCosmeticsRolloutStageArguments };
