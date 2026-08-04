const crypto = require('node:crypto');

const ATTENDANCE_SCHEMA_VERSION = 1;
const DEFAULT_MUTE_GRACE_MILLIS = 5 * 60 * 1000;
const DEFAULT_RECONNECT_MERGE_MILLIS = 30 * 1000;
const SUPPORTED_WEBHOOK_EVENTS = Object.freeze([
  'participant_joined',
  'participant_left',
  'participant_connection_aborted',
  'track_published',
  'track_unpublished',
]);

function createAttendanceSessionId(roomId, uid) {
  const normalizedRoomId = normalizeId(roomId, 128);
  const normalizedUid = normalizeUid(uid);
  if (!normalizedRoomId || !normalizedUid) return '';
  return `ras_${crypto.createHash('sha256').update(`${normalizedRoomId}\0${normalizedUid}`).digest('hex').slice(0, 40)}`;
}

function createAttendanceIntervalId(sessionId, startAtMillis) {
  if (!/^ras_[a-f0-9]{40}$/.test(sessionId) || !isMillis(startAtMillis)) return '';
  return `rai_${crypto.createHash('sha256').update(`${sessionId}\0${startAtMillis}`).digest('hex').slice(0, 40)}`;
}

function normalizeLiveKitWebhookEvent(event) {
  if (!isPlainObject(event) || !SUPPORTED_WEBHOOK_EVENTS.includes(event.event)) {
    return { ok: false, code: 'UNSUPPORTED_EVENT' };
  }
  const eventId = normalizeId(event.id, 160);
  const roomId = normalizeId(event.room?.name, 128);
  const uid = normalizeUid(event.participant?.identity);
  const participantSid = normalizeId(event.participant?.sid, 128);
  const occurredAtMillis = secondsToMillis(event.createdAt);
  if (!eventId || !roomId || !uid || !participantSid || !isMillis(occurredAtMillis)) {
    return { ok: false, code: 'INVALID_EVENT' };
  }
  const track = normalizeTrack(event.track);
  if (['track_published', 'track_unpublished'].includes(event.event) && !track) {
    return { ok: false, code: 'INVALID_TRACK' };
  }
  return {
    ok: true,
    value: {
      eventId,
      kind: event.event,
      occurredAtMillis,
      participantSid,
      roomId,
      schemaVersion: ATTENDANCE_SCHEMA_VERSION,
      track,
      uid,
    },
  };
}

function normalizeAuthoritativeSnapshot(input) {
  if (!isPlainObject(input)) return { ok: false, code: 'INVALID_SNAPSHOT' };
  const eventId = normalizeId(input.eventId, 160);
  const roomId = normalizeId(input.roomId, 128);
  const uid = normalizeUid(input.uid);
  const participantSid = normalizeId(input.participantSid, 128);
  if (
    !eventId
    || !roomId
    || !uid
    || !participantSid
    || !isMillis(input.occurredAtMillis)
    || typeof input.connected !== 'boolean'
    || typeof input.microphonePublished !== 'boolean'
    || typeof input.muted !== 'boolean'
  ) return { ok: false, code: 'INVALID_SNAPSHOT' };
  return {
    ok: true,
    value: {
      connected: input.connected,
      eventId,
      kind: 'authoritative-snapshot',
      microphonePublished: input.microphonePublished,
      muted: input.muted,
      occurredAtMillis: input.occurredAtMillis,
      participantSid,
      roomId,
      schemaVersion: ATTENDANCE_SCHEMA_VERSION,
      uid,
    },
  };
}

function reduceAttendanceSession(previous, event, options = {}) {
  const muteGraceMillis = positiveInteger(options.muteGraceMillis, DEFAULT_MUTE_GRACE_MILLIS);
  const current = normalizeSession(previous, event);
  if (!current || !event || !isMillis(event.occurredAtMillis)) {
    return { ok: false, code: 'INVALID_TRANSITION' };
  }
  if (current.lastObservedAtMillis > event.occurredAtMillis) {
    return {
      ok: true,
      value: {
        actions: [],
        ignored: true,
        reason: 'stale-event',
        session: current,
      },
    };
  }

  const actions = [];
  closeExpiredMuteGrace(current, event.occurredAtMillis, muteGraceMillis, actions);
  const wasEligible = isSessionEligible(current, event.occurredAtMillis, muteGraceMillis);
  applyEvent(current, event);
  const isEligible = isSessionEligible(current, event.occurredAtMillis, muteGraceMillis);

  if (wasEligible && !isEligible && current.activeIntervalId) {
    actions.push(closeAction(current, event.occurredAtMillis, exclusionReason(current)));
    current.activeIntervalId = '';
    current.activeIntervalStartedAtMillis = 0;
  } else if (!wasEligible && isEligible && !current.activeIntervalId) {
    current.activeIntervalStartedAtMillis = event.occurredAtMillis;
    current.activeIntervalId = createAttendanceIntervalId(current.sessionId, event.occurredAtMillis);
    actions.push(openAction(current, event.occurredAtMillis));
  }

  current.lastEventId = event.eventId;
  current.lastObservedAtMillis = event.occurredAtMillis;
  current.schemaVersion = ATTENDANCE_SCHEMA_VERSION;
  return { ok: true, value: { actions, ignored: false, session: current } };
}

function splitAndUnionAttendanceIntervals(intervals, options = {}) {
  const dayStartAtMillis = options.dayStartAtMillis;
  const dayEndAtMillis = options.dayEndAtMillis;
  const outageWindows = Array.isArray(options.outageWindows) ? options.outageWindows : [];
  if (!isMillis(dayStartAtMillis) || !isMillis(dayEndAtMillis) || dayEndAtMillis <= dayStartAtMillis) {
    return { ok: false, code: 'INVALID_DAY' };
  }
  const clipped = [];
  for (const interval of Array.isArray(intervals) ? intervals : []) {
    const start = Math.max(dayStartAtMillis, toMillis(interval.startAtMillis ?? interval.startAt));
    const end = Math.min(dayEndAtMillis, toMillis(interval.endAtMillis ?? interval.endAt));
    if (isMillis(start) && isMillis(end) && end > start) clipped.push([start, end]);
  }
  clipped.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged = [];
  for (const interval of clipped) {
    const last = merged[merged.length - 1];
    if (!last || interval[0] > last[1]) merged.push([...interval]);
    else last[1] = Math.max(last[1], interval[1]);
  }
  const outage = normalizeWindows(outageWindows, dayStartAtMillis, dayEndAtMillis);
  return {
    ok: true,
    value: {
      dayEndAtMillis,
      dayStartAtMillis,
      excusedMillis: duration(outage),
      intervals: merged.map(([startAtMillis, endAtMillis]) => ({ endAtMillis, startAtMillis })),
      qualifiedMillis: duration(merged),
    },
  };
}

function groupReconnectIntervals(intervals, reconnectMergeMillis = DEFAULT_RECONNECT_MERGE_MILLIS) {
  const normalized = (Array.isArray(intervals) ? intervals : []).flatMap((interval) => {
    const startAtMillis = toMillis(interval.startAtMillis ?? interval.startAt);
    const endAtMillis = toMillis(interval.endAtMillis ?? interval.endAt);
    return isMillis(startAtMillis) && isMillis(endAtMillis) && endAtMillis > startAtMillis
      ? [{ endAtMillis, startAtMillis }]
      : [];
  }).sort((left, right) => left.startAtMillis - right.startAtMillis);
  const groups = [];
  for (const interval of normalized) {
    const last = groups[groups.length - 1];
    if (!last || interval.startAtMillis - last.endAtMillis > reconnectMergeMillis) {
      groups.push({
        endAtMillis: interval.endAtMillis,
        intervalCount: 1,
        qualifiedMillis: interval.endAtMillis - interval.startAtMillis,
        startAtMillis: interval.startAtMillis,
      });
    } else {
      last.endAtMillis = Math.max(last.endAtMillis, interval.endAtMillis);
      last.intervalCount += 1;
      last.qualifiedMillis += interval.endAtMillis - interval.startAtMillis;
    }
  }
  return groups;
}

function detectMuteGraceCycling(events, options = {}) {
  const windowMillis = positiveInteger(options.windowMillis, 30 * 60 * 1000);
  const threshold = positiveInteger(options.threshold, 4);
  const sorted = (Array.isArray(events) ? events : [])
    .filter((event) => ['muted', 'unmuted'].includes(event.kind) && isMillis(event.occurredAtMillis))
    .sort((a, b) => a.occurredAtMillis - b.occurredAtMillis);
  const resets = [];
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index - 1].kind === 'muted' && sorted[index].kind === 'unmuted') {
      resets.push(sorted[index].occurredAtMillis);
    }
  }
  for (let index = 0; index < resets.length; index += 1) {
    const count = resets.filter((value) => value >= resets[index] && value <= resets[index] + windowMillis).length;
    if (count >= threshold) return { flagged: true, resetCount: count, windowMillis };
  }
  return { flagged: false, resetCount: resets.length, windowMillis };
}

function normalizeAttendanceDeviceEnrollment(input) {
  if (!isPlainObject(input) || Object.keys(input).some((key) => ![
    'attestationProvider',
    'attestationVerdictId',
    'installationId',
    'platform',
    'state',
    'uid',
  ].includes(key))) return { ok: false, code: 'INVALID_DEVICE_ENROLLMENT' };
  const uid = normalizeUid(input.uid);
  const installationId = normalizeId(input.installationId, 128);
  const attestationVerdictId = normalizeId(input.attestationVerdictId, 160);
  if (
    !uid
    || !installationId
    || !attestationVerdictId
    || input.platform !== 'android'
    || input.attestationProvider !== 'play-integrity'
    || !['pending-review', 'active', 'replaced', 'revoked'].includes(input.state)
  ) return { ok: false, code: 'INVALID_DEVICE_ENROLLMENT' };
  return {
    ok: true,
    value: {
      attestationProvider: 'play-integrity',
      attestationVerdictId,
      installationId,
      platform: 'android',
      schemaVersion: ATTENDANCE_SCHEMA_VERSION,
      state: input.state,
      uid,
    },
  };
}

function normalizeAttendanceOutageMutation(input) {
  if (!isPlainObject(input)) return { ok: false, code: 'INVALID_OUTAGE' };
  const operation = input.operation;
  const requestId = normalizeId(input.requestId, 100);
  const outageId = normalizeId(input.outageId || input.requestId, 100);
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  const startAtMillis = Number(input.startAtMillis);
  const endAtMillis = Number(input.endAtMillis);
  if (
    !['create', 'revoke'].includes(operation)
    || !requestId
    || !outageId
    || reason.length < 3
    || reason.length > 500
  ) return { ok: false, code: 'INVALID_OUTAGE' };
  if (operation === 'create' && (
    !isMillis(startAtMillis)
    || !isMillis(endAtMillis)
    || endAtMillis <= startAtMillis
    || endAtMillis - startAtMillis > 7 * 24 * 60 * 60 * 1000
  )) return { ok: false, code: 'INVALID_OUTAGE' };
  return {
    ok: true,
    value: {
      endAtMillis: operation === 'create' ? endAtMillis : 0,
      operation,
      outageId,
      reason,
      requestId,
      startAtMillis: operation === 'create' ? startAtMillis : 0,
    },
  };
}

function attendanceSessionDefaults({ participantSid, roomId, sessionId, uid }) {
  return {
    activeIntervalId: '',
    activeIntervalStartedAtMillis: 0,
    connected: false,
    lastEventId: '',
    lastObservedAtMillis: 0,
    microphonePublished: false,
    muteStartedAtMillis: 0,
    muted: true,
    participantSid,
    roomId,
    schemaVersion: ATTENDANCE_SCHEMA_VERSION,
    seated: false,
    seatId: '',
    sessionId,
    uid,
  };
}

function normalizeSession(previous, event) {
  const sessionId = createAttendanceSessionId(event?.roomId, event?.uid);
  if (!sessionId) return undefined;
  const base = attendanceSessionDefaults({
    participantSid: event.participantSid,
    roomId: event.roomId,
    sessionId,
    uid: event.uid,
  });
  if (!isPlainObject(previous)) return base;
  return {
    ...base,
    ...previous,
    participantSid: event.participantSid || previous.participantSid || '',
    roomId: event.roomId,
    sessionId,
    uid: event.uid,
  };
}

function applyEvent(session, event) {
  if (event.kind === 'participant_joined') {
    session.connected = true;
    session.participantSid = event.participantSid;
  } else if (event.kind === 'participant_left' || event.kind === 'participant_connection_aborted') {
    session.connected = false;
    session.microphonePublished = false;
    session.muted = true;
    session.muteStartedAtMillis = 0;
  } else if (event.kind === 'track_published' && event.track?.microphone) {
    session.microphonePublished = true;
    session.muted = event.track.muted;
    session.muteStartedAtMillis = event.track.muted ? event.occurredAtMillis : 0;
  } else if (event.kind === 'track_unpublished' && event.track?.microphone) {
    session.microphonePublished = false;
    session.muted = true;
    session.muteStartedAtMillis = 0;
  } else if (event.kind === 'authoritative-snapshot') {
    session.connected = event.connected;
    session.microphonePublished = event.microphonePublished;
    if (event.muted && !session.muted) session.muteStartedAtMillis = event.occurredAtMillis;
    if (!event.muted) session.muteStartedAtMillis = 0;
    session.muted = event.muted;
  } else if (event.kind === 'seat-state') {
    session.seated = event.seated === true;
    session.seatId = event.seated ? event.seatId : '';
  } else if (event.kind === 'mute-deadline') {
    // The pre-transition expiry check closes the interval.
  }
}

function closeExpiredMuteGrace(session, atMillis, graceMillis, actions) {
  if (
    session.activeIntervalId
    && session.muted
    && session.muteStartedAtMillis > 0
    && atMillis >= session.muteStartedAtMillis + graceMillis
  ) {
    actions.push(closeAction(session, session.muteStartedAtMillis + graceMillis, 'muted-over-grace'));
    session.activeIntervalId = '';
    session.activeIntervalStartedAtMillis = 0;
  }
}

function isSessionEligible(session, atMillis, graceMillis) {
  return session.connected
    && session.seated
    && session.microphonePublished
    && (!session.muted || session.muteStartedAtMillis > 0 && atMillis < session.muteStartedAtMillis + graceMillis);
}

function exclusionReason(session) {
  if (!session.connected) return 'disconnected';
  if (!session.seated) return 'not-seated';
  if (!session.microphonePublished) return 'microphone-unpublished';
  if (session.muted) return 'muted-over-grace';
  return 'not-qualified';
}

function openAction(session, startAtMillis) {
  return {
    intervalId: session.activeIntervalId,
    kind: 'open',
    roomId: session.roomId,
    seatId: session.seatId,
    startAtMillis,
    uid: session.uid,
  };
}

function closeAction(session, endAtMillis, reason) {
  return {
    endAtMillis,
    intervalId: session.activeIntervalId,
    kind: 'close',
    reason,
    roomId: session.roomId,
    startAtMillis: session.activeIntervalStartedAtMillis,
    uid: session.uid,
  };
}

function normalizeTrack(track) {
  if (!isPlainObject(track)) return undefined;
  const sid = normalizeId(track.sid, 128);
  if (!sid) return undefined;
  const source = String(track.source || '').toLowerCase();
  const type = String(track.type || '').toLowerCase();
  return {
    microphone: source === 'microphone' || source === '2' || type === 'audio' && !source,
    muted: track.muted === true,
    sid,
  };
}

function normalizeWindows(windows, start, end) {
  const clipped = windows.flatMap((window) => {
    const from = Math.max(start, toMillis(window.startAtMillis ?? window.startAt));
    const to = Math.min(end, toMillis(window.endAtMillis ?? window.endAt));
    return isMillis(from) && isMillis(to) && to > from ? [[from, to]] : [];
  }).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const item of clipped) {
    const last = merged[merged.length - 1];
    if (!last || item[0] > last[1]) merged.push([...item]);
    else last[1] = Math.max(last[1], item[1]);
  }
  return merged;
}

function duration(intervals) {
  return intervals.reduce((total, [start, end]) => total + end - start, 0);
}

function secondsToMillis(value) {
  const seconds = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds * 1000 : NaN;
}

function toMillis(value) {
  if (Number.isSafeInteger(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  return NaN;
}

function isMillis(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function normalizeId(value, maxLength) {
  const result = typeof value === 'string' ? value.trim() : '';
  return result && result.length <= maxLength && !result.includes('/') ? result : '';
}

function normalizeUid(value) {
  return normalizeId(value, 128);
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

module.exports = {
  ATTENDANCE_SCHEMA_VERSION,
  DEFAULT_MUTE_GRACE_MILLIS,
  DEFAULT_RECONNECT_MERGE_MILLIS,
  SUPPORTED_WEBHOOK_EVENTS,
  createAttendanceIntervalId,
  createAttendanceSessionId,
  detectMuteGraceCycling,
  groupReconnectIntervals,
  normalizeAttendanceDeviceEnrollment,
  normalizeAttendanceOutageMutation,
  normalizeAuthoritativeSnapshot,
  normalizeLiveKitWebhookEvent,
  reduceAttendanceSession,
  splitAndUnionAttendanceIntervals,
};
