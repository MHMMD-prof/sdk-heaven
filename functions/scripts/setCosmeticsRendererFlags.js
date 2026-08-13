const admin = require('firebase-admin');
const { parseCosmeticsRendererOffArguments } = require('../cosmeticsRendererFlagsCore');
const { buildPreviousConfigSnapshot } = require('../bottomEffectStageRolloutCore');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const parsed = parseCosmeticsRendererOffArguments(process.argv.slice(2));
  if (!parsed.ok) throw new Error(parsed.error);
  const { actorUid, apply, patch, rolloutPatch } = parsed.value;
  console.info(JSON.stringify({ actorUid: actorUid || '', apply, patch, rolloutPatch }));
  if (!apply) return;

  const db = admin.firestore();
  await requirePlatformOwner(db, actorUid);
  const configRef = db.doc('appConfig/cosmeticsFeatures');
  const auditRef = db.collection('adminAuditEvents').doc();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const combinedPatch = { ...patch, ...rolloutPatch };
  await db.runTransaction(async (transaction) => {
    const beforeSnapshot = await transaction.get(configRef);
    const before = beforeSnapshot.exists ? beforeSnapshot.data() : {};
    transaction.set(configRef, {
      ...combinedPatch,
      updatedAt: timestamp,
      updatedBy: actorUid,
    }, { merge: true });
    transaction.create(auditRef, {
      action: 'cosmetics-renderer-disable',
      actorUid,
      after: combinedPatch,
      before: buildPreviousConfigSnapshot(before, combinedPatch),
      createdAt: timestamp,
      entityId: 'cosmeticsFeatures',
      entityType: 'system',
      kind: 'cosmetics-config',
      note: 'Emergency renderer and bottom-stage rollback',
      status: 'completed',
    });
  });
  console.info(JSON.stringify({ applied: true, auditEventId: auditRef.id, path: configRef.path }));
}

async function requirePlatformOwner(db, actorUid) {
  const snapshot = await db.doc(`adminProfiles/${actorUid}`).get();
  const profile = snapshot.exists ? snapshot.data() : null;
  if (!profile || profile.uid !== actorUid || profile.role !== 'owner' || profile.status !== 'active') {
    throw new Error('The actor must be an active Platform Owner.');
  }
}
