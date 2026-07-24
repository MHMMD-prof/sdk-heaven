import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const { cleanupOrphanedRoomMedia, executeRoomMediaCommand } = require('./roomMediaService');

describe('roomMediaService', () => {
  it('fully decodes an immutable owner upload and records a pending review', async () => {
    const db = createFakeDb();
    seedOwnerState(db);
    const buffer = await sharp({
      create: {
        background: '#102030',
        channels: 3,
        height: 900,
        width: 1600,
      },
    }).png().toBuffer();
    const mediaId = 'media_request_000001';
    const result = await executeRoomMediaCommand({
      body: {
        action: 'submit-room-image',
        expectedRevision: 4,
        mediaId,
        mediaPath: `room-media/room-1/${mediaId}/source`,
        requestId: 'media_command_000001',
        roomId: 'room-1',
      },
      bucket: fakeBucket(buffer, 'owner-1'),
      db,
      decodedToken: { email: 'owner@example.com', uid: 'owner-1' },
      fieldValue: fakeFieldValue,
    });
    expect(result).toMatchObject({ ok: true, result: { revision: 5 } });
    expect(db.data.get(`rooms/room-1/media/${mediaId}`)).toMatchObject({
      contentType: 'image/png',
      height: 900,
      ownerUid: 'owner-1',
      status: 'pending',
      width: 1600,
    });
    expect(db.data.get('rooms/room-1')).toMatchObject({
      pendingRoomImageId: mediaId,
      revision: 5,
      roomImageReviewStatus: 'pending',
    });
  });

  it('lets platform operations approve a pending image exactly once', async () => {
    const db = createFakeDb();
    seedOwnerState(db);
    seedStaffState(db);
    const mediaId = 'media_request_000001';
    const path = `room-media/room-1/${mediaId}/source`;
    db.data.set(`rooms/room-1/media/${mediaId}`, {
      mediaId,
      ownerUid: 'owner-1',
      path,
      roomId: 'room-1',
      status: 'pending',
    });
    db.data.set('rooms/room-1', {
      ...db.data.get('rooms/room-1'),
      pendingRoomImageId: mediaId,
      pendingRoomImagePath: path,
    });
    const options = {
      body: {
        action: 'approve-room-image',
        expectedRevision: 4,
        mediaId,
        requestId: 'media_approve_000001',
        roomId: 'room-1',
      },
      bucket: fakeBucket(Buffer.alloc(0), 'owner-1'),
      db,
      decodedToken: {
        admin: true,
        adminRole: 'owner',
        email: 'staff@example.com',
        uid: 'staff-1',
      },
      fieldValue: fakeFieldValue,
    };
    expect(await executeRoomMediaCommand(options)).toMatchObject({ ok: true, replayed: false });
    expect(await executeRoomMediaCommand(options)).toMatchObject({ ok: true, replayed: true });
    expect(db.data.get('rooms/room-1')).toMatchObject({
      activeRoomImageId: mediaId,
      activeRoomImagePath: path,
      revision: 5,
      roomImageReviewStatus: 'approved',
    });
    expect(db.data.get(`rooms/room-1/media/${mediaId}`)).toMatchObject({
      approvedBy: 'staff-1',
      status: 'approved',
    });
  });

  it('marks the previous approved image superseded when a replacement is approved', async () => {
    const db = createFakeDb();
    seedOwnerState(db);
    seedStaffState(db);
    db.data.set('rooms/room-1', {
      ...db.data.get('rooms/room-1'),
      activeRoomImageId: 'media_previous_00001',
    });
    db.data.set('rooms/room-1/media/media_previous_00001', {
      mediaId: 'media_previous_00001',
      path: 'room-media/room-1/media_previous_00001/source',
      status: 'approved',
    });
    db.data.set('rooms/room-1/media/media_replacement_001', {
      mediaId: 'media_replacement_001',
      path: 'room-media/room-1/media_replacement_001/source',
      status: 'pending',
    });
    const result = await executeRoomMediaCommand({
      body: {
        action: 'approve-room-image',
        expectedRevision: 4,
        mediaId: 'media_replacement_001',
        requestId: 'media_replace_cmd_001',
        roomId: 'room-1',
      },
      bucket: fakeBucket(Buffer.alloc(0), 'owner-1'),
      db,
      decodedToken: {
        admin: true,
        adminRole: 'owner',
        email: 'staff@example.com',
        uid: 'staff-1',
      },
      fieldValue: fakeFieldValue,
    });
    expect(result).toMatchObject({ ok: true });
    expect(db.data.get('rooms/room-1/media/media_previous_00001')).toMatchObject({
      status: 'superseded',
      supersededByMediaId: 'media_replacement_001',
    });
    expect(db.data.get('rooms/room-1')).toMatchObject({
      activeRoomImageId: 'media_replacement_001',
    });
  });

  it('keeps cleanup dark with the feature flag and deletes only old uncommitted uploads', async () => {
    const db = createFakeDb();
    db.data.set('appConfig/voiceRoomFeatures', {
      voice_room_command_center: false,
      voice_room_media: false,
    });
    const deleteOrphan = vi.fn().mockResolvedValue(undefined);
    const bucket = {
      getFiles: vi.fn().mockResolvedValue([[
        {
          delete: deleteOrphan,
          getMetadata: async () => [{ timeCreated: '2026-07-01T00:00:00.000Z' }],
          name: 'room-media/room-1/media_orphan_000001/source',
        },
      ]]),
    };
    expect(await cleanupOrphanedRoomMedia({
      bucket,
      db,
      now: Date.parse('2026-07-02T00:00:00.000Z'),
    })).toEqual({ deleted: 0, inspected: 0, skipped: true });
    expect(bucket.getFiles).not.toHaveBeenCalled();

    db.data.set('appConfig/voiceRoomFeatures', {
      voice_room_command_center: true,
      voice_room_media: true,
    });
    expect(await cleanupOrphanedRoomMedia({
      bucket,
      db,
      now: Date.parse('2026-07-02T00:00:00.000Z'),
    })).toEqual({ deleted: 1, inspected: 1, purged: 0, skipped: false });
    expect(deleteOrphan).toHaveBeenCalledWith({ ignoreNotFound: true });
  });

  it('purges retained rejected objects while preserving their Firestore audit record', async () => {
    const db = createFakeDb();
    db.data.set('appConfig/voiceRoomFeatures', {
      voice_room_command_center: true,
      voice_room_media: true,
    });
    db.data.set('rooms/room-1/media/media_rejected_00001', {
      status: 'rejected',
      updatedAt: { toMillis: () => Date.parse('2026-05-01T00:00:00.000Z') },
    });
    const deleteRejected = vi.fn().mockResolvedValue(undefined);
    const bucket = {
      getFiles: vi.fn().mockResolvedValue([[
        {
          delete: deleteRejected,
          getMetadata: async () => [{ timeCreated: '2026-05-01T00:00:00.000Z' }],
          name: 'room-media/room-1/media_rejected_00001/source',
        },
      ]]),
    };
    expect(await cleanupOrphanedRoomMedia({
      bucket,
      db,
      now: Date.parse('2026-07-02T00:00:00.000Z'),
    })).toEqual({ deleted: 0, inspected: 1, purged: 1, skipped: false });
    expect(deleteRejected).toHaveBeenCalledOnce();
    expect(db.data.get('rooms/room-1/media/media_rejected_00001').objectDeletedAt).toBeInstanceOf(Date);
  });
});

const DELETE_SENTINEL = Symbol('delete');
const fakeFieldValue = {
  delete: () => DELETE_SENTINEL,
  serverTimestamp: () => 'SERVER_TIMESTAMP',
};

function seedOwnerState(db) {
  db.data.set('appConfig/voiceRoomFeatures', {
    voice_room_command_center: true,
    voice_room_media: true,
  });
  db.data.set('users/owner-1', {
    avatarLabel: 'O',
    displayName: 'Owner',
    email: 'owner@example.com',
    uid: 'owner-1',
  });
  db.data.set('publicProfiles/owner-1', { moderationStatus: 'active', uid: 'owner-1' });
  db.data.set('rooms/room-1', {
    availability: 'active',
    countryCode: 'IQ',
    hostId: 'owner-1',
    id: 'room-1',
    ownerUid: 'owner-1',
    revision: 4,
    status: 'active',
  });
  db.data.set('rooms/room-1/members/owner-1', {
    authorityRole: 'owner',
    status: 'active',
    uid: 'owner-1',
  });
}

function seedStaffState(db) {
  db.data.set('users/staff-1', {
    avatarLabel: 'S',
    displayName: 'Staff',
    email: 'staff@example.com',
    uid: 'staff-1',
  });
  db.data.set('publicProfiles/staff-1', { moderationStatus: 'active', uid: 'staff-1' });
}

function fakeBucket(buffer, uploaderUid) {
  return {
    file: () => ({
      download: async () => [buffer],
      getMetadata: async () => [{
        contentType: 'image/png',
        generation: '1',
        metadata: { uploaderUid },
        size: String(buffer.length),
      }],
    }),
  };
}

function createFakeDb() {
  const data = new Map();
  const snapshot = (reference) => ({
    exists: data.has(reference.path),
    data: () => data.get(reference.path),
    ref: reference,
  });
  const collection = (path) => ({
    doc(id) { return ref(`${path}/${id}`); },
  });
  const ref = (path) => {
    const reference = {
      path,
      collection(name) { return collection(`${path}/${name}`); },
      get: async () => snapshot(reference),
      set: async (value, options) => {
        data.set(path, options?.merge ? { ...(data.get(path) || {}), ...value } : value);
      },
    };
    return reference;
  };
  const transaction = {
    get: async (reference) => snapshot(reference),
    create(reference, value) {
      if (data.has(reference.path)) throw new Error(`already exists: ${reference.path}`);
      data.set(reference.path, applyDeletes(value));
    },
    update(reference, value) {
      data.set(reference.path, applyDeletes({ ...(data.get(reference.path) || {}), ...value }));
    },
  };
  return {
    data,
    doc: ref,
    runTransaction: (callback) => callback(transaction),
  };
}

function applyDeletes(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== DELETE_SENTINEL));
}
