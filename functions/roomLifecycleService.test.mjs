import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { finalizeRemovedRooms } = require('./roomLifecycleService');

describe('roomLifecycleService', () => {
  it('finalizes only expired recoverable removals and preserves a safety archive', async () => {
    const DELETE = Symbol('delete');
    const room = {
      availability: 'removed',
      deletionStatus: 'recoverable',
      ownerUid: 'owner-1',
      removalReason: 'owner request',
      scheduledDeletionAt: 999,
      status: 'closed',
      title: 'Room title',
    };
    const roomRef = { id: 'room-1', path: 'rooms/room-1' };
    const data = new Map([[roomRef.path, room]]);
    const snapshot = (ref) => ({
      data: () => data.get(ref.path),
      exists: data.has(ref.path),
      id: ref.id,
      ref,
    });
    const query = {
      get: async () => ({ docs: [snapshot(roomRef)], size: 1 }),
      limit: () => query,
      orderBy: () => query,
      where: () => query,
    };
    const db = {
      collection: () => query,
      doc: (path) => ({ id: path.split('/').at(-1), path }),
      runTransaction: async (callback) => callback({
        get: async (ref) => snapshot(ref),
        set: (ref, value) => data.set(ref.path, value),
        update: (ref, value) => data.set(ref.path, Object.fromEntries(
          Object.entries({ ...data.get(ref.path), ...value }).filter(([, item]) => item !== DELETE),
        )),
      }),
    };

    await expect(finalizeRemovedRooms({
      clock: { nowMillis: () => 1_000, timestampFromMillis: (value) => value },
      db,
      fieldValue: { delete: () => DELETE, serverTimestamp: () => 1_000 },
    })).resolves.toEqual({ finalized: 1, scanned: 1 });
    expect(data.get('rooms/room-1')).toMatchObject({
      availability: 'purged',
      deletionStatus: 'finalized',
      status: 'closed',
      title: 'Removed room',
    });
    expect(data.get('deletedRoomArchives/room-1')).toMatchObject({
      ownerUid: 'owner-1',
      roomId: 'room-1',
      safetyEvidencePreserved: true,
    });
  });
});
