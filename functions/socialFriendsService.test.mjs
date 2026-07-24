import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  getFriendsOverview,
  getFriendshipStatus,
  mutateFriendship,
} = require('./socialFriendsService');

const fieldValue = { serverTimestamp: () => ({ __serverTimestamp: true }) };

describe('socialFriendsService', () => {
  it('requires the remotely controlled friends flag', async () => {
    const db = socialDb({ friends: false });
    expect(await getFriendshipStatus({ db, input: { targetUid: 'target' }, uid: 'self' }))
      .toEqual({ errorCode: 'FEATURE_DISABLED' });
  });

  it('creates one request and accepts it transactionally with consistent counters', async () => {
    const db = socialDb({ friends: true });
    const sent = await mutateFriendship({
      action: 'send-friend-request',
      db,
      fieldValue,
      input: { targetUid: 'target' },
      requestId: 'send_request_123456',
      uid: 'self',
    });

    expect(sent).toEqual({ result: { status: 'outgoing' } });
    expect((await getFriendshipStatus({ db, input: { targetUid: 'target' }, uid: 'self' })).result.status)
      .toBe('outgoing');
    expect((await getFriendshipStatus({ db, input: { targetUid: 'self' }, uid: 'target' })).result.status)
      .toBe('incoming');

    const accepted = await mutateFriendship({
      action: 'accept-friend-request',
      db,
      fieldValue,
      input: { targetUid: 'self' },
      requestId: 'accept_request_1234',
      uid: 'target',
    });

    expect(accepted).toEqual({ result: { status: 'friends' } });
    expect(db.documents.get('publicProfiles/self').friendCount).toBe(1);
    expect(db.documents.get('publicProfiles/target').friendCount).toBe(1);

    const overview = await getFriendsOverview({ db, uid: 'self' });
    expect(overview.result.friends.map((row) => row.profile.uid)).toEqual(['target']);
    expect(overview.result.incoming).toEqual([]);
    expect(overview.result.outgoing).toEqual([]);
  });

  it('is idempotent for a repeated command request ID', async () => {
    const db = socialDb({ friends: true });
    const command = {
      action: 'send-friend-request',
      db,
      fieldValue,
      input: { targetUid: 'target' },
      requestId: 'same_request_123456',
      uid: 'self',
    };

    expect(await mutateFriendship(command)).toEqual({ result: { status: 'outgoing' } });
    expect(await mutateFriendship(command)).toEqual({ result: { status: 'outgoing' } });
    expect([...db.documents.keys()].filter((path) => path.startsWith('friendRequests/'))).toHaveLength(1);
  });

  it('rejects friendship operations across either blocking direction', async () => {
    const db = socialDb({ friends: true });
    db.documents.set('blocks/target/blocked/self', { createdAt: timestamp() });

    expect(await mutateFriendship({
      action: 'send-friend-request',
      db,
      fieldValue,
      input: { targetUid: 'target' },
      requestId: 'blocked_request_123',
      uid: 'self',
    })).toEqual({ errorCode: 'PERMISSION_DENIED' });
  });
});

function socialDb(flags) {
  return new FakeFirestore({
    'appConfig/socialFeatures': flags,
    'publicProfiles/self': publicProfile('self', 'Self', '1111111'),
    'publicProfiles/target': publicProfile('target', 'Target', '2222222'),
    'publicIds/1111111': reservation('self'),
    'publicIds/2222222': reservation('target'),
  });
}

function publicProfile(uid, displayName, publicId) {
  return {
    avatarModerationStatus: 'clear',
    avatarUrl: '',
    bio: '',
    countryCode: 'IQ',
    coupleLevel: 0,
    createdAt: timestamp(),
    displayName,
    friendCount: 0,
    giftScore: 0,
    moderationStatus: 'active',
    normalizedName: displayName.toLowerCase(),
    publicId,
    uid,
    updatedAt: timestamp(),
  };
}

function reservation(uid) {
  return { createdAt: timestamp(), uid };
}

function timestamp() {
  return { toMillis: () => 1 };
}

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(documents));
  }

  collection(path) {
    return new FakeQuery(this, path);
  }

  doc(path) {
    return { get: async () => createSnapshot(path, this.documents.get(path)), path };
  }

  async getAll(...refs) {
    return refs.map((ref) => createSnapshot(ref.path, this.documents.get(ref.path)));
  }

  async runTransaction(callback) {
    const transaction = new FakeTransaction(this);
    const result = await callback(transaction);
    transaction.commit();
    return result;
  }
}

class FakeTransaction {
  constructor(db) {
    this.db = db;
    this.operations = [];
  }

  async get(ref) {
    return createSnapshot(ref.path, this.db.documents.get(ref.path));
  }

  create(ref, data) {
    this.operations.push({ kind: 'create', path: ref.path, data });
  }

  delete(ref) {
    this.operations.push({ kind: 'delete', path: ref.path });
  }

  set(ref, data) {
    this.operations.push({ kind: 'set', path: ref.path, data });
  }

  update(ref, data) {
    this.operations.push({ kind: 'update', path: ref.path, data });
  }

  commit() {
    for (const operation of this.operations) {
      if (operation.kind === 'delete') {
        this.db.documents.delete(operation.path);
      } else if (operation.kind === 'update') {
        this.db.documents.set(operation.path, {
          ...this.db.documents.get(operation.path),
          ...operation.data,
        });
      } else if (operation.kind === 'set') {
        this.db.documents.set(operation.path, operation.data);
      } else {
        if (this.db.documents.has(operation.path)) throw new Error(`Already exists: ${operation.path}`);
        this.db.documents.set(operation.path, operation.data);
      }
    }
  }
}

class FakeQuery {
  constructor(db, path, state = {}) {
    this.db = db;
    this.path = path;
    this.state = state;
  }

  where(field, operator, value) {
    return this.next({ filters: [...(this.state.filters || []), { field, operator, value }] });
  }

  orderBy(field, direction = 'asc') {
    return this.next({ order: { field, direction } });
  }

  limit(value) {
    return this.next({ limit: value });
  }

  async get() {
    let rows = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'))
      .map(([path, data]) => ({ path, data }));

    for (const filter of this.state.filters || []) {
      rows = rows.filter(({ data }) => filter.operator === 'array-contains'
        ? Array.isArray(data[filter.field]) && data[filter.field].includes(filter.value)
        : data[filter.field] === filter.value);
    }

    if (this.state.limit) rows = rows.slice(0, this.state.limit);
    return { docs: rows.map(({ path, data }) => createSnapshot(path, data)) };
  }

  next(update) {
    return new FakeQuery(this.db, this.path, { ...this.state, ...update });
  }
}

function createSnapshot(path, data) {
  return {
    data: () => data,
    exists: data !== undefined,
    id: path.split('/').at(-1),
    ref: { path },
  };
}
