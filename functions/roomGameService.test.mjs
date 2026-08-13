import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  cleanupExpiredRoomGameRecords,
  executeRoomGameCommand,
  expireRoomGameSessions,
} = require('./roomGameService');
const { ROOM_GAME_RATE_LIMIT } = require('./voiceRoomRateLimitCore');

const nowMs = 2_000_000_000_000;
const clock = {
  nowMillis: () => nowMs,
  timestampFromMillis: (value) => timestamp(value),
};
const fieldValue = { serverTimestamp: () => timestamp(nowMs) };

describe('roomGameService', () => {
  it('lists only for active room members and persists bounded replay state', async () => {
    const db = seededDb();
    const result = await execute(db, body('list-room-games', 'roomgame_list_000001'));

    expect(result).toMatchObject({
      ok: true,
      result: { action: 'list-room-games', roomId: 'room-1' },
    });
    expect(result.result.games.map((game) => game.gameId)).toEqual([
      'drawing-guess',
      'carrom-royal',
      'royal-majlis',
      'naval-duel',
    ]);
    expect(db.read('roomGameRateLimits/user-1')).toMatchObject({ count: 1, uid: 'user-1' });
    expect(db.read('rooms/room-1/gameCommandRequests/roomgame_list_000001').purgeAfter).toBeDefined();
  });

  it('serializes concurrent starts into one room session', async () => {
    const db = seededDb();
    const [first, second] = await Promise.all([
      execute(db, body('create-room-game-invite', 'roomgame_create_0001', {
        gameId: 'drawing-guess',
      })),
      execute(db, body('create-room-game-invite', 'roomgame_create_0002', {
        gameId: 'drawing-guess',
      })),
    ]);

    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect([first, second].find((result) => !result.ok)).toMatchObject({
      code: 'SESSION_ALREADY_ACTIVE',
    });
    expect(paths(db, '/gameSessions/')).toHaveLength(1);
  });

  it('allows safe leave cleanup after the feature kill switch is disabled', async () => {
    const db = seededDb();
    db.documents.set('appConfig/voiceRoomFeatures', { voice_room_games: false });
    db.documents.set('rooms/room-1', {
      ...db.read('rooms/room-1'),
      activeGameSessionId: 'rgs_session_000000000001',
      currentGameId: 'drawing-guess',
    });
    db.documents.set('rooms/room-1/gameSessions/rgs_session_000000000001', {
      expiresAt: timestamp(nowMs + 60_000),
      hostUid: 'user-1',
      maxPlayers: 8,
      minPlayers: 2,
      playerCount: 1,
      playerUids: ['user-1'],
      roomId: 'room-1',
      sessionId: 'rgs_session_000000000001',
      sessionMode: 'multiplayer',
      status: 'active',
    });

    const result = await execute(db, body('leave-room-game', 'roomgame_leave_00001', {
      sessionId: 'rgs_session_000000000001',
    }));
    expect(result).toMatchObject({
      ok: true,
      result: { session: { status: 'abandoned' } },
    });
    expect(db.read('rooms/room-1')).toMatchObject({
      activeGameSessionId: null,
      currentGameId: null,
    });
  });

  it('creates a Drawing Guess invite, lets a second member join, and keeps the voice room on leave', async () => {
    const db = seededDb();
    db.documents.set('publicProfiles/user-2', {
      displayName: 'Sara',
      moderationStatus: 'active',
      uid: 'user-2',
    });
    db.documents.set('rooms/room-1/members/user-2', {
      status: 'active',
      uid: 'user-2',
    });

    const created = await executeRoomGameCommand({
      body: body('create-room-game-invite', 'roomgame_create_join01', {
        gameId: 'drawing-guess',
      }),
      clock,
      db,
      decodedToken: { uid: 'user-1' },
      fieldValue,
    });
    expect(created).toMatchObject({
      ok: true,
      result: {
        action: 'create-room-game-invite',
        session: {
          gameId: 'drawing-guess',
          hostUid: 'user-1',
          sessionMode: 'multiplayer',
          status: 'lobby',
          playerUids: ['user-1'],
        },
      },
    });
    const sessionId = created.result.session.sessionId;
    expect(db.read('rooms/room-1')).toMatchObject({
      activeGameSessionId: sessionId,
      currentGameId: 'drawing-guess',
      status: 'active',
    });

    const joined = await executeRoomGameCommand({
      body: body('join-room-game', 'roomgame_join_user2_01', { sessionId }),
      clock,
      db,
      decodedToken: { uid: 'user-2' },
      fieldValue,
    });
    expect(joined).toMatchObject({
      ok: true,
      result: {
        action: 'join-room-game',
        session: {
          hostUid: 'user-1',
          playerCount: 2,
          playerUids: ['user-1', 'user-2'],
          status: 'active',
        },
      },
    });

    const left = await executeRoomGameCommand({
      body: body('leave-room-game', 'roomgame_leave_user2_01', { sessionId }),
      clock,
      db,
      decodedToken: { uid: 'user-2' },
      fieldValue,
    });
    expect(left.ok).toBe(true);
    expect(db.read('rooms/room-1')).toMatchObject({
      status: 'active',
    });
    expect(db.read('rooms/room-1/members/user-2')).toMatchObject({
      status: 'active',
      uid: 'user-2',
    });
  });

  it('creates a Naval Duel invite that becomes active when the second player joins', async () => {
    const db = seededDb();
    db.documents.set('publicProfiles/user-2', {
      displayName: 'Sara',
      moderationStatus: 'active',
      uid: 'user-2',
    });
    db.documents.set('rooms/room-1/members/user-2', {
      status: 'active',
      uid: 'user-2',
    });

    const created = await executeRoomGameCommand({
      body: body('create-room-game-invite', 'roomgame_naval_create01', {
        gameId: 'naval-duel',
      }),
      clock,
      db,
      decodedToken: { uid: 'user-1' },
      fieldValue,
    });
    expect(created).toMatchObject({
      ok: true,
      result: {
        session: {
          gameId: 'naval-duel',
          hostUid: 'user-1',
          maxPlayers: 2,
          minPlayers: 2,
          sessionMode: 'multiplayer',
          status: 'lobby',
          playerUids: ['user-1'],
        },
      },
    });

    const joined = await executeRoomGameCommand({
      body: body('join-room-game', 'roomgame_naval_join_01', {
        sessionId: created.result.session.sessionId,
      }),
      clock,
      db,
      decodedToken: { uid: 'user-2' },
      fieldValue,
    });
    expect(joined).toMatchObject({
      ok: true,
      result: {
        session: {
          gameId: 'naval-duel',
          playerCount: 2,
          playerUids: ['user-1', 'user-2'],
          status: 'active',
        },
      },
    });
  });

  it('rejects the retired public reward command without touching wallets', async () => {
    const db = seededDb();
    const result = await execute(db, {
      ...body('credit-game-reward', 'roomgame_reward_0001'),
      amount: 5_000,
      sessionId: 'rgs_session_000000000001',
      targetUid: 'user-1',
    });
    expect(result).toMatchObject({ code: 'INVALID_REQUEST', ok: false, status: 400 });
    expect(paths(db, 'wallet')).toHaveLength(0);
  });

  it('rate limits repeated room game commands globally per user', async () => {
    const db = seededDb();
    for (let index = 0; index < ROOM_GAME_RATE_LIMIT; index += 1) {
      const result = await execute(db, body(
        'list-room-games',
        `roomgame_limit_${String(index).padStart(4, '0')}`,
      ));
      expect(result.ok).toBe(true);
    }
    expect(await execute(db, body('list-room-games', 'roomgame_limit_blocked')))
      .toMatchObject({ code: 'RATE_LIMITED', ok: false, status: 429 });
  });

  it('expires stuck sessions transactionally and purges only terminal retained records', async () => {
    const db = seededDb();
    db.documents.set('rooms/room-1', {
      ...db.read('rooms/room-1'),
      activeGameSessionId: 'rgs_session_000000000001',
      currentGameId: 'drawing-guess',
    });
    db.documents.set('rooms/room-1/gameSessions/rgs_session_000000000001', {
      expiresAt: timestamp(nowMs - 1),
      hostUid: 'user-1',
      playerUids: ['user-1'],
      roomId: 'room-1',
      sessionId: 'rgs_session_000000000001',
      status: 'active',
    });

    expect(await expireRoomGameSessions({ clock, db })).toEqual({ expired: 1, scanned: 1 });
    expect(db.read('rooms/room-1')).toMatchObject({
      activeGameSessionId: null,
      currentGameId: null,
    });
    const expired = db.read('rooms/room-1/gameSessions/rgs_session_000000000001');
    expect(expired).toMatchObject({ endReason: 'expired', status: 'abandoned' });

    db.documents.set('rooms/room-1/gameCommandRequests/old', {
      purgeAfter: timestamp(nowMs - 1),
    });
    db.documents.set('roomGameRateLimits/old-user', {
      purgeAfter: timestamp(nowMs - 1),
    });
    db.documents.set('rooms/room-1/gameSessions/old-terminal', {
      purgeAfter: timestamp(nowMs - 1),
      status: 'ended',
    });
    db.documents.set('rooms/room-1/gameSessions/old-active', {
      purgeAfter: timestamp(nowMs - 1),
      status: 'active',
    });

    expect(await cleanupExpiredRoomGameRecords({ clock, db }))
      .toEqual({ deleted: 3, scanned: 3 });
    expect(db.read('rooms/room-1/gameSessions/old-active')).toBeDefined();
  });

  it('debits wallet entry fees when roomGameEconomy is enabled', async () => {
    const db = seededDb();
    db.documents.set('appConfig/growthFeatures', { roomGameEconomy: true });
    db.documents.set('walletSummaries/user-1', {
      balances: { coins: 100, diamonds: 0 },
      lifetimeCredit: { coins: 100, diamonds: 0 },
      lifetimeDebit: { coins: 0, diamonds: 0 },
      uid: 'user-1',
    });
    const created = await execute(db, body('create-room-game-invite', 'roomgame_pay_00000001', {
      amount: 25,
      gameId: 'drawing-guess',
    }));
    expect(created).toMatchObject({
      ok: true,
      result: {
        session: {
          economy: { entryFeeCoins: 25, poolCoins: 25 },
          gameId: 'drawing-guess',
        },
      },
    });
    expect(db.read('walletSummaries/user-1').balances.coins).toBe(75);
    expect(paths(db, 'walletTransactions/').length).toBe(1);
  });
});

function execute(db, requestBody) {
  return executeRoomGameCommand({
    body: requestBody,
    clock,
    db,
    decodedToken: { uid: 'user-1' },
    fieldValue,
  });
}

function body(action, requestId, extra = {}) {
  return {
    action,
    clientVersion: '1.0.0',
    requestId,
    roomId: 'room-1',
    ...extra,
  };
}

function seededDb() {
  return new FakeFirestore({
    'appConfig/voiceRoomFeatures': { voice_room_games: true },
    'publicProfiles/user-1': {
      displayName: 'Ali',
      moderationStatus: 'active',
      uid: 'user-1',
    },
    'rooms/room-1': {
      availability: 'active',
      countryCode: 'IQ',
      hostId: 'owner-1',
      id: 'room-1',
      status: 'active',
    },
    'rooms/room-1/members/user-1': {
      status: 'active',
      uid: 'user-1',
    },
  });
}

function paths(db, fragment) {
  return [...db.documents.keys()].filter((path) => path.includes(fragment));
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
      commit: async () => {
        deleted.forEach((path) => this.documents.delete(path));
      },
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
      .filter(([, data]) => this.filters.every(({ field, operator, value }) => {
        if (operator !== '<=') return false;
        return data[field]?.toMillis?.() <= value.toMillis();
      }))
      .slice(0, this.limitCount)
      .map(([path, data]) => snapshot(path, data));
    return { docs, size: docs.length };
  }
}

function makeRef(path) {
  const parts = path.split('/');
  return {
    collection(name) {
      return { doc: (id) => makeRef(`${path}/${name}/${id}`) };
    },
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
