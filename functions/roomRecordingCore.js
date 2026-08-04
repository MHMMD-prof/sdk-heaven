/**
 * Wave 13 rolling safety recording — governance control plane (fail-closed).
 * LiveKit audio egress is attempted only when output is configured; otherwise
 * evidence records stay explicit about missing/partial audio so staff never
 * assume bytes exist.
 */

const { createHash } = require('node:crypto');

const ROOM_RECORDING_ACTIONS = Object.freeze([
  'get-recording-status',
  'acknowledge-recording-notice',
  'ensure-rolling-session',
  'stop-rolling-session',
  'preserve-for-report',
  'set-legal-hold',
  'request-playback',
]);

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const FIRESTORE_ID_PATTERN = /^[^/]{1,128}$/;

const RECORDING_POLICY_VERSION = 'safety-recording-v1';
const ROLLING_WINDOW_MS = 5 * 60 * 1000;
const PRE_REPORT_WINDOW_MS = 5 * 60 * 1000;
const POST_REPORT_WINDOW_MS = 60 * 1000;
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const LEGAL_HOLD_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const SEGMENT_TTL_MS = ROLLING_WINDOW_MS;

function roomRecordingError(code, status, error, details) {
  return {
    ok: false,
    code,
    status,
    error,
    ...(details ? { details } : {}),
  };
}

function normalizeRoomRecordingBody(body = {}) {
  return {
    action: typeof body.action === 'string' ? body.action.trim() : '',
    evidenceId: typeof body.evidenceId === 'string' ? body.evidenceId.trim() : '',
    legalHold: body.legalHold === true,
    noticeVersion: typeof body.noticeVersion === 'string' ? body.noticeVersion.trim() : '',
    reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 240) : '',
    reportId: typeof body.reportId === 'string' ? body.reportId.trim() : '',
    requestId: typeof body.requestId === 'string' ? body.requestId.trim() : '',
    roomId: typeof body.roomId === 'string' ? body.roomId.trim() : '',
    sessionId: typeof body.sessionId === 'string' ? body.sessionId.trim() : '',
  };
}

function validateRoomRecordingRequest(command) {
  if (!ROOM_RECORDING_ACTIONS.includes(command.action) || !FIRESTORE_ID_PATTERN.test(command.roomId)) {
    return roomRecordingError('INVALID_REQUEST', 400, 'A valid room recording command is required.');
  }
  if (!REQUEST_ID_PATTERN.test(command.requestId)) {
    return roomRecordingError('INVALID_REQUEST', 400, 'A valid request ID is required.');
  }
  if (command.action === 'acknowledge-recording-notice' && command.noticeVersion !== RECORDING_POLICY_VERSION) {
    return roomRecordingError('NOTICE_STALE', 409, 'Acknowledge the current recording policy version.');
  }
  if (command.action === 'preserve-for-report' && !FIRESTORE_ID_PATTERN.test(command.reportId)) {
    return roomRecordingError('INVALID_REQUEST', 400, 'A valid report ID is required.');
  }
  if (
    (command.action === 'set-legal-hold' || command.action === 'request-playback')
    && !FIRESTORE_ID_PATTERN.test(command.evidenceId)
  ) {
    return roomRecordingError('INVALID_REQUEST', 400, 'A valid evidence ID is required.');
  }
  if (command.action === 'set-legal-hold' && !command.reason) {
    return roomRecordingError('INVALID_REQUEST', 400, 'A reason is required for legal hold changes.');
  }
  return { ok: true, value: command };
}

function requireRecordingFlag(featureFlags) {
  if (featureFlags?.voice_room_safety_recording !== true) {
    return roomRecordingError('FEATURE_DISABLED', 503, 'Safety recording is not enabled.');
  }
  return { ok: true };
}

function createRecordingSessionId(roomId, requestId) {
  const digest = createHash('sha256')
    .update(`recording-session:${roomId}:${requestId}`)
    .digest('hex')
    .slice(0, 24);
  return `rrs_${digest}`;
}

function createEvidenceId(roomId, reportId) {
  const digest = createHash('sha256')
    .update(`room-evidence:${roomId}:${reportId}`)
    .digest('hex')
    .slice(0, 24);
  return `rev_${digest}`;
}

function buildRoomRecordingFingerprint(uid, command) {
  return createHash('sha256')
    .update([
      uid,
      command.action,
      command.roomId,
      command.sessionId || '',
      command.reportId || '',
      command.evidenceId || '',
      command.noticeVersion || '',
      String(command.legalHold === true),
      command.reason || '',
      command.requestId,
    ].join('|'))
    .digest('hex');
}

function resolveStaffAuthority(operatorProfile) {
  if (!operatorProfile || operatorProfile.status !== 'active') return null;
  if (operatorProfile.role === 'owner') return 'platform-owner';
  if (operatorProfile.role === 'super-moderator') return 'super-moderator';
  return null;
}

function isActiveMember(membership) {
  return membership?.status === 'active';
}

function mapRecordingStatusPublic({
  featureEnabled,
  noticeAcknowledged,
  room,
  session,
}) {
  return {
    audioAvailable: session?.egressStatus === 'rolling' || session?.egressStatus === 'stopped',
    egressStatus: session?.egressStatus || (featureEnabled ? 'not-configured' : 'stopped'),
    featureEnabled: featureEnabled === true,
    indicator: featureEnabled ? 'recording-safety-active' : 'recording-off',
    noticeAcknowledged: noticeAcknowledged === true,
    noticeVersion: RECORDING_POLICY_VERSION,
    policyVersion: RECORDING_POLICY_VERSION,
    rollingWindowMs: ROLLING_WINDOW_MS,
    sessionId: session?.sessionId || room?.activeRecordingSessionId || null,
  };
}

function resolveGetRecordingStatus({
  featureFlags,
  membership,
  noticeAcknowledged,
  operatorProfile,
  room,
  session,
}) {
  const staff = resolveStaffAuthority(operatorProfile);
  if (!staff && !isActiveMember(membership)) {
    return roomRecordingError('NOT_A_MEMBER', 403, 'Active room membership is required.');
  }
  return {
    ok: true,
    value: mapRecordingStatusPublic({
      featureEnabled: featureFlags?.voice_room_safety_recording === true,
      noticeAcknowledged,
      room,
      session,
    }),
  };
}

function resolveAcknowledgeNotice({ featureFlags, membership, senderUid }) {
  const flag = requireRecordingFlag(featureFlags);
  if (!flag.ok) return flag;
  if (!isActiveMember(membership)) {
    return roomRecordingError('NOT_A_MEMBER', 403, 'Active room membership is required.');
  }
  return {
    ok: true,
    value: {
      noticeVersion: RECORDING_POLICY_VERSION,
      uid: senderUid,
    },
  };
}

function resolveEnsureRollingSession({
  featureFlags,
  membership,
  nowMs,
  operatorProfile,
  room,
  senderUid,
  sessionId,
  activeSession,
}) {
  const flag = requireRecordingFlag(featureFlags);
  if (!flag.ok) return flag;
  const staff = resolveStaffAuthority(operatorProfile);
  if (!staff && !isActiveMember(membership)) {
    return roomRecordingError('NOT_A_MEMBER', 403, 'Active room membership is required.');
  }
  if (room?.status !== 'active' || room?.availability === 'removed') {
    return roomRecordingError('ROOM_UNAVAILABLE', 409, 'This room is not available for recording.');
  }
  if (activeSession && activeSession.status === 'rolling') {
    return {
      ok: true,
      value: {
        created: false,
        liveKitEgress: { type: 'none' },
        session: activeSession,
      },
    };
  }
  return {
    ok: true,
    value: {
      created: true,
      liveKitEgress: { type: 'start-rolling' },
      session: {
        audioOnly: true,
        egressId: '',
        egressStatus: 'not-configured',
        policyVersion: RECORDING_POLICY_VERSION,
        retentionDefaultMs: DEFAULT_RETENTION_MS,
        rollingWindowMs: ROLLING_WINDOW_MS,
        roomId: room.id || room.roomId,
        sessionId,
        startedAtMs: nowMs,
        startedBy: senderUid,
        status: 'rolling',
      },
    },
  };
}

function resolveStopRollingSession({
  featureFlags,
  nowMs,
  operatorProfile,
  room,
  senderUid,
  session,
  membership,
}) {
  const flag = requireRecordingFlag(featureFlags);
  if (!flag.ok) return flag;
  const staff = resolveStaffAuthority(operatorProfile);
  const ownerUid = typeof room?.ownerUid === 'string' ? room.ownerUid : room?.hostId;
  const isOwner = ownerUid && ownerUid === senderUid;
  if (!staff && !isOwner && membership?.authorityRole !== 'moderator') {
    return roomRecordingError('FORBIDDEN', 403, 'Only room staff or platform staff may stop recording.');
  }
  if (!session || session.status !== 'rolling') {
    return roomRecordingError('SESSION_NOT_ACTIVE', 409, 'No active rolling recording session.');
  }
  return {
    ok: true,
    value: {
      liveKitEgress: session.egressId
        ? { type: 'stop', egressId: session.egressId }
        : { type: 'none' },
      stoppedAtMs: nowMs,
    },
  };
}

function buildEvidenceForReport({
  nowMs,
  reportId,
  roomId,
  session,
  reporterUid,
}) {
  const evidenceId = createEvidenceId(roomId, reportId);
  const hasEgressBytes = Boolean(session?.egressId)
    && ['rolling', 'stopped'].includes(session?.egressStatus);
  return {
    accessPolicy: 'staff-only',
    audioStatus: hasEgressBytes ? 'pending-egress' : 'missing',
    evidenceId,
    legalHold: false,
    policyVersion: RECORDING_POLICY_VERSION,
    preserveRequestedAtMs: nowMs,
    reportId,
    reporterUid: reporterUid || '',
    retentionUntilMs: nowMs + DEFAULT_RETENTION_MS,
    roomId,
    sessionId: session?.sessionId || '',
    storagePath: '',
    windowEndMs: nowMs + POST_REPORT_WINDOW_MS,
    windowStartMs: nowMs - PRE_REPORT_WINDOW_MS,
  };
}

function resolvePreserveForReport({
  existingEvidence,
  featureFlags,
  membership,
  nowMs,
  operatorProfile,
  reportId,
  room,
  senderUid,
  session,
}) {
  const flag = requireRecordingFlag(featureFlags);
  if (!flag.ok) return flag;
  const staff = resolveStaffAuthority(operatorProfile);
  if (!staff && !isActiveMember(membership)) {
    return roomRecordingError('NOT_A_MEMBER', 403, 'Active room membership is required.');
  }
  if (existingEvidence) {
    return {
      ok: true,
      value: {
        created: false,
        evidence: existingEvidence,
        liveKitEgress: { type: 'none' },
      },
    };
  }
  const evidence = buildEvidenceForReport({
    nowMs,
    reportId,
    roomId: room.id || room.roomId,
    reporterUid: senderUid,
    session,
  });
  return {
    ok: true,
    value: {
      created: true,
      evidence,
      liveKitEgress: session?.egressId
        ? { type: 'preserve-window', egressId: session.egressId, evidenceId: evidence.evidenceId }
        : { type: 'none' },
    },
  };
}

function resolveSetLegalHold({
  evidence,
  featureFlags,
  legalHold,
  nowMs,
  operatorProfile,
  reason,
  senderUid,
}) {
  const flag = requireRecordingFlag(featureFlags);
  if (!flag.ok) return flag;
  const staff = resolveStaffAuthority(operatorProfile);
  if (!staff) {
    return roomRecordingError('FORBIDDEN', 403, 'Only platform staff may change legal holds.');
  }
  if (!evidence) {
    return roomRecordingError('EVIDENCE_NOT_FOUND', 404, 'Evidence record was not found.');
  }
  return {
    ok: true,
    value: {
      audit: {
        action: legalHold ? 'set-legal-hold' : 'clear-legal-hold',
        actorUid: senderUid,
        atMs: nowMs,
        authority: staff,
        evidenceId: evidence.evidenceId,
        reason,
      },
      legalHold,
      retentionUntilMs: legalHold
        ? Math.max(Number(evidence.retentionUntilMs || 0), nowMs + LEGAL_HOLD_RETENTION_MS)
        : nowMs + DEFAULT_RETENTION_MS,
    },
  };
}

function resolveRequestPlayback({
  evidence,
  featureFlags,
  nowMs,
  operatorProfile,
  reason,
  senderUid,
}) {
  const flag = requireRecordingFlag(featureFlags);
  if (!flag.ok) return flag;
  const staff = resolveStaffAuthority(operatorProfile);
  if (!staff) {
    return roomRecordingError('FORBIDDEN', 403, 'Only platform staff may request evidence playback.');
  }
  if (!evidence) {
    return roomRecordingError('EVIDENCE_NOT_FOUND', 404, 'Evidence record was not found.');
  }
  if (evidence.legalHold !== true && Number(evidence.retentionUntilMs || 0) <= nowMs) {
    return roomRecordingError('EVIDENCE_EXPIRED', 410, 'Evidence retention has expired.');
  }
  const audioStatus = evidence.audioStatus || 'missing';
  return {
    ok: true,
    value: {
      audit: {
        action: 'request-playback',
        actorUid: senderUid,
        atMs: nowMs,
        authority: staff,
        evidenceId: evidence.evidenceId,
        reason: reason || '',
      },
      audioStatus,
      note: audioStatus === 'preserved'
        ? 'Playback URL issuance requires signed storage access configuration.'
        : 'No preserved audio bytes are available for this evidence window.',
      playbackAvailable: audioStatus === 'preserved' && Boolean(evidence.storagePath),
      playbackUrl: null,
    },
  };
}

function shouldDeleteExpiredEvidence(evidence, nowMs) {
  if (!evidence) return false;
  if (evidence.legalHold === true) return false;
  return Number(evidence.retentionUntilMs || 0) <= nowMs;
}

function shouldDeleteUnreportedSegment(segment, nowMs) {
  if (!segment || segment.preserved === true) return false;
  return Number(segment.expireAtMs || 0) <= nowMs;
}

module.exports = {
  DEFAULT_RETENTION_MS,
  LEGAL_HOLD_RETENTION_MS,
  POST_REPORT_WINDOW_MS,
  PRE_REPORT_WINDOW_MS,
  RECORDING_POLICY_VERSION,
  ROLLING_WINDOW_MS,
  ROOM_RECORDING_ACTIONS,
  SEGMENT_TTL_MS,
  buildEvidenceForReport,
  buildRoomRecordingFingerprint,
  createEvidenceId,
  createRecordingSessionId,
  mapRecordingStatusPublic,
  normalizeRoomRecordingBody,
  resolveAcknowledgeNotice,
  resolveEnsureRollingSession,
  resolveGetRecordingStatus,
  resolvePreserveForReport,
  resolveRequestPlayback,
  resolveSetLegalHold,
  resolveStopRollingSession,
  roomRecordingError,
  shouldDeleteExpiredEvidence,
  shouldDeleteUnreportedSegment,
  validateRoomRecordingRequest,
};
