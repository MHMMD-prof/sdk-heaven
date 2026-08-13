import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  cleanupExpiredRoomReactionRecords,
  executeRoomReactionCommand,
} = require('./roomReactionService');

const nowMs = 2_000_000_000_000;
const checksum = 'a'.repeat(64);
const body = {
  action: 'send-room-reaction',
  assetId: 'room-heart',
  assetVersionId: 'v1-123456789abc',
  requestId: 'reaction_request_00001',
  roomId: 'room-1',
  sessionId: 'presence_session_0001',
};
const context = {
  body,
  clock: { nowMillis: () => nowMs, timestampFromMillis: timestamp },
  decodedToken: { uid: 'user-1' },
  fieldValue: { serverTimestamp: () => timestamp() },
};

describe('roomReactionService', () => {
  it('authorizes once, writes only bounded operational state, and replays idempotently', async () => {
    const db = seededDb();
    const first = await executeRoomReactionCommand({ ...context, db });
    const replay = await executeRoomReactionCommand({ ...context, db });
    expect(first).toMatchObject({ ok: true, result: { envelope: { eventId: expect.stringMatching(/^rr_/) } } });
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(paths(db, '/events/')).toHaveLength(0);
    expect(paths(db, '/reactionRequests/')).toHaveLength(1);
    expect(paths(db, '/reactionRateLimits/')).toHaveLength(1);
    expect(paths(db, '/reactionRoomRateLimits/')).toHaveLength(1);
    expect(db.documents.get('rooms/room-1/reactionRateLimits/user-1').count).toBe(1);
    for (let index = 2; index <= 20; index += 1) {
      await executeRoomReactionCommand({
        ...context,
        body: { ...body, requestId: `reaction_request_${String(index).padStart(5, '0')}` },
        db,
      });
    }
    expect(await executeRoomReactionCommand({
      ...context,
      body: { ...body, requestId: 'reaction_request_99999' },
      db,
    })).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('rejects stale presence and conflicting request IDs', async () => {
    const db = seededDb();
    db.documents.set('rooms/room-1/presence/user-1', {
      sessionId: 'presence_session_other',
      leaseExpiresAt: timestamp(nowMs + 45_000),
      status: 'online',
      uid: 'user-1',
    });
    expect(await executeRoomReactionCommand({ ...context, db })).toMatchObject({ code: 'SESSION_MISMATCH' });

    const validDb = seededDb();
    await executeRoomReactionCommand({ ...context, db: validDb });
    expect(await executeRoomReactionCommand({
      ...context,
      body: { ...body, assetId: 'room-other' },
      db: validDb,
    })).toMatchObject({ code: 'REQUEST_ID_CONFLICT' });
  });

  it('rejects matching sessions that are stale or have an expired lease', async () => {
    const staleDb = seededDb();
    staleDb.documents.set('rooms/room-1/presence/user-1', {
      leaseExpiresAt: timestamp(nowMs + 45_000),
      sessionId: body.sessionId,
      status: 'stale',
      uid: 'user-1',
    });
    expect(await executeRoomReactionCommand({ ...context, db: staleDb }))
      .toMatchObject({ code: 'SESSION_MISMATCH' });

    const expiredDb = seededDb();
    expiredDb.documents.set('rooms/room-1/presence/user-1', {
      leaseExpiresAt: timestamp(nowMs),
      sessionId: body.sessionId,
      status: 'online',
      uid: 'user-1',
    });
    expect(await executeRoomReactionCommand({ ...context, db: expiredDb }))
      .toMatchObject({ code: 'SESSION_MISMATCH' });
  });

  it('drains every expired collection in bounded pages', async () => {
    const db = seededDb();
    for (let index = 0; index < 5; index += 1) {
      db.documents.set(`rooms/room-1/reactionRequests/expired-${index}`, { purgeAfter: timestamp(nowMs - 1) });
      db.documents.set(`rooms/room-1/reactionRateLimits/expired-${index}`, { purgeAfter: timestamp(nowMs - 1) });
      db.documents.set(`rooms/room-1/reactionRoomRateLimits/expired-${index}`, { purgeAfter: timestamp(nowMs - 1) });
    }
    expect(await cleanupExpiredRoomReactionRecords({ clock: context.clock, db, limit: 2 }))
      .toEqual({ deleted: 15, scanned: 15 });
    expect(paths(db, 'expired-')).toHaveLength(0);
  });
});

function seededDb() {
  return new FakeFirestore({
    'appConfig/cosmeticsFeatures': {
      room_reaction_catalog: [{ assetId: 'room-heart', assetVersionId: 'v1-123456789abc' }],
      room_reactions: true,
    },
    'cosmeticAssetApprovals/room-heart__v1-123456789abc': {
      assetId: 'room-heart', assetVersionId: 'v1-123456789abc', checksum, decision: 'approved',
    },
    'cosmeticAssets/room-heart': {
      approvalId: 'room-heart__v1-123456789abc',
      approvedVersionId: 'v1-123456789abc',
      assetId: 'room-heart',
      moderationStatus: 'approved',
      publicationStatus: 'published',
      publishedVersionId: 'v1-123456789abc',
      renderingEnabled: true,
    },
    'cosmeticAssets/room-heart/versions/v1-123456789abc': {
      assetId: 'room-heart',
      assetVersionId: 'v1-123456789abc',
      category: 'room-reaction',
      format: 'png',
      sha256: checksum,
    },
    'publicProfiles/user-1': { moderationStatus: 'active', uid: 'user-1' },
    'rooms/room-1': { availability: 'active', effectsPolicy: 'full', status: 'active' },
    'rooms/room-1/members/user-1': { status: 'active', uid: 'user-1' },
    'rooms/room-1/presence/user-1': {
      leaseExpiresAt: timestamp(nowMs + 45_000),
      sessionId: 'presence_session_0001',
      status: 'online',
      uid: 'user-1',
    },
  });
}

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(documents));
    this.tail = Promise.resolve();
  }
  doc(path) { return makeRef(path); }
  collectionGroup(name) { return new FakeQuery(this, name); }
  batch() {
    const deletes = [];
    return {
      commit: async () => deletes.forEach((path) => this.documents.delete(path)),
      delete: (ref) => deletes.push(ref.path),
    };
  }
  async runTransaction(callback) {
    const run = async () => {
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      transaction.commit();
      return result;
    };
    const result = this.tail.then(run, run);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

class FakeQuery {
  constructor(db, name, limitCount = 300) {
    this.db = db;
    this.name = name;
    this.limitCount = limitCount;
  }
  where() { return this; }
  orderBy() { return this; }
  limit(count) { return new FakeQuery(this.db, this.name, count); }
  async get() {
    const docs = [...this.db.documents.entries()]
      .filter(([path, data]) => path.split('/').at(-2) === this.name && data.purgeAfter?.toMillis() <= nowMs)
      .slice(0, this.limitCount)
      .map(([path, data]) => snapshot(path, data));
    return { docs };
  }
}

class FakeTransaction {
  constructor(db) {
    this.db = db;
    this.operations = [];
  }
  async get(ref) { return snapshot(ref.path, this.db.documents.get(ref.path)); }
  create(ref, data) { this.operations.push({ data, merge: false, path: ref.path }); }
  set(ref, data, options) { this.operations.push({ data, merge: options?.merge === true, path: ref.path }); }
  commit() {
    for (const operation of this.operations) {
      const current = this.db.documents.get(operation.path) || {};
      this.db.documents.set(
        operation.path,
        operation.merge ? { ...current, ...operation.data } : operation.data,
      );
    }
  }
}

function makeRef(path) {
  return {
    collection: (name) => ({ doc: (id) => makeRef(`${path}/${name}/${id}`) }),
    path,
  };
}

function snapshot(path, data) {
  return { data: () => data, exists: data !== undefined, ref: makeRef(path) };
}

function paths(db, fragment) {
  return [...db.documents.keys()].filter((path) => path.includes(fragment));
}

function timestamp(value = nowMs) {
  return { toDate: () => new Date(value), toMillis: () => value };
}
