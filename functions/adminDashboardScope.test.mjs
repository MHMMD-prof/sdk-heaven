import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  assertAdminTargetHierarchy,
  assertFreshAdminAuth,
  assertRoomInOperatorScope,
  assertUserInOperatorScope,
  filterRowsByOperatorScope,
  normalizeAdministratorAction,
  normalizeAdminRoomAction,
  resolveOperatorRegionScope,
} = require('./adminDashboardCore');

describe('adminDashboard Super Moderator scope', () => {
  it('resolves owner as global and super-moderator as region-scoped', () => {
    expect(resolveOperatorRegionScope({ admin: true, adminRole: 'owner', uid: 'owner-1' }, null)).toMatchObject({
      ok: true,
      regionCodes: null,
      role: 'owner',
    });
    expect(resolveOperatorRegionScope(
      { admin: true, adminRole: 'super-moderator', uid: 'staff-1' },
      { regionCodes: ['IQ', 'SA'], role: 'super-moderator', status: 'active', uid: 'staff-1' },
    )).toMatchObject({
      ok: true,
      regionCodes: ['IQ', 'SA'],
      role: 'super-moderator',
    });
    expect(resolveOperatorRegionScope(
      { admin: true, adminRole: 'super-moderator', uid: 'staff-1' },
      { regionCodes: [], role: 'super-moderator', status: 'pending', uid: 'staff-1' },
    ).ok).toBe(false);
  });

  it('filters rooms and denies out-of-scope mutations', () => {
    const scope = {
      ok: true,
      regionCodes: ['IQ'],
      role: 'super-moderator',
    };
    expect(filterRowsByOperatorScope([
      { countryCode: 'IQ', id: 'a' },
      { countryCode: 'SA', id: 'b' },
    ], scope)).toEqual([{ countryCode: 'IQ', id: 'a' }]);
    expect(assertRoomInOperatorScope(scope, { countryCode: 'SA' })).toMatchObject({
      code: 'REGION_SCOPE_DENIED',
      ok: false,
    });
    expect(assertUserInOperatorScope(scope, { countryCode: 'IQ' }).ok).toBe(true);
  });

  it('accepts set-region-scope and staff lockdown room actions', () => {
    expect(normalizeAdministratorAction({
      administratorAction: 'set-region-scope',
      reason: 'assign IQ and SA',
      regionCodes: ['IQ', 'SA'],
      requestId: 'admin_request_000001',
      targetUid: 'staff-1',
    })).toMatchObject({
      ok: true,
      value: { action: 'set-region-scope', regionCodes: ['IQ', 'SA'] },
    });
    expect(normalizeAdminRoomAction({
      reason: 'emergency lockdown',
      requestId: 'admin_request_000002',
      roomAction: 'staff-lockdown',
      roomId: 'room-1',
    }).ok).toBe(true);
  });

  it('enforces fresh authentication and protects the top platform hierarchy', () => {
    const nowMs = Date.parse('2026-07-26T12:00:00.000Z');
    expect(assertFreshAdminAuth({
      auth_time: Math.floor((nowMs - 60_000) / 1000),
    }, nowMs).ok).toBe(true);
    expect(assertFreshAdminAuth({
      auth_time: Math.floor((nowMs - 11 * 60_000) / 1000),
    }, nowMs)).toMatchObject({ code: 'FRESH_AUTH_REQUIRED', ok: false });
    expect(assertAdminTargetHierarchy('super-moderator', {
      role: 'owner',
      status: 'active',
    }, 'owner-1')).toMatchObject({ code: 'TARGET_PROTECTED', ok: false });
    expect(assertAdminTargetHierarchy('super-moderator', {
      role: 'super-moderator',
      status: 'active',
    }, 'staff-2')).toMatchObject({ code: 'TARGET_PROTECTED', ok: false });
    expect(assertAdminTargetHierarchy('super-moderator', {
      role: 'moderator',
      status: 'active',
    }, 'moderator-1').ok).toBe(true);
  });
});
