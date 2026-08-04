import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  ADMIN_ACTION_PERMISSIONS,
  ADMIN_CLAIM,
  ADMIN_ROLE_CLAIM,
  canAdminPerformAction,
  createAdminClaims,
  getAdminPermissions,
  hasAdminClaim,
  normalizeAdminLookup,
  parseAdminClaimArgs,
  resolveAdminRole,
} = require('./adminClaimsCore');
const { ADMIN_DASHBOARD_ACTIONS } = require('./adminDashboardCore');

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
      [ADMIN_ROLE_CLAIM]: 'owner',
    });
    expect(createAdminClaims(existingClaims, true, 'auditor')).toMatchObject({ admin: true, adminRole: 'auditor' });
    expect(createAdminClaims({ ...existingClaims, [ADMIN_CLAIM]: true, [ADMIN_ROLE_CLAIM]: 'owner' }, false)).toEqual(existingClaims);
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
    expect(hasAdminClaim({ [ADMIN_CLAIM]: true })).toBe(false);
    expect(resolveAdminRole({ [ADMIN_CLAIM]: true })).toBe('');
    expect(hasAdminClaim({ [ADMIN_CLAIM]: true, [ADMIN_ROLE_CLAIM]: 'owner' })).toBe(true);
    expect(resolveAdminRole({ [ADMIN_CLAIM]: true, [ADMIN_ROLE_CLAIM]: 'moderator' })).toBe('moderator');
    expect(hasAdminClaim({ [ADMIN_CLAIM]: true, [ADMIN_ROLE_CLAIM]: 'unknown' })).toBe(false);
    expect(hasAdminClaim({ [ADMIN_CLAIM]: 'true' })).toBe(false);
    expect(hasAdminClaim({ roles: ['admin'] })).toBe(false);
  });

  it('enforces least-privilege permissions per role and action', () => {
    expect(canAdminPerformAction('owner', 'administrator-action')).toBe(true);
    expect(canAdminPerformAction('auditor', 'administrator-action')).toBe(true);
    expect(canAdminPerformAction('moderator', 'report-action')).toBe(true);
    expect(canAdminPerformAction('moderator', 'store-catalog-upsert')).toBe(false);
    expect(canAdminPerformAction('support', 'user-note')).toBe(true);
    expect(canAdminPerformAction('support', 'user-action')).toBe(false);
    expect(canAdminPerformAction('catalog-manager', 'wallet-adjust')).toBe(true);
    expect(canAdminPerformAction('catalog-manager', 'representative-reversal')).toBe(true);
    expect(canAdminPerformAction('auditor', 'audit-export')).toBe(true);
    expect(canAdminPerformAction('auditor', 'user-history')).toBe(true);
    expect(canAdminPerformAction('support', 'user-history')).toBe(true);
    expect(getAdminPermissions('auditor')).not.toContain('audit:manage');
    expect(getAdminPermissions('auditor')).toContain('incentives:view');
    expect(getAdminPermissions('auditor')).toContain('payroll:view');
    expect(getAdminPermissions('auditor')).not.toContain('incentives:manage');
    expect(getAdminPermissions('auditor')).not.toContain('payroll:manage');
    expect(getAdminPermissions('owner')).toEqual(expect.arrayContaining([
      'incentives:view',
      'incentives:manage',
      'payroll:view',
      'payroll:manage',
    ]));
    expect(getAdminPermissions('super-moderator')).toContain('rooms:manage');
    expect(getAdminPermissions('super-moderator')).not.toContain('incentives:view');
    expect(getAdminPermissions('super-moderator')).not.toContain('payroll:manage');
    expect(getAdminPermissions('super-moderator')).not.toContain('admins:manage');
    expect(createAdminClaims({}, true, 'super-moderator')).toMatchObject({
      admin: true,
      adminRole: 'super-moderator',
    });
  });

  it('keeps every dashboard action inside the permission contract', () => {
    expect(Object.keys(ADMIN_ACTION_PERMISSIONS).sort()).toEqual([...ADMIN_DASHBOARD_ACTIONS].sort());
    for (const action of ADMIN_DASHBOARD_ACTIONS) expect(canAdminPerformAction('owner', action), action).toBe(true);
  });

  it('keeps sensitive mutation boundaries out of read-only roles', () => {
    const sensitiveActions = ['user-action', 'room-action', 'store-catalog-upsert', 'wallet-adjust', 'representative-reversal', 'feature-flag-update', 'room-gift-policy-update', 'daily-login-campaign-mutate'];
    for (const action of sensitiveActions) expect(canAdminPerformAction('auditor', action), action).toBe(false);
    expect(canAdminPerformAction('auditor', 'daily-login-campaign')).toBe(true);
    expect(canAdminPerformAction('support', 'user-note')).toBe(true);
    expect(canAdminPerformAction('support', 'wallet-adjust')).toBe(false);
    expect(canAdminPerformAction('catalog-manager', 'report-action')).toBe(false);
  });
});
