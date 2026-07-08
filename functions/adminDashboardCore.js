const { hasAdminClaim } = require('./adminClaimsCore');

const ADMIN_DASHBOARD_ACTIONS = ['overview', 'session'];

function normalizeAdminDashboardBody(body = {}) {
  return {
    action: typeof body.action === 'string' ? body.action.trim() : '',
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

function readCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

module.exports = {
  ADMIN_DASHBOARD_ACTIONS,
  createAdminOverviewPayload,
  normalizeAdminDashboardBody,
  resolveAdminDashboardRequest,
};
