import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createAdminOverviewPayload,
  filterAdminAuditEventRows,
  filterAdminEconomyRows,
  filterAdminGiftRows,
  filterAdminSpecialIdRows,
  filterAdminStoreRows,
  filterAdminReportRows,
  filterAdminRoomRows,
  filterAdminUserRows,
  mapAdminAuditEventDocument,
  mapAdminReportDocument,
  mapAdminRoomDocument,
  mapAdminGiftCatalogDocument,
  mapAdminSpecialIdDocument,
  mapAdminWalletTransactionDocument,
  mapAdminUserProfileDocument,
  normalizeAdminAuditQuery,
  normalizeAdminAuditLookup,
  normalizeAdminClientError,
  normalizeAdminFeatureFlagUpdate,
  normalizeAdministratorAction,
  normalizeAdminSettingsUpdate,
  normalizeAdminEconomyQuery,
  normalizeAdminEconomyExport,
  normalizeAdminStoreItemLookup,
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

  it('validates bounded user-history queries and section-bound cursors', () => {
    expect(normalizeAdminUserHistoryQuery({ cursor: '', limit: 20, section: 'reports', targetUid: 'user-1' })).toEqual({
      ok: true,
      value: { cursor: '', limit: 20, section: 'reports', targetUid: 'user-1' },
    });
    expect(normalizeAdminUserHistoryQuery({ limit: 21, section: 'reports', targetUid: 'user-1' })).toMatchObject({ ok: true, value: { limit: 20 } });
    expect(normalizeAdminUserHistoryQuery({ section: 'unknown', targetUid: 'user-1' }).ok).toBe(false);
    expect(normalizeAdminUserHistoryQuery({ section: 'notes', targetUid: '' }).ok).toBe(false);
  });

  it('validates audited couple dissolution requests', () => {
    expect(normalizeAdminCoupleDissolve({ reason: 'Safety review', requestId: 'couple_request_1234', targetUid: 'user-1' })).toEqual({
      ok: true,
      value: { reason: 'Safety review', requestId: 'couple_request_1234', targetUid: 'user-1' },
    });
    expect(normalizeAdminCoupleDissolve({ reason: 'Safety review', requestId: 'short', targetUid: 'user-1' }).ok).toBe(false);
    expect(normalizeAdminCoupleDissolve({ reason: 'Safety review', requestId: 'couple_request_1234', targetUid: '' }).ok).toBe(false);
    expect(normalizeAdminCoupleDissolve({ reason: '', requestId: 'couple_request_1234', targetUid: 'user-1' }).ok).toBe(false);
  });

  it('allows verified custom-claim admins to resolve a session request', () => {
    expect(resolveAdminDashboardRequest({ body: { action: 'session' }, decodedToken: adminToken })).toEqual({
      ok: true,
      value: {
        action: 'session',
        admin: true,
        email: 'admin@example.com',
        permissions: expect.any(Array),
        role: 'owner',
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
        permissions: expect.any(Array),
        role: 'owner',
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
    expect(resolveAdminDashboardRequest({ body: { action: 'wallet-credit' }, decodedToken: adminToken })).toMatchObject({
      ok: true,
      value: { action: 'wallet-credit' },
    });
    expect(resolveAdminDashboardRequest({ body: { action: 'special-id-upsert' }, decodedToken: adminToken })).toMatchObject({
      ok: true,
      value: { action: 'special-id-upsert' },
    });
    expect(resolveAdminDashboardRequest({ body: { action: 'gift-catalog-upsert' }, decodedToken: adminToken })).toMatchObject({
      ok: true,
      value: { action: 'gift-catalog-upsert' },
    });
  });

  it('allows verified admins to resolve store and economy requests', () => {
    for (const action of ['store-catalog', 'gift-catalog', 'special-id-catalog', 'economy-history', 'economy-export', 'store-item-detail', 'store-summary', 'store-catalog-upsert']) {
      expect(resolveAdminDashboardRequest({ body: { action }, decodedToken: adminToken })).toMatchObject({ ok: true, value: { action } });
    }
  });

  it('normalizes store and economy filters conservatively', () => {
    expect(normalizeAdminStoreCatalogQuery({ availability: 'available', category: 'cars', cursor: 'next', limit: 500, search: ' Royal ' })).toEqual({
      availability: 'available', category: 'cars', cursor: 'next', limit: 50, readLimit: 100, search: 'royal', status: '',
    });
    expect(normalizeAdminEconomyQuery({ currency: 'diamonds', limit: 200, search: ' 0000777 ', source: ' Admin ', type: 'debit' })).toEqual({
      createdFrom: '', createdTo: '', currency: 'diamonds', cursor: '', limit: 25, readLimit: 100, search: '0000777', source: 'admin', targetUid: '', type: 'debit',
    });
    expect(normalizeAdminStoreCatalogQuery({ status: 'sold' })).toMatchObject({ status: 'sold' });
    expect(normalizeAdminEconomyQuery({ createdFrom: '2026-07-01', createdTo: '2026-07-21' })).toMatchObject({ createdFrom: '2026-07-01', createdTo: '2026-07-21' });
    expect(normalizeAdminEconomyExport({ currency: 'coins', requestId: 'economy_export_1234' })).toMatchObject({ ok: true, value: { currency: 'coins', limit: 2000, readLimit: 2000 } });
    expect(normalizeAdminEconomyExport({ requestId: 'short' })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeAdminStoreItemLookup({ itemId: ' royal_car ' })).toEqual({ ok: true, value: { itemId: 'royal_car' } });
    expect(normalizeAdminStoreItemLookup({ itemId: '../unsafe' })).toMatchObject({ ok: false, status: 400 });
  });

  it('maps and filters safe catalog and wallet records', () => {
    const timestamp = { toDate: () => new Date('2026-07-18T10:00:00.000Z') };
    const gift = mapAdminGiftCatalogDocument('crown', { createdAt: timestamp, giftId: 'crown', iconKey: 'crown', lastEditorEmail: 'admin@example.com', nameAr: 'تاج ملكي', price: 50, scoreValue: 10, status: 'available', updatedAt: timestamp });
    const special = mapAdminSpecialIdDocument('0000777', { price: 500, specialId: '0000777', status: 'available', updatedAt: timestamp });
    const transaction = mapAdminWalletTransactionDocument('tx-1', { actorUid: 'admin-1', amount: 10, balanceAfter: 90, createdAt: timestamp, currency: 'coins', note: 'test', source: 'admin-debit', type: 'debit', uid: 'user-1' });
    expect(gift).toMatchObject({ giftId: 'crown', lastEditorEmail: 'admin@example.com', updatedAt: '2026-07-18T10:00:00.000Z' });
    expect(special).toMatchObject({ specialId: '0000777', status: 'available' });
    expect(transaction).toMatchObject({ id: 'tx-1', type: 'debit', uid: 'user-1' });
    expect(filterAdminGiftRows([gift], { search: 'تاج', status: 'available' })).toHaveLength(1);
    expect(filterAdminSpecialIdRows([special], { search: '777', status: '' })).toHaveLength(1);
    expect(filterAdminEconomyRows([transaction], { currency: 'coins', source: 'admin', type: 'debit' })).toHaveLength(1);
    expect(filterAdminEconomyRows([transaction], { createdFrom: '2026-07-18', createdTo: '2026-07-18' })).toHaveLength(1);
    expect(filterAdminEconomyRows([transaction], { createdFrom: '2026-07-19' })).toHaveLength(0);
    expect(filterAdminStoreRows([{ category: 'cars', availability: 'available', customId: '', description: { ar: 'سيارة', en: 'Car' }, itemId: 'car-1', name: { ar: 'ملكية', en: 'Royal' } }], { availability: 'available', category: 'cars', search: 'royal' })).toHaveLength(1);
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
    expect(resolveAdminDashboardRequest({ body: { action: 'room-summary' }, decodedToken: adminToken })).toMatchObject({ ok: true, value: { action: 'room-summary' } });
    expect(resolveAdminDashboardRequest({ body: { action: 'room-detail' }, decodedToken: adminToken })).toMatchObject({ ok: true, value: { action: 'room-detail' } });
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
    for (const action of ['audit-events', 'audit-summary', 'audit-detail', 'audit-export']) {
      expect(resolveAdminDashboardRequest({ body: { action }, decodedToken: adminToken })).toMatchObject({ ok: true, value: { action } });
    }
  });

  it('enforces role permissions on the backend request boundary', () => {
    const moderator = { ...adminToken, adminRole: 'moderator' };
    const auditor = { ...adminToken, adminRole: 'auditor' };
    expect(resolveAdminDashboardRequest({ body: { action: 'report-action' }, decodedToken: moderator })).toMatchObject({ ok: true, value: { role: 'moderator' } });
    expect(resolveAdminDashboardRequest({ body: { action: 'store-catalog-upsert' }, decodedToken: moderator })).toMatchObject({ ok: false, status: 403 });
    expect(resolveAdminDashboardRequest({ body: { action: 'audit-export' }, decodedToken: auditor })).toMatchObject({ ok: true });
    expect(resolveAdminDashboardRequest({ body: { action: 'administrator-action' }, decodedToken: auditor })).toMatchObject({ ok: true });
  });

  it('normalizes settings, administrator, and approved feature mutations', () => {
    expect(normalizeAdminSettingsUpdate({ density: 'compact', notifications: { flaggedRooms: false }, reduceMotion: true, requestId: 'settings_request_1234' })).toMatchObject({ ok: true, value: { density: 'compact', reduceMotion: true } });
    expect(normalizeAdministratorAction({ administratorAction: 'grant-role', email: ' Admin@Example.com ', reason: 'new operator', requestId: 'administrator_req_1', role: 'support' })).toMatchObject({ ok: true, value: { email: 'admin@example.com', role: 'support' } });
    expect(normalizeAdminFeatureFlagUpdate({ enabled: true, flag: 'wallet', reason: 'release ready', requestId: 'feature_request_123' })).toMatchObject({ ok: true });
    expect(normalizeAdminFeatureFlagUpdate({ enabled: true, flag: 'unsafeFlag', reason: 'no', requestId: 'feature_request_123' })).toMatchObject({ ok: false, status: 400 });
  });

  it('bounds client failure reports before operational logging', () => {
    expect(normalizeAdminClientError({ message: 'Render failed', requestId: 'client_error_req_123', route: '/reports', source: 'boundary', stack: 'stack' })).toMatchObject({ ok: true, value: { message: 'Render failed', route: '/reports' } });
    expect(normalizeAdminClientError({ message: '', requestId: 'client_error_req_123' })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeAdminClientError({ message: 'x', requestId: 'short' })).toMatchObject({ ok: false, status: 400 });
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
      avatarStatus: '',
      countryCode: '',
      cursor: '',
      exactSearch: 'Dana@example.com',
      limit: 25,
      moderationStatus: '',
      profileStatus: '',
      readLimit: 100,
      relationship: '',
      search: 'dana@example.com',
    });
    expect(normalizeAdminUsersQuery({ limit: 10 })).toEqual({
      avatarStatus: '',
      countryCode: '',
      cursor: '',
      exactSearch: '',
      limit: 10,
      moderationStatus: '',
      profileStatus: '',
      readLimit: 100,
      relationship: '',
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

  it('validates user lookups and audited moderation actions', () => {
    expect(normalizeAdminUserLookup({ targetUid: ' user-1 ' })).toEqual({ ok: true, value: { targetUid: 'user-1' } });
    expect(normalizeAdminUserAction({
      durationHours: 24,
      expectedUpdatedAt: '2026-07-18T10:00:00.000Z',
      reason: ' repeated room disruption ',
      requestId: 'moderation_action_001',
      targetUid: ' user-1 ',
      userAction: 'mute',
    })).toEqual({
      ok: true,
      value: {
        action: 'mute',
        durationHours: 24,
        expectedUpdatedAt: '2026-07-18T10:00:00.000Z',
        reason: 'repeated room disruption',
        requestId: 'moderation_action_001',
        targetUid: 'user-1',
      },
    });
    expect(normalizeAdminUserAction({ reason: 'ok', requestId: 'moderation_action_002', targetUid: 'user-1', userAction: 'unmute' })).toMatchObject({ ok: true });
    expect(normalizeAdminUserAction({ durationHours: 0, reason: 'ok', requestId: 'moderation_action_003', targetUid: 'user-1', userAction: 'mute' })).toMatchObject({ ok: false, status: 400 });
  });

  it('normalizes room queries and safe room actions', () => {
    expect(normalizeAdminRoomsQuery({ limit: 250, status: 'closed' })).toEqual({
      capacity: '',
      countryCode: '',
      cursor: '',
      host: '',
      limit: 25,
      readLimit: 100,
      search: '',
      status: 'closed',
      type: '',
      visibility: '',
    });
    expect(normalizeAdminRoomsQuery({ limit: 12, status: 'unknown' })).toEqual({
      capacity: '',
      countryCode: '',
      cursor: '',
      host: '',
      limit: 12,
      readLimit: 100,
      search: '',
      status: 'active',
      type: '',
      visibility: '',
    });
    expect(normalizeAdminRoomLookup({ roomId: ' room-1 ' })).toEqual({ ok: true, value: { roomId: 'room-1' } });
    expect(normalizeAdminRoomAction({ expectedUpdatedAt: '2026-07-18T10:00:00.000Z', requestId: 'room_action_000001', roomAction: 'close-room', roomId: ' room-1 ', reason: ' done ' })).toEqual({
      ok: true,
      value: {
        action: 'close-room',
        expectedUpdatedAt: '2026-07-18T10:00:00.000Z',
        reason: 'done',
        requestId: 'room_action_000001',
        roomId: 'room-1',
        targetUid: '',
      },
    });
    expect(normalizeAdminRoomAction({ requestId: 'room_action_000002', reason: 'policy breach', roomAction: 'remove-member', roomId: 'room-1', targetUid: 'user-2' })).toEqual({
      ok: true,
      value: {
        action: 'remove-member',
        expectedUpdatedAt: '',
        reason: 'policy breach',
        requestId: 'room_action_000002',
        roomId: 'room-1',
        targetUid: 'user-2',
      },
    });
    expect(normalizeAdminRoomAction({ roomAction: 'delete-room', roomId: 'room-1' })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeAdminRoomAction({ reason: 'policy', requestId: 'room_action_000003', roomAction: 'remove-member', roomId: 'room-1' })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeAdminRoomAction({ reason: 'disruptive audio', requestId: 'room_action_000004', roomAction: 'mute-member', roomId: 'room-1', targetUid: 'user-2' })).toMatchObject({ ok: true, value: { action: 'mute-member', targetUid: 'user-2' } });
  });

  it('normalizes report queries and workflow actions', () => {
    expect(normalizeAdminReportsQuery({ limit: 250, status: 'triage' })).toEqual({
      assigneeUid: '',
      createdFrom: '',
      createdTo: '',
      cursor: '',
      limit: 25,
      readLimit: 100,
      roomId: '',
      search: '',
      severity: '',
      source: '',
      status: 'triage',
    });
    expect(normalizeAdminReportsQuery({ limit: 12, status: 'bad' })).toEqual({
      assigneeUid: '',
      createdFrom: '',
      createdTo: '',
      cursor: '',
      limit: 12,
      readLimit: 100,
      roomId: '',
      search: '',
      severity: '',
      source: '',
      status: 'open',
    });
    expect(normalizeAdminReportAction({ reportAction: 'assign', reportId: ' report-1 ', assigneeUid: ' admin-2 ', requestId: 'report_action_0001' })).toEqual({
      ok: true,
      value: {
        action: 'assign',
        assigneeUid: 'admin-2',
        expectedUpdatedAt: '',
        note: '',
        reportId: 'report-1',
        requestId: 'report_action_0001',
      },
    });
    expect(normalizeAdminReportAction({ expectedUpdatedAt: '2026-07-08T00:00:00.000Z', reportAction: 'resolve', reportId: 'report-1', note: ' done ', requestId: 'report_action_0002' })).toEqual({
      ok: true,
      value: {
        action: 'resolve',
        assigneeUid: '',
        expectedUpdatedAt: '2026-07-08T00:00:00.000Z',
        note: 'done',
        reportId: 'report-1',
        requestId: 'report_action_0002',
      },
    });
    expect(normalizeAdminReportAction({ reportAction: 'delete', reportId: 'report-1' })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeAdminReportAction({ reportAction: 'resolve', reportId: 'report-1', note: 'x', requestId: 'report_action_0003' })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeAdminReportAction({ reportAction: 'triage', reportId: 'report-1' })).toMatchObject({ ok: false, status: 400 });
    expect(normalizeAdminReportLookup({ reportId: ' report-1 ' })).toEqual({ ok: true, value: { reportId: 'report-1' } });
    expect(normalizeAdminReportLookup({})).toMatchObject({ ok: false, status: 400 });
  });

  it('normalizes audit event queries with conservative limits', () => {
    expect(normalizeAdminAuditQuery({ actorUid: ' admin-1 ', kind: ' report-workflow ', limit: 250 })).toEqual({
      action: '',
      actorUid: 'admin-1',
      createdFrom: '',
      createdTo: '',
      cursor: '',
      entityType: '',
      kind: 'report-workflow',
      limit: 25,
      readLimit: 100,
      search: '',
      status: '',
      target: '',
    });
    expect(normalizeAdminAuditQuery({ limit: 12 })).toEqual({
      action: '',
      actorUid: '',
      createdFrom: '',
      createdTo: '',
      cursor: '',
      entityType: '',
      kind: '',
      limit: 12,
      readLimit: 13,
      search: '',
      status: '',
      target: '',
    });
    expect(normalizeAdminAuditQuery({ createdFrom: '2026-07-01', createdTo: '2026-07-21', entityType: 'room', eventAction: ' Room-Close ', search: ' R-1 ', status: 'COMPLETED', target: ' room-1 ' })).toMatchObject({ action: 'room-close', createdFrom: '2026-07-01', createdTo: '2026-07-21', entityType: 'room', search: 'r-1', status: 'completed', target: 'room-1' });
    expect(normalizeAdminAuditLookup({ eventId: ' audit-1 ' })).toEqual({ ok: true, value: { eventId: 'audit-1' } });
    expect(normalizeAdminAuditLookup({})).toMatchObject({ ok: false, status: 400 });
  });

  it('maps and filters safe admin user profile rows', () => {
    const updatedAt = { toMillis: () => Date.parse('2026-07-08T00:00:00.000Z') };
    const row = mapAdminUserProfileDocument(
      'user-1',
      {
        avatarLabel: 'DA',
        displayName: ' Dana ',
        email: ' dana@example.com ',
        updatedAt,
      },
      {
        avatarModerationStatus: 'clear',
        avatarUrl: '',
        bio: '',
        countryCode: 'IQ',
        coupleLevel: 0,
        createdAt: updatedAt,
        displayName: 'Dana',
        friendCount: 0,
        giftScore: 14,
        moderationStatus: 'active',
        normalizedName: 'dana',
        publicId: '1234567',
        uid: 'user-1',
        updatedAt,
      },
      { createdAt: updatedAt, uid: 'user-1' },
    );

    expect(row).toEqual({
      avatarModerationStatus: 'clear',
      avatarUrl: '',
      avatarLabel: 'DA',
      bio: '',
      countryCode: 'IQ',
      coupleLevel: 0,
      createdAt: '',
      displayName: 'Dana',
      email: 'dana@example.com',
      friendCount: 0,
      gender: '',
      giftScore: 14,
      moderationStatus: 'active',
      notificationPreferencesConfigured: false,
      profileHealthReason: 'ready',
      publicId: '1234567',
      publicProfileStatus: 'ready',
      specialId: '',
      uid: 'user-1',
      updatedAt: '2026-07-08T00:00:00.000Z',
      walletCoins: 0,
      walletDiamonds: 0,
    });
    expect(filterAdminUserRows([row], 'example')).toEqual([row]);
    expect(filterAdminUserRows([row], '1234567')).toEqual([row]);
    expect(filterAdminUserRows([row], 'missing')).toEqual([]);
    expect(filterAdminUserRows([row], { countryCode: 'IQ', moderationStatus: 'active', profileStatus: 'ready', relationship: 'single', search: '' })).toEqual([row]);
    expect(filterAdminUserRows([row], { relationship: 'coupled', search: '' })).toEqual([]);
  });

  it('marks missing and malformed public profile provisioning state', () => {
    expect(mapAdminUserProfileDocument('user-1', { displayName: 'Dana' })).toMatchObject({
      publicId: '',
      publicProfileStatus: 'missing',
    });
    expect(mapAdminUserProfileDocument('user-1', { displayName: 'Dana' }, { publicId: 'bad' })).toMatchObject({
      publicId: 'bad',
      publicProfileStatus: 'invalid',
    });
    expect(mapAdminUserProfileDocument(
      'user-1',
      { displayName: 'Dana' },
      {
        avatarModerationStatus: 'clear',
        avatarUrl: '',
        bio: '',
        countryCode: 'IQ',
        coupleLevel: 0,
        createdAt: { toMillis: () => 1 },
        displayName: 'Dana',
        friendCount: 0,
        giftScore: 0,
        moderationStatus: 'active',
        normalizedName: 'dana',
        publicId: '1234567',
        uid: 'user-1',
        updatedAt: { toMillis: () => 2 },
      },
    )).toMatchObject({ publicProfileStatus: 'invalid' });
  });

  it('maps safe admin room rows without invite codes', () => {
    const updatedAt = { toDate: () => new Date('2026-07-08T01:00:00.000Z') };
    expect(
      mapAdminRoomDocument('room-1', {
        countryCode: 'iq',
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
      activeRoomImageId: '',
      createdAt: '',
      countryCode: 'IQ',
      currentGameId: 'game-1',
      hostAvatarLabel: 'H',
      hostDisplayName: 'Host',
      hostId: 'host-1',
      id: 'room-1',
      openReportCount: 0,
      participantCount: 4,
      revision: 1,
      roomCustomizationSuspended: false,
      roomImageReviewStatus: 'none',
      status: 'active',
      title: 'Lobby',
      type: 'voice',
      updatedAt: '2026-07-08T01:00:00.000Z',
      visibility: 'private',
    });
  });

  it('filters admin room rows by normalized dashboard status', () => {
    expect(
      filterAdminRoomRows(
        [
          { id: 'room-1', status: 'active' },
          { id: 'room-2', status: 'closed' },
        ],
        'active',
      ),
    ).toEqual([{ id: 'room-1', status: 'active' }]);
    expect(filterAdminRoomRows([
      { countryCode: 'IQ', currentGameId: '', hostDisplayName: 'Dana', hostId: 'host-1', id: 'room-1', participantCount: 4, status: 'active', title: 'Majlis', type: 'voice', visibility: 'public' },
      { countryCode: 'SA', currentGameId: 'carrom', hostDisplayName: 'Salem', hostId: 'host-2', id: 'room-2', participantCount: 25, status: 'active', title: 'Arena', type: 'game', visibility: 'private' },
    ], { capacity: 'crowded', countryCode: 'SA', host: 'salem', search: 'arena', status: 'active', type: 'game', visibility: 'private' })).toHaveLength(1);
  });

  it('maps safe admin report rows', () => {
    const createdAt = { toDate: () => new Date('2026-07-08T02:00:00.000Z') };
    expect(
      mapAdminReportDocument('report-1', {
        assignedTo: 'admin-1',
        contentExcerpt: ' original message ',
        createdAt,
        evidence: [{ kind: 'screenshot', label: 'Capture', url: 'https://example.com/evidence.png' }, { label: 'unsafe', url: 'javascript:alert(1)' }],
        reason: ' spam ',
        reporterUid: 'user-1',
        reporterPublicId: '1002003',
        resolutionNote: 'handled',
        roomId: 'room-1',
        source: 'room-command',
        status: 'open',
        subjectType: 'member',
        targetUid: 'user-2',
        targetPublicId: '9008007',
      }),
    ).toEqual({
      assignedTo: 'admin-1',
      contentExcerpt: 'original message',
      createdAt: '2026-07-08T02:00:00.000Z',
      evidence: [{ kind: 'screenshot', label: 'Capture', url: 'https://example.com/evidence.png' }],
      escalatedAt: '',
      id: 'report-1',
      noteCount: 0,
      reason: 'spam',
      reporterUid: 'user-1',
      reporterPublicId: '1002003',
      resolvedAt: '',
      resolutionNote: 'handled',
      roomId: 'room-1',
      severity: 'medium',
      source: 'room-command',
      status: 'open',
      subjectType: 'member',
      targetUid: 'user-2',
      targetPublicId: '9008007',
      updatedAt: '',
    });
  });

  it('filters admin report rows by normalized dashboard status', () => {
    expect(
      filterAdminReportRows(
        [
          { id: 'report-1', status: 'open' },
          { id: 'report-2', status: 'resolved' },
        ],
        'open',
      ),
    ).toEqual([{ id: 'report-1', status: 'open' }]);
  });

  it('filters report queues by assignment, severity, source, and search', () => {
    const reports = [
      { assignedTo: '', createdAt: '2026-07-08T12:00:00.000Z', id: 'report-1', reason: 'Threat in chat', reporterUid: 'user-1', roomId: 'room-1', severity: 'critical', source: 'chat', status: 'open', targetUid: 'user-2' },
      { assignedTo: 'admin-2', createdAt: '2026-06-08T12:00:00.000Z', id: 'report-2', reason: 'spam', reporterUid: 'user-3', roomId: '', severity: 'low', source: 'profile', status: 'open', targetUid: 'user-4' },
    ];
    expect(filterAdminReportRows(reports, { assigneeUid: 'unassigned', search: 'user-2', severity: 'critical', source: 'chat', status: 'open' })).toEqual([reports[0]]);
    expect(filterAdminReportRows(reports, { createdFrom: '2026-07-01', createdTo: '2026-07-31', identityUids: ['user-2'], roomId: 'room-1', search: 'public-42', status: 'open' })).toEqual([reports[0]]);
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
        publicId: '1234567',
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
      entityId: 'report-1',
      entityType: 'report',
      eventPath: 'rooms/room-1/moderationEvents/event-1',
      id: 'audit-1',
      kind: 'report-workflow',
      note: 'handled',
      publicId: '1234567',
      reportId: 'report-1',
      roomId: 'room-1',
      source: 'admin-dashboard',
      status: 'resolved',
      targetUid: 'user-2',
      category: '',
      itemId: '',
    });
  });

  it('filters admin audit event rows by optional actor and kind', () => {
    const rows = [
      { id: 'audit-1', actorUid: 'admin-1', kind: 'report-workflow' },
      { id: 'audit-2', actorUid: 'admin-2', kind: 'room-moderation' },
    ];

    expect(filterAdminAuditEventRows(rows, { actorUid: 'admin-1', kind: '' })).toEqual([rows[0]]);
    expect(filterAdminAuditEventRows(rows, { actorUid: '', kind: 'room-moderation' })).toEqual([rows[1]]);
    expect(filterAdminAuditEventRows(rows, { actorUid: '', kind: '' })).toEqual(rows);
    const richRows = [
      { action: 'room-close-room', actorEmail: 'admin@example.com', actorUid: 'admin-1', createdAt: '2026-07-20T10:00:00.000Z', entityId: 'room-1', entityType: 'room', id: 'audit-3', itemId: '', kind: 'room-moderation', note: 'abuse', publicId: '', reportId: '', roomId: 'room-1', status: 'completed', targetUid: '' },
    ];
    expect(filterAdminAuditEventRows(richRows, { action: 'room-close', actorUid: '', createdFrom: '2026-07-01', createdTo: '2026-07-21', entityType: 'room', kind: '', search: 'abuse', status: 'completed', target: 'room-1' })).toEqual(richRows);
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
