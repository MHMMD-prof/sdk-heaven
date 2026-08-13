'use strict';

/**
 * Enable all cosmetics presentation flags for closed/dev testing.
 *
 * Requires explicit --enable-all. Reversible with:
 *   npm run cosmetics:renderer:disable -- --apply --actor-uid <ownerUid>
 */

const admin = require('firebase-admin');
const { parseCosmeticsRendererOnArguments } = require('../cosmeticsRendererFlagsCore');
const { buildPreviousConfigSnapshot } = require('../bottomEffectStageRolloutCore');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const parsed = parseCosmeticsRendererOnArguments(process.argv.slice(2));
  if (!parsed.ok) throw new Error(parsed.error);
  const { actorUid, apply, patch, rolloutPatch } = parsed.value;
  console.info(JSON.stringify({
    actorUid: actorUid || '',
    apply,
    note: apply
      ? 'Enabling ALL cosmetics presentation flags for testing.'
      : 'Dry run only. Re-run with --enable-all --apply --actor-uid <platform-owner-uid>.',
    patch,
    rolloutPatch,
  }, null, 2));
  if (!apply) return;

  const db = admin.firestore();
  await requirePlatformOwner(db, actorUid);
  const configRef = db.doc('appConfig/cosmeticsFeatures');
  const rolloutRef = db.doc('appRuntime/cosmeticsRollout');
  const auditRef = db.collection('adminAuditEvents').doc();
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  await db.runTransaction(async (transaction) => {
    const beforeSnapshot = await transaction.get(configRef);
    const before = beforeSnapshot.exists ? beforeSnapshot.data() : {};
    transaction.set(configRef, {
      ...patch,
      ...rolloutPatch,
      updatedAt: timestamp,
      updatedBy: actorUid,
    }, { merge: true });
    transaction.set(rolloutRef, {
      previousStageName: beforeSnapshot.exists ? 'prior' : 'dark',
      stageId: 10,
      stageName: 'custom',
      updatedAt: timestamp,
      updatedBy: actorUid,
      writesCosmeticsFeatures: true,
      note: 'Dev enable-all; presentation flags set true',
    }, { merge: true });
    transaction.create(auditRef, {
      action: 'cosmetics-renderer-enable-all',
      actorUid,
      after: { ...patch, ...rolloutPatch },
      before: buildPreviousConfigSnapshot(before, { ...patch, ...rolloutPatch }),
      createdAt: timestamp,
      entityId: 'cosmeticsFeatures',
      entityType: 'system',
      kind: 'cosmetics-config',
      note: 'Closed/dev testing enable-all',
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
