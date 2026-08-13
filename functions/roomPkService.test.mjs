import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { executeRoomPkCommand } = require('./roomPkService');

const nowMs = 2_000_000_000_000;
const clock = {
  nowMillis: () => nowMs,
  timestampFromMillis: (value) => timestamp(value),
};
const fieldValue = { serverTimestamp: () => timestamp(nowMs) };

describe('roomPkService Wave 1 cross-room transactions', () => {
  it('fails closed when either global flag or the rollout policy is dark', async () => {
    const disabled = seededDb();
    disabled.documents.set('appConfig/growthFeatures', { roomPk: true, crossRoomPk: false });
    expect(await execute(disabled, challengeBody('cross_room_disabled_01'), 'host-red-1'))
      .toMatchObject({ code: 'FEATURE_DISABLED' });

    const dark = seededDb();
    dark.documents.set('appRuntime/crossRoomPkRollout', { schemaVersion: 1, stage: 'dark' });
    expect(await execute(dark, challengeBody('cross_room_dark_000001'), 'host-red-1'))
      .toMatchObject({ code: 'FEATURE_DISABLED' });
    expect(paths(dark, 'roomPkChallenges/')).toHaveLength(0);
  });

  it('discovers only sanitized, eligible, unblocked rollout rooms', async () => {
    const db = seededDb();
    db.documents.set('rooms/room-private-1', room('room-private-1', 'host-private-1', { visibility: 'private' }));
    seedAuthority(db, 'room-private-1', 'host-private-1');
    db.documents.set('rooms/room-game-1', room('room-game-1', 'host-game-1', { activeGameSessionId: 'game-1' }));
    seedAuthority(db, 'room-game-1', 'host-game-1');
    db.documents.set('rooms/room-blocked-1', room('room-blocked-1', 'host-blocked-1'));
    seedAuthority(db, 'room-blocked-1', 'host-blocked-1');
    db.documents.set('blocks/host-red-1/blocked/host-blocked-1', {
      blockedUid: 'host-blocked-1', blockerUid: 'host-red-1',
    });

    const result = await execute(db, body('list-cross-room-pk-opponents', 'cross_room_list_000001'), 'host-red-1');
    expect(result).toMatchObject({ ok: true, result: { nextCursor: null } });
    expect(result.result.opponents).toEqual([{
      authorityDisplayName: 'host-blue-1',
      countryCode: 'IQ',
      participantCount: 5,
      roomId: 'room-blue-1',
      roomImageUrl: '',
      roomTitle: 'Room room-blue-1',
    }]);
    expect(result.result.opponents[0]).not.toHaveProperty('hostUid');
    expect(result.result.opponents[0]).not.toHaveProperty('inviteCode');
  });

  it('atomically reserves both rooms, persists replay, and repairs proven stale pointers', async () => {
    const db = seededDb();
    db.documents.set('rooms/room-red-1', { ...db.read('rooms/room-red-1'), pendingPkChallengeId: 'old-challenge' });
    db.documents.set('roomPkChallenges/old-challenge', { status: 'expired' });
    const request = challengeBody('cross_room_challenge_01');
    const first = await execute(db, request, 'host-red-1');
    expect(first).toMatchObject({
      ok: true,
      result: { action: 'challenge-cross-room-pk', challenge: { status: 'pending' } },
    });
    const challengeId = first.result.challengeId;
    expect(db.read('rooms/room-red-1').pendingPkChallengeId).toBe(challengeId);
    expect(db.read('rooms/room-blue-1').pendingPkChallengeId).toBe(challengeId);
    expect(db.read(`roomPkChallenges/${challengeId}`)).toMatchObject({
      challengerRoomId: 'room-red-1', opponentRoomId: 'room-blue-1', schemaVersion: 1,
    });
    expect(await execute(db, request, 'host-red-1')).toMatchObject({ ok: true, replayed: true });
    expect(paths(db, 'roomPkChallenges/')).toHaveLength(2);
  });

  it('serializes concurrent A-to-B and C-to-B challenges into one reservation', async () => {
    const db = seededDb();
    db.documents.set('rooms/room-green-1', room('room-green-1', 'host-green-1'));
    seedAuthority(db, 'room-green-1', 'host-green-1');
    const [first, second] = await Promise.all([
      execute(db, challengeBody('cross_room_race_a_001'), 'host-red-1'),
      execute(db, body('challenge-cross-room-pk', 'cross_room_race_c_001', {
        opponentRoomId: 'room-blue-1', roomId: 'room-green-1',
      }), 'host-green-1'),
    ]);
    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect([first, second].find((result) => !result.ok)).toMatchObject({ code: 'ROOM_ALREADY_RESERVED' });
    expect(paths(db, 'roomPkChallenges/')).toHaveLength(1);
  });

  it('accepts once, creates one V2 session and exactly 32 shards, and reserves both rooms', async () => {
    const db = seededDb();
    const created = await execute(db, challengeBody('cross_room_accept_seed1'), 'host-red-1');
    const challengeId = created.result.challengeId;
    const accepted = await execute(db, body('accept-cross-room-pk', 'cross_room_accept_0001', {
      challengeId, roomId: 'room-blue-1',
    }), 'host-blue-1');
    expect(accepted).toMatchObject({
      ok: true,
      result: {
        challengeId,
        session: {
          mode: 'cross-room',
          roomId: 'room-red-1',
          roomIds: ['room-red-1', 'room-blue-1'],
          schemaVersion: 2,
          scoreShardCount: 16,
          status: 'active',
        },
      },
    });
    const pkId = accepted.result.pkId;
    expect(db.read(`roomPkChallenges/${challengeId}`)).toMatchObject({ status: 'accepted', sessionId: pkId });
    expect(db.read('rooms/room-red-1')).toMatchObject({ activePkSessionId: pkId, pendingPkChallengeId: null });
    expect(db.read('rooms/room-blue-1')).toMatchObject({ activePkSessionId: pkId, pendingPkChallengeId: null });
    expect(paths(db, `roomPkSessions/${pkId}/scoreShards/`)).toHaveLength(32);
    expect(db.read(`roomPkSessions/${pkId}`)).not.toHaveProperty('giftEventIds');
    expect(db.read(`roomPkSessions/${pkId}`).teams.red).not.toHaveProperty('memberUids');
    expect(await execute(db, body('accept-cross-room-pk', 'cross_room_accept_0002', {
      challengeId, roomId: 'room-blue-1',
    }), 'host-blue-1')).toMatchObject({ code: 'CHALLENGE_NOT_PENDING' });
    expect(paths(db, 'roomPkSessions/').filter((path) => path.split('/').length === 2)).toHaveLength(1);
  });

  it('serializes concurrent acceptance into exactly one V2 session', async () => {
    const db = seededDb();
    const created = await execute(db, challengeBody('cross_room_accept_race0'), 'host-red-1');
    const challengeId = created.result.challengeId;
    const [first, second] = await Promise.all([
      execute(db, body('accept-cross-room-pk', 'cross_room_accept_race1', {
        challengeId, roomId: 'room-blue-1',
      }), 'host-blue-1'),
      execute(db, body('accept-cross-room-pk', 'cross_room_accept_race2', {
        challengeId, roomId: 'room-blue-1',
      }), 'host-blue-1'),
    ]);
    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect([first, second].find((result) => !result.ok)).toMatchObject({ code: 'CHALLENGE_NOT_PENDING' });
    expect(paths(db, 'roomPkSessions/').filter((path) => path.split('/').length === 2)).toHaveLength(1);
  });

  it('blocks an in-room start while the room is reserved by a pending challenge', async () => {
    const db = seededDb();
    await execute(db, challengeBody('cross_room_reserve_seed'), 'host-red-1');
    expect(await execute(db, body('start-room-pk', 'roompk_reserved_start1'), 'host-red-1'))
      .toMatchObject({ code: 'ROOM_ALREADY_RESERVED' });
  });

  it('repairs a proven stale active pointer before reserving the room', async () => {
    const db = seededDb();
    db.documents.set('rooms/room-red-1', {
      ...db.read('rooms/room-red-1'), activePkSessionId: 'old-session',
    });
    db.documents.set('roomPkSessions/old-session', { status: 'ended' });
    const result = await execute(db, challengeBody('cross_room_stale_active'), 'host-red-1');
    expect(result.ok).toBe(true);
    expect(db.read('rooms/room-red-1')).toMatchObject({
      activePkSessionId: null,
      pendingPkChallengeId: result.result.challengeId,
    });
  });

  it('declines and cancels only with the correct side authority and clears both pointers', async () => {
    const declineDb = seededDb();
    const created = await execute(declineDb, challengeBody('cross_room_decline_seed'), 'host-red-1');
    expect(await execute(declineDb, body('cancel-cross-room-pk', 'cross_room_bad_cancel_01', {
      challengeId: created.result.challengeId, roomId: 'room-blue-1',
    }), 'host-blue-1')).toMatchObject({ code: 'FORBIDDEN' });
    const declined = await execute(declineDb, body('decline-cross-room-pk', 'cross_room_decline_001', {
      challengeId: created.result.challengeId, roomId: 'room-blue-1',
    }), 'host-blue-1');
    expect(declined).toMatchObject({ ok: true, result: { challenge: { status: 'declined' } } });
    expect(declineDb.read('rooms/room-red-1').pendingPkChallengeId).toBeNull();
    expect(declineDb.read('rooms/room-blue-1').pendingPkChallengeId).toBeNull();

    const cancelDb = seededDb();
    const second = await execute(cancelDb, challengeBody('cross_room_cancel_seed1'), 'host-red-1');
    expect(await execute(cancelDb, body('cancel-cross-room-pk', 'cross_room_cancel_0001', {
      challengeId: second.result.challengeId, roomId: 'room-red-1',
    }), 'host-red-1')).toMatchObject({ ok: true, result: { challenge: { status: 'cancelled' } } });
  });

  it('expires a challenge deterministically through status and rejects late acceptance', async () => {
    let mutableNow = nowMs;
    const movingClock = {
      nowMillis: () => mutableNow,
      timestampFromMillis: (value) => timestamp(value),
    };
    const db = seededDb();
    const created = await executeWithClock(db, challengeBody('cross_room_expire_seed1'), 'host-red-1', movingClock);
    mutableNow += 61_000;
    const expired = await executeWithClock(db, body('get-room-pk-challenge-status', 'cross_room_status_0001', {
      roomId: 'room-blue-1',
    }), 'host-blue-1', movingClock);
    expect(expired).toMatchObject({ ok: true, result: { challenge: { status: 'expired' } } });
    expect(db.read('rooms/room-red-1').pendingPkChallengeId).toBeNull();
    expect(db.read('rooms/room-blue-1').pendingPkChallengeId).toBeNull();
    expect(await executeWithClock(db, body('accept-cross-room-pk', 'cross_room_late_accept1', {
      challengeId: created.result.challengeId, roomId: 'room-blue-1',
    }), 'host-blue-1', movingClock)).toMatchObject({ code: 'CHALLENGE_NOT_PENDING' });
  });

  it('preserves the legacy in-room command path', async () => {
    const db = seededDb();
    const result = await execute(db, body('start-room-pk', 'roompk_legacy_start01'), 'host-red-1');
    expect(result).toMatchObject({
      ok: true,
      result: { session: { mode: 'in-room-teams', schemaVersion: 1 } },
    });
  });

  it('rejects surrender unless the room points to that active V2 session', async () => {
    const db = seededDb();
    expect(await execute(db, body('surrender-cross-room-pk', 'cross_room_surrender01', {
      pkId: 'crpks_session_00000001',
    }), 'host-red-1')).toMatchObject({ code: 'SESSION_NOT_ACTIVE' });
  });

  it('moves an active V2 session into surrender settlement and creates its reconciliation job', async () => {
    const db = seededDb();
    const created = await execute(db, challengeBody('cross_room_surrender_seed'), 'host-red-1');
    const accepted = await execute(db, body('accept-cross-room-pk', 'cross_room_surrender_accept', {
      challengeId: created.result.challengeId, roomId: 'room-blue-1',
    }), 'host-blue-1');
    const surrendered = await execute(db, body('surrender-cross-room-pk', 'cross_room_surrender_ok01', {
      pkId: accepted.result.pkId,
    }), 'host-red-1');
    expect(surrendered).toMatchObject({
      ok: true,
      result: { session: { endReason: 'surrender', forfeitSide: 'red', status: 'settling' } },
    });
    expect(db.read(`roomPkSessions/${accepted.result.pkId}`)).toMatchObject({
      endedBy: 'host-red-1', endReason: 'surrender', forfeitSide: 'red',
      scoringEndsAtMs: nowMs, settleAfterMs: nowMs + 15_000, status: 'settling',
    });
    expect(db.read(`roomPkReconciliations/${accepted.result.pkId}`)).toMatchObject({
      pkId: accepted.result.pkId, status: 'pending',
    });
    expect(db.read('rooms/room-red-1').activePkSessionId).toBe(accepted.result.pkId);
    expect(db.read('rooms/room-blue-1').activePkSessionId).toBe(accepted.result.pkId);
  });
});

function execute(db, requestBody, uid) {
  return executeWithClock(db, requestBody, uid, clock);
}

function executeWithClock(db, requestBody, uid, selectedClock) {
  return executeRoomPkCommand({ body: requestBody, clock: selectedClock, db,
    decodedToken: { uid }, fieldValue });
}

function body(action, requestId, extra = {}) {
  return { action, clientVersion: '1.0.0', requestId, roomId: 'room-red-1', ...extra };
}

function challengeBody(requestId) {
  return body('challenge-cross-room-pk', requestId, {
    durationMs: 180_000,
    opponentRoomId: 'room-blue-1',
  });
}

function seededDb() {
  const db = new FakeFirestore({
    'appConfig/growthFeatures': { crossRoomPk: true, roomPk: true },
    'appConfig/voiceRoomFeatures': { voice_room_gifts: true },
    'appRuntime/crossRoomPkRollout': {
      allowedAuthorityUids: [],
      allowedRoomIds: ['room-red-1', 'room-blue-1', 'room-green-1'],
      countryCodes: [],
      percentageBasisPoints: 0,
      schemaVersion: 1,
      stage: 'closed-beta',
    },
    'rooms/room-blue-1': room('room-blue-1', 'host-blue-1', { participantCount: 5 }),
    'rooms/room-red-1': room('room-red-1', 'host-red-1'),
  });
  seedAuthority(db, 'room-red-1', 'host-red-1');
  seedAuthority(db, 'room-blue-1', 'host-blue-1');
  return db;
}

function room(id, ownerUid, extra = {}) {
  return {
    availability: 'active',
    countryCode: 'IQ',
    hostDisplayName: ownerUid,
    hostId: ownerUid,
    id,
    ownerDisplayName: ownerUid,
    ownerUid,
    participantCount: 1,
    schemaVersion: 2,
    status: 'active',
    title: `Room ${id}`,
    type: 'voice',
    visibility: 'public',
    ...extra,
  };
}

function seedAuthority(db, roomId, uid) {
  db.documents.set(`publicProfiles/${uid}`, { displayName: uid, moderationStatus: 'active', uid });
  db.documents.set(`rooms/${roomId}/members/${uid}`, {
    authorityRole: 'owner', role: 'host', status: 'active', uid,
  });
}

function paths(db, fragment) {
  return [...db.documents.keys()].filter((path) => path.includes(fragment));
}

function timestamp(value = nowMs) {
  return { toDate: () => new Date(value), toMillis: () => value };
}

class FakeFirestore {
  constructor(documents) {
    this.documents = new Map(Object.entries(documents));
    this.transactionTail = Promise.resolve();
  }
  doc(path) { return makeRef(path, this); }
  collection(name) { return new FakeQuery(this, name); }
  read(path) { return this.documents.get(path); }
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
  constructor(db) { this.db = db; this.operations = []; }
  async get(ref) { return snapshot(ref.path, this.db.documents.get(ref.path), this.db); }
  create(ref, data) { this.operations.push({ data, kind: 'create', path: ref.path }); }
  set(ref, data, options) { this.operations.push({ data, kind: 'set', merge: options?.merge === true, path: ref.path }); }
  update(ref, data) { this.operations.push({ data, kind: 'update', path: ref.path }); }
  commit() {
    for (const operation of this.operations) {
      if (operation.kind === 'create' && this.db.documents.has(operation.path)) throw new Error(`Exists: ${operation.path}`);
      if (operation.kind === 'update' && !this.db.documents.has(operation.path)) throw new Error(`Missing: ${operation.path}`);
      const current = this.db.documents.get(operation.path) || {};
      this.db.documents.set(operation.path,
        operation.kind === 'set' && !operation.merge ? operation.data : { ...current, ...operation.data });
    }
  }
}

class FakeQuery {
  constructor(db, name, filters = [], limitCount = 100) {
    this.db = db; this.name = name; this.filters = filters; this.limitCount = limitCount;
  }
  where(field, operator, value) {
    return new FakeQuery(this.db, this.name, [...this.filters, { field, operator, value }], this.limitCount);
  }
  orderBy() { return this; }
  startAfter() { return this; }
  limit(count) { return new FakeQuery(this.db, this.name, this.filters, count); }
  async get() {
    const docs = [...this.db.documents.entries()]
      .filter(([path]) => path.split('/').length === 2 && path.startsWith(`${this.name}/`))
      .filter(([, data]) => this.filters.every(({ field, operator, value }) => operator === '==' && data[field] === value))
      .slice(0, this.limitCount)
      .map(([path, data]) => snapshot(path, data, this.db));
    return { docs, size: docs.length };
  }
}

function makeRef(path, db) {
  return {
    collection(name) { return { doc: (id) => makeRef(`${path}/${name}/${id}`, db) }; },
    get: async () => snapshot(path, db.documents.get(path), db),
    id: path.split('/').at(-1),
    path,
  };
}

function snapshot(path, data, db) {
  return { data: () => data, exists: data !== undefined, id: path.split('/').at(-1), ref: makeRef(path, db) };
}
