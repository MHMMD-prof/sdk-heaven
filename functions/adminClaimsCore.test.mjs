import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  ADMIN_CLAIM,
  createAdminClaims,
  hasAdminClaim,
  normalizeAdminLookup,
  parseAdminClaimArgs,
} = require('./adminClaimsCore');

describe('adminClaimsCore', () => {
  it('normalizes a trusted admin lookup by uid or email', () => {
    expect(normalizeAdminLookup({ uid: '  user-1  ', email: 'admin@example.com' })).toEqual({
      ok: true,
      value: { kind: 'uid', value: 'user-1' },
    });
    expect(normalizeAdminLookup({ email: '  Admin@Example.COM ' })).toEqual({
      ok: true,
      value: { kind: 'email', value: 'admin@example.com' },
    });
    expect(normalizeAdminLookup({})).toEqual({
      ok: false,
      error: 'Provide either --uid or --email.',
    });
  });

  it('grants and revokes only the admin custom claim', () => {
    const existingClaims = {
      betaTester: true,
      theme: 'dark',
    };

    expect(createAdminClaims(existingClaims, true)).toEqual({
      ...existingClaims,
      [ADMIN_CLAIM]: true,
    });
    expect(createAdminClaims({ ...existingClaims, [ADMIN_CLAIM]: true }, false)).toEqual(existingClaims);
  });

  it('parses claim script args with one explicit mode and safe values', () => {
    expect(parseAdminClaimArgs(['--grant', '--email', 'admin@example.com'])).toEqual({
      ok: true,
      value: {
        email: 'admin@example.com',
        mode: 'grant',
        uid: '',
      },
    });
    expect(parseAdminClaimArgs(['--grant', '--revoke', '--uid', 'user-1'])).toEqual({
      ok: false,
      error: 'Choose exactly one of --grant or --revoke.',
    });
    expect(parseAdminClaimArgs(['--grant', '--uid', '--email'])).toEqual({
      ok: false,
      error: '--uid requires a value.',
    });
    expect(parseAdminClaimArgs(['--grant', '--unknown'])).toEqual({
      ok: false,
      error: 'Unknown argument: --unknown',
    });
  });

  it('treats only boolean true as admin authority', () => {
    expect(hasAdminClaim({ [ADMIN_CLAIM]: true })).toBe(true);
    expect(hasAdminClaim({ [ADMIN_CLAIM]: 'true' })).toBe(false);
    expect(hasAdminClaim({ roles: ['admin'] })).toBe(false);
  });
});
