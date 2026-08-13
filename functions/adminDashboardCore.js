const { canAdminPerformAction, getAdminPermissions, hasAdminClaim, resolveAdminRole } = require('./adminClaimsCore');
const { inspectPublicProfile, normalizeSearchName } = require('./socialProfileCore');
const { mapStoreCatalogItem } = require('./storeCore');
const { mapGiftCatalogItem } = require('./socialGiftsCore');
const { normalizeRoomGiftPolicyUpdate } = require('./roomGiftPolicyCore');

const ADMIN_DASHBOARD_ACTIONS = [
  'admin-settings',
  'admin-settings-update',
  'account-deletion-jobs',
  'account-deletion-retry',
  'administrator-action',
  'administrators',
  'attendance-outage-mutate',
  'attendance-shadow',
  'audit-detail',
  'audit-events',
  'audit-export',
  'audit-summary',
  'client-error',
  'cosmetic-assets',
  'cosmetic-assets-mutate',
  'cosmetic-custom-eligibility',
  'cosmetic-custom-submission-preview',
  'cosmetic-custom-submissions',
  'cosmetics-renderer-disable',
  'couple-dissolve',
  'daily-login-campaign',
  'daily-login-campaign-mutate',
  'ops-events',
  'ops-events-mutate',
  'direct-chat-action',
  'direct-chat-evidence',
  'direct-chat-ops-status',
  'direct-chat-retention-get',
  'direct-chat-retention-set',
  'economy-export',
  'economy-history',
  'feature-flag-update',
  'gift-catalog',
  'gift-catalog-upsert',
  'overview',
  'payroll-mutate',
  'payroll-overview',
  'push-audience-estimate',
  'push-campaigns-list',
  'push-notification-send',
  'report-action',
  'report-detail',
  'report-summary',
  'representative-operations',
  'representative-override-update',
  'representative-pin-reset',
  'representative-policy-update',
  'representative-reversal',
  'representative-update',
  'reports',
  'rocket-campaign',
  'rocket-campaign-mutate',
  'room-target-campaign',
  'room-target-campaign-mutate',
  'room-target-member-hold',
  'weekly-incentive-integrity',
  'weekly-incentive-integrity-mutate',
  'weekly-incentive-reconcile',
  'room-action',
  'room-detail',
  'room-gift-policy-update',
  'room-summary',
  'room-theme',
  'room-theme-mutate',
  'rooms',
  'session',
  'special-id-catalog',
  'special-id-upsert',
  'store-catalog',
  'store-catalog-upsert',
  'store-item-detail',
  'store-summary',
  'user-action',
  'user-detail',
  'user-history',
  'user-note',
  'user-summary',
  'users',
  'voice-room-launch-status',
  'wallet-adjust',
  'wallet-credit',
];
const ADMIN_ROLES = ['owner', 'super-moderator', 'moderator', 'support', 'catalog-manager', 'auditor'];
const APPROVED_ADMIN_FEATURE_FLAGS = [
  'avatarUploads',
  'usersDiscovery',
  'friends',
  'wallet',
  'gifts',
  'couples',
  'pushNotifications',
  'representativeTransfers',
  'directMessages',
  'directMessageRequests',
  'directMessageMedia',
  'personalChatsFrontendV2',
];
const APPROVED_COSMETICS_DARK_FLAGS = [
  'cosmetics_couple_effects',
  'cosmetics_couple_entrances',
  'cosmetics_custom_submissions',
  'cosmetics_custom_rendering',
];
const MAX_STORE_CATALOG_RESULTS = 50;
const MAX_STORE_FILTER_SCAN_RESULTS = 100;
const MAX_ECONOMY_RESULTS = 25;
const MAX_AUDIT_RESULTS = 25;
const MAX_AUDIT_FILTER_SCAN_RESULTS = 100;
const ADMIN_AUDIT_ENTITY_TYPES = ['catalog', 'economy', 'report', 'room', 'system', 'user'];
const ADMIN_REPORT_ACTIONS = ['assign', 'escalate', 'note', 'reopen', 'resolve', 'triage'];
const ADMIN_REPORT_SEVERITIES = ['low', 'medium', 'high', 'critical'];
const ADMIN_REPORT_STATUSES = ['open', 'triage', 'resolved'];
const ADMIN_ROOM_ACTIONS = ['clear-staff-lockdown', 'close-room', 'kick-everyone', 'mute-member', 'remove-member', 'reopen-room', 'reverse-ownership-transfer', 'staff-lockdown', 'transfer-host', 'unmute-member'];
const ADMIN_ROOM_STATUSES = ['active', 'closed'];
const MAX_REPORT_RESULTS = 25;
const MAX_REPORT_FILTER_SCAN_RESULTS = 100;
const MAX_ROOM_RESULTS = 25;
const MAX_ROOM_FILTER_SCAN_RESULTS = 100;
const MAX_USER_RESULTS = 25;
const MAX_USER_SEARCH_SCAN_RESULTS = 100;
const ADMIN_USER_ACTIONS = ['avatar-approve', 'avatar-reject', 'ban', 'force-sign-out', 'mute', 'note', 'suspend', 'unban', 'unmute', 'unsuspend', 'warn'];
const ADMIN_USER_MODERATION_STATUSES = ['active', 'suspended', 'removed'];
const ADMIN_USER_PROFILE_STATUSES = ['ready', 'missing', 'invalid'];
const RECENT_ADMIN_AUTH_MAX_AGE_MS = 10 * 60 * 1000;

function normalizeAdminDashboardBody(body = {}) {
  return {
    action: typeof body.action === 'string' ? body.action.trim() : '',
  };
}

function normalizeAdminSettingsUpdate(body = {}) {
  const density = body.density === 'compact' ? 'compact' : body.density === 'comfortable' ? 'comfortable' : '';
  const notifications = body.notifications && typeof body.notifications === 'object' ? body.notifications : {};
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  if (!density) return { ok: false, status: 400, error: 'A valid density is required.' };
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) return { ok: false, status: 400, error: 'A valid requestId is required.' };
  return {
    ok: true,
    value: {
      density,
      notifications: {
        flaggedRooms: notifications.flaggedRooms !== false,
        operationalFailures: notifications.operationalFailures !== false,
        urgentReports: notifications.urgentReports !== false,
      },
      reduceMotion: body.reduceMotion === true,
      requestId,
    },
  };
}

function normalizeAdministratorAction(body = {}) {
  const action = typeof body.administratorAction === 'string' ? body.administratorAction.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const role = typeof body.role === 'string' ? body.role.trim() : '';
  const targetUid = typeof body.targetUid === 'string' ? body.targetUid.trim().slice(0, 128) : '';
  const regionCodes = normalizeRegionCodes(body.regionCodes);
  if (!['grant-role', 'change-role', 'remove-admin', 'revoke-sessions', 'set-region-scope'].includes(action)) {
    return { ok: false, status: 400, error: 'A valid administrator action is required.' };
  }
  if (action === 'grant-role' && !/^\S+@\S+\.\S+$/.test(email)) return { ok: false, status: 400, error: 'A valid existing account email is required.' };
  if (action !== 'grant-role' && !targetUid) return { ok: false, status: 400, error: 'targetUid is required.' };
  if (['grant-role', 'change-role'].includes(action) && !ADMIN_ROLES.includes(role)) return { ok: false, status: 400, error: 'A valid administrator role is required.' };
  if (action === 'set-region-scope' && regionCodes === null) {
    return { ok: false, status: 400, error: 'regionCodes must be an array of supported country codes.' };
  }
  if (reason.length < 3) return { ok: false, status: 400, error: 'A reason with at least 3 characters is required.' };
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) return { ok: false, status: 400, error: 'A valid requestId is required.' };
  return { ok: true, value: { action, email, reason, regionCodes: regionCodes || [], requestId, role, targetUid } };
}

function normalizeRegionCodes(value) {
  if (!Array.isArray(value)) return null;
  const { ROOM_COUNTRY_CODES } = require('./roomCommandCore');
  const codes = [...new Set(value
    .map((item) => typeof item === 'string' ? item.trim().toUpperCase() : '')
    .filter((code) => ROOM_COUNTRY_CODES.includes(code)))];
  if (codes.length !== value.filter((item) => typeof item === 'string' && item.trim()).length) return null;
  return codes;
}

function resolveOperatorRegionScope(decodedToken, operatorProfile) {
  const role = resolveAdminRole(decodedToken);
  if (role === 'owner') {
    return { ok: true, role, regionCodes: null };
  }
  if (role !== 'super-moderator') {
    return { ok: true, role, regionCodes: null };
  }
  if (
    !operatorProfile
    || operatorProfile.uid !== decodedToken.uid
    || operatorProfile.role !== 'super-moderator'
    || operatorProfile.status !== 'active'
    || !Array.isArray(operatorProfile.regionCodes)
    || operatorProfile.regionCodes.length === 0
  ) {
    return { ok: false, status: 403, error: 'Super Moderator region scope is missing or inactive.' };
  }
  const regionCodes = [...new Set(operatorProfile.regionCodes
    .map((value) => typeof value === 'string' ? value.trim().toUpperCase() : '')
    .filter(Boolean))];
  if (regionCodes.length === 0) {
    return { ok: false, status: 403, error: 'Super Moderator region scope is missing or inactive.' };
  }
  return { ok: true, role, regionCodes };
}

function assertFreshAdminAuth(decodedToken, nowMs = Date.now()) {
  const authTimeMs = Number(decodedToken?.auth_time) * 1000;
  if (
    !Number.isFinite(authTimeMs)
    || authTimeMs > nowMs + 30_000
    || nowMs - authTimeMs > RECENT_ADMIN_AUTH_MAX_AGE_MS
  ) {
    return {
      ok: false,
      status: 401,
      code: 'FRESH_AUTH_REQUIRED',
      error: 'Fresh authentication is required for this action.',
    };
  }
  return { ok: true };
}

function assertAdminTargetHierarchy(actorRole, targetOperatorProfile, targetUid) {
  if (
    !targetOperatorProfile
    || targetOperatorProfile.status === 'revoked'
  ) {
    return { ok: true };
  }
  if (
    actorRole === 'super-moderator'
    && ['owner', 'super-moderator'].includes(targetOperatorProfile.role)
  ) {
    return {
      ok: false,
      status: 403,
      code: 'TARGET_PROTECTED',
      error: 'Super Moderators cannot act on the Platform Owner or another Super Moderator.',
    };
  }
  if (actorRole === 'owner' && targetOperatorProfile.role === 'owner') {
    return {
      ok: false,
      status: 403,
      code: 'TARGET_PROTECTED',
      error: 'Platform Owners cannot moderate another Platform Owner through regional tools.',
    };
  }
  return { ok: true };
}

function assertRoomInOperatorScope(scope, room) {
  if (!scope.ok) return scope;
  if (!scope.regionCodes) return { ok: true };
  const countryCode = typeof room?.countryCode === 'string' ? room.countryCode.trim().toUpperCase() : '';
  if (!scope.regionCodes.includes(countryCode)) {
    return { ok: false, status: 403, error: 'This room is outside the operator region scope.', code: 'REGION_SCOPE_DENIED' };
  }
  return { ok: true };
}

function assertUserInOperatorScope(scope, userRow) {
  if (!scope.ok) return scope;
  if (!scope.regionCodes) return { ok: true };
  const countryCode = typeof userRow?.countryCode === 'string' ? userRow.countryCode.trim().toUpperCase() : '';
  if (!countryCode || !scope.regionCodes.includes(countryCode)) {
    return { ok: false, status: 403, error: 'This user is outside the operator region scope.', code: 'REGION_SCOPE_DENIED' };
  }
  return { ok: true };
}

function filterRowsByOperatorScope(rows, scope, countryKey = 'countryCode') {
  if (!scope.ok || !scope.regionCodes) return rows;
  return rows.filter((row) => scope.regionCodes.includes(String(row?.[countryKey] || '').toUpperCase()));
}

function normalizeAdminFeatureFlagUpdate(body = {}) {
  const enabled = body.enabled;
  const flag = typeof body.flag === 'string' ? body.flag.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt.trim() : '';
  if (!APPROVED_ADMIN_FEATURE_FLAGS.includes(flag)) return { ok: false, status: 400, error: 'This feature flag is not approved for dashboard management.' };
  if (typeof enabled !== 'boolean') return { ok: false, status: 400, error: 'enabled must be a boolean.' };
  if (reason.length < 3) return { ok: false, status: 400, error: 'A reason with at least 3 characters is required.' };
  if (expectedUpdatedAt !== 'missing' && !Number.isFinite(Date.parse(expectedUpdatedAt))) return { ok: false, status: 400, error: 'A current feature flag revision is required.' };
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) return { ok: false, status: 400, error: 'A valid requestId is required.' };
  return { ok: true, value: { enabled, expectedUpdatedAt: expectedUpdatedAt === 'missing' ? 'missing' : new Date(expectedUpdatedAt).toISOString(), flag, reason, requestId } };
}

function readRetentionDays(body, key) {
  if (body[key] === undefined || body[key] === null || body[key] === '') return undefined;
  const days = Number(body[key]);
  if (!Number.isInteger(days) || days < 1) return { ok: false };
  return { ok: true, value: days };
}

function normalizeAdminDirectChatRetentionSet(body = {}) {
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const messageRetentionDays = readRetentionDays(body, 'messageRetentionDays');
  const evidenceRetentionDays = readRetentionDays(body, 'evidenceRetentionDays');
  const legalHoldRetentionDays = readRetentionDays(body, 'legalHoldRetentionDays');
  if (messageRetentionDays && messageRetentionDays.ok === false) {
    return { ok: false, status: 400, error: 'messageRetentionDays must be a whole number of days.' };
  }
  if (evidenceRetentionDays && evidenceRetentionDays.ok === false) {
    return { ok: false, status: 400, error: 'evidenceRetentionDays must be a whole number of days.' };
  }
  if (legalHoldRetentionDays && legalHoldRetentionDays.ok === false) {
    return { ok: false, status: 400, error: 'legalHoldRetentionDays must be a whole number of days.' };
  }
  if (
    messageRetentionDays?.value === undefined
    && evidenceRetentionDays?.value === undefined
    && legalHoldRetentionDays?.value === undefined
  ) {
    return { ok: false, status: 400, error: 'Provide at least one retention day field.' };
  }
  if (reason.length < 3) return { ok: false, status: 400, error: 'A reason with at least 3 characters is required.' };
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) return { ok: false, status: 400, error: 'A valid requestId is required.' };
  return {
    ok: true,
    value: {
      ...(evidenceRetentionDays?.value !== undefined ? { evidenceRetentionDays: evidenceRetentionDays.value } : {}),
      ...(legalHoldRetentionDays?.value !== undefined ? { legalHoldRetentionDays: legalHoldRetentionDays.value } : {}),
      ...(messageRetentionDays?.value !== undefined ? { messageRetentionDays: messageRetentionDays.value } : {}),
      reason,
      requestId,
    },
  };
}

function normalizeAdminCosmeticsRendererDisable(body = {}) {
  const flag = typeof body.flag === 'string' ? body.flag.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  if (!APPROVED_COSMETICS_DARK_FLAGS.includes(flag)) return { ok: false, status: 400, error: 'This cosmetics renderer flag is not approved for emergency control.' };
  if (body.enabled !== undefined && body.enabled !== false) return { ok: false, status: 400, error: 'Emergency cosmetics controls can only force false.' };
  if (reason.length < 3) return { ok: false, status: 400, error: 'A reason with at least 3 characters is required.' };
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) return { ok: false, status: 400, error: 'A valid requestId is required.' };
  return { ok: true, value: { flag, reason, requestId } };
}

function normalizeAdminClientError(body = {}) {
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 500) : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const route = typeof body.route === 'string' ? body.route.trim().slice(0, 160) : '';
  const source = typeof body.source === 'string' ? body.source.trim().slice(0, 120) : '';
  const stack = typeof body.stack === 'string' ? body.stack.trim().slice(0, 1600) : '';
  if (!message) return { ok: false, status: 400, error: 'A client error message is required.' };
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) return { ok: false, status: 400, error: 'A valid requestId is required.' };
  return { ok: true, value: { message, requestId, route, source, stack } };
}

function normalizeAdminUsersQuery(body = {}) {
  const rawLimit = Number(body.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_USER_RESULTS)
    : MAX_USER_RESULTS;
  const exactSearch = typeof body.search === 'string' ? body.search.trim().slice(0, 80) : '';
  const search = exactSearch.toLowerCase();
  const avatarStatus = typeof body.avatarStatus === 'string' && ['clear', 'pending', 'removed'].includes(body.avatarStatus.trim()) ? body.avatarStatus.trim() : '';
  const countryCode = typeof body.countryCode === 'string' ? body.countryCode.trim().toUpperCase().slice(0, 2) : '';
  const cursor = typeof body.cursor === 'string' ? body.cursor.trim().slice(0, 512) : '';
  const moderationStatus = typeof body.moderationStatus === 'string' && ADMIN_USER_MODERATION_STATUSES.includes(body.moderationStatus.trim()) ? body.moderationStatus.trim() : '';
  const profileStatus = typeof body.profileStatus === 'string' && ADMIN_USER_PROFILE_STATUSES.includes(body.profileStatus.trim()) ? body.profileStatus.trim() : '';
  const relationship = typeof body.relationship === 'string' && ['coupled', 'single'].includes(body.relationship.trim()) ? body.relationship.trim() : '';

  return {
    avatarStatus,
    countryCode,
    cursor,
    exactSearch,
    limit,
    moderationStatus,
    profileStatus,
    readLimit: MAX_USER_SEARCH_SCAN_RESULTS,
    relationship,
    search,
  };
}

function normalizeAdminUserLookup(body = {}) {
  const targetUid = typeof body.targetUid === 'string' ? body.targetUid.trim().slice(0, 128) : '';
  return targetUid ? { ok: true, value: { targetUid } } : { ok: false, status: 400, error: 'targetUid is required.' };
}

function normalizeAdminUserHistoryQuery(body = {}) {
  const sections = ['activity', 'notes', 'ownerships', 'reports', 'room-moderation', 'rooms', 'social-gifts', 'store-gifts', 'transfers'];
  const section = typeof body.section === 'string' && sections.includes(body.section.trim()) ? body.section.trim() : '';
  const targetUid = typeof body.targetUid === 'string' ? body.targetUid.trim().slice(0, 128) : '';
  const cursor = typeof body.cursor === 'string' ? body.cursor.trim().slice(0, 2000) : '';
  const rawLimit = Number(body.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 20) : 20;
  if (!targetUid) return { ok: false, status: 400, error: 'targetUid is required.' };
  if (!section) return { ok: false, status: 400, error: 'A valid user history section is required.' };
  return { ok: true, value: { cursor, limit, section, targetUid } };
}

function normalizeAdminUserAction(body = {}) {
  const action = typeof body.userAction === 'string' ? body.userAction.trim() : '';
  const durationHours = Number(body.durationHours);
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt.trim().slice(0, 80) : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const targetUid = typeof body.targetUid === 'string' ? body.targetUid.trim() : '';
  if (!ADMIN_USER_ACTIONS.includes(action)) return { ok: false, status: 400, error: 'Valid user action is required.' };
  if (!targetUid || targetUid.length > 128) return { ok: false, status: 400, error: 'targetUid is required.' };
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) return { ok: false, status: 400, error: 'A valid requestId is required.' };
  if (reason.length < 2) return { ok: false, status: 400, error: 'A reason with at least 2 characters is required.' };
  if (action === 'mute' && (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 720)) {
    return { ok: false, status: 400, error: 'Mute duration must be between 1 and 720 hours.' };
  }
  return { ok: true, value: { action, durationHours: action === 'mute' ? durationHours : 0, expectedUpdatedAt, reason, requestId, targetUid } };
}

function normalizeAdminAuditQuery(body = {}) {
  const rawLimit = Number(body.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_AUDIT_RESULTS)
    : MAX_AUDIT_RESULTS;
  const actorUid = typeof body.actorUid === 'string' ? body.actorUid.trim().slice(0, 80) : '';
  const action = typeof body.eventAction === 'string' ? body.eventAction.trim().toLowerCase().slice(0, 120) : '';
  const createdFrom = normalizeAdminDateFilter(body.createdFrom);
  const createdTo = normalizeAdminDateFilter(body.createdTo);
  const cursor = typeof body.cursor === 'string' ? body.cursor.trim().slice(0, 512) : '';
  const entityType = typeof body.entityType === 'string' && ADMIN_AUDIT_ENTITY_TYPES.includes(body.entityType.trim()) ? body.entityType.trim() : '';
  const kind = typeof body.kind === 'string' ? body.kind.trim().slice(0, 80) : '';
  const search = typeof body.search === 'string' ? body.search.trim().toLowerCase().slice(0, 160) : '';
  const status = typeof body.status === 'string' ? body.status.trim().toLowerCase().slice(0, 80) : '';
  const target = typeof body.target === 'string' ? body.target.trim().toLowerCase().slice(0, 160) : '';
  const hasFilters = Boolean(actorUid || action || createdFrom || createdTo || entityType || kind || search || status || target);

  return {
    action,
    actorUid,
    createdFrom,
    createdTo,
    cursor,
    entityType,
    kind,
    limit,
    readLimit: hasFilters ? MAX_AUDIT_FILTER_SCAN_RESULTS : limit + 1,
    search,
    status,
    target,
  };
}

function normalizeAdminAuditLookup(body = {}) {
  const eventId = typeof body.eventId === 'string' ? body.eventId.trim().slice(0, 200) : '';
  return eventId ? { ok: true, value: { eventId } } : { ok: false, status: 400, error: 'eventId is required.' };
}

function normalizeAdminStoreCatalogQuery(body = {}) {
  const rawLimit = Number(body.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_STORE_CATALOG_RESULTS)
    : MAX_STORE_CATALOG_RESULTS;
  const availability = typeof body.availability === 'string' && ['available', 'disabled', 'unavailable'].includes(body.availability.trim()) ? body.availability.trim() : '';
  const category = typeof body.category === 'string' && ['game-items', 'chat-themes', 'avatar-frames', 'profile-skins', 'chat-bubbles', 'nameplates', 'cosmetic-badges', 'seat-effects', 'cars', 'custom-ids'].includes(body.category.trim()) ? body.category.trim() : '';
  const cursor = typeof body.cursor === 'string' ? body.cursor.trim().slice(0, 512) : '';
  const search = typeof body.search === 'string' ? body.search.trim().toLowerCase().slice(0, 100) : '';
  const status = typeof body.status === 'string' && ['available', 'disabled', 'sold'].includes(body.status.trim()) ? body.status.trim() : '';
  return { availability, category, cursor, limit, readLimit: MAX_STORE_FILTER_SCAN_RESULTS, search, status };
}

function normalizeAdminEconomyQuery(body = {}) {
  const rawLimit = Number(body.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_ECONOMY_RESULTS) : MAX_ECONOMY_RESULTS;
  const currency = typeof body.currency === 'string' && ['coins', 'diamonds'].includes(body.currency.trim()) ? body.currency.trim() : '';
  const createdFrom = normalizeAdminDateFilter(body.createdFrom);
  const createdTo = normalizeAdminDateFilter(body.createdTo);
  const cursor = typeof body.cursor === 'string' ? body.cursor.trim().slice(0, 512) : '';
  const search = typeof body.search === 'string' ? body.search.trim().slice(0, 128) : '';
  const source = typeof body.source === 'string' ? body.source.trim().toLowerCase().slice(0, 80) : '';
  const targetUid = typeof body.targetUid === 'string' ? body.targetUid.trim().slice(0, 128) : '';
  const type = typeof body.type === 'string' && ['credit', 'debit', 'purchase', 'transfer'].includes(body.type.trim()) ? body.type.trim() : '';
  return { createdFrom, createdTo, currency, cursor, limit, readLimit: MAX_STORE_FILTER_SCAN_RESULTS, search, source, targetUid, type };
}

function normalizeAdminEconomyExport(body = {}) {
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) return { ok: false, status: 400, error: 'A valid requestId is required.' };
  return { ok: true, value: { ...normalizeAdminEconomyQuery(body), cursor: '', limit: 2000, readLimit: 2000, requestId } };
}

function normalizeAdminStoreItemLookup(body = {}) {
  const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';
  return /^[a-z0-9][a-z0-9_-]{2,79}$/.test(itemId)
    ? { ok: true, value: { itemId } }
    : { ok: false, status: 400, error: 'A valid itemId is required.' };
}

function normalizeAdminRoomsQuery(body = {}) {
  const rawLimit = Number(body.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_ROOM_RESULTS)
    : MAX_ROOM_RESULTS;
  const status = typeof body.status === 'string' && [...ADMIN_ROOM_STATUSES, 'all'].includes(body.status.trim())
    ? body.status.trim()
    : 'active';
  const capacity = typeof body.capacity === 'string' && ['quiet', 'busy', 'crowded'].includes(body.capacity.trim()) ? body.capacity.trim() : '';
  const countryCode = typeof body.countryCode === 'string' ? body.countryCode.trim().toUpperCase().slice(0, 2) : '';
  const cursor = typeof body.cursor === 'string' ? body.cursor.trim().slice(0, 512) : '';
  const host = typeof body.host === 'string' ? body.host.trim().toLowerCase().slice(0, 120) : '';
  const search = typeof body.search === 'string' ? body.search.trim().toLowerCase().slice(0, 120) : '';
  const type = typeof body.type === 'string' && ['voice', 'game'].includes(body.type.trim()) ? body.type.trim() : '';
  const visibility = typeof body.visibility === 'string' && ['public', 'private'].includes(body.visibility.trim()) ? body.visibility.trim() : '';

  return {
    capacity,
    countryCode,
    cursor,
    host,
    limit,
    readLimit: MAX_ROOM_FILTER_SCAN_RESULTS,
    search,
    status,
    type,
    visibility,
  };
}

function normalizeAdminRoomLookup(body = {}) {
  const roomId = typeof body.roomId === 'string' ? body.roomId.trim().slice(0, 160) : '';
  return roomId ? { ok: true, value: { roomId } } : { ok: false, status: 400, error: 'roomId is required.' };
}

function normalizeAdminReportsQuery(body = {}) {
  const rawLimit = Number(body.limit);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, MAX_REPORT_RESULTS)
    : MAX_REPORT_RESULTS;
  const status = typeof body.status === 'string' && ADMIN_REPORT_STATUSES.includes(body.status.trim())
    ? body.status.trim()
    : 'open';
  const assigneeUid = typeof body.assigneeUid === 'string' ? body.assigneeUid.trim().slice(0, 128) : '';
  const createdFrom = normalizeAdminDateFilter(body.createdFrom);
  const createdTo = normalizeAdminDateFilter(body.createdTo);
  const cursor = typeof body.cursor === 'string' ? body.cursor.trim().slice(0, 512) : '';
  const roomId = typeof body.roomId === 'string' ? body.roomId.trim().slice(0, 160) : '';
  const search = typeof body.search === 'string' ? body.search.trim().toLowerCase().slice(0, 120) : '';
  const severity = typeof body.severity === 'string' && ADMIN_REPORT_SEVERITIES.includes(body.severity.trim())
    ? body.severity.trim()
    : '';
  const source = typeof body.source === 'string' ? body.source.trim().toLowerCase().slice(0, 80) : '';

  return {
    assigneeUid,
    createdFrom,
    createdTo,
    cursor,
    limit,
    readLimit: MAX_REPORT_FILTER_SCAN_RESULTS,
    roomId,
    search,
    severity,
    source,
    status,
  };
}

function normalizeAdminDateFilter(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) && !Number.isNaN(Date.parse(`${normalized}T00:00:00.000Z`))
    ? normalized
    : '';
}

function normalizeAdminReportLookup(body = {}) {
  const reportId = typeof body.reportId === 'string' ? body.reportId.trim().slice(0, 160) : '';
  return reportId
    ? { ok: true, value: { reportId } }
    : { ok: false, status: 400, error: 'reportId is required.' };
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

function normalizeAdminCoupleDissolve(body = {}) {
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
  const targetUid = typeof body.targetUid === 'string' ? body.targetUid.trim() : '';

  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) {
    return { ok: false, status: 400, error: 'A valid requestId is required.' };
  }
  if (!targetUid || targetUid.length > 128) {
    return { ok: false, status: 400, error: 'targetUid is required.' };
  }
  if (reason.length < 2) {
    return { ok: false, status: 400, error: 'A reason with at least 2 characters is required.' };
  }
  return { ok: true, value: { reason, requestId, targetUid } };
}

function normalizeAdminReportAction(body = {}) {
  const action = typeof body.reportAction === 'string' ? body.reportAction.trim() : '';
  const assigneeUid = typeof body.assigneeUid === 'string' ? body.assigneeUid.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  const reportId = typeof body.reportId === 'string' ? body.reportId.trim() : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt.trim().slice(0, 80) : '';

  if (!ADMIN_REPORT_ACTIONS.includes(action)) {
    return { ok: false, status: 400, error: 'Valid report action is required.' };
  }

  if (!reportId) {
    return { ok: false, status: 400, error: 'reportId is required.' };
  }

  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) {
    return { ok: false, status: 400, error: 'A valid requestId is required.' };
  }

  if (['escalate', 'note', 'reopen', 'resolve'].includes(action) && note.length < 2) {
    return { ok: false, status: 400, error: 'A note with at least 2 characters is required.' };
  }

  return {
    ok: true,
    value: {
      action,
      assigneeUid,
      expectedUpdatedAt,
      note,
      reportId,
      requestId,
    },
  };
}

function normalizeAdminRoomAction(body = {}) {
  const action = typeof body.roomAction === 'string' ? body.roomAction.trim() : '';
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt.trim().slice(0, 80) : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 240) : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const roomId = typeof body.roomId === 'string' ? body.roomId.trim() : '';
  const targetUid = typeof body.targetUid === 'string' ? body.targetUid.trim() : '';

  if (!ADMIN_ROOM_ACTIONS.includes(action)) {
    return { ok: false, status: 400, error: 'Valid room action is required.' };
  }

  if (!roomId) {
    return { ok: false, status: 400, error: 'roomId is required.' };
  }

  if (['mute-member', 'remove-member', 'reverse-ownership-transfer', 'transfer-host', 'unmute-member'].includes(action) && !targetUid) {
    return { ok: false, status: 400, error: 'targetUid is required.' };
  }
  if (['staff-lockdown', 'kick-everyone', 'clear-staff-lockdown'].includes(action) && reason.length < 4) {
    return { ok: false, status: 400, error: 'A structured reason with at least 4 characters is required.' };
  }
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) return { ok: false, status: 400, error: 'A valid requestId is required.' };
  if (reason.length < 2) return { ok: false, status: 400, error: 'A reason with at least 2 characters is required.' };

  return {
    ok: true,
    value: {
      action,
      expectedUpdatedAt,
      reason,
      requestId,
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

  const role = resolveAdminRole(decodedToken);
  if (!canAdminPerformAction(role, request.action)) {
    return { ok: false, status: 403, error: 'Your administrator role does not allow this action.' };
  }

  return {
    ok: true,
    value: {
      action: request.action,
      admin: true,
      email: decodedToken.email || '',
      permissions: getAdminPermissions(role),
      role,
      uid: decodedToken.uid,
    },
  };
}

function createAdminOverviewPayload(counts, generatedAt = new Date().toISOString()) {
  const growth = counts.growthHealth && typeof counts.growthHealth === 'object'
    ? counts.growthHealth
    : {};
  return {
    activeRooms: readCount(counts.activeRooms),
    adminAuditEvents: readCount(counts.adminAuditEvents),
    gameRooms: readCount(counts.gameRooms),
    generatedAt,
    growthHealth: {
      emptyRoomJoinRate: readRate(growth.emptyRoomJoinRate),
      emptyRoomJoins: readCount(growth.emptyRoomJoins),
      giftGmvCoins: readCount(growth.giftGmvCoins),
      giftGmvDiamonds: readCount(growth.giftGmvDiamonds),
      matchAttempts: readCount(growth.matchAttempts),
      matchRoomLandings: readCount(growth.matchRoomLandings),
      matchToRoomRate: readRate(growth.matchToRoomRate),
      nonemptyRoomJoins: readCount(growth.nonemptyRoomJoins),
      softMatchAttempts: readCount(growth.softMatchAttempts),
      softMatchPaired: readCount(growth.softMatchPaired),
      softMatchPairRate: readRate(growth.softMatchPairRate),
      stageId: Number.isInteger(growth.stageId) ? growth.stageId : 0,
      stageName: typeof growth.stageName === 'string' && growth.stageName.trim()
        ? growth.stageName.trim()
        : 'dark',
      vipConversions: readCount(growth.vipConversions),
    },
    moderationEvents: readCount(counts.moderationEvents),
    privateRooms: readCount(counts.privateRooms),
    reports: readCount(counts.reports),
    systemStatus: 'ok',
    users: readCount(counts.users),
  };
}

function readRate(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function mapAdminUserProfileDocument(id, data = {}, publicData, reservationData, notificationPreferences, walletData) {
  const uid = typeof data.uid === 'string' && data.uid.trim() ? data.uid.trim() : id;

  if (!uid) {
    return null;
  }

  const hasPublicProfile = publicData && typeof publicData === 'object';
  const publicId = hasPublicProfile && typeof publicData.publicId === 'string'
    ? publicData.publicId.trim()
    : '';
  const specialId = hasPublicProfile && typeof publicData.specialId === 'string'
    ? publicData.specialId.trim()
    : '';
  const profileInspection = inspectPublicProfile(publicData, reservationData, uid);

  return {
    avatarModerationStatus: hasPublicProfile && typeof publicData.avatarModerationStatus === 'string'
      ? publicData.avatarModerationStatus.trim()
      : '',
    avatarUrl: hasPublicProfile ? normalizeAdminEvidenceUrl(publicData.avatarUrl) : '',
    avatarLabel: typeof data.avatarLabel === 'string' ? data.avatarLabel.trim().slice(0, 2) : '',
    bio: hasPublicProfile && typeof publicData.bio === 'string' ? publicData.bio.trim().slice(0, 160) : '',
    countryCode: hasPublicProfile && typeof publicData.countryCode === 'string'
      ? publicData.countryCode.trim()
      : '',
    coupleLevel: hasPublicProfile ? readCount(publicData.coupleLevel) : 0,
    createdAt: readTimestampIso(data.createdAt),
    displayName: typeof data.displayName === 'string' ? data.displayName.trim() : '',
    email: typeof data.email === 'string' ? data.email.trim() : '',
    giftScore: hasPublicProfile ? readCount(publicData.giftScore) : 0,
    friendCount: hasPublicProfile ? readCount(publicData.friendCount) : 0,
    gender: hasPublicProfile && ['male', 'female'].includes(publicData.gender) ? publicData.gender : '',
    moderationStatus: hasPublicProfile && typeof publicData.moderationStatus === 'string'
      ? publicData.moderationStatus.trim()
      : '',
    notificationPreferencesConfigured: Boolean(
      notificationPreferences
      && typeof notificationPreferences === 'object'
      && ['coupleRequests', 'friendRequests', 'gifts'].every((key) => typeof notificationPreferences[key] === 'boolean')
    ),
    publicId,
    publicProfileStatus: !hasPublicProfile
      ? 'missing'
      : profileInspection.ok
        ? 'ready'
        : 'invalid',
    profileHealthReason: profileInspection.reason,
    specialId,
    uid,
    updatedAt: readTimestampIso(data.updatedAt),
    walletCoins: readCount(walletData?.balances?.coins ?? walletData?.balance),
    walletDiamonds: readCount(walletData?.balances?.diamonds),
  };
}

function mapAdminRoomDocument(id, data = {}) {
  const roomId = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : id;

  if (!roomId) {
    return null;
  }

  return {
    activeRoomImageId: typeof data.activeRoomImageId === 'string' ? data.activeRoomImageId : '',
    createdAt: readTimestampIso(data.createdAt),
    countryCode: typeof data.countryCode === 'string' ? data.countryCode.trim().toUpperCase().slice(0, 2) : '',
    currentGameId: typeof data.currentGameId === 'string' ? data.currentGameId.trim() : '',
    hostAvatarLabel: typeof data.hostAvatarLabel === 'string' ? data.hostAvatarLabel.trim().slice(0, 2) : '',
    hostDisplayName: typeof data.hostDisplayName === 'string' ? data.hostDisplayName.trim() : '',
    hostId: typeof data.hostId === 'string' ? data.hostId.trim() : '',
    id: roomId,
    participantCount: readCount(data.participantCount),
    openReportCount: readCount(data.openReportCount),
    revision: Number.isInteger(data.revision) && data.revision >= 1 ? data.revision : 1,
    roomCustomizationSuspended: data.roomCustomizationSuspended === true,
    roomImageReviewStatus: typeof data.roomImageReviewStatus === 'string' ? data.roomImageReviewStatus : 'none',
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
    contentExcerpt: typeof data.contentExcerpt === 'string' ? data.contentExcerpt.trim().slice(0, 1000) : '',
    countryCode: typeof data.countryCode === 'string' ? data.countryCode.trim().toUpperCase().slice(0, 2) : '',
    createdAt: readTimestampIso(data.createdAt),
    evidence: mapAdminReportEvidence(data.evidence, data.evidenceUrls),
    escalatedAt: readTimestampIso(data.escalatedAt),
    id: reportId,
    noteCount: readCount(data.noteCount),
    reason: typeof data.reason === 'string' ? data.reason.trim().slice(0, 240) : '',
    reporterUid: typeof data.reporterUid === 'string' ? data.reporterUid.trim() : '',
    reporterPublicId: typeof data.reporterPublicId === 'string' ? data.reporterPublicId.trim() : '',
    resolvedAt: readTimestampIso(data.resolvedAt),
    resolutionNote: typeof data.resolutionNote === 'string' ? data.resolutionNote.trim().slice(0, 500) : '',
    roomId: typeof data.roomId === 'string' ? data.roomId.trim() : '',
    severity: ADMIN_REPORT_SEVERITIES.includes(data.severity) ? data.severity : 'medium',
    source: typeof data.source === 'string' ? data.source.trim() : '',
    status: ADMIN_REPORT_STATUSES.includes(data.status) ? data.status : '',
    subjectType: typeof data.subjectType === 'string' ? data.subjectType.trim() : '',
    targetUid: typeof data.targetUid === 'string' ? data.targetUid.trim() : '',
    targetPublicId: typeof data.targetPublicId === 'string' ? data.targetPublicId.trim() : '',
    updatedAt: readTimestampIso(data.updatedAt),
  };
}

function mapAdminReportEvidence(evidence, evidenceUrls) {
  const rawItems = Array.isArray(evidence) ? evidence : Array.isArray(evidenceUrls) ? evidenceUrls : [];
  return rawItems.slice(0, 12).map((item, index) => {
    if (typeof item === 'string') {
      const url = normalizeAdminEvidenceUrl(item);
      return url ? { kind: 'link', label: `Evidence ${index + 1}`, url } : null;
    }
    if (!item || typeof item !== 'object') return null;
    const url = normalizeAdminEvidenceUrl(item.url);
    if (!url) return null;
    return {
      kind: typeof item.kind === 'string' ? item.kind.trim().slice(0, 40) : 'link',
      label: typeof item.label === 'string' && item.label.trim() ? item.label.trim().slice(0, 100) : `Evidence ${index + 1}`,
      url,
    };
  }).filter(Boolean);
}

function normalizeAdminEvidenceUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function mapAdminAuditEventDocument(id, data = {}) {
  const eventId = typeof data.id === 'string' && data.id.trim() ? data.id.trim() : id;

  if (!eventId) {
    return null;
  }

  const entity = deriveAdminAuditEntity(data);
  return {
    action: typeof data.action === 'string' ? data.action.trim().slice(0, 120) : '',
    actorEmail: typeof data.actorEmail === 'string' ? data.actorEmail.trim().slice(0, 160) : '',
    actorUid: typeof data.actorUid === 'string' ? data.actorUid.trim() : '',
    assignedTo: typeof data.assignedTo === 'string' ? data.assignedTo.trim() : '',
    createdAt: readTimestampIso(data.createdAt),
    countryCode: typeof data.countryCode === 'string'
      ? data.countryCode.trim().toUpperCase().slice(0, 2)
      : typeof data.regionCode === 'string'
        ? data.regionCode.trim().toUpperCase().slice(0, 2)
        : '',
    eventPath: typeof data.eventPath === 'string' ? data.eventPath.trim() : '',
    entityId: entity.id,
    entityType: entity.type,
    id: eventId,
    kind: typeof data.kind === 'string' ? data.kind.trim().slice(0, 80) : '',
    category: typeof data.category === 'string' ? data.category.trim().slice(0, 80) : '',
    itemId: typeof data.itemId === 'string' ? data.itemId.trim().slice(0, 80) : '',
    note: typeof data.note === 'string' ? data.note.trim().slice(0, 500) : '',
    publicId: typeof data.publicId === 'string' ? data.publicId.trim() : '',
    reportId: typeof data.reportId === 'string' ? data.reportId.trim() : '',
    roomId: typeof data.roomId === 'string' ? data.roomId.trim() : '',
    source: typeof data.source === 'string' ? data.source.trim().slice(0, 80) : 'admin-dashboard',
    status: typeof data.status === 'string' ? data.status.trim() : '',
    targetUid: typeof data.targetUid === 'string' ? data.targetUid.trim() : '',
  };
}

function deriveAdminAuditEntity(data = {}) {
  if (typeof data.reportId === 'string' && data.reportId.trim()) return { id: data.reportId.trim(), type: 'report' };
  if (typeof data.roomId === 'string' && data.roomId.trim()) return { id: data.roomId.trim(), type: 'room' };
  if (typeof data.targetUid === 'string' && data.targetUid.trim()) return { id: data.targetUid.trim(), type: 'user' };
  if (typeof data.itemId === 'string' && data.itemId.trim()) return { id: data.itemId.trim(), type: 'catalog' };
  if (typeof data.specialId === 'string' && data.specialId.trim()) return { id: data.specialId.trim(), type: 'catalog' };
  if (typeof data.giftId === 'string' && data.giftId.trim()) return { id: data.giftId.trim(), type: 'catalog' };
  const kind = typeof data.kind === 'string' ? data.kind.toLowerCase() : '';
  if (kind.includes('economy') || kind.includes('wallet')) return { id: '', type: 'economy' };
  return { id: '', type: 'system' };
}

function mapAdminStoreCatalogDocument(id, data = {}) {
  const item = mapStoreCatalogItem(data, id);
  return item ? {
    ...item,
    createdAt: readTimestampIso(data.createdAt),
    lastEditorEmail: typeof data.lastEditorEmail === 'string' ? data.lastEditorEmail.trim().slice(0, 160) : '',
    lastEditorUid: typeof data.lastEditorUid === 'string' ? data.lastEditorUid.trim().slice(0, 128) : '',
    updatedAt: readTimestampIso(data.updatedAt),
  } : null;
}

function mapAdminGiftCatalogDocument(id, data = {}) {
  const item = mapGiftCatalogItem({ ...data, giftId: data.giftId || id });
  return item ? {
    ...item,
    createdAt: readTimestampIso(data.createdAt),
    lastEditorEmail: typeof data.lastEditorEmail === 'string' ? data.lastEditorEmail.trim().slice(0, 160) : '',
    lastEditorUid: typeof data.lastEditorUid === 'string' ? data.lastEditorUid.trim().slice(0, 128) : '',
    updatedAt: readTimestampIso(data.updatedAt),
  } : null;
}

function mapAdminSpecialIdDocument(id, data = {}) {
  const specialId = typeof data.specialId === 'string' ? data.specialId.trim() : id;
  if (!/^[0-9]{7}$/.test(specialId) || !Number.isSafeInteger(data.price) || data.price < 1 || !['available', 'disabled', 'sold'].includes(data.status)) return null;
  return {
    createdAt: readTimestampIso(data.createdAt),
    lastEditorEmail: typeof data.lastEditorEmail === 'string' ? data.lastEditorEmail.trim().slice(0, 160) : '',
    lastEditorUid: typeof data.lastEditorUid === 'string' ? data.lastEditorUid.trim().slice(0, 128) : '',
    ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid.trim().slice(0, 128) : '',
    price: data.price,
    specialId,
    status: data.status,
    updatedAt: readTimestampIso(data.updatedAt),
  };
}

function mapAdminWalletTransactionDocument(id, data = {}) {
  if (!data || typeof data !== 'object' || !['coins', 'diamonds'].includes(data.currency) || !['credit', 'debit', 'purchase', 'transfer'].includes(data.type)) return null;
  if (!Number.isSafeInteger(data.amount) || data.amount < 1 || !Number.isSafeInteger(data.balanceAfter) || data.balanceAfter < 0) return null;
  const uid = typeof data.uid === 'string' ? data.uid.trim() : '';
  if (!uid) return null;
  return {
    actorUid: typeof data.actorUid === 'string' ? data.actorUid.trim() : '',
    amount: data.amount,
    balanceAfter: data.balanceAfter,
    createdAt: readTimestampIso(data.createdAt),
    currency: data.currency,
    id,
    note: typeof data.note === 'string' ? data.note.trim().slice(0, 160) : '',
    referenceId: typeof data.referenceId === 'string' ? data.referenceId.trim().slice(0, 160) : '',
    source: typeof data.source === 'string' ? data.source.trim().slice(0, 80) : '',
    type: data.type,
    uid,
  };
}

function filterAdminStoreRows(rows, query) {
  return rows.filter((row) => {
    if (query.category && row.category !== query.category) return false;
    if (query.availability && row.availability !== query.availability) return false;
    if (!query.search) return true;
    return `${row.itemId} ${row.customId || ''} ${row.name.ar} ${row.name.en} ${row.description.ar}`.toLowerCase().includes(query.search);
  });
}

function filterAdminGiftRows(rows, query) {
  return rows.filter((row) => (!query.status || row.status === query.status)
    && (!query.search || `${row.giftId} ${row.nameAr} ${row.iconKey}`.toLowerCase().includes(query.search)));
}

function filterAdminSpecialIdRows(rows, query) {
  return rows.filter((row) => (!query.status || row.status === query.status)
    && (!query.search || row.specialId.includes(query.search)));
}

function filterAdminEconomyRows(rows, query) {
  const source = query.source === 'store-purchase' ? 'store' : query.source;
  return rows.filter((row) => (!query.currency || row.currency === query.currency)
    && (!query.type || row.type === query.type)
    && (!source || (source === 'store' ? row.source.toLowerCase() === source : row.source.toLowerCase().includes(source)))
    && (!query.createdFrom || (row.createdAt && row.createdAt >= `${query.createdFrom}T00:00:00.000Z`))
    && (!query.createdTo || (row.createdAt && row.createdAt <= `${query.createdTo}T23:59:59.999Z`)));
}

function filterAdminUserRows(rows, search) {
  const query = typeof search === 'string' ? { search } : search;
  const normalizedSearch = normalizeSearchName(query.search || '');
  return rows.filter((row) => {
    if (query.avatarStatus && row.avatarModerationStatus !== query.avatarStatus) return false;
    if (query.countryCode && row.countryCode !== query.countryCode) return false;
    if (query.moderationStatus && row.moderationStatus !== query.moderationStatus) return false;
    if (query.profileStatus && row.publicProfileStatus !== query.profileStatus) return false;
    if (query.relationship === 'coupled' && row.coupleLevel < 1) return false;
    if (query.relationship === 'single' && row.coupleLevel > 0) return false;
    if (!query.search) return true;
    const haystack = `${row.uid} ${row.email} ${row.displayName} ${row.publicId} ${row.specialId}`.toLowerCase();
    return haystack.includes(query.search) || normalizeSearchName(row.displayName).includes(normalizedSearch);
  });
}

function filterAdminAuditEventRows(rows, query) {
  return rows.filter((row) => {
    if (query.actorUid && row.actorUid !== query.actorUid) return false;
    if (query.kind && row.kind !== query.kind) return false;
    if (query.action && !row.action.toLowerCase().includes(query.action)) return false;
    if (query.entityType && row.entityType !== query.entityType) return false;
    if (query.status && row.status.toLowerCase() !== query.status) return false;
    if (query.target && !`${row.entityId} ${row.targetUid} ${row.reportId} ${row.roomId} ${row.itemId} ${row.publicId}`.toLowerCase().includes(query.target)) return false;
    if (query.createdFrom && (!row.createdAt || row.createdAt < `${query.createdFrom}T00:00:00.000Z`)) return false;
    if (query.createdTo && (!row.createdAt || row.createdAt > `${query.createdTo}T23:59:59.999Z`)) return false;
    if (query.search) {
      const haystack = `${row.id} ${row.action} ${row.actorEmail} ${row.actorUid} ${row.entityId} ${row.kind} ${row.note} ${row.publicId} ${row.reportId} ${row.roomId} ${row.status} ${row.targetUid}`.toLowerCase();
      const identityMatches = Array.isArray(query.identityUids) && (query.identityUids.includes(row.targetUid) || query.identityUids.includes(row.entityId));
      if (!haystack.includes(query.search) && !identityMatches) return false;
    }
    return true;
  });
}

function filterAdminRoomRows(rows, status) {
  const query = typeof status === 'string' ? { status } : status;
  return rows.filter((row) => {
    if (query.status && query.status !== 'all' && row.status !== query.status) return false;
    if (query.type && row.type !== query.type) return false;
    if (query.visibility && row.visibility !== query.visibility) return false;
    if (query.countryCode && row.countryCode !== query.countryCode) return false;
    if (query.capacity === 'quiet' && row.participantCount > 4) return false;
    if (query.capacity === 'busy' && (row.participantCount < 5 || row.participantCount > 19)) return false;
    if (query.capacity === 'crowded' && row.participantCount < 20) return false;
    if (query.host) {
      const hostHaystack = `${row.hostId} ${row.hostDisplayName}`.toLowerCase();
      if (!hostHaystack.includes(query.host)) return false;
    }
    if (query.search) {
      const haystack = `${row.id} ${row.title} ${row.hostId} ${row.hostDisplayName} ${row.countryCode} ${row.currentGameId}`.toLowerCase();
      if (!haystack.includes(query.search)) return false;
    }
    return true;
  });
}

function filterAdminReportRows(rows, status) {
  const query = typeof status === 'string' ? { status } : status;
  return rows.filter((row) => {
    if (row.status !== query.status) return false;
    if (query.assigneeUid === 'unassigned' && row.assignedTo) return false;
    if (query.assigneeUid && query.assigneeUid !== 'unassigned' && row.assignedTo !== query.assigneeUid) return false;
    if (query.severity && row.severity !== query.severity) return false;
    if (query.roomId && row.roomId !== query.roomId) return false;
    if (query.source && row.source.toLowerCase() !== query.source) return false;
    if (query.createdFrom && (!row.createdAt || row.createdAt < `${query.createdFrom}T00:00:00.000Z`)) return false;
    if (query.createdTo && (!row.createdAt || row.createdAt > `${query.createdTo}T23:59:59.999Z`)) return false;
    if (query.search) {
      const haystack = `${row.id} ${row.reason} ${row.reporterUid} ${row.reporterPublicId} ${row.targetUid} ${row.targetPublicId} ${row.roomId} ${row.source}`.toLowerCase();
      const identityMatches = Array.isArray(query.identityUids)
        && (query.identityUids.includes(row.reporterUid) || query.identityUids.includes(row.targetUid));
      if (!haystack.includes(query.search) && !identityMatches) return false;
    }
    return true;
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
  APPROVED_ADMIN_FEATURE_FLAGS,
  APPROVED_COSMETICS_DARK_FLAGS,
  createAdminOverviewPayload,
  filterAdminAuditEventRows,
  filterAdminReportRows,
  filterAdminRoomRows,
  filterAdminEconomyRows,
  filterAdminGiftRows,
  filterAdminSpecialIdRows,
  filterAdminStoreRows,
  filterAdminUserRows,
  filterRowsByOperatorScope,
  mapAdminAuditEventDocument,
  mapAdminReportDocument,
  mapAdminRoomDocument,
  mapAdminUserProfileDocument,
  mapAdminStoreCatalogDocument,
  mapAdminGiftCatalogDocument,
  mapAdminSpecialIdDocument,
  mapAdminWalletTransactionDocument,
  normalizeAdminAuditQuery,
  normalizeAdminAuditLookup,
  normalizeAdminClientError,
  normalizeAdminCosmeticsRendererDisable,
  normalizeAdminDirectChatRetentionSet,
  normalizeAdminFeatureFlagUpdate,
  normalizeRoomGiftPolicyUpdate,
  normalizeAdministratorAction,
  normalizeAdminSettingsUpdate,
  normalizeAdminCoupleDissolve,
  normalizeAdminReportAction,
  normalizeAdminReportLookup,
  normalizeAdminReportsQuery,
  normalizeAdminRoomAction,
  normalizeAdminRoomLookup,
  normalizeAdminRoomsQuery,
  normalizeAdminUserNote,
  normalizeAdminUserAction,
  normalizeAdminUserLookup,
  normalizeAdminUserHistoryQuery,
  normalizeAdminUsersQuery,
  normalizeAdminStoreCatalogQuery,
  normalizeAdminEconomyQuery,
  normalizeAdminEconomyExport,
  normalizeAdminStoreItemLookup,
  normalizeAdminDashboardBody,
  normalizeRegionCodes,
  assertAdminTargetHierarchy,
  assertFreshAdminAuth,
  assertRoomInOperatorScope,
  assertUserInOperatorScope,
  resolveAdminDashboardRequest,
  resolveOperatorRegionScope,
};
