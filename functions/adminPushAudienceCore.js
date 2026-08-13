const { resolveConfigForCycle } = require('./payrollService');
const { createWeeklyCycle, DEFAULT_INCENTIVE_TIME_ZONE } = require('./weeklyIncentiveCore');
const { resolveAdminRole } = require('./adminClaimsCore');

const ADMIN_PUSH_ROLES = Object.freeze(['staff', 'room-owners', 'admins', 'representatives']);
const ADMIN_PUSH_ROUTES = Object.freeze([
  '',
  'Friends',
  'Couples',
  'Gifts',
  'Store',
  'RepresentativeTransfer',
  'WalletStore',
]);
const MAX_ADMIN_PUSH_UIDS = 200;
const MAX_ADMIN_PUSH_RECIPIENTS = 2_000;
const MAX_ADMIN_PUSH_TITLE = 80;
const MAX_ADMIN_PUSH_BODY = 240;
const MAX_STAFF_SCAN = 2_000;
const MAX_ROOM_OWNER_SCAN = 2_000;
const MAX_REPRESENTATIVE_SCAN = 2_000;
const ADMIN_UID_CACHE_TTL_MS = 60_000;
let adminUidCache = { expiresAtMs: 0, uids: null };

function normalizeAdminPushAudience(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, status: 400, error: 'Audience must be an object.' };
  }
  const rawUids = Array.isArray(input.uids) ? input.uids : [];
  if (rawUids.length > MAX_ADMIN_PUSH_UIDS) {
    return { ok: false, status: 400, error: `At most ${MAX_ADMIN_PUSH_UIDS} UIDs can be pasted.` };
  }
  const uids = [];
  const seen = new Set();
  for (const value of rawUids) {
    if (typeof value !== 'string') {
      return { ok: false, status: 400, error: 'Each UID must be a string.' };
    }
    const uid = value.trim();
    if (!uid || uid.length > 128) {
      return { ok: false, status: 400, error: 'Each UID must be 1–128 characters.' };
    }
    if (seen.has(uid)) continue;
    seen.add(uid);
    uids.push(uid);
  }

  const rawRoles = Array.isArray(input.roles) ? input.roles : [];
  const roles = [];
  const roleSeen = new Set();
  for (const value of rawRoles) {
    if (typeof value !== 'string' || !ADMIN_PUSH_ROLES.includes(value)) {
      return { ok: false, status: 400, error: 'Audience roles must be staff, room-owners, admins, or representatives.' };
    }
    if (roleSeen.has(value)) continue;
    roleSeen.add(value);
    roles.push(value);
  }

  if (uids.length === 0 && roles.length === 0) {
    return { ok: false, status: 400, error: 'Select at least one UID or role audience.' };
  }

  return { ok: true, value: { roles, uids } };
}

function normalizeAdminPushSendInput(body = {}) {
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_ADMIN_PUSH_TITLE) : '';
  const textBody = typeof body.body === 'string' ? body.body.trim().slice(0, MAX_ADMIN_PUSH_BODY) : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : '';
  const routeRaw = typeof body.route === 'string' ? body.route.trim() : '';
  const route = routeRaw === '' ? '' : routeRaw;
  const audience = normalizeAdminPushAudience(body.audience);

  if (title.length < 2) return { ok: false, status: 400, error: 'Title must be at least 2 characters.' };
  if (textBody.length < 2) return { ok: false, status: 400, error: 'Body must be at least 2 characters.' };
  if (reason.length < 3) return { ok: false, status: 400, error: 'A reason with at least 3 characters is required.' };
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) return { ok: false, status: 400, error: 'A valid requestId is required.' };
  if (!ADMIN_PUSH_ROUTES.includes(route)) {
    return { ok: false, status: 400, error: 'Choose a supported deep-link route or leave it empty.' };
  }
  if (!audience.ok) return audience;

  return {
    ok: true,
    value: {
      audience: audience.value,
      body: textBody,
      reason,
      requestId,
      route,
      title,
    },
  };
}

function normalizeAdminPushEstimateInput(body = {}) {
  const audience = normalizeAdminPushAudience(body.audience);
  if (!audience.ok) return audience;
  return { ok: true, value: { audience: audience.value } };
}

function unionRecipientUids(groups) {
  const seen = new Set();
  const recipientUids = [];
  for (const group of groups) {
    for (const uid of group) {
      if (typeof uid !== 'string' || !uid || seen.has(uid)) continue;
      seen.add(uid);
      recipientUids.push(uid);
      if (recipientUids.length >= MAX_ADMIN_PUSH_RECIPIENTS) {
        return { recipientUids, truncated: true };
      }
    }
  }
  return { recipientUids, truncated: false };
}

async function resolveStaffUids({ db, nowMillis = Date.now() }) {
  const cycle = createWeeklyCycle({ nowMillis, timeZone: DEFAULT_INCENTIVE_TIME_ZONE });
  if (!cycle.ok) return [];
  const snapshot = await db.collection('payrollEnrollments').limit(MAX_STAFF_SCAN).get();
  const uids = [];
  for (const document of snapshot.docs) {
    const enrollment = resolveConfigForCycle(document.data(), cycle.value.cycleId);
    if (enrollment?.state === 'active') uids.push(document.id);
  }
  return uids;
}

async function resolveRoomOwnerUids({ db }) {
  const snapshot = await db.collection('rooms').limit(MAX_ROOM_OWNER_SCAN).get();
  const seen = new Set();
  const uids = [];
  for (const document of snapshot.docs) {
    const data = document.data() || {};
    const uid = typeof data.ownerUid === 'string' && data.ownerUid.trim()
      ? data.ownerUid.trim()
      : (typeof data.hostId === 'string' ? data.hostId.trim() : '');
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    uids.push(uid);
  }
  return uids;
}

async function resolveRepresentativeUids({ db }) {
  const snapshot = await db.collection('representativePrivileges').limit(MAX_REPRESENTATIVE_SCAN).get();
  const uids = [];
  for (const document of snapshot.docs) {
    const data = document.data() || {};
    if (data.active !== true) continue;
    if (data.currencies?.coins !== true && data.currencies?.diamonds !== true) continue;
    uids.push(document.id);
  }
  return uids;
}

async function resolveAdminUids({ auth, nowMillis = Date.now() }) {
  if (!auth || typeof auth.listUsers !== 'function') return [];
  if (adminUidCache.uids && nowMillis < adminUidCache.expiresAtMs) {
    return adminUidCache.uids;
  }
  const uids = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      if (user.customClaims?.admin === true && Boolean(resolveAdminRole(user.customClaims))) {
        uids.push(user.uid);
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);
  adminUidCache = { expiresAtMs: nowMillis + ADMIN_UID_CACHE_TTL_MS, uids: [...uids] };
  return uids;
}

function clearAdminUidCache() {
  adminUidCache = { expiresAtMs: 0, uids: null };
}

async function resolveAdminPushAudience({ audience, auth, db, nowMillis = Date.now() }) {
  const breakdown = {
    admins: 0,
    representatives: 0,
    'room-owners': 0,
    staff: 0,
    uids: audience.uids.length,
  };
  const groups = [audience.uids];

  if (audience.roles.includes('staff')) {
    const staff = await resolveStaffUids({ db, nowMillis });
    breakdown.staff = staff.length;
    groups.push(staff);
  }
  if (audience.roles.includes('room-owners')) {
    const owners = await resolveRoomOwnerUids({ db });
    breakdown['room-owners'] = owners.length;
    groups.push(owners);
  }
  if (audience.roles.includes('admins')) {
    const admins = await resolveAdminUids({ auth, nowMillis });
    breakdown.admins = admins.length;
    groups.push(admins);
  }
  if (audience.roles.includes('representatives')) {
    const representatives = await resolveRepresentativeUids({ db });
    breakdown.representatives = representatives.length;
    groups.push(representatives);
  }

  const { recipientUids, truncated } = unionRecipientUids(groups);
  return {
    breakdown,
    recipientCount: recipientUids.length,
    recipientUids,
    truncated,
  };
}

module.exports = {
  ADMIN_PUSH_ROLES,
  ADMIN_PUSH_ROUTES,
  ADMIN_UID_CACHE_TTL_MS,
  MAX_ADMIN_PUSH_BODY,
  MAX_ADMIN_PUSH_RECIPIENTS,
  MAX_ADMIN_PUSH_TITLE,
  MAX_ADMIN_PUSH_UIDS,
  clearAdminUidCache,
  normalizeAdminPushAudience,
  normalizeAdminPushEstimateInput,
  normalizeAdminPushSendInput,
  resolveAdminPushAudience,
  unionRecipientUids,
};
