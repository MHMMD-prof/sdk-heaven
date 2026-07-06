const ADMIN_CLAIM = 'admin';

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

function createAdminClaims(existingClaims = {}, shouldGrant = true) {
  const nextClaims = { ...existingClaims };

  if (shouldGrant) {
    nextClaims[ADMIN_CLAIM] = true;
    return nextClaims;
  }

  delete nextClaims[ADMIN_CLAIM];
  return nextClaims;
}

function hasAdminClaim(decodedToken = {}) {
  return decodedToken[ADMIN_CLAIM] === true;
}

module.exports = {
  ADMIN_CLAIM,
  createAdminClaims,
  hasAdminClaim,
  normalizeAdminLookup,
  parseAdminClaimArgs,
};
