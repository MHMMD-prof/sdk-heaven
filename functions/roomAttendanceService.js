const crypto = require('node:crypto');

const {
  ATTENDANCE_SCHEMA_VERSION,
  DEFAULT_MUTE_GRACE_MILLIS,
  createAttendanceSessionId,
  detectMuteGraceCycling,
  groupReconnectIntervals,
  normalizeAuthoritativeSnapshot,
  reduceAttendanceSession,
  splitAndUnionAttendanceIntervals,
} = require('./roomAttendanceCore');
const { createDailyBucket, DEFAULT_INCENTIVE_TIME_ZONE } = require('./weeklyIncentiveCore');
const ATTENDANCE_RECEIPT_RETENTION_MILLIS = 30 * 24 * 60 * 60 * 1000;
const ATTENDANCE_INTERVAL_RETENTION_MILLIS = 180 * 24 * 60 * 60 * 1000;

async function ingestLiveKitAttendanceEvent({
  clock,
  db,
  event,
  fieldValue,
  source = 'livekit-webhook',
}) {
  const feature = await db.doc('appConfig/voiceRoomFeatures').get();
  if (feature.data()?.voice_room_attendance_shadow !== true) {
    return { skipped: true, reason: 'feature-disabled' };
  }
  const sessionId = createAttendanceSessionId(event.roomId, event.uid);
  if (!sessionId) return { errorCode: 'INVALID_EVENT' };
  const receiptRef = db.doc(`roomAttendanceEventReceipts/${event.eventId}`);
  const sessionRef = db.doc(`roomAttendanceSessions/${sessionId}`);
  return db.runTransaction(async (transaction) => {
    const [receiptSnapshot, sessionSnapshot, membershipSnapshot] = await Promise.all([
      transaction.get(receiptRef),
      transaction.get(sessionRef),
      transaction.get(db.doc(`rooms/${event.roomId}/members/${event.uid}`)),
    ]);
    if (receiptSnapshot.exists) return { replayed: true };
    const membership = membershipSnapshot.exists ? membershipSnapshot.data() : undefined;
    const seatId = typeof membership?.seatId === 'string' ? membership.seatId : '';
    const seatSnapshot = seatId
      ? await transaction.get(db.doc(`rooms/${event.roomId}/seats/${seatId}`))
      : undefined;
    const seated = Boolean(
      membership?.status === 'active'
      && seatId
      && seatSnapshot?.exists
      && seatSnapshot.data()?.occupantUid === event.uid
      && ['occupied', 'reconnecting', 'retiring'].includes(seatSnapshot.data()?.state),
    );
    const previous = sessionSnapshot.exists ? sessionDocumentToCore(sessionSnapshot.data()) : undefined;
    const first = reduceAttendanceSession(previous, event);
    if (!first.ok) return { errorCode: first.code };
    let transition = first.value;
    if (transition.session.seated !== seated || transition.session.seatId !== (seated ? seatId : '')) {
      const seatTransition = reduceAttendanceSession(transition.session, {
        ...event,
        eventId: `${event.eventId}_seat`,
        kind: 'seat-state',
        seated,
        seatId: seated ? seatId : '',
      });
      if (!seatTransition.ok) return { errorCode: seatTransition.code };
      transition = {
        ...seatTransition.value,
        actions: [...transition.actions, ...seatTransition.value.actions],
        ignored: transition.ignored && seatTransition.value.ignored,
      };
    }
    applyAttendanceTransition({
      clock,
      event,
      fieldValue,
      reduced: transition,
      sessionRef,
      source,
      transaction,
    });
    transaction.create(receiptRef, {
      eventId: event.eventId,
      eventKind: event.kind,
      occurredAt: clock.timestampFromMillis(event.occurredAtMillis),
      participantSid: event.participantSid,
      processedAt: fieldValue.serverTimestamp(),
      purgeAfter: clock.timestampFromMillis(clock.nowMillis() + ATTENDANCE_RECEIPT_RETENTION_MILLIS),
      roomId: event.roomId,
      schemaVersion: ATTENDANCE_SCHEMA_VERSION,
      sessionId,
      source,
      uid: event.uid,
    });
    return {
      actions: transition.actions.map((action) => action.kind),
      ignored: transition.ignored,
      replayed: false,
      sessionId,
    };
  });
}

async function ingestSeatMembershipChange({
  clock,
  db,
  eventId,
  fieldValue,
  roomId,
  uid,
}) {
  const sessionId = createAttendanceSessionId(roomId, uid);
  const sessionSnapshot = await db.doc(`roomAttendanceSessions/${sessionId}`).get();
  if (!sessionSnapshot.exists || sessionSnapshot.data()?.connected !== true) {
    return { skipped: true, reason: 'no-connected-session' };
  }
  const session = sessionSnapshot.data();
  return ingestLiveKitAttendanceEvent({
    clock,
    db,
    event: {
      eventId: `seat_${eventId}`,
      kind: 'seat-state',
      occurredAtMillis: clock.nowMillis(),
      participantSid: session.participantSid,
      roomId,
      schemaVersion: ATTENDANCE_SCHEMA_VERSION,
      uid,
    },
    fieldValue,
    source: 'firestore-seat-authority',
  });
}

async function verifyAndIngestMicrophoneHint({
  clock,
  db,
  fieldValue,
  requestId,
  roomId,
  roomService,
  uid,
}) {
  const feature = await db.doc('appConfig/voiceRoomFeatures').get();
  if (feature.data()?.voice_room_attendance_shadow !== true) {
    return { skipped: true, reason: 'feature-disabled' };
  }
  let participant;
  try {
    participant = await roomService.getParticipant(roomId, uid);
  } catch (error) {
    if (/not.?found|404/i.test(error instanceof Error ? error.message : String(error))) {
      return { errorCode: 'PARTICIPANT_NOT_FOUND' };
    }
    throw error;
  }
  if (!participant || participant.identity !== uid) return { errorCode: 'PARTICIPANT_NOT_FOUND' };
  const microphoneTracks = (participant.tracks || []).filter(isMicrophoneTrack);
  const normalized = normalizeAuthoritativeSnapshot({
    connected: true,
    eventId: `hint_${requestId}`,
    microphonePublished: microphoneTracks.length > 0,
    muted: microphoneTracks.length === 0 || microphoneTracks.every((track) => track.muted === true),
    occurredAtMillis: clock.nowMillis(),
    participantSid: participant.sid,
    roomId,
    uid,
  });
  if (!normalized.ok) return { errorCode: normalized.code };
  return ingestLiveKitAttendanceEvent({
    clock,
    db,
    event: normalized.value,
    fieldValue,
    source: 'verified-client-hint',
  });
}

async function reconcileLiveKitAttendance({
  clock,
  db,
  fieldValue,
  limit = 200,
  roomService,
}) {
  const feature = await db.doc('appConfig/voiceRoomFeatures').get();
  if (feature.data()?.voice_room_attendance_shadow !== true) {
    return { processed: 0, results: [], scanned: 0, skipped: true };
  }
  const sessions = await db.collection('roomAttendanceSessions')
    .where('connected', '==', true)
    .limit(limit)
    .get();
  const grouped = new Map();
  sessions.docs.forEach((document) => {
    const data = document.data();
    if (!grouped.has(data.roomId)) grouped.set(data.roomId, []);
    grouped.get(data.roomId).push(data);
  });
  const results = [];
  const observedAt = clock.nowMillis();
  const minute = Math.floor(observedAt / 60_000);
  for (const [roomId, roomSessions] of grouped.entries()) {
    let participants;
    try {
      participants = await roomService.listParticipants(roomId);
    } catch (error) {
      results.push({ error: error instanceof Error ? error.message : String(error), roomId });
      continue;
    }
    const byUid = new Map(participants.map((participant) => [participant.identity, participant]));
    for (const session of roomSessions) {
      const participant = byUid.get(session.uid);
      const microphones = (participant?.tracks || []).filter(isMicrophoneTrack);
      const normalized = normalizeAuthoritativeSnapshot({
        connected: Boolean(participant),
        eventId: `poll_${minute}_${hashScope(roomId, session.uid)}`,
        microphonePublished: microphones.length > 0,
        muted: microphones.length === 0 || microphones.every((track) => track.muted === true),
        occurredAtMillis: observedAt,
        participantSid: participant?.sid || session.participantSid,
        roomId,
        uid: session.uid,
      });
      if (!normalized.ok) {
        results.push({ errorCode: normalized.code, roomId, uid: session.uid });
        continue;
      }
      results.push(await ingestLiveKitAttendanceEvent({
        clock,
        db,
        event: normalized.value,
        fieldValue,
        source: 'livekit-authoritative-poll',
      }));
    }
  }
  return { processed: results.length, results, scanned: sessions.size };
}

async function getAttendanceShadowReport({
  clock,
  db,
  timeZone = DEFAULT_INCENTIVE_TIME_ZONE,
  uid,
}) {
  const endAtMillis = clock.nowMillis();
  const startAtMillis = endAtMillis - 8 * 24 * 60 * 60 * 1000;
  const [intervalSnapshot, sessionSnapshot, outageSnapshot] = await Promise.all([
    db.collection('roomAttendanceIntervals').where('uid', '==', uid)
      .where('startAt', '>=', clock.timestampFromMillis(startAtMillis))
      .orderBy('startAt', 'asc').limit(500).get(),
    db.collection('roomAttendanceSessions').where('uid', '==', uid).limit(50).get(),
    db.collection('attendanceOutageWindows').where('endAt', '>=', clock.timestampFromMillis(startAtMillis))
      .orderBy('endAt', 'asc').limit(100).get(),
  ]);
  const sessionRows = sessionSnapshot.docs.map((document) => ({
    activeIntervalId: document.data().activeIntervalId || '',
    connected: document.data().connected === true,
    lastObservedAtMillis: toMillis(document.data().lastObservedAt),
    microphonePublished: document.data().microphonePublished === true,
    muteGraceExpiresAtMillis: toMillis(document.data().muteGraceExpiresAt),
    muted: document.data().muted === true,
    roomId: document.data().roomId || '',
    seated: document.data().seated === true,
    seatId: document.data().seatId || '',
    sessionId: document.id,
  }));
  const activeDeadlines = new Map(sessionRows
    .filter((session) => session.muted && session.activeIntervalId && session.muteGraceExpiresAtMillis)
    .map((session) => [session.activeIntervalId, session.muteGraceExpiresAtMillis]));
  const rawIntervals = intervalSnapshot.docs.map((document) => ({
    endAtMillis: toMillis(document.data().endAt)
      || Math.min(endAtMillis, activeDeadlines.get(document.id) || endAtMillis),
    exclusionReason: document.data().exclusionReason || '',
    intervalId: document.id,
    roomId: document.data().roomId || '',
    seatId: document.data().seatId || '',
    startAtMillis: toMillis(document.data().startAt),
    state: document.data().state || '',
  }));
  const outages = outageSnapshot.docs.filter((document) => document.data().active !== false).map((document) => ({
    endAtMillis: toMillis(document.data().endAt),
    outageId: document.id,
    reason: document.data().reason || '',
    startAtMillis: toMillis(document.data().startAt),
  }));
  const days = [];
  let cursor = startAtMillis;
  while (cursor < endAtMillis) {
    const bucket = createDailyBucket({ nowMillis: cursor, timeZone });
    if (!bucket.ok) break;
    if (!days.some((day) => day.dayId === bucket.value.dayId)) {
      const aggregate = splitAndUnionAttendanceIntervals(rawIntervals, {
        dayEndAtMillis: bucket.value.endAtMillis,
        dayStartAtMillis: bucket.value.startAtMillis,
        outageWindows: outages,
      });
      days.push({
        dayId: bucket.value.dayId,
        endAtMillis: bucket.value.endAtMillis,
        excusedMillis: aggregate.value.excusedMillis,
        qualifiedMillis: aggregate.value.qualifiedMillis,
        startAtMillis: bucket.value.startAtMillis,
      });
    }
    cursor = bucket.value.endAtMillis;
  }
  const muteEvents = sessionSnapshot.docs.flatMap((document) => document.data().recentMuteEvents || []);
  return {
    days,
    generatedAtMillis: endAtMillis,
    muteGraceMillis: DEFAULT_MUTE_GRACE_MILLIS,
    muteGraceCycling: detectMuteGraceCycling(muteEvents),
    outageWindows: outages,
    rawIntervals,
    reconnectGroups: groupReconnectIntervals(rawIntervals),
    reportOnly: true,
    sessions: sessionRows.map(({ activeIntervalId, muteGraceExpiresAtMillis, ...session }) => session),
    timeZone,
    uid,
  };
}

async function mutateAttendanceOutageWindow({ clock, db, decodedToken, fieldValue, input }) {
  const outageRef = db.doc(`attendanceOutageWindows/${input.outageId}`);
  const requestRef = db.doc(`attendanceOutageCommands/${input.requestId}`);
  const auditRef = db.collection('adminAuditEvents').doc();
  return db.runTransaction(async (transaction) => {
    const [requestSnapshot, outageSnapshot] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(outageRef),
    ]);
    if (requestSnapshot.exists) return { auditId: requestSnapshot.data()?.auditId || '', replayed: true };
    if (input.operation === 'revoke' && !outageSnapshot.exists) return { errorCode: 'OUTAGE_NOT_FOUND' };
    const timestamp = fieldValue.serverTimestamp();
    if (input.operation === 'create') {
      transaction.set(outageRef, {
        active: true,
        createdAt: timestamp,
        createdBy: decodedToken.uid,
        endAt: clock.timestampFromMillis(input.endAtMillis),
        outageId: input.outageId,
        reason: input.reason,
        schemaVersion: ATTENDANCE_SCHEMA_VERSION,
        startAt: clock.timestampFromMillis(input.startAtMillis),
        updatedAt: timestamp,
      });
    } else {
      transaction.update(outageRef, {
        active: false,
        revokedAt: timestamp,
        revokedBy: decodedToken.uid,
        revocationReason: input.reason,
        updatedAt: timestamp,
      });
    }
    transaction.create(auditRef, {
      action: `attendance-outage-${input.operation}`,
      actorEmail: decodedToken.email || '',
      actorRole: decodedToken.adminRole || '',
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      entityId: input.outageId,
      entityType: 'system',
      kind: 'attendance-outage',
      note: input.reason,
      source: 'admin-dashboard',
      status: input.operation === 'create' ? 'active' : 'revoked',
    });
    transaction.create(requestRef, {
      auditId: auditRef.id,
      createdAt: timestamp,
      operation: input.operation,
      outageId: input.outageId,
      requestId: input.requestId,
    });
    return { auditId: auditRef.id, replayed: false };
  });
}

function applyAttendanceTransition({
  clock,
  event,
  fieldValue,
  reduced,
  sessionRef,
  source,
  transaction,
}) {
  for (const action of reduced.actions) {
    const intervalRef = sessionRef.firestore.doc(`roomAttendanceIntervals/${action.intervalId}`);
    if (action.kind === 'open') {
      transaction.set(intervalRef, {
        createdAt: fieldValue.serverTimestamp(),
        intervalId: action.intervalId,
        roomId: action.roomId,
        schemaVersion: ATTENDANCE_SCHEMA_VERSION,
        seatId: action.seatId,
        source,
        startAt: clock.timestampFromMillis(action.startAtMillis),
        state: 'open',
        uid: action.uid,
        updatedAt: fieldValue.serverTimestamp(),
      }, { merge: false });
    } else {
      transaction.set(intervalRef, {
        endAt: clock.timestampFromMillis(action.endAtMillis),
        exclusionReason: action.reason,
        qualifiedMillis: Math.max(0, action.endAtMillis - action.startAtMillis),
        purgeAfter: clock.timestampFromMillis(action.endAtMillis + ATTENDANCE_INTERVAL_RETENTION_MILLIS),
        state: 'closed',
        updatedAt: fieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }
  const session = reduced.session;
  const recentMuteEvents = appendMuteEvent(
    session.recentMuteEvents || [],
    event,
    session.muted,
  );
  transaction.set(sessionRef, {
    activeIntervalId: session.activeIntervalId || '',
    activeIntervalStartedAt: session.activeIntervalStartedAtMillis
      ? clock.timestampFromMillis(session.activeIntervalStartedAtMillis)
      : null,
    connected: session.connected,
    lastEventId: session.lastEventId,
    lastObservedAt: clock.timestampFromMillis(session.lastObservedAtMillis),
    microphonePublished: session.microphonePublished,
    muteGraceExpiresAt: session.muted && session.muteStartedAtMillis
      ? clock.timestampFromMillis(session.muteStartedAtMillis + DEFAULT_MUTE_GRACE_MILLIS)
      : null,
    muteStartedAt: session.muteStartedAtMillis
      ? clock.timestampFromMillis(session.muteStartedAtMillis)
      : null,
    muted: session.muted,
    participantSid: session.participantSid,
    recentMuteEvents,
    roomId: session.roomId,
    schemaVersion: ATTENDANCE_SCHEMA_VERSION,
    seated: session.seated,
    seatId: session.seatId,
    sessionId: session.sessionId,
    uid: session.uid,
    updatedAt: fieldValue.serverTimestamp(),
  }, { merge: true });
}

function sessionDocumentToCore(data) {
  return {
    ...data,
    activeIntervalStartedAtMillis: toMillis(data.activeIntervalStartedAt) || 0,
    lastObservedAtMillis: toMillis(data.lastObservedAt) || 0,
    muteStartedAtMillis: toMillis(data.muteStartedAt) || 0,
  };
}

function appendMuteEvent(previous, event, nowMuted) {
  if (event.kind !== 'authoritative-snapshot') return previous.slice(-19);
  const last = previous[previous.length - 1];
  const kind = nowMuted ? 'muted' : 'unmuted';
  if (last?.kind === kind) return previous.slice(-20);
  return [...previous.slice(-19), { kind, occurredAtMillis: event.occurredAtMillis }];
}

function isMicrophoneTrack(track) {
  const source = String(track?.source ?? '').toLowerCase();
  const type = String(track?.type ?? '').toLowerCase();
  return source === '2' || source.includes('microphone') || type === '0' && !source;
}

function hashScope(roomId, uid) {
  return crypto.createHash('sha256').update(`${roomId}\0${uid}`).digest('hex').slice(0, 24);
}

function toMillis(value) {
  if (Number.isSafeInteger(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  return 0;
}

module.exports = {
  getAttendanceShadowReport,
  ingestLiveKitAttendanceEvent,
  ingestSeatMembershipChange,
  mutateAttendanceOutageWindow,
  reconcileLiveKitAttendance,
  verifyAndIngestMicrophoneHint,
};
