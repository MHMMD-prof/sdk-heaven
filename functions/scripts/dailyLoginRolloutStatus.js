const admin = require('firebase-admin');

const {
  mapDailyLoginCampaignPointer,
  mapDailyLoginCampaignVersion,
  resolveDailyLoginCampaignRevision,
} = require('../dailyLoginCore');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const db = admin.firestore();
  const [flagsSnapshot, currentSnapshot, rolloutSnapshot] = await db.getAll(
    db.doc('appConfig/dailyLoginFeatures'),
    db.doc('dailyLoginCampaign/current'),
    db.doc('appRuntime/dailyLoginRollout'),
  );
  const flags = {
    daily_login_reward_items: flagsSnapshot.data()?.daily_login_reward_items === true,
    daily_login_rewards: flagsSnapshot.data()?.daily_login_rewards === true,
  };
  const pointer = currentSnapshot.exists
    ? mapDailyLoginCampaignPointer(currentSnapshot.data())
    : undefined;
  let campaign = null;
  let effectiveRevision = 0;
  if (pointer?.ok) {
    effectiveRevision = resolveDailyLoginCampaignRevision(pointer.value, Date.now());
    const versionSnapshot = await currentSnapshot.ref.collection('versions')
      .doc(String(effectiveRevision))
      .get();
    const mapped = versionSnapshot.exists
      ? mapDailyLoginCampaignVersion(versionSnapshot.data())
      : undefined;
    campaign = mapped?.ok ? mapped.value : null;
  }
  const claims = await safeGet(() => db.collectionGroup('days')
    .where('kind', '==', 'daily-login-claim')
    .limit(500)
    .get());
  const output = {
    campaign,
    campaignPointer: pointer?.ok ? pointer.value : null,
    claimSampleCount: claims?.size ?? null,
    effectiveRevision,
    flags,
    rollout: rolloutSnapshot.exists ? rolloutSnapshot.data() : null,
  };
  console.info(JSON.stringify(output, null, 2));
  if (
    process.argv.includes('--assert-dark')
    && (flags.daily_login_rewards || flags.daily_login_reward_items)
  ) throw new Error('Daily Login rollout is not dark.');
  if (process.argv.includes('--assert-campaign-ready') && !isCampaignReady(pointer, campaign)) {
    throw new Error('Daily Login campaign is not active and ready.');
  }
}

async function safeGet(factory) {
  try {
    return await factory();
  } catch (error) {
    console.warn(`Claim sample unavailable before index deployment: ${error.code || 'query-failed'}`);
    return null;
  }
}

function isCampaignReady(pointer, campaign) {
  return Boolean(
    pointer?.ok
    && pointer.value.publicationStatus === 'published'
    && pointer.value.emergencyDisabled === false
    && campaign
    && (campaign.startsAtMillis === undefined || Date.now() >= campaign.startsAtMillis),
  );
}
