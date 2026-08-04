const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');
const { LAUNCH_STAGES, summarizeLaunchReadiness } = require('../voiceRoomLaunchCore');

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const stageArg = readArgument('--stage');
  const stageId = stageArg ? Number(stageArg) : undefined;
  if (stageArg && (!Number.isInteger(stageId) || !LAUNCH_STAGES.some((stage) => stage.id === stageId))) {
    throw new Error('--stage must identify a documented launch stage.');
  }
  const projectId = readArgument('--project') || resolveDefaultProjectId();
  if (!projectId) throw new Error('Pass --project or configure .firebaserc.');

  const { features, policy, source } = await readLaunchDocuments(projectId);
  const summary = summarizeLaunchReadiness(features, { policy });
  const payload = stageId
    ? {
        projectId,
        source,
        stage: summary.stages.find((entry) => entry.stage?.id === stageId),
        note: summary.note,
      }
    : {
        projectId,
        source,
        highestReadyStageId: summary.highestReadyStageId,
        broadReleaseReady: summary.broadReleaseReady,
        policy: summary.policy,
        flagStates: summary.flagStates,
        stages: summary.stages.map((entry) => ({
          id: entry.stage?.id,
          name: entry.stage?.name,
          ready: entry.ready === true,
          broadReleaseReady: entry.broadReleaseReady === true,
          blocked: ['STAGE_BLOCKED', 'STAGE_REJECTED'].includes(entry.code) ? entry.error : undefined,
          missingTrue: entry.missingTrue || [],
          leakingFalse: entry.leakingFalse || [],
          policyProblems: entry.policyProblems || [],
          missingEvidence: entry.missingEvidence || [],
        })),
        releaseSloTargets: summary.releaseSloTargets,
        note: summary.note,
      };
  console.info(JSON.stringify(payload, null, 2));
}

async function readLaunchDocuments(projectId) {
  try {
    if (!admin.apps.length) admin.initializeApp({ projectId });
    const db = admin.firestore();
    const [featureSnapshot, launchSnapshot] = await Promise.all([
      db.doc('appConfig/voiceRoomFeatures').get(),
      db.doc('appConfig/voiceRoomLaunch').get(),
    ]);
    return {
      features: featureSnapshot.exists ? featureSnapshot.data() : {},
      policy: launchSnapshot.exists ? launchSnapshot.data() : {},
      source: 'application-default-credentials',
    };
  } catch (adminError) {
    try {
      return await readWithFirebaseCliSession(projectId);
    } catch (cliError) {
      throw new Error(
        `Unable to read launch status with Application Default Credentials or the Firebase CLI session. `
        + `ADC: ${adminError.message}. Firebase CLI: ${cliError.message}.`,
      );
    }
  }
}

async function readWithFirebaseCliSession(projectId) {
  const auth = require('firebase-tools/lib/auth');
  const account = auth.getAllAccounts()[0];
  if (!account?.tokens?.refresh_token) throw new Error('Run firebase login first.');
  const token = await auth.getAccessToken(account.tokens.refresh_token, account.tokens.scopes);
  const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`
    + '/databases/(default)/documents/appConfig';
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const [featureResponse, launchResponse] = await Promise.all([
    fetch(`${base}/voiceRoomFeatures`, { headers }),
    fetch(`${base}/voiceRoomLaunch`, { headers }),
  ]);
  if (!featureResponse.ok || (!launchResponse.ok && launchResponse.status !== 404)) {
    throw new Error(`Firestore REST returned ${featureResponse.status}/${launchResponse.status}.`);
  }
  return {
    features: decodeFirestoreDocument(await featureResponse.json()),
    policy: launchResponse.status === 404 ? {} : decodeFirestoreDocument(await launchResponse.json()),
    source: 'firebase-cli-session',
  };
}

function decodeFirestoreDocument(document = {}) {
  return Object.fromEntries(
    Object.entries(document.fields || {}).map(([key, value]) => [key, decodeFirestoreValue(value)]),
  );
}

function decodeFirestoreValue(value = {}) {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if (value.mapValue) return decodeFirestoreDocument(value.mapValue);
  return undefined;
}

function resolveDefaultProjectId() {
  for (const candidate of [
    path.resolve(process.cwd(), '.firebaserc'),
    path.resolve(process.cwd(), '..', '.firebaserc'),
  ]) {
    if (!fs.existsSync(candidate)) continue;
    const config = JSON.parse(fs.readFileSync(candidate, 'utf8'));
    if (typeof config.projects?.default === 'string') return config.projects.default;
  }
  return '';
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}
