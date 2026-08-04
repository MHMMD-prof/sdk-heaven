const admin = require('firebase-admin');

const { normalizeAdminRoomRocketMutation } = require('../adminRoomRocketCore');
const { mutateAdminRoomRocketCampaign } = require('../adminRoomRocketService');
const { normalizeAdminRoomTargetMutation } = require('../adminRoomTargetCore');
const { mutateAdminRoomTargetCampaign } = require('../adminRoomTargetService');

const OWNER_UID = 'loVyyTeaNOQTJNSaNyOgtrVTB622';

admin.initializeApp();

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  if (!process.argv.includes('--apply')) {
    throw new Error('Publishing development defaults requires explicit --apply.');
  }
  const db = admin.firestore();
  const ownerProfile = await db.doc(`adminProfiles/${OWNER_UID}`).get();
  if (
    !ownerProfile.exists
    || ownerProfile.data()?.role !== 'owner'
    || ownerProfile.data()?.status !== 'active'
  ) {
    throw new Error('The configured Platform Owner is not active.');
  }
  const owner = await admin.auth().getUser(OWNER_UID);
  const decodedToken = { email: owner.email || '', uid: OWNER_UID };
  const fieldValue = admin.firestore.FieldValue;
  const clock = {
    nowMillis: () => Date.now(),
    timestampFromMillis: (value) => admin.firestore.Timestamp.fromMillis(value),
  };

  const [rocketSnapshot, targetSnapshot] = await db.getAll(
    db.doc('roomRocketCampaign/current'),
    db.doc('roomTargetCampaign/current'),
  );
  if (rocketSnapshot.exists || targetSnapshot.exists) {
    throw new Error(
      'A Rocket or Room Target campaign already exists. Use the dashboard for subsequent revisions.',
    );
  }

  const rocketInput = requireValid(normalizeAdminRoomRocketMutation({
    expectedRevision: 0,
    operation: 'save-draft',
    reason: 'Initial conservative development defaults',
    requestId: 'wave10_defaults_rocket_v1',
    template: {
      appearance: {
        name: { ar: 'الصاروخ الأسبوعي', en: 'Weekly Rocket' },
      },
      enabledRankCount: 3,
      minimumClientVersion: '1.0.0',
      rewards: {
        1: reward(10_000),
        2: reward(5_000),
        3: reward(2_500),
      },
      targetSupportPoints: 500_000,
      timeZone: 'Asia/Baghdad',
    },
  }), 'Rocket draft');
  const rocket = await mutateAdminRoomRocketCampaign({
    clock,
    db,
    decodedToken,
    fieldValue,
    input: rocketInput,
  });

  const targetInput = requireValid(normalizeAdminRoomTargetMutation({
    expectedRevision: 0,
    operation: 'publish',
    reason: 'Initial conservative development defaults',
    requestId: 'wave10_defaults_target_v1',
    template: {
      conversion: {
        denominator: 1,
        numerator: 1,
        payoutCurrency: 'coins',
        rounding: 'floor',
        sourceCurrency: 'coins',
      },
      eligibleGiftRules: {
        committedOnly: true,
        excludeSelfGifts: true,
        minimumDebitedCoins: 10,
      },
      enabled: true,
      maxSelectedUsers: 3,
      perRoomReturnCap: 30_000,
      perUserReturnCap: 10_000,
      returnBps: 500,
      riskValuation: {
        diamondValueCoins: 100,
        itemValuesCoins: {},
      },
      targetSupportPoints: 500_000,
      timeZone: 'Asia/Baghdad',
    },
  }), 'Room Target campaign');
  const target = await mutateAdminRoomTargetCampaign({
    clock,
    db,
    decodedToken,
    fieldValue,
    input: targetInput,
  });

  console.info(JSON.stringify({
    rocket: {
      publicationStatus: 'draft',
      rewards: { 1: 10_000, 2: 5_000, 3: 2_500 },
      revision: rocket.revision,
      targetSupportPoints: 500_000,
    },
    target: {
      effectiveFromCycleId: target.effectiveFromCycleId,
      maxSelectedUsers: 3,
      perRoomReturnCap: 30_000,
      perUserReturnCap: 10_000,
      publicationStatus: 'published',
      returnBps: 500,
      revision: target.revision,
      riskSnapshot: target.riskSnapshot,
      targetSupportPoints: 500_000,
    },
  }, null, 2));
}

function reward(coins) {
  return {
    coins,
    diamonds: 0,
    items: [],
    schemaVersion: 1,
  };
}

function requireValid(result, label) {
  if (!result.ok) throw new Error(`${label} is invalid: ${result.error}`);
  return result.value;
}
