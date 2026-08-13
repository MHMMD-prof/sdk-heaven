'use strict';

const admin = require('firebase-admin');
const {
  assertCosmeticsDark,
  mapCosmeticsPresentationFlags,
  summarizeCosmeticsRolloutReadiness,
} = require('../cosmeticsRolloutCore');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const db = admin.firestore();
  const [flagsSnapshot, rolloutSnapshot] = await db.getAll(
    db.doc('appConfig/cosmeticsFeatures'),
    db.doc('appRuntime/cosmeticsRollout'),
  );
  const flags = mapCosmeticsPresentationFlags(
    flagsSnapshot.exists ? flagsSnapshot.data() : undefined,
  );
  const rollout = rolloutSnapshot.exists ? rolloutSnapshot.data() : null;
  const dark = assertCosmeticsDark(flags);
  const readiness = summarizeCosmeticsRolloutReadiness({
    flags,
    recordedStageName: typeof rollout?.stageName === 'string' ? rollout.stageName : 'dark',
  });
  const output = {
    dark: dark.ok,
    enablementPolicy: readiness.enablementPolicy,
    flags,
    readiness,
    rollout,
  };
  console.info(JSON.stringify(output, null, 2));
  if (process.argv.includes('--assert-dark') && !dark.ok) {
    throw new Error(`Cosmetics rollout is not dark. Enabled: ${dark.enabledFlags.join(', ')}`);
  }
}
