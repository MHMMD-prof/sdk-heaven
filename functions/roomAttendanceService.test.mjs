import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  ingestLiveKitAttendanceEvent,
  mutateAttendanceOutageWindow,
} = require('./roomAttendanceService');

const fieldValue = { serverTimestamp: () => timestamp(now.value) };
const now = { value: 1_000 };
const clock = {
  nowMillis: () => now.value,
  timestampFromMillis: timestamp,
};

describe('roomAttendanceService', () => {
  it('uses the server-owned seat, deduplicates delivery, and closes at mute grace', async () => {
    const db = new FakeFirestore({
      'appConfig/voiceRoomFeatures': { voice_room_attendance_shadow: true },
      'rooms/room-1/members/user-1': { seatId: '01', status: 'active', uid: 'user-1' },
      'rooms/room-1/seats/01': { occupantUid: 'user-1', state: 'occupied' },
    });
    const joined = await ingest(db, event('participant_joined', 'join', 1_000));
    const published = await ingest(db, {
      ...event('track_published', 'publish', 2_000),
      track: { microphone: true, muted: false, sid: 'TR_1' },
    });
    const replay = await ingest(db, {
      ...event('track_published', 'publish', 2_000),
      track: { microphone: true, muted: false, sid: 'TR_1' },
    });
    expect(joined.actions).toEqual([]);
    expect(published.actions).toEqual(['open']);
    expect(replay).toEqual({ replayed: true });

    await ingest(db, {
      ...event('authoritative-snapshot', 'mute', 3_000),
      connected: true,
      microphonePublished: true,
      muted: true,
    });
    const deadline = await ingest(db, {
      ...event('authoritative-snapshot', 'deadline', 303_000),
      connected: true,
      microphonePublished: true,
      muted: true,
    });
    expect(deadline.actions).toEqual(['close']);
    const interval = [...db.documents.entries()].find(([path]) => path.startsWith('roomAttendanceIntervals/'))?.[1];
    expect(interval).toMatchObject({
      exclusionReason: 'muted-over-grace',
      qualifiedMillis: 301_000,
      state: 'closed',
    });
  });

  it('never opens when a forged membership seat is not backed by the seat document', async () => {
    const db = new FakeFirestore({
      'appConfig/voiceRoomFeatures': { voice_room_attendance_shadow: true },
      'rooms/room-1/members/user-1': { seatId: '01', status: 'active', uid: 'user-1' },
      'rooms/room-1/seats/01': { occupantUid: 'someone-else', state: 'occupied' },
    });
    await ingest(db, event('participant_joined', 'join-invalid-seat', 1_000));
    const result = await ingest(db, {
      ...event('track_published', 'publish-invalid-seat', 2_000),
      track: { microphone: true, muted: false, sid: 'TR_1' },
    });
    expect(result.actions).toEqual([]);
    expect([...db.documents.keys()].some((path) => path.startsWith('roomAttendanceIntervals/'))).toBe(false);
  });

  it('creates and revokes outage windows with idempotent audited commands', async () => {
    const db = new FakeFirestore({});
    const createInput = {
      endAtMillis: 20_000,
      operation: 'create',
      outageId: 'outage-1',
      reason: 'LiveKit outage',
      requestId: 'request-create-1',
      startAtMillis: 10_000,
    };
    const dependencies = {
      clock,
      db,
      decodedToken: { adminRole: 'owner', email: 'owner@example.com', uid: 'owner-1' },
      fieldValue,
    };
    const created = await mutateAttendanceOutageWindow({ ...dependencies, input: createInput });
    const replay = await mutateAttendanceOutageWindow({ ...dependencies, input: createInput });
    const revoked = await mutateAttendanceOutageWindow({
      ...dependencies,
      input: {
        endAtMillis: 0,
        operation: 'revoke',
        outageId: 'outage-1',
        reason: 'Incident review completed',
        requestId: 'request-revoke-1',
        startAtMillis: 0,
      },
    });
    expect(created).toMatchObject({ replayed: false });
    expect(replay).toMatchObject({ auditId: created.auditId, replayed: true });
    expect(revoked).toMatchObject({ replayed: false });
    expect(db.documents.get('attendanceOutageWindows/outage-1')).toMatchObject({ active: false });
  });
});

function ingest(db, input) {
  now.value = input.occurredAtMillis;
  return ingestLiveKitAttendanceEvent({ clock, db, event: input, fieldValue });
}

function event(kind, eventId, occurredAtMillis) {
  return {
    eventId,
    kind,
    occurredAtMillis,
    participantSid: 'PA_1',
    roomId: 'room-1',
    schemaVersion: 1,
    uid: 'user-1',
  };
}

function timestamp(milliseconds) {
  return { toMillis: () => milliseconds };
}

class FakeFirestore {
  constructor(seed) {
    this.documents = new Map(Object.entries(seed));
  }

  doc(path) {
    return new FakeDocumentReference(this, path);
  }

  collection(path) {
    return {
      doc: () => new FakeDocumentReference(this, `${path}/auto-${this.documents.size + 1}`),
    };
  }

  async runTransaction(callback) {
    return callback({
      create: (ref, value) => {
        if (this.documents.has(ref.path)) throw new Error('already-exists');
        this.documents.set(ref.path, clone(value));
      },
      get: (ref) => ref.get(),
      set: (ref, value, options) => {
        const previous = this.documents.get(ref.path);
        this.documents.set(ref.path, options?.merge ? { ...(previous || {}), ...clone(value) } : clone(value));
      },
      update: (ref, value) => {
        if (!this.documents.has(ref.path)) throw new Error('not-found');
        this.documents.set(ref.path, { ...this.documents.get(ref.path), ...clone(value) });
      },
    });
  }
}

class FakeDocumentReference {
  constructor(firestore, path) {
    this.firestore = firestore;
    this.path = path;
    this.id = path.split('/').at(-1);
  }

  async get() {
    const value = this.firestore.documents.get(this.path);
    return { data: () => value, exists: value !== undefined };
  }
}

function clone(value) {
  if (!value || typeof value !== 'object' || typeof value.toMillis === 'function') return value;
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}
