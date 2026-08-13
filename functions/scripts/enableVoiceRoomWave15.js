const fs = require('node:fs');
const path = require('node:path');
const { LAUNCH_STAGES } = require('../voiceRoomLaunchCore');

const RECORDING_FLAG = 'voice_room_safety_recording';
const CAPACITY_FLAG = 'voice_room_new_joins';

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const apply = process.argv.includes('--apply');
  const actorUid = readArgument('--actor-uid');
  const projectId = readArgument('--project') || resolveDefaultProjectId();
  const minimumClientVersion = readArgument('--minimum-client-version') || '1.0.0';
  const audienceMode = readArgument('--audience') || 'allowlist';
  const stageId = audienceMode === 'public' ? 10 : 8;
  const stage = LAUNCH_STAGES.find((candidate) => candidate.id === stageId);
  const requestId = readArgument('--request-id')
    || `voice_room_wave15_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  const reason = readArgument('--reason') || 'Enable Wave 15 as a restricted stage 8 production test';
  const allowedUids = audienceMode === 'public'
    ? []
    : [...new Set(readArguments('--allow-uid').concat(actorUid).filter(Boolean))];
  const functionsVerified = process.argv.includes('--functions-verified');

  if (!projectId) throw new Error('Pass --project or configure .firebaserc.');
  if (apply && !actorUid) throw new Error('--actor-uid is required with --apply.');
  if (!['allowlist', 'public'].includes(audienceMode)) {
    throw new Error('--audience must be allowlist or public.');
  }
  if (audienceMode === 'allowlist' && allowedUids.length === 0) {
    throw new Error('Pass at least one --allow-uid for an allowlist audience.');
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(minimumClientVersion)) {
    throw new Error('--minimum-client-version must use semantic version form, such as 1.0.0.');
  }
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(requestId)) {
    throw new Error('--request-id must contain 8-160 letters, digits, underscores, or hyphens.');
  }

  const accessToken = await getFirebaseCliAccessToken();
  const featuresPath = 'appConfig/voiceRoomFeatures';
  const policyPath = 'appConfig/voiceRoomLaunch';
  const [featuresDocument, policyDocument] = await Promise.all([
    readDocument(projectId, featuresPath, accessToken),
    readDocument(projectId, policyPath, accessToken, true),
  ]);
  const beforeFeatures = decodeDocument(featuresDocument);
  const beforePolicy = decodeDocument(policyDocument);
  const featurePatch = Object.fromEntries(stage.requiredTrue.map((flag) => [flag, true]));
  featurePatch[RECORDING_FLAG] = false;
  featurePatch[CAPACITY_FLAG] = true;
  const policy = {
    stageId,
    status: 'testing',
    audienceMode,
    broadReleaseReady: false,
    allowedUids,
    allowedRegionCodes: [],
    minimumClientVersion,
    recordingDecision: 'rejected',
    verification: {
      automatedTestsPassed: true,
      rulesVerified: true,
      functionsVerified,
      indexesReady: true,
      recoveryHealthy: true,
      androidMatrixPassed: false,
      iosMatrixPassed: false,
      loadTestPassed: false,
      chaosTestPassed: false,
      accessibilityPassed: false,
      economyReconciled: false,
      rollbackRehearsed: false,
      productSignoff: false,
      engineeringSignoff: false,
      moderationOpsSignoff: false,
      supportSignoff: false,
    },
  };

  console.info(JSON.stringify({
    apply,
    projectId,
    requestId,
    actorUid: actorUid || '',
    reason,
    featurePatch,
    policy,
    previousStageId: beforePolicy.stageId || 0,
    note: audienceMode === 'public'
      ? 'Public access remains closed until broadReleaseReady is explicitly enabled. Recording remains rejected.'
      : 'Stage 8 is allowlist-only. Recording remains rejected. Broad public release remains blocked.',
  }, null, 2));
  if (!apply) return;

  const actor = decodeDocument(await readDocument(projectId, `adminProfiles/${actorUid}`, accessToken));
  if (actor.uid !== actorUid || actor.role !== 'owner' || actor.status !== 'active') {
    throw new Error('The actor must be an active Platform Owner.');
  }

  const auditPath = `adminAuditEvents/${requestId}`;
  const auditDocument = await readDocument(projectId, auditPath, accessToken, true);
  if (auditDocument) {
    const previous = decodeDocument(auditDocument);
    if (previous.action === 'voice-room-wave15-enable' && previous.actorUid === actorUid) {
      console.info(JSON.stringify({ applied: false, replayed: true, eventId: requestId }));
      return;
    }
    throw new Error('The request ID conflicts with an existing audit event.');
  }

  await commitDocuments(projectId, accessToken, [
    updateWrite(projectId, featuresPath, {
      ...featurePatch,
      updatedBy: actorUid,
    }, featuresDocument.updateTime, 'updatedAt'),
    updateWrite(projectId, policyPath, {
      ...policy,
      updatedBy: actorUid,
    }, policyDocument?.updateTime, 'updatedAt'),
    createWrite(projectId, auditPath, {
      action: 'voice-room-wave15-enable',
      actorEmail: actor.email || '',
      actorUid,
      after: { features: featurePatch, policy },
      before: { features: selectFields(beforeFeatures, Object.keys(featurePatch)), policy: beforePolicy },
      kind: 'settings',
      note: reason,
      requestId,
      source: 'operations-cli',
      status: 'completed',
      targetUid: policyPath,
    }, 'createdAt'),
  ]);
  console.info(JSON.stringify({
    applied: true,
    eventId: requestId,
    featurePath: featuresPath,
    policyPath,
  }));
}

function updateWrite(projectId, documentPath, fields, updateTime, timestampField) {
  return {
    update: {
      name: documentName(projectId, documentPath),
      fields: encodeMap(fields),
    },
    updateMask: {
      fieldPaths: Object.keys(fields),
    },
    updateTransforms: [{
      fieldPath: timestampField,
      setToServerValue: 'REQUEST_TIME',
    }],
    currentDocument: updateTime ? { updateTime } : { exists: false },
  };
}

function createWrite(projectId, documentPath, fields, timestampField) {
  return {
    update: {
      name: documentName(projectId, documentPath),
      fields: encodeMap(fields),
    },
    updateTransforms: [{
      fieldPath: timestampField,
      setToServerValue: 'REQUEST_TIME',
    }],
    currentDocument: { exists: false },
  };
}

async function commitDocuments(projectId, accessToken, writes) {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}`
    + '/databases/(default)/documents:commit';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ writes }),
  });
  if (!response.ok) throw new Error(`Firestore commit failed with ${response.status}: ${await response.text()}`);
}

async function readDocument(projectId, documentPath, accessToken, allowMissing = false) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/${documentName(projectId, documentPath)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore read failed for ${documentPath} with ${response.status}.`);
  return response.json();
}

async function getFirebaseCliAccessToken() {
  const auth = require('firebase-tools/lib/auth');
  const account = auth.getAllAccounts()[0];
  if (!account?.tokens?.refresh_token) throw new Error('Run firebase login first.');
  const token = await auth.getAccessToken(account.tokens.refresh_token, account.tokens.scopes);
  return token.access_token;
}

function documentName(projectId, documentPath) {
  return `projects/${projectId}/databases/(default)/documents/${documentPath}`;
}

function encodeMap(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)]));
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === 'object') return { mapValue: { fields: encodeMap(value) } };
  throw new Error(`Unsupported Firestore value type: ${typeof value}.`);
}

function decodeDocument(document) {
  return Object.fromEntries(
    Object.entries(document?.fields || {}).map(([key, value]) => [key, decodeValue(value)]),
  );
}

function decodeValue(value = {}) {
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if (value.arrayValue) return (value.arrayValue.values || []).map(decodeValue);
  if (value.mapValue) return decodeDocument(value.mapValue);
  return undefined;
}

function selectFields(source, fields) {
  return Object.fromEntries(fields.map((field) => [field, source?.[field]]));
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

function readArguments(name) {
  return process.argv.flatMap((argument, index) =>
    argument === name ? [String(process.argv[index + 1] || '').trim()] : []);
}
