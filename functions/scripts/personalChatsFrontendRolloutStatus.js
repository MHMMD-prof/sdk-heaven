const admin = require('firebase-admin');

const { mapPersonalChatsFrontendRollout } = require('../personalChatsFrontendRolloutCore');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const db = admin.firestore();
  const [rolloutSnapshot, socialSnapshot] = await db.getAll(
    db.doc('appConfig/personalChatsFrontendRollout'),
    db.doc('appConfig/socialFeatures'),
  );
  console.info(JSON.stringify({
    masterEnabled: socialSnapshot.data()?.personalChatsFrontendV2 === true,
    rollout: mapPersonalChatsFrontendRollout(rolloutSnapshot.exists ? rolloutSnapshot.data() : undefined),
  }, null, 2));
}
