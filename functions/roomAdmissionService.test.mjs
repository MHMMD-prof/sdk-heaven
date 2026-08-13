import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { executeRoomAdmissionCommand } = require('./roomAdmissionService');

const nowMs = 2_000_000_000_000;
const clock = { nowMillis: () => nowMs, timestampFromMillis: (value) => value };
const INCREMENT = Symbol('increment');
const fieldValue = {
  increment: (amount) => ({ [INCREMENT]: amount }),
  serverTimestamp: () => nowMs,
};

describe('roomAdmissionService', () => {
  it('creates one room, host membership, twenty seats, lock, rate record, and replay receipt', async () => {
    const db = seededDb('host-1');
    const options = {
      body: {
        action: 'create-room',
        clientVersion: '1.0.0',
        countryCode: 'IQ',
        requestId: 'admission_create_0001',
        title: 'Majlis',
        type: 'voice',
      },
      clock,
      db,
      decodedToken: { email: 'host@example.test', uid: 'host-1' },
      fieldValue,
    };
    const first = await executeRoomAdmissionCommand(options);
    const replay = await executeRoomAdmissionCommand(options);
    expect(first).toMatchObject({
      ok: true,
      replayed: false,
      result: { room: { hostId: 'host-1', participantCount: 1 }, localMember: { role: 'host' } },
    });
    expect(replay).toMatchObject({ ok: true, replayed: true, result: first.result });
    expect([...db.data.keys()].filter((path) => /rooms\/[^/]+\/seats\//.test(path))).toHaveLength(20);
    expect(db.data.get('voiceRoomActiveHosts/host-1')).toMatchObject({ roomId: first.result.room.id });
  });

  it('allows only one active host room across concurrent create attempts', async () => {
    const db = seededDb('host-1');
    const makeOptions = (suffix) => ({
      body: {
        action: 'create-room', countryCode: 'IQ', requestId: `admission_create_${suffix}`,
        type: 'voice',
      },
      clock,
      db,
      decodedToken: { email: 'host@example.test', uid: 'host-1' },
      fieldValue,
    });
    const results = await Promise.all([
      executeRoomAdmissionCommand(makeOptions('0002')),
      executeRoomAdmissionCommand(makeOptions('0003')),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({ code: 'ACTIVE_ROOM_EXISTS' });
  });

  it('joins idempotently and increments participant count only for the first membership', async () => {
    const db = seededDb('member-1');
    db.data.set('rooms/room-1', {
      availability: 'active', id: 'room-1', participantCount: 1, schemaVersion: 2,
      status: 'active', visibility: 'public',
    });
    const options = {
      body: { action: 'join-room', requestId: 'admission_join_00001', roomId: 'room-1' },
      clock,
      db,
      decodedToken: { email: 'member@example.test', uid: 'member-1' },
      fieldValue,
    };
    const first = await executeRoomAdmissionCommand(options);
    const replay = await executeRoomAdmissionCommand(options);
    expect(first).toMatchObject({ ok: true, result: { localMember: { role: 'listener' } } });
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(db.data.get('rooms/room-1')).toMatchObject({ participantCount: 2 });
  });

  it('rejects an invalid private invite and an active ban without creating membership', async () => {
    const db = seededDb('member-1');
    db.data.set('rooms/private-1', {
      id: 'private-1', inviteCode: 'SECRET1', participantCount: 1,
      status: 'active', visibility: 'private',
    });
    expect(await executeRoomAdmissionCommand({
      body: { action: 'join-room', inviteCode: 'WRONG1', requestId: 'admission_join_00002', roomId: 'private-1' },
      clock, db, decodedToken: { email: 'member@example.test', uid: 'member-1' }, fieldValue,
    })).toMatchObject({ code: 'INVITE_INVALID', ok: false });
    db.data.set('rooms/private-1/bans/member-1', { status: 'active' });
    expect(await executeRoomAdmissionCommand({
      body: { action: 'join-room', inviteCode: 'SECRET1', requestId: 'admission_join_00003', roomId: 'private-1' },
      clock, db, decodedToken: { email: 'member@example.test', uid: 'member-1' }, fieldValue,
    })).toMatchObject({ code: 'ROOM_BANNED', ok: false });
    expect(db.data.has('rooms/private-1/members/member-1')).toBe(false);
  });
});

function seededDb(uid) {
  const db = createFakeDb();
  const name = uid === 'host-1' ? 'Host' : 'Member';
  const email = uid === 'host-1' ? 'host@example.test' : 'member@example.test';
  db.data.set('appConfig/voiceRoomFeatures', { voice_room_new_joins: true });
  db.data.set(`users/${uid}`, { avatarLabel: name[0], displayName: name, email, uid });
  db.data.set(`publicProfiles/${uid}`, { moderationStatus: 'active', uid });
  return db;
}

function createFakeDb() {
  const data = new Map();
  let autoId = 0;
  let queue = Promise.resolve();
  const makeRef = (path) => ({
    id: path.split('/').at(-1),
    path,
    collection(name) {
      return {
        doc: (id) => makeRef(`${path}/${name}/${id || `auto-${++autoId}`}`),
      };
    },
  });
  const snapshot = (reference) => ({
    data: () => data.get(reference.path),
    exists: data.has(reference.path),
    id: reference.id,
    ref: reference,
  });
  const applyValue = (value, current) => {
    if (value && typeof value === 'object' && value[INCREMENT] !== undefined) {
      return Number(current || 0) + value[INCREMENT];
    }
    return value;
  };
  const merge = (value, current = {}) => Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, applyValue(item, current?.[key])]),
  );
  const transaction = {
    create(reference, value) {
      if (data.has(reference.path)) throw new Error(`already exists: ${reference.path}`);
      data.set(reference.path, merge(value));
    },
    delete(reference) { data.delete(reference.path); },
    get: async (reference) => snapshot(reference),
    set(reference, value, options) {
      data.set(reference.path, { ...(options?.merge ? data.get(reference.path) : {}), ...merge(value, data.get(reference.path)) });
    },
    update(reference, value) {
      data.set(reference.path, { ...data.get(reference.path), ...merge(value, data.get(reference.path)) });
    },
  };
  return {
    collection(name) {
      return { doc: (id) => makeRef(`${name}/${id || `auto-${++autoId}`}`) };
    },
    data,
    doc: makeRef,
    runTransaction(callback) {
      const result = queue.then(() => callback(transaction));
      queue = result.catch(() => undefined);
      return result;
    },
  };
}
