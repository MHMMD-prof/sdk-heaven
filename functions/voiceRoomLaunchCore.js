const CLIENT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CAPACITY_KILL_SWITCH = 'voice_room_new_joins';
const RECORDING_FLAG = 'voice_room_safety_recording';

const APPROVED_CAPABILITY_SEQUENCE = Object.freeze([
  Object.freeze(['voice_room_v2_read', 'voice_room_v2_mutations', 'voice_room_seats']),
  Object.freeze(['voice_room_command_center', 'voice_room_media']),
  Object.freeze(['voice_room_super_moderation']),
  Object.freeze(['voice_room_chat', 'voice_room_safety', 'voice_room_ownership_transfer']),
  Object.freeze(['voice_room_gifts', 'voice_room_entry_effects']),
  Object.freeze(['voice_room_games']),
  Object.freeze(['voice_room_shared_music']),
]);

const ALL_APPROVED_FLAGS = Object.freeze([...new Set(APPROVED_CAPABILITY_SEQUENCE.flat())]);
const CORE_STAGE_FLAGS = Object.freeze(APPROVED_CAPABILITY_SEQUENCE.slice(0, 4).flat());
const EXPANSION_STAGE_FLAGS = Object.freeze(APPROVED_CAPABILITY_SEQUENCE.slice(4).flat());
const BLOCKED_EXPANSION_FLAGS = Object.freeze([RECORDING_FLAG]);

const STAGE_CAPABILITY_DEPTH = Object.freeze({
  1: 1,
  2: 2,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  8: 7,
  10: 7,
});

const LAUNCH_STAGES = Object.freeze([
  stage(1, 'staff-only', 'Staff-only seat and presence validation.', ['staff', 'allowlist']),
  stage(2, 'internal-native-matrix', 'Internal Android/iOS Command Center and media matrix.', ['staff', 'allowlist']),
  stage(3, 'invited-cohort', 'Small explicit test cohort.', ['allowlist']),
  stage(4, 'one-region-core', 'Region-scoped moderation validation.', ['allowlist', 'region']),
  stage(5, 'chat-ownership', 'Chat, safety, and ownership validation.', ['allowlist', 'region']),
  stage(6, 'gifts-effects', 'Gift economy and entry-effect validation.', ['allowlist', 'region']),
  stage(7, 'games', 'Room-linked games validation.', ['allowlist', 'region']),
  stage(8, 'music', 'Shared-music validation for an explicitly restricted audience.', ['allowlist', 'region']),
  Object.freeze({
    id: 9,
    name: 'recording-rejected',
    description: 'Recording was rejected and cannot be launched.',
    rejected: true,
    blockedUntil: 'Product rejected room recording. This stage is permanently unavailable.',
    requiredTrue: Object.freeze([]),
    requiredFalse: Object.freeze([RECORDING_FLAG]),
    allowedAudienceModes: Object.freeze([]),
  }),
  stage(10, 'scale-out', 'Measured expansion to the public audience.', ['public']),
]);

const RELEASE_SLO_TARGETS = Object.freeze({
  crashFreeRoomSessionsPercent: 99.5,
  joinSuccessRatePercent: 98,
  reconnectSuccessRatePercent: 95,
  roomCommandP95Ms: 2500,
  effectQueueMax: 8,
  unresolvedDoubleSeatIncidents: 0,
  unresolvedDoubleOwnerIncidents: 0,
  unresolvedDuplicateWalletIncidents: 0,
  unresolvedCommissionRewriteIncidents: 0,
});

const REQUIRED_BROAD_RELEASE_EVIDENCE = Object.freeze([
  'automatedTestsPassed',
  'rulesVerified',
  'functionsVerified',
  'indexesReady',
  'recoveryHealthy',
  'androidMatrixPassed',
  'iosMatrixPassed',
  'loadTestPassed',
  'chaosTestPassed',
  'accessibilityPassed',
  'economyReconciled',
  'rollbackRehearsed',
  'productSignoff',
  'engineeringSignoff',
  'moderationOpsSignoff',
  'supportSignoff',
]);

const ALL_TRACKED_FLAGS = Object.freeze([
  ...ALL_APPROVED_FLAGS,
  RECORDING_FLAG,
  CAPACITY_KILL_SWITCH,
]);

function stage(id, name, description, allowedAudienceModes) {
  const depth = STAGE_CAPABILITY_DEPTH[id];
  const requiredTrue = APPROVED_CAPABILITY_SEQUENCE.slice(0, depth).flat();
  const requiredFalse = [
    ...ALL_APPROVED_FLAGS.filter((flag) => !requiredTrue.includes(flag)),
    RECORDING_FLAG,
  ];
  return Object.freeze({
    id,
    name,
    description,
    requiredTrue: Object.freeze(requiredTrue),
    requiredFalse: Object.freeze(requiredFalse),
    allowedAudienceModes: Object.freeze(allowedAudienceModes),
  });
}

function isFlagEnabled(features, flag) {
  if (flag === CAPACITY_KILL_SWITCH) return features?.[flag] !== false;
  return features?.[flag] === true;
}

function normalizeLaunchPolicy(policy = {}) {
  const allowedUids = uniqueStrings(policy.allowedUids, 200);
  const allowedRegionCodes = uniqueStrings(policy.allowedRegionCodes, 50)
    .map((value) => value.toUpperCase())
    .filter((value) => /^[A-Z]{2}$/.test(value));
  return {
    stageId: Number.isInteger(policy.stageId) ? policy.stageId : 0,
    status: ['testing', 'active', 'paused'].includes(policy.status) ? policy.status : 'disabled',
    audienceMode: ['staff', 'allowlist', 'region', 'public'].includes(policy.audienceMode)
      ? policy.audienceMode
      : '',
    allowedUids,
    allowedRegionCodes,
    minimumClientVersion: CLIENT_VERSION_PATTERN.test(policy.minimumClientVersion || '')
      ? policy.minimumClientVersion
      : '',
    recordingDecision: policy.recordingDecision === 'rejected' ? 'rejected' : '',
    broadReleaseReady: policy.broadReleaseReady === true,
    verification: isObject(policy.verification) ? policy.verification : {},
  };
}

function evaluateLaunchStage(features = {}, stageId, options = {}) {
  const launchStage = LAUNCH_STAGES.find((entry) => entry.id === stageId);
  if (!launchStage) return { ok: false, error: 'Unknown launch stage.', code: 'STAGE_UNKNOWN' };
  if (launchStage.rejected || launchStage.blockedUntil) {
    return {
      ok: false,
      code: launchStage.rejected ? 'STAGE_REJECTED' : 'STAGE_BLOCKED',
      error: launchStage.blockedUntil,
      stage: launchStage,
      ready: false,
      broadReleaseReady: false,
    };
  }

  const policy = normalizeLaunchPolicy(options.policy);
  const missingTrue = launchStage.requiredTrue.filter((flag) => !isFlagEnabled(features, flag));
  const leakingFalse = launchStage.requiredFalse.filter((flag) => isFlagEnabled(features, flag));
  const policyProblems = [];
  if (policy.stageId !== stageId) policyProblems.push('stage-policy-mismatch');
  if (!['testing', 'active'].includes(policy.status)) policyProblems.push('launch-policy-inactive');
  if (!launchStage.allowedAudienceModes.includes(policy.audienceMode)) policyProblems.push('audience-mode-invalid');
  if (['staff', 'allowlist'].includes(policy.audienceMode) && policy.allowedUids.length === 0) {
    policyProblems.push('audience-empty');
  }
  if (policy.audienceMode === 'region' && policy.allowedRegionCodes.length === 0) {
    policyProblems.push('regions-empty');
  }
  if (!policy.minimumClientVersion) policyProblems.push('minimum-client-version-missing');
  if (policy.recordingDecision !== 'rejected') policyProblems.push('recording-decision-missing');
  if (!isFlagEnabled(features, CAPACITY_KILL_SWITCH)) policyProblems.push('new-joins-paused');

  const missingEvidence = REQUIRED_BROAD_RELEASE_EVIDENCE
    .filter((field) => policy.verification?.[field] !== true);
  const ready = missingTrue.length === 0 && leakingFalse.length === 0 && policyProblems.length === 0;
  return {
    ok: true,
    stage: launchStage,
    policy,
    ready,
    broadReleaseReady: ready
      && stageId === 10
      && policy.broadReleaseReady
      && missingEvidence.length === 0,
    missingTrue,
    leakingFalse,
    policyProblems,
    missingEvidence,
    newJoinsAllowed: isFlagEnabled(features, CAPACITY_KILL_SWITCH),
  };
}

function summarizeLaunchReadiness(features = {}, options = {}) {
  const flagStates = {};
  for (const flag of ALL_TRACKED_FLAGS) {
    flagStates[flag] = { enabled: isFlagEnabled(features, flag), raw: features?.[flag] };
  }
  const stages = LAUNCH_STAGES.map((launchStage) =>
    evaluateLaunchStage(features, launchStage.id, options));
  const highestReady = [...stages].reverse().find((entry) => entry.ok && entry.ready);
  return {
    flagStates,
    stages,
    highestReadyStageId: highestReady?.stage?.id || 0,
    broadReleaseReady: stages.some((entry) => entry.broadReleaseReady === true),
    releaseSloTargets: RELEASE_SLO_TARGETS,
    policy: normalizeLaunchPolicy(options.policy),
    note: 'Read-only report. Controlled testing readiness is separate from broad-release evidence.',
  };
}

function evaluateVoiceRoomLaunchAccess({
  clientVersion = '',
  countryCode = '',
  decodedToken = {},
  policy,
  requireClientVersion = false,
}) {
  const normalized = normalizeLaunchPolicy(policy);
  if (!['testing', 'active'].includes(normalized.status) || normalized.stageId === 9) {
    return launchError('LAUNCH_DISABLED', 503, 'Voice-room access is not enabled.');
  }
  if (normalized.recordingDecision !== 'rejected') {
    return launchError('LAUNCH_POLICY_INVALID', 503, 'Voice-room launch policy is incomplete.');
  }
  if (requireClientVersion) {
    if (!CLIENT_VERSION_PATTERN.test(clientVersion)) {
      return launchError('CLIENT_VERSION_REQUIRED', 426, 'A supported app version is required.');
    }
    if (compareClientVersions(clientVersion, normalized.minimumClientVersion) < 0) {
      return launchError('CLIENT_UPGRADE_REQUIRED', 426, 'Update the app before joining voice rooms.');
    }
  }

  const uid = typeof decodedToken.uid === 'string' ? decodedToken.uid : '';
  const admin = decodedToken.admin === true;
  const explicitlyAllowed = normalized.allowedUids.includes(uid);
  const regionAllowed = normalized.allowedRegionCodes.includes(String(countryCode).toUpperCase());
  const publicAllowed = normalized.audienceMode === 'public'
    && normalized.stageId === 10
    && normalized.broadReleaseReady;
  const allowed = publicAllowed
    || admin
    || explicitlyAllowed
    || (normalized.audienceMode === 'region' && regionAllowed);
  return allowed
    ? { ok: true, policy: normalized }
    : launchError('LAUNCH_AUDIENCE_DENIED', 403, 'This test stage is limited to an approved audience.');
}

function compareClientVersions(left, right) {
  if (!CLIENT_VERSION_PATTERN.test(left || '') || !CLIENT_VERSION_PATTERN.test(right || '')) return -1;
  const l = left.split('-', 1)[0].split('.').map(Number);
  const r = right.split('-', 1)[0].split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (l[index] !== r[index]) return l[index] > r[index] ? 1 : -1;
  }
  return 0;
}

function uniqueStrings(value, limit) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === 'string')
    .map((item) => item.trim()).filter(Boolean))].slice(0, limit);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function launchError(code, status, error) {
  return { code, error, ok: false, status };
}

module.exports = {
  ALL_TRACKED_FLAGS,
  BLOCKED_EXPANSION_FLAGS,
  CAPACITY_KILL_SWITCH,
  CORE_STAGE_FLAGS,
  EXPANSION_STAGE_FLAGS,
  LAUNCH_STAGES,
  RELEASE_SLO_TARGETS,
  REQUIRED_BROAD_RELEASE_EVIDENCE,
  compareClientVersions,
  evaluateLaunchStage,
  evaluateVoiceRoomLaunchAccess,
  isFlagEnabled,
  normalizeLaunchPolicy,
  summarizeLaunchReadiness,
};
