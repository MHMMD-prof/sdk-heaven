const ADMIN_CLAIM = 'admin';
const ADMIN_ROLE_CLAIM = 'adminRole';
const ADMIN_ROLES = ['owner', 'super-moderator', 'moderator', 'support', 'catalog-manager', 'auditor'];

const ADMIN_ROLE_PERMISSIONS = Object.freeze({
  owner: ['overview', 'users:view', 'users:manage', 'rooms:view', 'rooms:manage', 'reports:view', 'reports:manage', 'store:view', 'store:manage', 'audit:view', 'audit:export', 'admins:view', 'admins:manage', 'settings:manage', 'flags:manage'],
  'super-moderator': ['overview', 'users:view', 'users:manage', 'rooms:view', 'rooms:manage', 'reports:view', 'reports:manage', 'audit:view', 'admins:view'],
  moderator: ['overview', 'users:view', 'users:manage', 'rooms:view', 'rooms:manage', 'reports:view', 'reports:manage', 'audit:view', 'admins:view', 'settings:manage'],
  support: ['overview', 'users:view', 'users:note', 'rooms:view', 'reports:view', 'reports:manage', 'admins:view', 'settings:manage'],
  'catalog-manager': ['overview', 'store:view', 'store:manage', 'audit:view', 'admins:view', 'settings:manage'],
  auditor: ['overview', 'users:view', 'rooms:view', 'reports:view', 'store:view', 'audit:view', 'audit:export', 'admins:view', 'settings:manage'],
});

const ADMIN_ACTION_PERMISSIONS = Object.freeze({
  session: null,
  'client-error': null,
  overview: 'overview',
  users: 'users:view',
  'user-summary': 'users:view',
  'user-detail': 'users:view',
  'user-history': 'users:view',
  'user-note': ['users:note', 'users:manage'],
  'user-action': 'users:manage',
  'couple-dissolve': 'users:manage',
  rooms: 'rooms:view',
  'room-summary': 'rooms:view',
  'room-detail': 'rooms:view',
  'room-action': 'rooms:manage',
  reports: 'reports:view',
  'report-summary': 'reports:view',
  'report-detail': 'reports:view',
  'report-action': 'reports:manage',
  'store-catalog': 'store:view',
  'gift-catalog': 'store:view',
  'special-id-catalog': 'store:view',
  'economy-history': 'store:view',
  'economy-export': 'store:view',
  'store-item-detail': 'store:view',
  'store-summary': 'store:view',
  'store-catalog-upsert': 'store:manage',
  'gift-catalog-upsert': 'store:manage',
  'special-id-upsert': 'store:manage',
  'wallet-credit': 'store:manage',
  'wallet-adjust': 'store:manage',
  'representative-update': 'store:manage',
  'representative-reversal': 'store:manage',
  'audit-events': 'audit:view',
  'audit-summary': 'audit:view',
  'audit-detail': 'audit:view',
  'audit-export': 'audit:export',
  administrators: 'admins:view',
  'admin-settings': 'settings:manage',
  'admin-settings-update': 'settings:manage',
  'administrator-action': null,
  'feature-flag-update': 'flags:manage',
});

function normalizeAdminLookup(input = {}) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const uid = typeof input.uid === 'string' ? input.uid.trim() : '';

  if (uid) {
    return { ok: true, value: { kind: 'uid', value: uid } };
  }

  if (email) {
    return { ok: true, value: { kind: 'email', value: email } };
  }

  return {
    ok: false,
    error: 'Provide either --uid or --email.',
  };
}

function parseAdminClaimArgs(argv = []) {
  const options = {
    email: '',
    mode: '',
    uid: '',
  };
  let modeCount = 0;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--grant' || arg === '--revoke') {
      options.mode = arg === '--grant' ? 'grant' : 'revoke';
      modeCount += 1;
      continue;
    }

    if (arg === '--uid' || arg === '--email') {
      const value = argv[index + 1] || '';

      if (!value || value.startsWith('--')) {
        return { ok: false, error: `${arg} requires a value.` };
      }

      if (arg === '--uid') {
        options.uid = value;
      } else {
        options.email = value;
      }

      index += 1;
      continue;
    }

    return { ok: false, error: `Unknown argument: ${arg}` };
  }

  if (modeCount !== 1) {
    return { ok: false, error: 'Choose exactly one of --grant or --revoke.' };
  }

  return { ok: true, value: options };
}

function createAdminClaims(existingClaims = {}, shouldGrant = true, role = 'owner') {
  const nextClaims = { ...existingClaims };

  if (shouldGrant) {
    if (!ADMIN_ROLES.includes(role)) throw new Error('A valid admin role is required.');
    nextClaims[ADMIN_CLAIM] = true;
    nextClaims[ADMIN_ROLE_CLAIM] = role;
    return nextClaims;
  }

  delete nextClaims[ADMIN_CLAIM];
  delete nextClaims[ADMIN_ROLE_CLAIM];
  return nextClaims;
}

function hasAdminClaim(decodedToken = {}) {
  return decodedToken[ADMIN_CLAIM] === true && Boolean(resolveAdminRole(decodedToken));
}

function resolveAdminRole(decodedToken = {}) {
  if (decodedToken[ADMIN_CLAIM] !== true) return '';
  const role = decodedToken[ADMIN_ROLE_CLAIM];
  if (role === undefined || role === null || role === '') return 'owner';
  return ADMIN_ROLES.includes(role) ? role : '';
}

function getAdminPermissions(role) {
  return ADMIN_ROLE_PERMISSIONS[role] ? [...ADMIN_ROLE_PERMISSIONS[role]] : [];
}

function canAdminPerformAction(role, action) {
  if (!(action in ADMIN_ACTION_PERMISSIONS)) return false;
  const required = ADMIN_ACTION_PERMISSIONS[action];
  if (required === null) return ADMIN_ROLES.includes(role);
  const permissions = getAdminPermissions(role);
  return Array.isArray(required)
    ? required.some((permission) => permissions.includes(permission))
    : permissions.includes(required);
}

module.exports = {
  ADMIN_ACTION_PERMISSIONS,
  ADMIN_CLAIM,
  ADMIN_ROLE_CLAIM,
  ADMIN_ROLE_PERMISSIONS,
  ADMIN_ROLES,
  canAdminPerformAction,
  createAdminClaims,
  getAdminPermissions,
  hasAdminClaim,
  normalizeAdminLookup,
  parseAdminClaimArgs,
  resolveAdminRole,
};
