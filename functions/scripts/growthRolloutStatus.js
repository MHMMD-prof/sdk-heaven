'use strict';

const admin = require('firebase-admin');
const { summarizeGrowthRolloutReadiness } = require('../growthRolloutCore');
const { readGrowthTelemetry } = require('../growthTelemetryCore');

admin.initializeApp();
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const db = admin.firestore();
  const [rollout, social, voice, growth, telemetry] = await Promise.all([
    db.doc('appRuntime/growthRollout').get(),
    db.doc('appConfig/socialFeatures').get(),
    db.doc('appConfig/voiceRoomFeatures').get(),
    db.doc('appConfig/growthFeatures').get(),
    readGrowthTelemetry({ db }),
  ]);
  const readiness = summarizeGrowthRolloutReadiness({
    growthFeatures: growth.exists ? growth.data() : {},
    recordedStageName: rollout.exists ? rollout.data()?.stageName : 'dark',
    socialFeatures: social.exists ? social.data() : {},
    voiceRoomFeatures: voice.exists ? voice.data() : {},
  });
  console.info(JSON.stringify({
    readiness,
    rollout: rollout.exists ? rollout.data() : { stageId: 0, stageName: 'dark' },
    telemetry,
  }, null, 2));
}
