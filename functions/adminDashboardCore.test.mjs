import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createAdminOverviewPayload,
  filterAdminUserRows,
  mapAdminRoomDocument,
  mapAdminUserProfileDocument,
  normalizeAdminRoomAction,
  normalizeAdminRoomsQuery,
  normalizeAdminUserNote,
  normalizeAdminUsersQuery,
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

  it('allows verified custom-claim admins to resolve user management requests', () => {
    expect(resolveAdminDashboardRequest({ body: { action: 'users' }, decodedToken: adminToken })).toMatchObject({
      ok: true,
      value: { action: 'users' },
    });
    expect(resolveAdminDashboardRequest({ body: { action: 'user-note' }, decodedToken: adminToken })).toMatchObject({
      ok: true,
      value: { action: 'user-note' },
    });
  });

  it('allows verified custom-claim admins to resolve room moderation requests', () => {
    expect(resolveAdminDashboardRequest({ body: { action: 'rooms' }, decodedToken: adminToken })).toMatchObject({
      ok: true,
      value: { action: 'rooms' },
    });
    expect(resolveAdminDashboardRequest({ body: { action: 'room-action' }, decodedToken: adminToken })).toMatchObject({
      ok: true,
      value: { action: 'room-action' },
    });
  });

  it('creates a conservative overview payload from aggregate counts', () => {
    expect(
      createAdminOverviewPayload(
        {
          activeRooms: 3,
          adminAuditEvents: 1,
          gameRooms: 2,
          moderationEvents: 4,
          privateRooms: 5,
          reports: -1,
          users: Number.NaN,
        },
        '2026-07-08T00:00:00.000Z',
      ),
    ).toEqual({
      activeRooms: 3,
      adminAuditEvents: 1,
      gameRooms: 2,
      generatedAt: '2026-07-08T00:00:00.000Z',
      moderationEvents: 4,
      privateRooms: 5,
      reports: 0,
      systemStatus: 'ok',
      users: 0,
    });
  });

  it('normalizes user queries and user notes with conservative limits', () => {
    expect(normalizeAdminUsersQuery({ limit: 250, search: '  Dana@example.com  ' })).toEqual({
      limit: 25,
      readLimit: 100,
      search: 'dana@example.com',
    });
    expect(normalizeAdminUsersQuery({ limit: 10 })).toEqual({
      limit: 10,
      readLimit: 10,
      search: '',
    });
    expect(normalizeAdminUserNote({ targetUid: ' user-1 ', note: '  Needs review  ' })).toEqual({
      ok: true,
      value: {
        note: 'Needs review',
        targetUid: 'user-1',
      },
    });
    expect(normalizeAdminUserNote({ targetUid: '', note: 'ok' })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeAdminUserNote({ targetUid: 'user-1', note: 'x' })).toMatchObject({ ok: false, status: 400 });
  });

  it('normalizes room queries and safe room actions', () => {
    expect(normalizeAdminRoomsQuery({ limit: 250, status: 'closed' })).toEqual({
      limit: 25,
      status: 'closed',
    });
    expect(normalizeAdminRoomsQuery({ limit: 12, status: 'unknown' })).toEqual({
      limit: 12,
      status: 'active',
    });
    expect(normalizeAdminRoomAction({ roomAction: 'close-room', roomId: ' room-1 ', reason: ' done ' })).toEqual({
      ok: true,
      value: {
        action: 'close-room',
        reason: 'done',
        roomId: 'room-1',
        targetUid: '',
      },
    });
    expect(normalizeAdminRoomAction({ roomAction: 'remove-member', roomId: 'room-1', targetUid: 'user-2' })).toEqual({
      ok: true,
      value: {
        action: 'remove-member',
        reason: '',
        roomId: 'room-1',
        targetUid: 'user-2',
      },
    });
    expect(normalizeAdminRoomAction({ roomAction: 'delete-room', roomId: 'room-1' })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeAdminRoomAction({ roomAction: 'remove-member', roomId: 'room-1' })).toMatchObject({ ok: false, status: 400 });
  });

  it('maps and filters safe admin user profile rows', () => {
    const updatedAt = { toMillis: () => Date.parse('2026-07-08T00:00:00.000Z') };
    const row = mapAdminUserProfileDocument('user-1', {
      avatarLabel: 'DA',
      displayName: ' Dana ',
      email: ' dana@example.com ',
      updatedAt,
    });

    expect(row).toEqual({
      avatarLabel: 'DA',
      displayName: 'Dana',
      email: 'dana@example.com',
      uid: 'user-1',
      updatedAt: '2026-07-08T00:00:00.000Z',
    });
    expect(filterAdminUserRows([row], 'example')).toEqual([row]);
    expect(filterAdminUserRows([row], 'missing')).toEqual([]);
  });

  it('maps safe admin room rows without invite codes', () => {
    const updatedAt = { toDate: () => new Date('2026-07-08T01:00:00.000Z') };
    expect(
      mapAdminRoomDocument('room-1', {
        currentGameId: 'game-1',
        hostAvatarLabel: 'H',
        hostDisplayName: ' Host ',
        hostId: 'host-1',
        inviteCode: 'SECRET',
        participantCount: 4,
        status: 'active',
        title: ' Lobby ',
        type: 'voice',
        updatedAt,
        visibility: 'private',
      }),
    ).toEqual({
      createdAt: '',
      currentGameId: 'game-1',
      hostAvatarLabel: 'H',
      hostDisplayName: 'Host',
      hostId: 'host-1',
      id: 'room-1',
      participantCount: 4,
      status: 'active',
      title: 'Lobby',
      type: 'voice',
      updatedAt: '2026-07-08T01:00:00.000Z',
      visibility: 'private',
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
