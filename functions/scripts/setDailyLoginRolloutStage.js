const admin = require('firebase-admin');

const {
  mapDailyLoginCampaignPointer,
  mapDailyLoginCampaignVersion,
  resolveDailyLoginCampaignRevision,
} = require('../dailyLoginCore');
const {
  resolveDailyLoginRolloutStage,
  validateDailyLoginStageTransition,
} = require('../dailyLoginRolloutCore');

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
  const requested = resolveDailyLoginRolloutStage(stageId);
  if (!requested) throw new Error('--stage must be 0, 1, or 2.');
  const db = admin.firestore();
  const [rolloutSnapshot, campaignSnapshot, reconciliationSnapshot] = await Promise.all([
    db.doc('appRuntime/dailyLoginRollout').get(),
    db.doc('dailyLoginCampaign/current').get(),
    db.collection('adminAuditEvents')
      .where('kind', '==', 'daily-login-reconciliation')
      .limit(20)
      .get(),
  ]);
  const currentStageId = Number.isInteger(rolloutSnapshot.data()?.stageId)
    ? rolloutSnapshot.data().stageId
    : 0;
  const pointer = campaignSnapshot.exists
    ? mapDailyLoginCampaignPointer(campaignSnapshot.data())
    : undefined;
  let campaignReady = false;
  if (pointer?.ok) {
    const revision = resolveDailyLoginCampaignRevision(pointer.value, Date.now());
    const versionSnapshot = await campaignSnapshot.ref.collection('versions')
      .doc(String(revision))
      .get();
    const campaign = versionSnapshot.exists
      ? mapDailyLoginCampaignVersion(versionSnapshot.data())
      : undefined;
    campaignReady = Boolean(
      campaign?.ok
      && pointer.value.publicationStatus === 'published'
      && pointer.value.emergencyDisabled === false
      && (campaign.value.startsAtMillis === undefined || Date.now() >= campaign.value.startsAtMillis),
    );
  }
  const itemReconciliationReady = reconciliationSnapshot.docs.some((document) => {
    const data = document.data();
    return data.status === 'completed'
      && data.summary?.scanned > 0
      && data.summary?.discrepancies === 0
      && data.summary?.errors === 0;
  });
  const validation = validateDailyLoginStageTransition({
    acknowledgeEconomicImpact,
    campaignReady,
    currentStageId,
    itemReconciliationReady,
    nextStageId: stageId,
  });
  console.info(JSON.stringify({
    acknowledgeEconomicImpact,
    apply,
    campaignReady,
    currentStageId,
    itemReconciliationReady,
    requested,
  }, null, 2));
  if (!validation.ok) throw new Error(validation.code);
  if (!apply || currentStageId === stageId) return;
  if (!isUid(actorUid)) throw new Error('--actor-uid is required with --apply.');
  const owner = await db.doc(`adminProfiles/${actorUid}`).get();
  if (
    !owner.exists
    || owner.data()?.uid !== actorUid
    || owner.data()?.role !== 'owner'
    || owner.data()?.status !== 'active'
  ) throw new Error('The actor must be an active Platform Owner.');
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  const requestId = `daily_login_rollout_${currentStageId}_${stageId}_${Date.now()}`;
  const batch = db.batch();
  batch.set(db.doc('appConfig/dailyLoginFeatures'), {
    ...requested.flags,
    updatedAt: timestamp,
    updatedBy: actorUid,
  }, { merge: true });
  batch.set(db.doc('appRuntime/dailyLoginRollout'), {
    economic: requested.economic,
    flags: requested.flags,
    previousStageId: currentStageId,
    stageId,
    stageName: requested.name,
    updatedAt: timestamp,
    updatedBy: actorUid,
  }, { merge: true });
  batch.create(db.doc(`adminAuditEvents/${requestId}`), {
    action: stageId === 0 ? 'daily-login-rollback-dark' : 'daily-login-rollout-stage',
    actorRole: 'owner',
    actorUid,
    createdAt: timestamp,
    entityId: String(stageId),
    entityType: 'system',
    id: requestId,
    kind: 'daily-login-rollout',
    previousStageId: currentStageId,
    stageId,
    status: 'completed',
  });
  await batch.commit();
  console.info(JSON.stringify({ applied: true, stageId, stageName: requested.name }));
}

function isUid(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && !value.includes('/');
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}
