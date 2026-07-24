import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { discoverUsers } = require('./socialDiscoveryService');

describe('socialDiscoveryService', () => {
  it('requires the remote discovery feature flag', async () => {
    const db = new FakeFirestore({ 'appConfig/socialFeatures': { usersDiscovery: false } });
    expect(await discoverUsers({ db, input: {}, uid: 'self' })).toEqual({ errorCode: 'FEATURE_DISABLED' });
  });

  it('returns only active, reserved, unblocked profiles and excludes self', async () => {
    const db = new FakeFirestore({
      'appConfig/socialFeatures': { usersDiscovery: true },
      'publicProfiles/self': publicProfile('self', 'Self', '1111111', 100),
      'publicProfiles/visible': publicProfile('visible', 'Visible', '2222222', 80),
      'publicProfiles/blocked': publicProfile('blocked', 'Blocked', '3333333', 70),
      'publicProfiles/suspended': publicProfile('suspended', 'Suspended', '4444444', 60, 'suspended'),
      'publicProfiles/broken': publicProfile('broken', 'Broken', '5555555', 50),
      'publicIds/1111111': reservation('self'),
      'publicIds/2222222': reservation('visible'),
      'publicIds/3333333': reservation('blocked'),
      'publicIds/4444444': reservation('suspended'),
      'publicIds/5555555': reservation('other-owner'),
      'blocks/blocked/blocked/self': { createdAt: timestamp() },
    });

    const response = await discoverUsers({ db, input: {}, uid: 'self' });
    expect(response.result.users.map((profile) => profile.uid)).toEqual(['visible']);
  });

  it('supports normalized prefix and country filtering', async () => {
    const db = new FakeFirestore({
      'appConfig/socialFeatures': { usersDiscovery: true },
      'publicProfiles/self': publicProfile('self', 'Self', '1111111', 100),
      'publicProfiles/ali-iq': publicProfile('ali-iq', 'Ali', '2222222', 4, 'active', 'IQ'),
      'publicProfiles/ali-lb': publicProfile('ali-lb', 'Alina', '3333333', 3, 'active', 'LB'),
      'publicIds/1111111': reservation('self'),
      'publicIds/2222222': reservation('ali-iq'),
      'publicIds/3333333': reservation('ali-lb'),
    });

    const response = await discoverUsers({ db, input: { countryCode: 'IQ', query: 'al' }, uid: 'self' });
    expect(response.result.users.map((profile) => profile.uid)).toEqual(['ali-iq']);
  });

  it('denies discovery to suspended requesters', async () => {
    const db = new FakeFirestore({
      'appConfig/socialFeatures': { usersDiscovery: true },
      'publicProfiles/self': publicProfile('self', 'Self', '1111111', 0, 'suspended'),
      'publicIds/1111111': reservation('self'),
    });

    expect(await discoverUsers({ db, input: {}, uid: 'self' })).toEqual({ errorCode: 'PERMISSION_DENIED' });
  });
});

function publicProfile(uid, displayName, publicId, giftScore, moderationStatus = 'active', countryCode = 'IQ') {
  return {
    avatarModerationStatus: 'clear',
    avatarUrl: '',
    bio: '',
    countryCode,
    coupleLevel: 0,
    createdAt: timestamp(),
    displayName,
    friendCount: 0,
    giftScore,
    moderationStatus,
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
    return {
      get: async () => createSnapshot(path, this.documents.get(path)),
      path,
    };
  }

  async getAll(...refs) {
    return refs.map((ref) => createSnapshot(ref.path, this.documents.get(ref.path)));
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
    return this.next({ order: { direction, field } });
  }

  startAt(value) {
    return this.next({ startAt: value });
  }

  endAt(value) {
    return this.next({ endAt: value });
  }

  limit(value) {
    return this.next({ limit: value });
  }

  async get() {
    let rows = [...this.db.documents.entries()]
      .filter(([path]) => path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/'))
      .map(([path, data]) => ({ path, data }));

    for (const filter of this.state.filters || []) {
      if (filter.operator !== '==') {
        throw new Error(`Unsupported fake operator: ${filter.operator}`);
      }
      rows = rows.filter(({ data }) => data[filter.field] === filter.value);
    }

    if (this.state.startAt !== undefined) {
      rows = rows.filter(({ data }) => data[this.state.order.field] >= this.state.startAt);
    }

    if (this.state.endAt !== undefined) {
      rows = rows.filter(({ data }) => data[this.state.order.field] <= this.state.endAt);
    }

    if (this.state.order) {
      const direction = this.state.order.direction === 'desc' ? -1 : 1;
      rows.sort((left, right) => String(left.data[this.state.order.field])
        .localeCompare(String(right.data[this.state.order.field])) * direction);
    }

    if (this.state.limit) {
      rows = rows.slice(0, this.state.limit);
    }

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
