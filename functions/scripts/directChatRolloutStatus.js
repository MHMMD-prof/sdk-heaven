const admin = require('firebase-admin');

const { mapDirectChatFlags } = require('../directChatCore');
const { resolveDirectChatStageFromFlags } = require('../directChatRolloutCore');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const db = admin.firestore();
  const [configSnapshot, rolloutSnapshot, restrictionSnapshot] = await Promise.all([
    db.doc('appConfig/socialFeatures').get(),
    db.doc('appRuntime/directChatRollout').get(),
    safeGet(() => db.collection('directChatRestrictions').where('state', '==', 'restricted').limit(100).get()),
  ]);
  const flags = mapDirectChatFlags(configSnapshot.exists ? configSnapshot.data() : undefined);
  const resolvedStage = resolveDirectChatStageFromFlags(flags);
  const output = {
    flags,
    restrictedAccountSampleCount: restrictionSnapshot?.size ?? null,
    rollout: rolloutSnapshot.exists ? rolloutSnapshot.data() : null,
    stage: resolvedStage || null,
  };
  console.info(JSON.stringify(output, null, 2));
  if (process.argv.includes('--assert-dark') && resolvedStage?.stageId !== 0) {
    throw new Error('Direct Chat rollout is not dark.');
  }
  if (!resolvedStage) throw new Error('Direct Chat flags are in an unsupported combination.');
}

async function safeGet(factory) {
  try {
    return await factory();
  } catch (error) {
    console.warn(`Restriction sample unavailable before index deployment: ${error.code || 'query-failed'}`);
    return null;
  }
}
