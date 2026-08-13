'use strict';

const admin = require('firebase-admin');
const {
  buildPreviousConfigSnapshot,
  parseBottomEffectStageRolloutArguments,
} = require('../bottomEffectStageRolloutCore');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const parsed = parseBottomEffectStageRolloutArguments(process.argv.slice(2));
  if (!parsed.ok) throw new Error(parsed.error);
  const { actorUid, apply, mode, patch } = parsed.value;
  console.info(JSON.stringify({ actorUid, apply, mode, patch }, null, 2));
  if (!apply) return;

  const db = admin.firestore();
  await requirePlatformOwner(db, actorUid);
  const configRef = db.doc('appConfig/cosmeticsFeatures');
  const auditRef = db.collection('adminAuditEvents').doc();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  await db.runTransaction(async (transaction) => {
    const beforeSnapshot = await transaction.get(configRef);
    const before = beforeSnapshot.exists ? beforeSnapshot.data() : {};
    transaction.set(configRef, { ...patch, updatedAt: timestamp, updatedBy: actorUid }, { merge: true });
    transaction.create(auditRef, {
      action: 'bottom-effect-stage-rollout',
      actorUid,
      after: patch,
      before: buildPreviousConfigSnapshot(before, patch),
      createdAt: timestamp,
      entityId: 'room_bottom_effect_stage',
      entityType: 'system',
      kind: 'cosmetics-config',
      note: `Bottom effect stage rollout set to ${mode}`,
      status: 'completed',
    });
  });
  console.info(JSON.stringify({ applied: true, auditEventId: auditRef.id }));
}

async function requirePlatformOwner(db, actorUid) {
  const snapshot = await db.doc(`adminProfiles/${actorUid}`).get();
  const profile = snapshot.exists ? snapshot.data() : null;
  if (!profile || profile.uid !== actorUid || profile.role !== 'owner' || profile.status !== 'active') {
    throw new Error('The actor must be an active Platform Owner.');
  }
}
