import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createOwnershipTransferId } = require('./roomOwnershipCore');
const { executeRoomOwnershipCommand } = require('./roomOwnershipService');

const nowMs = 2_000_000_000_000;
const clock = {
  nowMillis: () => nowMs,
  timestampFromMillis: (value) => value,
};
const DELETE = Symbol('delete');
const fieldValue = {
  delete: () => DELETE,
  serverTimestamp: () => nowMs,
};

describe('roomOwnershipService', () => {
  it('creates one idempotent expiring offer and an in-app notification', async () => {
    const db = seededDb();
    const body = {
      action: 'offer-ownership-transfer',
      expectedOwnershipRevision: 3,
      requestId: 'ownership_request_0001',
      roomId: 'room-1',
      targetUid: 'target-1',
    };
    const options = {
      body,
      clock,
      db,
      decodedToken: freshToken('owner-1'),
      fieldValue,
    };
    const first = await executeRoomOwnershipCommand(options);
    const replay = await executeRoomOwnershipCommand(options);
    expect(first).toMatchObject({
      ok: true,
      replayed: false,
      result: { status: 'pending', targetUid: 'target-1' },
    });
    expect(replay).toMatchObject({ ok: true, replayed: true, result: first.result });
    const transferId = createOwnershipTransferId(body.requestId);
    expect(db.data.get(`rooms/room-1/ownershipTransfers/${transferId}`)).toMatchObject({
      fromUid: 'owner-1',
      status: 'pending',
      toUid: 'target-1',
    });
    expect(db.data.get('rooms/room-1')).toMatchObject({
      pendingOwnershipTransferId: transferId,
      revision: 9,
    });
    expect(db.data.get(`roomOwnershipNotifications/target-1/items/${transferId}_room-ownership-offered`))
      .toMatchObject({ recipientUid: 'target-1' });
  });

  it('atomically accepts and makes the former owner a moderator', async () => {
    const db = seededDb();
    const offer = await executeRoomOwnershipCommand({
      body: {
        action: 'offer-ownership-transfer',
        expectedOwnershipRevision: 3,
        requestId: 'ownership_request_0002',
        roomId: 'room-1',
        targetUid: 'target-1',
      },
      clock,
      db,
      decodedToken: freshToken('owner-1'),
      fieldValue,
    });
    const accepted = await executeRoomOwnershipCommand({
      body: {
        action: 'accept-ownership-transfer',
        requestId: 'ownership_accept_0002',
        roomId: 'room-1',
        transferId: offer.result.transferId,
      },
      clock,
      db,
      decodedToken: freshToken('target-1'),
      fieldValue,
    });
    expect(accepted).toMatchObject({
      ok: true,
      result: { ownershipRevision: 4, status: 'accepted' },
    });
    expect(db.data.get('rooms/room-1')).toMatchObject({
      hostId: 'target-1',
      moderatorCount: 2,
      ownerUid: 'target-1',
      ownershipRevision: 4,
      revision: 10,
    });
    expect(db.data.get('rooms/room-1/members/owner-1')).toMatchObject({
      authorityRole: 'moderator',
    });
    expect(db.data.get('rooms/room-1/members/target-1')).toMatchObject({
      authorityRole: 'owner',
      role: 'host',
    });
    expect(db.data.get(`rooms/room-1/messages/system_${offer.result.transferId}`)).toMatchObject({
      kind: 'system',
      metadata: { type: 'ownership-transferred' },
    });
  });

  it('lets the recipient decline without changing ownership', async () => {
    const db = seededDb();
    const offer = await executeRoomOwnershipCommand({
      body: {
        action: 'offer-ownership-transfer',
        expectedOwnershipRevision: 3,
        requestId: 'ownership_request_0003',
        roomId: 'room-1',
        targetUid: 'target-1',
      },
      clock,
      db,
      decodedToken: freshToken('owner-1'),
      fieldValue,
    });
    expect(await executeRoomOwnershipCommand({
      body: {
        action: 'decline-ownership-transfer',
        requestId: 'ownership_decline_0003',
        roomId: 'room-1',
        transferId: offer.result.transferId,
      },
      clock,
      db,
      decodedToken: { uid: 'target-1' },
      fieldValue,
    })).toMatchObject({ ok: true, result: { status: 'declined' } });
    expect(db.data.get('rooms/room-1')).toMatchObject({ ownerUid: 'owner-1' });
    expect(db.data.get(`rooms/room-1/ownershipTransfers/${offer.result.transferId}`))
      .toMatchObject({ status: 'declined' });
  });

  it('fails closed and records a stable denial', async () => {
    const db = seededDb();
    db.data.set('appConfig/voiceRoomFeatures', {});
    const body = {
      action: 'offer-ownership-transfer',
      expectedOwnershipRevision: 3,
      requestId: 'ownership_request_0004',
      roomId: 'room-1',
      targetUid: 'target-1',
    };
    expect(await executeRoomOwnershipCommand({
      body,
      clock,
      db,
      decodedToken: freshToken('owner-1'),
      fieldValue,
    })).toMatchObject({ code: 'FEATURE_DISABLED', ok: false });
    expect(db.data.get('rooms/room-1/ownershipTransferRequests/ownership_request_0004'))
      .toMatchObject({ status: 'denied' });
  });
});

function freshToken(uid) {
  return { auth_time: Math.floor((nowMs - 30_000) / 1000), uid };
}

function seededDb() {
  const db = createFakeDb();
  db.data.set('appConfig/voiceRoomFeatures', {
    voice_room_chat: true,
    voice_room_ownership_transfer: true,
  });
  db.data.set('rooms/room-1', {
    audioLockdown: false,
    availability: 'active',
    hostId: 'owner-1',
    moderatorCount: 1,
    ownerUid: 'owner-1',
    ownershipRevision: 3,
    revision: 8,
    schemaVersion: 2,
    status: 'active',
  });
  db.data.set('rooms/room-1/members/owner-1', {
    authorityRole: 'owner',
    avatarLabel: 'O',
    canPublishAudio: true,
    displayName: 'Owner',
    role: 'host',
    status: 'active',
    uid: 'owner-1',
  });
  db.data.set('rooms/room-1/members/target-1', {
    authorityRole: 'member',
    avatarLabel: 'T',
    canPublishAudio: false,
    displayName: 'Target',
    role: 'listener',
    status: 'active',
    uid: 'target-1',
  });
  db.data.set('users/target-1', {
    avatarLabel: 'T',
    displayName: 'Target',
    email: 'target@example.test',
    uid: 'target-1',
  });
  db.data.set('users/owner-1', {
    avatarLabel: 'O',
    displayName: 'Owner',
    email: 'owner@example.test',
    uid: 'owner-1',
  });
  db.data.set('publicProfiles/owner-1', {
    avatarLabel: 'O',
    countryCode: 'IQ',
    displayName: 'Owner',
    moderationStatus: 'active',
    uid: 'owner-1',
  });
  db.data.set('publicProfiles/target-1', {
    avatarLabel: 'T',
    countryCode: 'IQ',
    displayName: 'Target',
    moderationStatus: 'active',
    uid: 'target-1',
  });
  return db;
}

function createFakeDb() {
  const data = new Map();
  const makeRef = (path) => ({
    id: path.split('/').at(-1),
    path,
    collection(name) {
      return { doc: (id) => makeRef(`${path}/${name}/${id}`) };
    },
  });
  const snapshot = (reference) => ({
    data: () => data.get(reference.path),
    exists: data.has(reference.path),
    id: reference.id,
    ref: reference,
  });
  const clean = (value, current = {}) => Object.fromEntries(
    Object.entries({ ...current, ...value }).filter(([, item]) => item !== DELETE),
  );
  const transaction = {
    create(reference, value) {
      if (data.has(reference.path)) throw new Error(`already exists: ${reference.path}`);
      data.set(reference.path, clean(value));
    },
    get: async (reference) => snapshot(reference),
    set(reference, value, options) {
      data.set(reference.path, clean(value, options?.merge ? data.get(reference.path) : {}));
    },
    update(reference, value) {
      data.set(reference.path, clean(value, data.get(reference.path)));
    },
  };
  return {
    data,
    doc: makeRef,
    runTransaction: (callback) => callback(transaction),
  };
}
