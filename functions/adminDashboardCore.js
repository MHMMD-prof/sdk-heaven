const { hasAdminClaim } = require('./adminClaimsCore');

const ADMIN_DASHBOARD_ACTIONS = ['audit-events', 'overview', 'report-action', 'reports', 'room-action', 'rooms', 'session', 'user-note', 'users'];
const MAX_AUDIT_RESULTS = 25;
const ADMIN_REPORT_ACTIONS = ['assign', 'resolve'];
const ADMIN_REPORT_STATUSES = ['open', 'triage', 'resolved'];
const ADMIN_ROOM_ACTIONS = ['close-room', 'remove-member'];
const ADMIN_ROOM_STATUSES = ['active', 'closed'];
const MAX_REPORT_RESULTS = 25;
const MAX_ROOM_RESULTS = 25;
const MAX_USER_RESULTS = 25;
const MAX_USER_SEARCH_SCAN_RESULTS = 100;

function normalizeAdminDashboardBody(body = {}) {
  return {
    action: typeof body.action === 'string' ? body.action.trim() : '',
  };
}

function normalizeAdminUsersQuery(body = {}) {
  const rawLimit = Number(body.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_USER_RESULTS)
    : MAX_USER_RESULTS;
  const search = typeof body.search === 'string' ? body.search.trim().toLowerCase().slice(0, 80) : '';

  return {
    limit,
    readLimit: search ? MAX_USER_SEARCH_SCAN_RESULTS : limit,
    search,
  };
}

function normalizeAdminAuditQuery(body = {}) {
  const rawLimit = Number(body.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_AUDIT_RESULTS)
    : MAX_AUDIT_RESULTS;
  const actorUid = typeof body.actorUid === 'string' ? body.actorUid.trim().slice(0, 80) : '';
  const kind = typeof body.kind === 'string' ? body.kind.trim().slice(0, 80) : '';

  return {
    actorUid,
    kind,
    limit,
  };
}

function normalizeAdminRoomsQuery(body = {}) {
  const rawLimit = Number(body.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_ROOM_RESULTS)
    : MAX_ROOM_RESULTS;
  const status = typeof body.status === 'string' && ADMIN_ROOM_STATUSES.includes(body.status.trim())
    ? body.status.trim()
    : 'active';

  return {
    limit,
    status,
  };
}

function normalizeAdminReportsQuery(body = {}) {
  const rawLimit = Number(body.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_REPORT_RESULTS)
    : MAX_REPORT_RESULTS;
  const status = typeof body.status === 'string' && ADMIN_REPORT_STATUSES.includes(body.status.trim())
    ? body.status.trim()
    : 'open';

  return {
    limit,
    status,
  };
}

function normalizeAdminUserNote(body = {}) {
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  const targetUid = typeof body.targetUid === 'string' ? body.targetUid.trim() : '';

  if (!targetUid) {
    return { ok: false, status: 400, error: 'targetUid is required.' };
  }

  if (note.length < 2) {
    return { ok: false, status: 400, error: 'A note with at least 2 characters is required.' };
  }

  return {
    ok: true,
    value: {
      note,
      targetUid,
    },
  };
}

function normalizeAdminReportAction(body = {}) {
  const action = typeof body.reportAction === 'string' ? body.reportAction.trim() : '';
  const assigneeUid = typeof body.assigneeUid === 'string' ? body.assigneeUid.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  const reportId = typeof body.reportId === 'string' ? body.reportId.trim() : '';

  if (!ADMIN_REPORT_ACTIONS.includes(action)) {
    return { ok: false, status: 400, error: 'Valid report action is required.' };
  }

  if (!reportId) {
    return { ok: false, status: 400, error: 'reportId is required.' };
  }

  if (action === 'resolve' && note.length < 2) {
    return { ok: false, status: 400, error: 'A resolution note with at least 2 characters is required.' };
  }

  return {
    ok: true,
    value: {
      action,
      assigneeUid,
      note,
      reportId,
    },
  };
}

function normalizeAdminRoomAction(body = {}) {
  const action = typeof body.roomAction === 'string' ? body.roomAction.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 240) : '';
  const roomId = typeof body.roomId === 'string' ? body.roomId.trim() : '';
  const targetUid = typeof body.targetUid === 'string' ? body.targetUid.trim() : '';

  if (!ADMIN_ROOM_ACTIONS.includes(action)) {
    return { ok: false, status: 400, error: 'Valid room action is required.' };
  }

  if (!roomId) {
    return { ok: false, status: 400, error: 'roomId is required.' };
  }

  if (action === 'remove-member' && !targetUid) {
    return { ok: false, status: 400, error: 'targetUid is required.' };
  }

  return {
    ok: true,
    value: {
      action,
      reason,
      roomId,
      targetUid,
    },
  };
}

function resolveAdminDashboardRequest({ body = {}, decodedToken }) {
  if (!decodedToken?.email_verified) {
    return { ok: false, status: 403, error: 'Email verification is required.' };
  }

  if (!hasAdminClaim(decodedToken)) {
    return { ok: false, status: 403, error: 'Admin access is required.' };
  }

  const request = normalizeAdminDashboardBody(body);

  if (!ADMIN_DASHBOARD_ACTIONS.includes(request.action)) {
    return { ok: false, status: 400, error: 'Valid admin dashboard action is required.' };
  }

  return {
    ok: true,
    value: {
      action: request.action,
      admin: true,
      email: decodedToken.email || '',
      uid: decodedToken.uid,
    },
  };
}

function createAdminOverviewPayload(counts, generatedAt = new Date().toISOString()) {
  return {
    activeRooms: readCount(counts.activeRooms),
    adminAuditEvents: readCount(counts.adminAuditEvents),
    gameRooms: readCount(counts.gameRooms),
    generatedAt,
    moderationEvents: readCount(counts.moderationEvents),
    privateRooms: readCount(counts.privateRooms),
    reports: readCount(counts.reports),
    systemStatus: 'ok',
    users: readCount(counts.users),
  };
}

function mapAdminUserProfileDocument(id, data = {}) {
  const uid = typeof data.uid === 'string' && data.uid.trim() ? data.uid.trim() : id;

  if (!uid) {
    return null;
  }

  return {
    avatarLabel: typeof data.avatarLabel === 'string' ? data.avatarLabel.trim().slice(0, 2) : '',
    displayName: typeof data.displayName === 'string' ? data.displayName.trim() : '',
    email: typeof data.email === 'string' ? data.email.trim() : '',
    uid,
    updatedAt: readTimestampIso(data.updatedAt),
  };
}

function mapAdminRoomDocument(id, data = {}) {
  const roomId = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : id;

  if (!roomId) {
    return null;
  }

  return {
    createdAt: readTimestampIso(data.createdAt),
    currentGameId: typeof data.currentGameId === 'string' ? data.currentGameId.trim() : '',
    hostAvatarLabel: typeof data.hostAvatarLabel === 'string' ? data.hostAvatarLabel.trim().slice(0, 2) : '',
    hostDisplayName: typeof data.hostDisplayName === 'string' ? data.hostDisplayName.trim() : '',
    hostId: typeof data.hostId === 'string' ? data.hostId.trim() : '',
    id: roomId,
    participantCount: readCount(data.participantCount),
    status: ADMIN_ROOM_STATUSES.includes(data.status) ? data.status : '',
    title: typeof data.title === 'string' ? data.title.trim() : '',
    type: typeof data.type === 'string' ? data.type.trim() : '',
    updatedAt: readTimestampIso(data.updatedAt),
    visibility: typeof data.visibility === 'string' ? data.visibility.trim() : '',
  };
}

function mapAdminReportDocument(id, data = {}) {
  const reportId = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : id;

  if (!reportId) {
    return null;
  }

  return {
    assignedTo: typeof data.assignedTo === 'string' ? data.assignedTo.trim() : '',
    createdAt: readTimestampIso(data.createdAt),
    id: reportId,
    reason: typeof data.reason === 'string' ? data.reason.trim().slice(0, 240) : '',
    reporterUid: typeof data.reporterUid === 'string' ? data.reporterUid.trim() : '',
    resolutionNote: typeof data.resolutionNote === 'string' ? data.resolutionNote.trim().slice(0, 500) : '',
    roomId: typeof data.roomId === 'string' ? data.roomId.trim() : '',
    source: typeof data.source === 'string' ? data.source.trim() : '',
    status: ADMIN_REPORT_STATUSES.includes(data.status) ? data.status : '',
    subjectType: typeof data.subjectType === 'string' ? data.subjectType.trim() : '',
    targetUid: typeof data.targetUid === 'string' ? data.targetUid.trim() : '',
    updatedAt: readTimestampIso(data.updatedAt),
  };
}

function mapAdminAuditEventDocument(id, data = {}) {
  const eventId = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : id;

  if (!eventId) {
    return null;
  }

  return {
    action: typeof data.action === 'string' ? data.action.trim().slice(0, 120) : '',
    actorEmail: typeof data.actorEmail === 'string' ? data.actorEmail.trim().slice(0, 160) : '',
    actorUid: typeof data.actorUid === 'string' ? data.actorUid.trim() : '',
    assignedTo: typeof data.assignedTo === 'string' ? data.assignedTo.trim() : '',
    createdAt: readTimestampIso(data.createdAt),
    eventPath: typeof data.eventPath === 'string' ? data.eventPath.trim() : '',
    id: eventId,
    kind: typeof data.kind === 'string' ? data.kind.trim().slice(0, 80) : '',
    note: typeof data.note === 'string' ? data.note.trim().slice(0, 500) : '',
    reportId: typeof data.reportId === 'string' ? data.reportId.trim() : '',
    roomId: typeof data.roomId === 'string' ? data.roomId.trim() : '',
    status: typeof data.status === 'string' ? data.status.trim() : '',
    targetUid: typeof data.targetUid === 'string' ? data.targetUid.trim() : '',
  };
}

function filterAdminUserRows(rows, search) {
  if (!search) {
    return rows;
  }

  return rows.filter((row) => {
    const haystack = `${row.uid} ${row.email} ${row.displayName}`.toLowerCase();
    return haystack.includes(search);
  });
}

function readCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function readTimestampIso(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value && typeof value === 'object' && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }

  if (value && typeof value === 'object' && typeof value.toMillis === 'function') {
    return new Date(value.toMillis()).toISOString();
  }

  return '';
}

module.exports = {
  ADMIN_DASHBOARD_ACTIONS,
  createAdminOverviewPayload,
  filterAdminUserRows,
  mapAdminAuditEventDocument,
  mapAdminReportDocument,
  mapAdminRoomDocument,
  mapAdminUserProfileDocument,
  normalizeAdminAuditQuery,
  normalizeAdminReportAction,
  normalizeAdminReportsQuery,
  normalizeAdminRoomAction,
  normalizeAdminRoomsQuery,
  normalizeAdminUserNote,
  normalizeAdminUsersQuery,
  normalizeAdminDashboardBody,
  resolveAdminDashboardRequest,
};
