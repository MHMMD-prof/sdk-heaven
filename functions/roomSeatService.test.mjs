import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  executeRoomSeatCommand,
  expireRoomSeatOffers,
  reconcileRoomPresenceCounts,
  recoverExpiredRoomSeats,
  recoverStaleRoomPresence,
} = require('./roomSeatService');

const fieldValue = {
  increment: (value) => value,
  serverTimestamp: () => 'SERVER_TIMESTAMP',
};

describe('roomSeatService', () => {
  it('lets exactly one member win a simultaneous claim for the same seat', async () => {
    const db = seededDb();
    const clock = fakeClock();
    const [first, second] = await Promise.all([
      command(db, clock, 'member-1', { action: 'claim-seat', requestId: 'seat_claim_member_0001', seatId: '01' }),
      command(db, clock, 'member-2', { action: 'claim-seat', requestId: 'seat_claim_member_0002', seatId: '01' }),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    expect([first.code, second.code]).toContain('SEAT_UNAVAILABLE');
    const occupantUid = db.data.get('rooms/room-1/seats/01').occupantUid;
    expect(['member-1', 'member-2']).toContain(occupantUid);
    expect(db.data.get(`rooms/room-1/members/${occupantUid}`).seatId).toBe('01');
  });

  it('prevents one member from occupying two seats', async () => {
    const db = seededDb();
    const clock = fakeClock();
    expect(await command(db, clock, 'member-1', {
      action: 'claim-seat', requestId: 'seat_claim_member_0003', seatId: '01',
    })).toMatchObject({ ok: true });
    expect(await command(db, clock, 'member-1', {
      action: 'claim-seat', requestId: 'seat_claim_member_0004', seatId: '02',
    })).toMatchObject({ ok: false, code: 'ALREADY_SEATED' });
    expect(db.data.get('rooms/room-1/seats/02')).toMatchObject({ state: 'open' });
  });

  it('fails closed when disabled while still allowing safe seat exit', async () => {
    const db = seededDb();
    const clock = fakeClock();
    await command(db, clock, 'member-1', {
      action: 'claim-seat', requestId: 'seat_claim_shutdown_01', seatId: '01',
    });
    db.data.set('appConfig/voiceRoomFeatures', { voice_room_seats: false, voice_room_v2_mutations: false });
    expect(await command(db, clock, 'member-2', {
      action: 'claim-seat', requestId: 'seat_claim_shutdown_02', seatId: '02',
    })).toMatchObject({ ok: false, code: 'FEATURE_DISABLED' });
    expect(await command(db, clock, 'member-1', {
      action: 'leave-seat', requestId: 'seat_leave_shutdown_01',
    })).toMatchObject({ ok: true });
  });

  it('enforces both individual and global microphone locks', async () => {
    const db = seededDb();
    const clock = fakeClock();
    expect(await command(db, clock, 'owner-1', {
      action: 'lock-seat', requestId: 'seat_lock_owner_00001', seatId: '01',
    })).toMatchObject({ ok: true, result: { revision: 2 } });
    expect(await command(db, clock, 'member-1', {
      action: 'claim-seat', requestId: 'seat_claim_locked_001', seatId: '01',
    })).toMatchObject({ ok: false, code: 'SEAT_UNAVAILABLE' });
    expect(await command(db, clock, 'owner-1', {
      action: 'set-seat-mode', expectedRevision: 2, requestId: 'seat_mode_locked_0001', seatMode: 'locked',
    })).toMatchObject({ ok: true });
    expect(await command(db, clock, 'member-1', {
      action: 'claim-seat', requestId: 'seat_claim_locked_002', seatId: '02',
    })).toMatchObject({ ok: false, code: 'SEAT_MODE_DENIED' });
  });

  it('supports request approval by a moderator while the owner is offline', async () => {
    const db = seededDb({ seatMode: 'request' });
    const clock = fakeClock();
    expect(await command(db, clock, 'member-1', {
      action: 'request-seat', requestId: 'seat_request_member_01', seatId: '03',
    })).toMatchObject({ ok: true });
    expect(await command(db, clock, 'mod-1', {
      action: 'approve-seat-request', requestId: 'seat_approve_member_01', seatId: '03', targetUid: 'member-1',
    })).toMatchObject({ ok: true });
    expect(db.data.get('rooms/room-1/seats/03')).toMatchObject({ occupantUid: 'member-1', state: 'occupied' });
    expect(db.data.get('rooms/room-1/members/member-1')).toMatchObject({ authorityRole: 'member', seatId: '03' });
    expect(db.data.get('rooms/room-1/seatRequests/member-1')).toMatchObject({ status: 'approved' });
  });

  it('rejects an expired invitation without consuming the seat', async () => {
    const db = seededDb({ seatMode: 'invite' });
    const clock = fakeClock();
    expect(await command(db, clock, 'mod-1', {
      action: 'invite-to-seat', requestId: 'seat_invite_member_001', seatId: '04', targetUid: 'member-1',
    })).toMatchObject({ ok: true });
    clock.advance(90_001);
    expect(await command(db, clock, 'member-1', {
      action: 'accept-seat-invite', requestId: 'seat_accept_member_001', seatId: '04',
    })).toMatchObject({ ok: false, code: 'SEAT_INVITE_EXPIRED' });
    expect(db.data.get('rooms/room-1/seats/04')).toMatchObject({ state: 'open' });
  });

  it('expires and purges bounded request records after the retention window', async () => {
    const db = seededDb({ seatMode: 'request' });
    const clock = fakeClock();
    await command(db, clock, 'member-1', {
      action: 'request-seat', requestId: 'seat_request_expiry_01', seatId: '03',
    });
    clock.advance(90_001);
    expect(await expireRoomSeatOffers({ clock, db, fieldValue })).toMatchObject({ expired: 1, purged: 0 });
    expect(db.data.get('rooms/room-1/seatRequests/member-1')).toMatchObject({
      purgeAfter: clock.now + 24 * 60 * 60 * 1000,
      status: 'expired',
    });
    clock.advance(24 * 60 * 60 * 1000 + 1);
    expect(await expireRoomSeatOffers({ clock, db, fieldValue })).toMatchObject({ expired: 0, purged: 1 });
    expect(db.data.has('rooms/room-1/seatRequests/member-1')).toBe(false);
  });

  it('retires an occupied overflow seat and removes it only after a clean leave', async () => {
    const db = seededDb({ seatTargetCount: 20 });
    const clock = fakeClock();
    expect(await command(db, clock, 'owner-1', {
      action: 'claim-seat', requestId: 'seat_claim_owner_00001', seatId: '20',
    })).toMatchObject({ ok: true, result: { revision: 2 } });
    expect(await command(db, clock, 'owner-1', {
      action: 'resize-seats', expectedRevision: 2, requestId: 'seat_resize_owner_001', seatTargetCount: 5,
    })).toMatchObject({ ok: true });
    expect(db.data.get('rooms/room-1/seats/20')).toMatchObject({ occupantUid: 'owner-1', retired: true, state: 'retiring' });
    expect(await command(db, clock, 'owner-1', {
      action: 'leave-seat', requestId: 'seat_leave_owner_0001',
    })).toMatchObject({ ok: true });
    expect(db.data.get('rooms/room-1/seats/20')).toMatchObject({ occupantUid: null, retired: true, state: 'locked' });
  });

  it('serializes resize plus claim so an overflow seat is never silently occupied', async () => {
    const db = seededDb({ seatTargetCount: 20 });
    const clock = fakeClock();
    const [resize, claim] = await Promise.all([
      command(db, clock, 'owner-1', {
        action: 'resize-seats', expectedRevision: 1, requestId: 'seat_resize_race_0001', seatTargetCount: 5,
      }),
      command(db, clock, 'member-1', {
        action: 'claim-seat', requestId: 'seat_claim_race_00001', seatId: '20',
      }),
    ]);
    expect(resize).toMatchObject({ ok: true });
    expect(claim).toMatchObject({ ok: false, code: 'SEAT_UNAVAILABLE' });
    expect(db.data.get('rooms/room-1/seats/20')).toMatchObject({ retired: true, state: 'locked' });
    expect(db.data.get('rooms/room-1/seats/20').occupantUid).toBeUndefined();
  });

  it('reserves for 45 seconds, resumes in time, and releases an expired reservation server-side', async () => {
    const db = seededDb();
    const clock = fakeClock();
    await command(db, clock, 'member-1', {
      action: 'claim-seat', requestId: 'seat_claim_reconnect_01', seatId: '02', sessionId: 'session-member-1',
    });
    await command(db, clock, 'member-1', {
      action: 'reserve-seat', requestId: 'seat_reserve_member_01', sessionId: 'session-member-1',
    });
    expect(db.data.get('rooms/room-1/seats/02')).toMatchObject({ state: 'reconnecting', reservationExpiresAt: clock.now + 45_000 });
    clock.advance(44_000);
    expect(await command(db, clock, 'member-1', {
      action: 'resume-seat', requestId: 'seat_resume_member_001', sessionId: 'session-member-1',
    })).toMatchObject({ ok: true });

    await command(db, clock, 'member-1', {
      action: 'reserve-seat', requestId: 'seat_reserve_member_02', sessionId: 'session-member-1',
    });
    clock.advance(45_001);
    expect(await recoverExpiredRoomSeats({ clock, db, fieldValue })).toMatchObject({ released: 1 });
    expect(db.data.get('rooms/room-1/seats/02')).toMatchObject({ occupantUid: null, state: 'open' });
    expect(db.data.get('rooms/room-1/members/member-1')).toMatchObject({ canPublishAudio: false, seatId: null });
    expect([...db.data.values()]).toContainEqual(expect.objectContaining({
      action: 'release-expired-seat', liveKitSyncStatus: 'pending', source: 'room-seat-recovery-v1',
    }));
  });

  it('marks expired presence stale, reserves its seat once, and repairs room counts from sources', async () => {
    const db = seededDb({ participantCount: 99, speakerCount: 99 });
    const clock = fakeClock();
    await command(db, clock, 'member-1', {
      action: 'claim-seat', requestId: 'seat_claim_presence_01', seatId: '05',
    });
    db.data.set('rooms/room-1/presence/member-1', {
      leaseExpiresAt: clock.now - 1, sessionId: 'presence-member-1', status: 'online', uid: 'member-1',
    });
    db.data.set('rooms/room-1/presence/owner-1', {
      leaseExpiresAt: clock.now + 45_000, sessionId: 'presence-owner-1', status: 'online', uid: 'owner-1',
    });
    expect(await recoverStaleRoomPresence({ clock, db, fieldValue })).toMatchObject({ reserved: 1, stale: 1 });
    const reservation = db.data.get('rooms/room-1/seats/05').reservationExpiresAt;
    expect(db.data.get('rooms/room-1/presence/member-1')).toMatchObject({ status: 'stale' });
    expect(await recoverStaleRoomPresence({ clock, db, fieldValue })).toMatchObject({ reserved: 0, stale: 0 });
    expect(db.data.get('rooms/room-1/seats/05').reservationExpiresAt).toBe(reservation);

    expect(await reconcileRoomPresenceCounts({ clock, db, fieldValue })).toMatchObject({ repaired: 1 });
    expect(db.data.get('rooms/room-1')).toMatchObject({ participantCount: 1, speakerCount: 1 });
  });

  it('does not let old stale presence records starve newly expired leases', async () => {
    const db = seededDb();
    const clock = fakeClock();
    await command(db, clock, 'member-1', {
      action: 'claim-seat', requestId: 'seat_claim_presence_02', seatId: '05',
    });
    db.data.set('rooms/room-1/presence/aaa-stale', {
      leaseExpiresAt: clock.now - 10_000,
      sessionId: 'presence-stale-user',
      status: 'stale',
      uid: 'aaa-stale',
    });
    db.data.set('rooms/room-1/presence/member-1', {
      leaseExpiresAt: clock.now - 1,
      sessionId: 'presence-member-1',
      status: 'online',
      uid: 'member-1',
    });

    expect(await recoverStaleRoomPresence({
      clock,
      db,
      fieldValue,
      limit: 1,
    })).toMatchObject({ reserved: 1, scanned: 1, stale: 1 });
    expect(db.data.get('rooms/room-1/presence/member-1')).toMatchObject({ status: 'stale' });
  });

  it('advances the room-count reconciliation cursor across bounded pages', async () => {
    const db = seededDb({ participantCount: 99, speakerCount: 99 });
    const clock = fakeClock();
    db.data.set('rooms/room-2', {
      availability: 'active',
      participantCount: 99,
      speakerCount: 99,
      status: 'active',
    });

    expect(await reconcileRoomPresenceCounts({
      clock,
      db,
      fieldValue,
      limit: 1,
    })).toMatchObject({ lastRoomId: 'room-1', scanned: 1 });
    expect(await reconcileRoomPresenceCounts({
      clock,
      db,
      fieldValue,
      limit: 1,
    })).toMatchObject({ lastRoomId: 'room-2', scanned: 1 });
    expect(db.data.get('rooms/room-2')).toMatchObject({ participantCount: 0, speakerCount: 0 });
  });
});

function command(db, clock, uid, body) {
  return executeRoomSeatCommand({
    body: { roomId: 'room-1', ...body },
    clock,
    db,
    decodedToken: { email: `${uid}@example.com`, uid },
    fieldValue,
  });
}

function fakeClock() {
  return {
    now: 1_000_000,
    nowMillis() { return this.now; },
    timestampFromMillis(value) { return value; },
    advance(value) { this.now += value; },
  };
}

function seededDb(roomOverrides = {}) {
  const db = createFakeDb();
  for (const [uid, name, avatar, authorityRole] of [
    ['owner-1', 'Owner', 'O', 'owner'],
    ['mod-1', 'Moderator', 'M', 'moderator'],
    ['member-1', 'Dana', 'D', 'member'],
    ['member-2', 'Noor', 'N', 'member'],
  ]) {
    db.data.set(`users/${uid}`, { avatarLabel: avatar, displayName: name, email: `${uid}@example.com`, uid });
    db.data.set(`publicProfiles/${uid}`, { moderationStatus: 'active', uid });
    db.data.set(`rooms/room-1/members/${uid}`, {
      authorityRole, avatarLabel: avatar, canPublishAudio: false, displayName: name,
      privileges: { canManageMusic: false }, role: uid === 'owner-1' ? 'host' : 'listener',
      schemaVersion: 2, seatId: null, status: 'active', uid,
    });
  }
  db.data.set('rooms/room-1', {
    availability: 'active', countryCode: 'IQ', hostId: 'owner-1', id: 'room-1', ownerUid: 'owner-1',
    participantCount: 4, revision: 1, schemaVersion: 2, seatMode: 'open', seatTargetCount: 10,
    seatEngineVersion: 1, speakerCount: 0, status: 'active', title: 'Room', ...roomOverrides,
  });
  db.data.set('appConfig/voiceRoomFeatures', {
    voice_room_seats: true,
    voice_room_v2_mutations: true,
  });
  for (let seatNumber = 1; seatNumber <= 20; seatNumber += 1) {
    db.data.set(`rooms/room-1/seats/${String(seatNumber).padStart(2, '0')}`, {
      revision: 1, schemaVersion: 2, seatNumber, state: 'open',
    });
  }
  return db;
}

function createFakeDb() {
  const data = new Map();
  let transactionTail = Promise.resolve();
  const ref = (path) => {
    const segments = path.split('/');
    return {
      id: segments.at(-1),
      path,
      get parent() { return collection(segments.slice(0, -1).join('/')); },
      collection(name) { return collection(`${path}/${name}`); },
      set(value, options) {
        data.set(path, options?.merge ? { ...(data.get(path) || {}), ...value } : value);
        return Promise.resolve();
      },
      get() { return Promise.resolve(snapshot(ref(path))); },
    };
  };
  const collection = (path) => {
    const segments = path.split('/');
    return {
      id: segments.at(-1),
      path,
      get parent() { return segments.length > 1 ? ref(segments.slice(0, -1).join('/')) : null; },
      doc(id) { return ref(`${path}/${id}`); },
      get() { return Promise.resolve(querySnapshot(directDocuments(path))); },
      where(field, operator, value) { return makeQuery(() => directDocuments(path), [{ field, operator, value }]); },
    };
  };
  const snapshot = (reference) => ({
    exists: data.has(reference.path),
    id: reference.id,
    ref: reference,
    data: () => data.get(reference.path),
  });
  const directDocuments = (path) => [...data.keys()]
    .filter((candidate) => candidate.startsWith(`${path}/`) && candidate.split('/').length === path.split('/').length + 1)
    .map((candidate) => snapshot(ref(candidate)));
  const querySnapshot = (docs) => ({ docs, empty: docs.length === 0, size: docs.length });
  const makeQuery = (source, filters = [], max = Infinity, ordered = false, startAfterId = '') => ({
    where(field, operator, value) {
      return makeQuery(source, [...filters, { field, operator, value }], max, ordered, startAfterId);
    },
    orderBy() { return makeQuery(source, filters, max, true, startAfterId); },
    startAfter(value) { return makeQuery(source, filters, max, ordered, String(value || '')); },
    limit(value) { return makeQuery(source, filters, value, ordered, startAfterId); },
    get() {
      let docs = source().filter((document) => filters.every((filter) => {
        const actual = document.data()?.[filter.field];
        if (filter.operator === '==') return actual === filter.value;
        if (filter.operator === 'in') return Array.isArray(filter.value) && filter.value.includes(actual);
        if (filter.operator === '<=') return actual != null && actual <= filter.value;
        return false;
      }));
      if (ordered) docs = docs.sort((left, right) => left.id.localeCompare(right.id));
      if (startAfterId) docs = docs.filter((document) => document.id > startAfterId);
      docs = docs.slice(0, max);
      return Promise.resolve(querySnapshot(docs));
    },
  });
  const transactionForRun = () => ({
    get: async (reference) => snapshot(reference),
    create(reference, value) {
      if (data.has(reference.path)) throw new Error(`already exists: ${reference.path}`);
      data.set(reference.path, value);
    },
    set(reference, value, options) {
      data.set(reference.path, options?.merge ? { ...(data.get(reference.path) || {}), ...value } : value);
    },
    update(reference, value) {
      if (!data.has(reference.path)) throw new Error(`missing: ${reference.path}`);
      data.set(reference.path, { ...data.get(reference.path), ...value });
    },
    delete(reference) {
      data.delete(reference.path);
    },
  });
  return {
    data,
    doc: ref,
    collection,
    collectionGroup(name) {
      return makeQuery(() => [...data.keys()]
        .filter((path) => path.split('/').at(-2) === name)
        .map((path) => snapshot(ref(path))));
    },
    runTransaction(callback) {
      const result = transactionTail.then(() => callback(transactionForRun()));
      transactionTail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}
