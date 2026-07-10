import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createAdminOverviewPayload,
  filterAdminUserRows,
  mapAdminAuditEventDocument,
  mapAdminReportDocument,
  mapAdminRoomDocument,
  mapAdminUserProfileDocument,
  normalizeAdminAuditQuery,
  normalizeAdminReportAction,
  normalizeAdminReportsQuery,
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

  it('allows verified custom-claim admins to resolve report workflow requests', () => {
    expect(resolveAdminDashboardRequest({ body: { action: 'reports' }, decodedToken: adminToken })).toMatchObject({
      ok: true,
      value: { action: 'reports' },
    });
    expect(resolveAdminDashboardRequest({ body: { action: 'report-action' }, decodedToken: adminToken })).toMatchObject({
      ok: true,
      value: { action: 'report-action' },
    });
  });

  it('allows verified custom-claim admins to resolve audit log requests', () => {
    expect(resolveAdminDashboardRequest({ body: { action: 'audit-events' }, decodedToken: adminToken })).toMatchObject({
      ok: true,
      value: { action: 'audit-events' },
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

  it('normalizes report queries and workflow actions', () => {
    expect(normalizeAdminReportsQuery({ limit: 250, status: 'triage' })).toEqual({
      limit: 25,
      status: 'triage',
    });
    expect(normalizeAdminReportsQuery({ limit: 12, status: 'bad' })).toEqual({
      limit: 12,
      status: 'open',
    });
    expect(normalizeAdminReportAction({ reportAction: 'assign', reportId: ' report-1 ', assigneeUid: ' admin-2 ' })).toEqual({
      ok: true,
      value: {
        action: 'assign',
        assigneeUid: 'admin-2',
        note: '',
        reportId: 'report-1',
      },
    });
    expect(normalizeAdminReportAction({ reportAction: 'resolve', reportId: 'report-1', note: ' done ' })).toEqual({
      ok: true,
      value: {
        action: 'resolve',
        assigneeUid: '',
        note: 'done',
        reportId: 'report-1',
      },
    });
    expect(normalizeAdminReportAction({ reportAction: 'delete', reportId: 'report-1' })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeAdminReportAction({ reportAction: 'resolve', reportId: 'report-1', note: 'x' })).toMatchObject({ ok: false, status: 400 });
  });

  it('normalizes audit event queries with conservative limits', () => {
    expect(normalizeAdminAuditQuery({ actorUid: ' admin-1 ', kind: ' report-workflow ', limit: 250 })).toEqual({
      actorUid: 'admin-1',
      kind: 'report-workflow',
      limit: 25,
    });
    expect(normalizeAdminAuditQuery({ limit: 12 })).toEqual({
      actorUid: '',
      kind: '',
      limit: 12,
    });
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

  it('maps safe admin report rows', () => {
    const createdAt = { toDate: () => new Date('2026-07-08T02:00:00.000Z') };
    expect(
      mapAdminReportDocument('report-1', {
        assignedTo: 'admin-1',
        createdAt,
        reason: ' spam ',
        reporterUid: 'user-1',
        resolutionNote: 'handled',
        roomId: 'room-1',
        source: 'room-command',
        status: 'open',
        subjectType: 'member',
        targetUid: 'user-2',
      }),
    ).toEqual({
      assignedTo: 'admin-1',
      createdAt: '2026-07-08T02:00:00.000Z',
      id: 'report-1',
      reason: 'spam',
      reporterUid: 'user-1',
      resolutionNote: 'handled',
      roomId: 'room-1',
      source: 'room-command',
      status: 'open',
      subjectType: 'member',
      targetUid: 'user-2',
      updatedAt: '',
    });
  });

  it('maps safe admin audit event rows', () => {
    const createdAt = { toMillis: () => Date.parse('2026-07-08T03:00:00.000Z') };
    expect(
      mapAdminAuditEventDocument('audit-1', {
        action: 'report-resolve',
        actorEmail: 'admin@example.com',
        actorUid: 'admin-1',
        assignedTo: 'admin-2',
        createdAt,
        eventPath: 'rooms/room-1/moderationEvents/event-1',
        kind: 'report-workflow',
        note: 'handled',
        privatePayload: 'hidden',
        reportId: 'report-1',
        roomId: 'room-1',
        status: 'resolved',
        targetUid: 'user-2',
      }),
    ).toEqual({
      action: 'report-resolve',
      actorEmail: 'admin@example.com',
      actorUid: 'admin-1',
      assignedTo: 'admin-2',
      createdAt: '2026-07-08T03:00:00.000Z',
      eventPath: 'rooms/room-1/moderationEvents/event-1',
      id: 'audit-1',
      kind: 'report-workflow',
      note: 'handled',
      reportId: 'report-1',
      roomId: 'room-1',
      status: 'resolved',
      targetUid: 'user-2',
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
