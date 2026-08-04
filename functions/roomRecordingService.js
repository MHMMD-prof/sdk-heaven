const {
  buildEvidenceForReport,
  buildRoomRecordingFingerprint,
  createEvidenceId,
  createRecordingSessionId,
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
} = require('./roomRecordingCore');
const { isRecentAuth } = require('./roomCommandCore');

const systemClock = {
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => {
    const { Timestamp } = require('firebase-admin/firestore');
    return Timestamp.fromMillis(value);
  },
};

async function executeRoomRecordingCommand({
  body,
  clock = systemClock,
  db,
  decodedToken,
  fieldValue,
}) {
  const validation = validateRoomRecordingRequest(normalizeRoomRecordingBody(body));
  if (!validation.ok) return validation;
  const command = validation.value;
  const fingerprint = buildRoomRecordingFingerprint(decodedToken.uid, command);

  return db.runTransaction(async (transaction) => {
    const roomRef = db.doc(`rooms/${command.roomId}`);
    const requestRef = roomRef.collection('recordingCommandRequests').doc(command.requestId);
    const featureRef = db.doc('appConfig/voiceRoomFeatures');
    const memberRef = roomRef.collection('members').doc(decodedToken.uid);
    const adminRef = db.doc(`adminProfiles/${decodedToken.uid}`);
    const noticeRef = roomRef.collection('recordingNoticeAcks').doc(decodedToken.uid);

    const [
      requestSnapshot,
      featureSnapshot,
      roomSnapshot,
      memberSnapshot,
      adminSnapshot,
      noticeSnapshot,
    ] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(featureRef),
      transaction.get(roomRef),
      transaction.get(memberRef),
      transaction.get(adminRef),
      transaction.get(noticeRef),
    ]);

    if (requestSnapshot.exists) {
      const previous = requestSnapshot.data();
      if (previous.actorUid !== decodedToken.uid || previous.fingerprint !== fingerprint) {
        return roomRecordingError('REQUEST_ID_CONFLICT', 409, 'This request ID belongs to another command.');
      }
      return { ...previous.response, replayed: true };
    }

    if (!roomSnapshot.exists) {
      return roomRecordingError('ROOM_NOT_FOUND', 404, 'Room was not found.');
    }

    const featureFlags = featureSnapshot.exists ? featureSnapshot.data() : undefined;
    const roomData = { id: command.roomId, ...roomSnapshot.data() };
    const membership = memberSnapshot.exists
      ? { uid: decodedToken.uid, ...memberSnapshot.data() }
      : undefined;
    const storedOperatorProfile = adminSnapshot.exists ? adminSnapshot.data() : undefined;
    const operatorRoleMatches = decodedToken.admin === true
      && storedOperatorProfile?.status === 'active'
      && decodedToken.adminRole === storedOperatorProfile.role;
    const operatorProfile = operatorRoleMatches && (
      decodedToken.adminRole === 'owner'
      || (
        decodedToken.adminRole === 'super-moderator'
        && featureFlags?.voice_room_super_moderation === true
        && Array.isArray(storedOperatorProfile.regionCodes)
        && storedOperatorProfile.regionCodes.includes(roomData.countryCode)
      )
    )
      ? storedOperatorProfile
      : undefined;
    const nowMs = clock.nowMillis();
    const timestamp = fieldValue.serverTimestamp();
    if (
      ['request-playback', 'set-legal-hold'].includes(command.action)
      && operatorProfile
      && !isRecentAuth(decodedToken, nowMs)
    ) {
      return roomRecordingError(
        'FRESH_AUTH_REQUIRED',
        401,
        'Fresh authentication is required for evidence access.',
      );
    }

    const activeSessionId = typeof roomData.activeRecordingSessionId === 'string'
      ? roomData.activeRecordingSessionId.trim()
      : '';
    let sessionSnapshot;
    if (activeSessionId) {
      sessionSnapshot = await transaction.get(roomRef.collection('recordingSessions').doc(activeSessionId));
    }
    const activeSession = sessionSnapshot?.exists
      ? { sessionId: activeSessionId, ...sessionSnapshot.data() }
      : undefined;

    let evidenceSnapshot;
    if (command.evidenceId) {
      evidenceSnapshot = await transaction.get(db.doc(`roomEvidence/${command.evidenceId}`));
    } else if (command.action === 'preserve-for-report') {
      evidenceSnapshot = await transaction.get(
        db.doc(`roomEvidence/${createEvidenceId(command.roomId, command.reportId)}`),
      );
    }
    const existingEvidence = evidenceSnapshot?.exists
      ? { evidenceId: evidenceSnapshot.id, ...evidenceSnapshot.data() }
      : undefined;

    let response;
    let liveKitEgress = { type: 'none' };

    if (command.action === 'get-recording-status') {
      const resolution = resolveGetRecordingStatus({
        featureFlags,
        membership,
        noticeAcknowledged: noticeSnapshot.exists,
        operatorProfile,
        room: roomData,
        session: activeSession,
      });
      if (!resolution.ok) return resolution;
      response = {
        ok: true,
        result: {
          action: command.action,
          requestId: command.requestId,
          roomId: command.roomId,
          status: resolution.value,
        },
        liveKitEgress,
      };
    } else if (command.action === 'acknowledge-recording-notice') {
      const resolution = resolveAcknowledgeNotice({
        featureFlags,
        membership,
        senderUid: decodedToken.uid,
      });
      if (!resolution.ok) return resolution;
      transaction.set(noticeRef, {
        acknowledgedAt: timestamp,
        noticeVersion: resolution.value.noticeVersion,
        uid: decodedToken.uid,
      });
      response = {
        ok: true,
        result: {
          action: command.action,
          noticeVersion: resolution.value.noticeVersion,
          requestId: command.requestId,
          roomId: command.roomId,
        },
        liveKitEgress,
      };
    } else if (command.action === 'ensure-rolling-session') {
      const sessionId = activeSession?.status === 'rolling'
        ? activeSession.sessionId
        : createRecordingSessionId(command.roomId, command.requestId);
      const resolution = resolveEnsureRollingSession({
        activeSession,
        featureFlags,
        membership,
        nowMs,
        operatorProfile,
        room: roomData,
        senderUid: decodedToken.uid,
        sessionId,
      });
      if (!resolution.ok) return resolution;
      liveKitEgress = resolution.value.liveKitEgress;
      if (resolution.value.created) {
        const session = resolution.value.session;
        transaction.create(roomRef.collection('recordingSessions').doc(session.sessionId), {
          audioOnly: true,
          createdAt: timestamp,
          egressId: '',
          egressStatus: 'not-configured',
          policyVersion: session.policyVersion,
          retentionDefaultMs: session.retentionDefaultMs,
          rollingWindowMs: session.rollingWindowMs,
          roomId: command.roomId,
          sessionId: session.sessionId,
          startedAt: clock.timestampFromMillis(nowMs),
          startedAtMs: nowMs,
          startedBy: decodedToken.uid,
          status: 'rolling',
          updatedAt: timestamp,
        });
        transaction.update(roomRef, {
          activeRecordingSessionId: session.sessionId,
          recordingPolicyVersion: session.policyVersion,
          updatedAt: timestamp,
        });
      }
      response = {
        ok: true,
        result: {
          action: command.action,
          created: resolution.value.created,
          requestId: command.requestId,
          roomId: command.roomId,
          session: resolution.value.session,
          sessionId: resolution.value.session.sessionId,
        },
        liveKitEgress,
      };
    } else if (command.action === 'stop-rolling-session') {
      const resolution = resolveStopRollingSession({
        featureFlags,
        membership,
        nowMs,
        operatorProfile,
        room: roomData,
        senderUid: decodedToken.uid,
        session: activeSession,
      });
      if (!resolution.ok) return resolution;
      liveKitEgress = resolution.value.liveKitEgress;
      transaction.update(roomRef.collection('recordingSessions').doc(activeSession.sessionId), {
        egressStatus: activeSession.egressId ? 'stopped' : 'not-configured',
        status: 'stopped',
        stoppedAt: clock.timestampFromMillis(nowMs),
        stoppedAtMs: nowMs,
        stoppedBy: decodedToken.uid,
        updatedAt: timestamp,
      });
      transaction.update(roomRef, {
        activeRecordingSessionId: null,
        updatedAt: timestamp,
      });
      response = {
        ok: true,
        result: {
          action: command.action,
          requestId: command.requestId,
          roomId: command.roomId,
          sessionId: activeSession.sessionId,
          stopped: true,
        },
        liveKitEgress,
      };
    } else if (command.action === 'preserve-for-report') {
      const resolution = resolvePreserveForReport({
        existingEvidence,
        featureFlags,
        membership,
        nowMs,
        operatorProfile,
        reportId: command.reportId,
        room: roomData,
        senderUid: decodedToken.uid,
        session: activeSession,
      });
      if (!resolution.ok) return resolution;
      liveKitEgress = resolution.value.liveKitEgress;
      if (resolution.value.created) {
        const evidence = resolution.value.evidence;
        transaction.create(db.doc(`roomEvidence/${evidence.evidenceId}`), {
          ...evidence,
          createdAt: timestamp,
          retentionUntil: clock.timestampFromMillis(evidence.retentionUntilMs),
          updatedAt: timestamp,
        });
        transaction.update(db.doc(`reports/${command.reportId}`), {
          evidenceId: evidence.evidenceId,
          evidenceAudioStatus: evidence.audioStatus,
          evidencePreservationRequested: true,
          updatedAt: timestamp,
        });
      }
      response = {
        ok: true,
        result: {
          action: command.action,
          created: resolution.value.created,
          evidence: resolution.value.evidence,
          evidenceId: resolution.value.evidence.evidenceId,
          requestId: command.requestId,
          roomId: command.roomId,
        },
        liveKitEgress,
      };
    } else if (command.action === 'set-legal-hold') {
      const resolution = resolveSetLegalHold({
        evidence: existingEvidence,
        featureFlags,
        legalHold: command.legalHold,
        nowMs,
        operatorProfile,
        reason: command.reason,
        senderUid: decodedToken.uid,
      });
      if (!resolution.ok) return resolution;
      transaction.update(db.doc(`roomEvidence/${command.evidenceId}`), {
        legalHold: resolution.value.legalHold,
        retentionUntil: clock.timestampFromMillis(resolution.value.retentionUntilMs),
        retentionUntilMs: resolution.value.retentionUntilMs,
        updatedAt: timestamp,
      });
      transaction.create(db.collection('roomEvidenceAccessLogs').doc(command.requestId), {
        ...resolution.value.audit,
        createdAt: timestamp,
        roomId: command.roomId,
      });
      response = {
        ok: true,
        result: {
          action: command.action,
          evidenceId: command.evidenceId,
          legalHold: resolution.value.legalHold,
          requestId: command.requestId,
          retentionUntilMs: resolution.value.retentionUntilMs,
          roomId: command.roomId,
        },
        liveKitEgress,
      };
    } else if (command.action === 'request-playback') {
      const resolution = resolveRequestPlayback({
        evidence: existingEvidence,
        featureFlags,
        nowMs,
        operatorProfile,
        reason: command.reason,
        senderUid: decodedToken.uid,
      });
      if (!resolution.ok) return resolution;
      transaction.create(db.collection('roomEvidenceAccessLogs').doc(command.requestId), {
        ...resolution.value.audit,
        audioStatus: resolution.value.audioStatus,
        createdAt: timestamp,
        playbackAvailable: resolution.value.playbackAvailable,
        roomId: command.roomId,
      });
      response = {
        ok: true,
        result: {
          action: command.action,
          audioStatus: resolution.value.audioStatus,
          evidenceId: command.evidenceId,
          note: resolution.value.note,
          playbackAvailable: resolution.value.playbackAvailable,
          playbackUrl: resolution.value.playbackUrl,
          requestId: command.requestId,
          roomId: command.roomId,
        },
        liveKitEgress,
      };
    } else {
      return roomRecordingError('INVALID_REQUEST', 400, 'A valid room recording command is required.');
    }

    transaction.create(requestRef, {
      action: command.action,
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      fingerprint,
      requestId: command.requestId,
      response,
    });
    return response;
  });
}

/**
 * Creates voice-report evidence inside an existing transaction when recording is enabled.
 * Always stamps audioStatus explicitly (often `missing` until egress is configured).
 */
function preserveVoiceReportEvidenceInTransaction({
  clock = systemClock,
  db,
  featureFlags,
  fieldValue,
  nowMs,
  reportId,
  roomId,
  senderUid,
  session,
  timestamp,
  transaction,
}) {
  if (featureFlags?.voice_room_safety_recording !== true) {
    return { created: false, evidenceId: null, audioStatus: 'missing' };
  }
  const evidence = buildEvidenceForReport({
    nowMs,
    reportId,
    roomId,
    reporterUid: senderUid,
    session,
  });
  const evidenceRef = db.doc(`roomEvidence/${evidence.evidenceId}`);
  transaction.create(evidenceRef, {
    ...evidence,
    createdAt: timestamp || fieldValue.serverTimestamp(),
    retentionUntil: clock.timestampFromMillis(evidence.retentionUntilMs),
    updatedAt: timestamp || fieldValue.serverTimestamp(),
  });
  return {
    audioStatus: evidence.audioStatus,
    created: true,
    evidenceId: evidence.evidenceId,
  };
}

async function cleanupExpiredRoomEvidence({
  clock = systemClock,
  db,
  limit = 100,
}) {
  const nowMs = clock.nowMillis();
  const snapshot = await db.collection('roomEvidence')
    .where('legalHold', '==', false)
    .where('retentionUntilMs', '<=', nowMs)
    .orderBy('retentionUntilMs', 'asc')
    .limit(limit)
    .get();
  if (snapshot.empty) return { deleted: 0, scanned: 0 };
  const batch = db.batch();
  let deleted = 0;
  for (const document of snapshot.docs) {
    const data = document.data();
    if (!shouldDeleteExpiredEvidence(data, nowMs)) continue;
    batch.update(document.ref, {
      audioStatus: 'expired',
      deletedAtMs: nowMs,
      storagePath: '',
      updatedAt: clock.timestampFromMillis(nowMs),
    });
    deleted += 1;
  }
  if (deleted > 0) await batch.commit();
  return { deleted, scanned: snapshot.size };
}

async function cleanupUnreportedRecordingSegments({
  clock = systemClock,
  db,
  limit = 100,
}) {
  const nowMs = clock.nowMillis();
  const snapshot = await db.collectionGroup('recordingSegments')
    .where('preserved', '==', false)
    .where('expireAtMs', '<=', nowMs)
    .orderBy('expireAtMs', 'asc')
    .limit(limit)
    .get();
  if (snapshot.empty) return { deleted: 0, scanned: 0 };
  const batch = db.batch();
  let deleted = 0;
  for (const document of snapshot.docs) {
    if (!shouldDeleteUnreportedSegment(document.data(), nowMs)) continue;
    batch.delete(document.ref);
    deleted += 1;
  }
  if (deleted > 0) await batch.commit();
  return { deleted, scanned: snapshot.size };
}

async function applyRoomRecordingEgress(_egressClient, liveKitEgress) {
  if (!liveKitEgress || liveKitEgress.type === 'none') {
    return { status: 'not-required' };
  }
  // Egress output credentials are not configured in this environment.
  // Keep explicit not-configured so staff never assume audio bytes exist.
  return { status: 'not-configured', plan: liveKitEgress.type };
}

module.exports = {
  applyRoomRecordingEgress,
  cleanupExpiredRoomEvidence,
  cleanupUnreportedRecordingSegments,
  executeRoomRecordingCommand,
  preserveVoiceReportEvidenceInTransaction,
};
