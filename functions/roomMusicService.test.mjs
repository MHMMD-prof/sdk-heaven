import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  cleanupExpiredRoomMusicRecords,
  executeRoomMusicCommand,
  expireRoomMusicLeases,
} = require('./roomMusicService');
const { ROOM_MUSIC_RATE_LIMIT } = require('./voiceRoomRateLimitCore');

const nowMs = 2_000_000_000_000;
const clock = {
  nowMillis: () => nowMs,
  timestampFromMillis: (value) => timestamp(value),
};
const fieldValue = { serverTimestamp: () => timestamp(nowMs) };

describe('roomMusicService', () => {
  it('lists only for active room members without creating replay-document amplification', async () => {
    const db = seededDb();
    const result = await execute(db, command('list-room-music-catalog', 'roommusic_list_000001'));

    expect(result).toMatchObject({
      ok: true,
      result: {
        deviceFilesEnabled: false,
        roomId: 'room-1',
        syncMode: 'server-clock-catalog-v1',
      },
    });
    expect(db.read('rooms/room-1/musicCommandRequests/roommusic_list_000001')).toBeUndefined();
    expect(db.read('roomMusicRateLimits/user-1')).toMatchObject({ count: 1, uid: 'user-1' });
    expect(db.read('roomMusicRateLimits/user-1').purgeAfter).toBeDefined();

    db.documents.set('rooms/room-1/members/user-1', {
      status: 'removed',
      uid: 'user-1',
    });
    expect(await execute(db, command('list-room-music-catalog', 'roommusic_list_000002')))
      .toMatchObject({ code: 'MEMBERSHIP_REQUIRED', status: 403 });
    expect(db.read('rooms/room-1/musicCommandRequests/roommusic_list_000002')).toBeUndefined();
  });

  it('claims and heartbeats one lease without persisting heartbeat replay documents', async () => {
    const db = seededDb();
    const claimed = await execute(db, command('claim-dj-lease', 'roommusic_claim_00001', {
      trackId: 'helix-one',
    }));
    const leaseId = claimed.result.leaseId;
    expect(claimed.ok).toBe(true);
    expect(db.read(`rooms/room-1/musicLeases/${leaseId}`)).toMatchObject({
      djUid: 'user-1',
      status: 'active',
    });

    const heartbeat = await execute(db, command('heartbeat-dj-lease', 'roommusic_heart_00001', {
      leaseId,
    }));
    expect(heartbeat.ok).toBe(true);
    expect(db.read('rooms/room-1/musicCommandRequests/roommusic_heart_00001')).toBeUndefined();
  });

  it('allows an authorized stop after the kill switch is disabled', async () => {
    const db = seededDb();
    const claimed = await execute(db, command('claim-dj-lease', 'roommusic_claim_00002', {
      trackId: 'helix-one',
    }));
    const leaseId = claimed.result.leaseId;
    db.documents.set('appConfig/voiceRoomFeatures', { voice_room_shared_music: false });

    const stopped = await execute(db, command('stop-music', 'roommusic_stop_000001', { leaseId }));
    expect(stopped).toMatchObject({ ok: true, result: { stopped: true } });
    expect(db.read(`rooms/room-1/musicLeases/${leaseId}`)).toMatchObject({
      endReason: 'stopped',
      status: 'stopped',
    });
    expect(db.read('rooms/room-1')).toMatchObject({
      activeDjUid: null,
      activeMusicLeaseId: null,
    });
  });

  it('rate limits music commands globally per user', async () => {
    const db = seededDb();
    for (let index = 0; index < ROOM_MUSIC_RATE_LIMIT; index += 1) {
      expect((await execute(db, command(
        'list-room-music-catalog',
        `roommusic_limit_${String(index).padStart(4, '0')}`,
      ))).ok).toBe(true);
    }
    expect(await execute(db, command('list-room-music-catalog', 'roommusic_limit_block')))
      .toMatchObject({ code: 'RATE_LIMITED', status: 429 });
  });

  it('expires abandoned leases transactionally and purges bounded terminal records', async () => {
    const db = seededDb();
    db.documents.set('rooms/room-1', {
      ...db.read('rooms/room-1'),
      activeDjUid: 'user-1',
      activeMusicLeaseId: 'rml_expired_0000000001',
    });
    db.documents.set('rooms/room-1/musicLeases/rml_expired_0000000001', {
      djUid: 'user-1',
      expiresAt: timestamp(nowMs - 1),
      leaseId: 'rml_expired_0000000001',
      nowPlaying: { playbackState: 'playing', trackId: 'helix-one' },
      roomId: 'room-1',
      status: 'active',
    });

    expect(await expireRoomMusicLeases({ clock, db })).toEqual({ expired: 1, scanned: 1 });
    expect(db.read('rooms/room-1')).toMatchObject({
      activeDjUid: null,
      activeMusicLeaseId: null,
    });
    expect(db.read('rooms/room-1/musicLeases/rml_expired_0000000001')).toMatchObject({
      endReason: 'expired',
      status: 'expired',
    });

    db.documents.set('rooms/room-1/musicCommandRequests/old', {
      purgeAfter: timestamp(nowMs - 1),
    });
    db.documents.set('roomMusicRateLimits/old-user', {
      purgeAfter: timestamp(nowMs - 1),
    });
    db.documents.set('rooms/room-1/musicLeases/old-terminal', {
      purgeAfter: timestamp(nowMs - 1),
      status: 'stopped',
    });
    db.documents.set('rooms/room-1/musicLeases/old-active', {
      purgeAfter: timestamp(nowMs - 1),
      status: 'active',
    });

    expect(await cleanupExpiredRoomMusicRecords({ clock, db }))
      .toEqual({ deleted: 3, scanned: 3 });
    expect(db.read('rooms/room-1/musicLeases/old-active')).toBeDefined();
  });
});

function execute(db, body, uid = 'user-1') {
  return executeRoomMusicCommand({
    body,
    clock,
    db,
    decodedToken: { uid },
    fieldValue,
  });
}

function command(action, requestId, extra = {}) {
  return {
    action,
    clientVersion: '1.0.0',
    protocolVersion: 2,
    requestId,
    roomId: 'room-1',
    ...extra,
  };
}

function seededDb() {
  return new FakeFirestore({
    'appConfig/voiceRoomFeatures': { voice_room_shared_music: true },
    'publicProfiles/user-1': {
      displayName: 'Ali',
      moderationStatus: 'active',
      uid: 'user-1',
    },
    'rooms/room-1': {
      availability: 'active',
      countryCode: 'IQ',
      hostId: 'user-1',
      id: 'room-1',
      ownerUid: 'user-1',
      status: 'active',
    },
    'rooms/room-1/members/user-1': {
      authorityRole: 'owner',
      displayName: 'Ali',
      status: 'active',
      uid: 'user-1',
    },
  });
}

function timestamp(value = nowMs) {
  return {
    toDate: () => new Date(value),
    toMillis: () => value,
  };
}

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(documents));
    this.transactionTail = Promise.resolve();
  }
  doc(path) {
    return makeRef(path);
  }
  collectionGroup(name) {
    return new FakeQuery(this, name);
  }
  batch() {
    const deleted = [];
    return {
      commit: async () => deleted.forEach((path) => this.documents.delete(path)),
      delete: (ref) => deleted.push(ref.path),
    };
  }
  read(path) {
    return this.documents.get(path);
  }
  async runTransaction(callback) {
    const run = async () => {
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      transaction.commit();
      return result;
    };
    const result = this.transactionTail.then(run, run);
    this.transactionTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

class FakeTransaction {
  constructor(db) {
    this.db = db;
    this.operations = [];
  }
  async get(ref) {
    return snapshot(ref.path, this.db.documents.get(ref.path));
  }
  create(ref, data) {
    this.operations.push({ data, kind: 'create', path: ref.path });
  }
  set(ref, data, options) {
    this.operations.push({ data, kind: 'set', merge: options?.merge === true, path: ref.path });
  }
  update(ref, data) {
    this.operations.push({ data, kind: 'update', path: ref.path });
  }
  commit() {
    for (const operation of this.operations) {
      if (operation.kind === 'create' && this.db.documents.has(operation.path)) {
        throw new Error(`Exists: ${operation.path}`);
      }
      if (operation.kind === 'update' && !this.db.documents.has(operation.path)) {
        throw new Error(`Missing: ${operation.path}`);
      }
      const current = this.db.documents.get(operation.path) || {};
      this.db.documents.set(
        operation.path,
        operation.kind === 'set' && !operation.merge ? operation.data : { ...current, ...operation.data },
      );
    }
  }
}

class FakeQuery {
  constructor(db, name, limitCount = 300, filters = []) {
    this.db = db;
    this.name = name;
    this.limitCount = limitCount;
    this.filters = filters;
  }
  where(field, operator, value) {
    return new FakeQuery(this.db, this.name, this.limitCount, [
      ...this.filters,
      { field, operator, value },
    ]);
  }
  orderBy() {
    return this;
  }
  limit(count) {
    return new FakeQuery(this.db, this.name, count, this.filters);
  }
  async get() {
    const docs = [...this.db.documents.entries()]
      .filter(([path]) => path.split('/').at(-2) === this.name)
      .filter(([, data]) => this.filters.every(({ field, operator, value }) => (
        operator === '<=' && data[field]?.toMillis?.() <= value.toMillis()
      )))
      .slice(0, this.limitCount)
      .map(([path, data]) => snapshot(path, data));
    return { docs, size: docs.length };
  }
}

function makeRef(path) {
  const parts = path.split('/');
  return {
    collection: (name) => ({ doc: (id) => makeRef(`${path}/${name}/${id}`) }),
    id: parts.at(-1),
    parent: parts.length >= 2 ? makeCollectionRef(parts.slice(0, -1).join('/')) : null,
    path,
  };
}

function makeCollectionRef(path) {
  const parts = path.split('/');
  return {
    doc: (id) => makeRef(`${path}/${id}`),
    id: parts.at(-1),
    parent: parts.length >= 2 ? makeRef(parts.slice(0, -1).join('/')) : null,
    path,
  };
}

function snapshot(path, data) {
  return {
    data: () => data,
    exists: data !== undefined,
    id: path.split('/').at(-1),
    ref: makeRef(path),
  };
}
