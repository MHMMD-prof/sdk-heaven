const admin = require('firebase-admin');

const { normalizeAdminDailyLoginMutation } = require('../adminDailyLoginCore');
const { mutateAdminDailyLoginCampaign } = require('../adminDailyLoginService');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const actorUid = readArgument('--actor-uid');
  const apply = process.argv.includes('--apply');
  const template = developmentTemplate();
  console.info(JSON.stringify({
    actorUid,
    apply,
    liabilityPerSevenDayUser: template.rewards.reduce(
      (total, day) => total + day.reward.coins,
      0,
    ),
    rewards: template.rewards.map((day) => day.reward),
  }, null, 2));
  if (!apply) return;
  if (!isUid(actorUid)) throw new Error('--actor-uid is required with --apply.');

  const db = admin.firestore();
  const [ownerSnapshot, flagsSnapshot, currentSnapshot, draftSnapshot] = await db.getAll(
    db.doc(`adminProfiles/${actorUid}`),
    db.doc('appConfig/dailyLoginFeatures'),
    db.doc('dailyLoginCampaign/current'),
    db.doc('dailyLoginCampaign/draft'),
  );
  const owner = ownerSnapshot.exists ? ownerSnapshot.data() : undefined;
  if (!owner || owner.uid !== actorUid || owner.role !== 'owner' || owner.status !== 'active') {
    throw new Error('The actor must be an active Platform Owner.');
  }
  if (
    flagsSnapshot.data()?.daily_login_rewards === true
    || flagsSnapshot.data()?.daily_login_reward_items === true
  ) throw new Error('Daily Login flags must remain dark while publishing the development campaign.');
  if (currentSnapshot.exists || draftSnapshot.exists) {
    throw new Error('A Daily Login campaign already exists. Use the dashboard for subsequent revisions.');
  }
  const authUser = await admin.auth().getUser(actorUid);
  const input = normalizeAdminDailyLoginMutation({
    expectedRevision: 0,
    operation: 'publish',
    reason: 'Initial conservative Daily Login development campaign',
    requestId: 'daily_login_wave3_development_v1',
    template,
  });
  if (!input.ok) throw new Error(input.error);
  const result = await mutateAdminDailyLoginCampaign({
    clock: {
      nowMillis: () => Date.now(),
      timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
    },
    db,
    decodedToken: {
      adminRole: 'owner',
      email: authUser.email || '',
      uid: actorUid,
    },
    fieldValue: admin.firestore.FieldValue,
    input: input.value,
  });
  console.info(JSON.stringify({ applied: true, ...result }, null, 2));
}

function developmentTemplate() {
  const coins = [10, 15, 20, 25, 30, 40, 50];
  return {
    minimumClientVersion: '1.0.0',
    rewards: coins.map((amount, index) => ({
      day: index + 1,
      reward: {
        coins: amount,
        diamonds: 0,
        items: [],
        schemaVersion: 1,
      },
    })),
    schemaVersion: 1,
    timeZone: 'Asia/Baghdad',
  };
}

function isUid(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && !value.includes('/');
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

module.exports = { developmentTemplate };
