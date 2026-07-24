import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { applyLiveKitPlan, executeRoomCommand } = require('./roomCommandService');

describe('roomCommandService', () => {
  it('applies a command once and replays the stored result without a second mutation', async () => {
    const db = createFakeDb();
    seedCommandState(db);
    const input = {
      action: 'promote-speaker',
      expectedRevision: 7,
      requestId: 'room_request_0001',
      roomId: 'room-1',
      targetUid: 'member-1',
    };
    const options = {
      body: input,
      db,
      decodedToken: { email: 'owner@example.com', uid: 'owner-1' },
      fieldValue: fakeFieldValue,
    };

    const first = await executeRoomCommand(options);
    const replay = await executeRoomCommand(options);

    expect(first).toMatchObject({ ok: true, replayed: false, result: { revision: 8 } });
    expect(replay).toMatchObject({ ok: true, replayed: true, result: { revision: 8 } });
    expect(db.data.get('rooms/room-1')).toMatchObject({ revision: 8 });
    expect(db.data.get('rooms/room-1/members/member-1')).toMatchObject({ role: 'speaker', canPublishAudio: true });
    expect([...db.data.keys()].filter((path) => path.includes('/moderationEvents/command_'))).toHaveLength(1);
  });

  it('rejects reusing a request ID for a different command', async () => {
    const db = createFakeDb();
    seedCommandState(db);
    const base = {
      db,
      decodedToken: { email: 'owner@example.com', uid: 'owner-1' },
      fieldValue: fakeFieldValue,
    };
    await executeRoomCommand({ ...base, body: {
      action: 'promote-speaker', expectedRevision: 7, requestId: 'room_request_0001', roomId: 'room-1', targetUid: 'member-1',
    } });
    expect(await executeRoomCommand({ ...base, body: {
      action: 'demote-listener', expectedRevision: 7, requestId: 'room_request_0001', roomId: 'room-1', targetUid: 'member-1',
    } })).toMatchObject({ ok: false, code: 'REQUEST_ID_CONFLICT', status: 409 });
  });

  it('pushes immediate permission and removal changes to LiveKit', async () => {
    const roomService = {
      removeParticipant: vi.fn().mockResolvedValue(undefined),
      updateParticipant: vi.fn().mockResolvedValue(undefined),
    };
    await applyLiveKitPlan(roomService, 'room-1', { type: 'update-permission', targetUid: 'member-1', canPublish: false });
    await applyLiveKitPlan(roomService, 'room-1', { type: 'remove-participant', targetUid: 'member-1' });
    expect(roomService.updateParticipant).toHaveBeenCalledWith('room-1', 'member-1', expect.objectContaining({
      permission: expect.objectContaining({ canPublish: false, canPublishSources: [] }),
    }));
    expect(roomService.removeParticipant).toHaveBeenCalledWith('room-1', 'member-1', expect.objectContaining({
      revokeTokenTs: expect.any(BigInt),
    }));
  });

  it('audits and replays cross-region Super Moderator denials', async () => {
    const db = createFakeDb();
    seedCommandState(db);
    db.data.set('users/staff-1', { uid: 'staff-1', email: 'staff@example.com', displayName: 'Region Staff', avatarLabel: 'R' });
    db.data.set('publicProfiles/staff-1', { uid: 'staff-1', moderationStatus: 'active' });
    db.data.set('adminProfiles/staff-1', {
      uid: 'staff-1', role: 'super-moderator', status: 'active', regionCodes: ['SA'],
    });
    const options = {
      body: { action: 'lock-audio', expectedRevision: 7, requestId: 'room_request_0002', roomId: 'room-1' },
      db,
      decodedToken: { admin: true, adminRole: 'super-moderator', email: 'staff@example.com', uid: 'staff-1' },
      fieldValue: fakeFieldValue,
    };

    expect(await executeRoomCommand(options)).toMatchObject({ ok: false, code: 'REGION_SCOPE_DENIED', replayed: false });
    expect(await executeRoomCommand(options)).toMatchObject({ ok: false, code: 'REGION_SCOPE_DENIED', replayed: true });
    expect(db.data.get('rooms/room-1/moderationEvents/denied_room_request_0002')).toMatchObject({
      code: 'REGION_SCOPE_DENIED',
      status: 'denied',
    });
  });

  it('atomically releases a reconnecting seat when its member is kicked', async () => {
    const db = createFakeDb();
    seedCommandState(db);
    db.data.set('rooms/room-1', {
      ...db.data.get('rooms/room-1'), seatTargetCount: 10, speakerCount: 1,
    });
    db.data.set('rooms/room-1/members/member-1', {
      ...db.data.get('rooms/room-1/members/member-1'), canPublishAudio: true, role: 'speaker', seatId: '01',
    });
    db.data.set('rooms/room-1/seats/01', {
      occupantUid: 'member-1', occupancyState: 'reconnecting', reservationExpiresAt: 45_000,
      revision: 4, schemaVersion: 2, seatNumber: 1, state: 'reconnecting',
    });
    const result = await executeRoomCommand({
      body: {
        action: 'remove-member', expectedRevision: 7, requestId: 'room_request_kick_01',
        roomId: 'room-1', targetUid: 'member-1',
      },
      db,
      decodedToken: { email: 'owner@example.com', uid: 'owner-1' },
      fieldValue: fakeFieldValue,
    });
    expect(result).toMatchObject({ ok: true });
    expect(db.data.get('rooms/room-1/seats/01')).toMatchObject({ occupantUid: null, state: 'open' });
    expect(db.data.get('rooms/room-1/members/member-1')).toMatchObject({ seatId: null, status: 'removed' });
    expect(db.data.get('rooms/room-1')).toMatchObject({ speakerCount: 0 });
  });

  it('applies gated owner settings atomically and includes them in idempotency', async () => {
    const db = createFakeDb();
    seedCommandState(db);
    const base = {
      db,
      decodedToken: { email: 'owner@example.com', uid: 'owner-1' },
      fieldValue: fakeFieldValue,
    };
    const body = {
      action: 'update-room-settings',
      expectedRevision: 7,
      requestId: 'room_settings_request_01',
      roomId: 'room-1',
      settings: {
        announcement: 'أهلاً بالجميع',
        chatMode: 'everyone',
        effectsPolicy: 'reduced',
        slowModeSeconds: 10,
        themeId: 'royal',
      },
    };

    expect(await executeRoomCommand({ ...base, body })).toMatchObject({
      ok: true,
      result: { revision: 8 },
    });
    expect(db.data.get('rooms/room-1')).toMatchObject({
      announcement: 'أهلاً بالجميع',
      chatMode: 'everyone',
      effectsPolicy: 'reduced',
      revision: 8,
      slowModeSeconds: 10,
      themeId: 'royal',
    });
    expect(await executeRoomCommand({
      ...base,
      body: { ...body, settings: { ...body.settings, themeId: 'ocean' } },
    })).toMatchObject({ ok: false, code: 'REQUEST_ID_CONFLICT' });
  });

  it('keeps Command Center mutations dark when the rollout flag is off', async () => {
    const db = createFakeDb();
    seedCommandState(db);
    db.data.set('appConfig/voiceRoomFeatures', { voice_room_command_center: false });

    expect(await executeRoomCommand({
      body: {
        action: 'remove-room',
        expectedRevision: 7,
        reason: 'owner-request',
        requestId: 'room_remove_request_01',
        roomId: 'room-1',
      },
      db,
      decodedToken: { email: 'owner@example.com', uid: 'owner-1' },
      fieldValue: fakeFieldValue,
    })).toMatchObject({ ok: false, code: 'FEATURE_DISABLED' });
    expect(db.data.get('rooms/room-1')).toMatchObject({
      availability: 'active',
      revision: 7,
      status: 'active',
    });
  });

  it('revokes a room ban and clears the removed membership so the user can rejoin', async () => {
    const db = createFakeDb();
    seedCommandState(db);
    db.data.set('rooms/room-1/members/member-1', {
      ...db.data.get('rooms/room-1/members/member-1'),
      status: 'removed',
    });
    db.data.set('rooms/room-1/bans/member-1', {
      actorUid: 'owner-1',
      reason: 'spam',
      roomId: 'room-1',
      status: 'active',
      targetUid: 'member-1',
    });

    expect(await executeRoomCommand({
      body: {
        action: 'unban-member',
        expectedRevision: 7,
        requestId: 'room_unban_request_01',
        roomId: 'room-1',
        targetUid: 'member-1',
      },
      db,
      decodedToken: { email: 'owner@example.com', uid: 'owner-1' },
      fieldValue: fakeFieldValue,
    })).toMatchObject({ ok: true, result: { revision: 8 } });
    expect(db.data.get('rooms/room-1/bans/member-1')).toMatchObject({
      status: 'revoked',
      revokedBy: 'owner-1',
    });
    expect(db.data.has('rooms/room-1/members/member-1')).toBe(false);
  });
});

const fakeFieldValue = {
  increment: (value) => value,
  serverTimestamp: () => 'SERVER_TIMESTAMP',
};

function seedCommandState(db) {
  db.data.set('appConfig/voiceRoomFeatures', { voice_room_command_center: true });
  db.data.set('users/owner-1', { uid: 'owner-1', email: 'owner@example.com', displayName: 'Owner', avatarLabel: 'O' });
  db.data.set('publicProfiles/owner-1', { uid: 'owner-1', moderationStatus: 'active' });
  db.data.set('rooms/room-1', {
    availability: 'active', countryCode: 'IQ', hostId: 'owner-1', id: 'room-1', ownerUid: 'owner-1',
    participantCount: 2, revision: 7, schemaVersion: 2, status: 'active', title: 'Room',
  });
  db.data.set('rooms/room-1/members/owner-1', {
    authorityRole: 'owner', role: 'host', status: 'active', uid: 'owner-1',
  });
  db.data.set('rooms/room-1/members/member-1', {
    avatarLabel: 'D', authorityRole: 'member', canPublishAudio: false, displayName: 'Dana',
    privileges: { canManageMusic: false }, role: 'listener', schemaVersion: 2, seatId: null, status: 'active', uid: 'member-1',
  });
}

function createFakeDb() {
  const data = new Map();
  const ref = (path) => ({
    path,
    collection(name) { return collection(`${path}/${name}`); },
    set(value, options) {
      data.set(path, options?.merge ? { ...(data.get(path) || {}), ...value } : value);
      return Promise.resolve();
    },
  });
  const collection = (path) => ({
    doc(id) { return ref(`${path}/${id}`); },
  });
  const snapshot = (reference) => ({
    exists: data.has(reference.path),
    data: () => data.get(reference.path),
  });
  const transaction = {
    get: async (reference) => snapshot(reference),
    create(reference, value) {
      if (data.has(reference.path)) throw new Error(`already exists: ${reference.path}`);
      data.set(reference.path, value);
    },
    set(reference, value, options) {
      data.set(reference.path, options?.merge ? { ...(data.get(reference.path) || {}), ...value } : value);
    },
    update(reference, value) {
      data.set(reference.path, { ...(data.get(reference.path) || {}), ...value });
    },
    delete(reference) {
      data.delete(reference.path);
    },
  };
  return {
    data,
    doc: ref,
    collection: (name) => collection(name),
    runTransaction: (callback) => callback(transaction),
  };
}
