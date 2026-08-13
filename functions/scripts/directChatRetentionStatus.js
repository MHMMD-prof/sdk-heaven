const admin = require('firebase-admin');

const {
  DIRECT_CHAT_RETENTION_POLICY_PATH,
  DIRECT_CHAT_RETENTION_SWEEP_PATH,
  mapDirectChatRetentionPolicy,
  resolveDirectChatRetentionCutoffs,
} = require('../directChatRetentionCore');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const db = admin.firestore();
  const nowMs = Date.now();
  const [policySnapshot, sweepSnapshot, pendingSnapshot, holdSnapshot] = await Promise.all([
    db.doc(DIRECT_CHAT_RETENTION_POLICY_PATH).get(),
    db.doc(DIRECT_CHAT_RETENTION_SWEEP_PATH).get(),
    safeGet(() => db.collectionGroup('evidence').where('evidenceMediaState', '==', 'pending').limit(100).get()),
    safeGet(() => db.collection('directChatReports').where('legalHold', '==', true).limit(100).get()),
  ]);
  const policy = mapDirectChatRetentionPolicy(policySnapshot.exists ? policySnapshot.data() : undefined);
  const cutoffs = resolveDirectChatRetentionCutoffs({ nowMs, policy });
  console.info(JSON.stringify({
    legalHoldCaseSampleCount: holdSnapshot?.size ?? null,
    messageCutoff: new Date(cutoffs.messageCutoffMs).toISOString(),
    pendingEvidenceCopySampleCount: pendingSnapshot?.size ?? null,
    policy,
    sweep: sweepSnapshot.exists ? sweepSnapshot.data() : null,
  }, null, 2));
}

async function safeGet(factory) {
  try {
    return await factory();
  } catch (error) {
    console.warn(`Sample unavailable before index deployment: ${error.code || 'query-failed'}`);
    return null;
  }
}
