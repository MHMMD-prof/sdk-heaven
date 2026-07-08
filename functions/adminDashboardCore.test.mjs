import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  normalizeAdminDashboardBody,
  resolveAdminDashboardRequest,
} = require('./adminDashboardCore');

const adminToken = {
  admin: true,
  email: 'admin@example.com',
  email_verified: true,
  uid: 'admin-1',
};

describe('adminDashboardCore', () => {
  it('normalizes dashboard action requests conservatively', () => {
    expect(normalizeAdminDashboardBody({ action: ' session ' })).toEqual({ action: 'session' });
    expect(normalizeAdminDashboardBody({ action: 123 })).toEqual({ action: '' });
  });

  it('allows verified custom-claim admins to resolve a session request', () => {
    expect(resolveAdminDashboardRequest({ body: { action: 'session' }, decodedToken: adminToken })).toEqual({
      ok: true,
      value: {
        action: 'session',
        admin: true,
        email: 'admin@example.com',
        uid: 'admin-1',
      },
    });
  });

  it('allows verified custom-claim admins to resolve an overview request', () => {
    expect(resolveAdminDashboardRequest({ body: { action: 'overview' }, decodedToken: adminToken })).toEqual({
      ok: true,
      value: {
        action: 'overview',
        admin: true,
        email: 'admin@example.com',
        uid: 'admin-1',
      },
    });
  });

  it('rejects unverified, non-admin, and malformed dashboard requests', () => {
    expect(
      resolveAdminDashboardRequest({
        body: { action: 'session' },
        decodedToken: { ...adminToken, email_verified: false },
      }),
    ).toMatchObject({ ok: false, status: 403 });
    expect(
      resolveAdminDashboardRequest({
        body: { action: 'session' },
        decodedToken: { ...adminToken, admin: false },
      }),
    ).toMatchObject({ ok: false, status: 403 });
    expect(resolveAdminDashboardRequest({ body: { action: 'export-users' }, decodedToken: adminToken })).toEqual({
      ok: false,
      status: 400,
      error: 'Valid admin dashboard action is required.',
    });
  });
});
