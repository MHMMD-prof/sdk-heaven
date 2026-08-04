import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createAttendanceSessionId,
  detectMuteGraceCycling,
  groupReconnectIntervals,
  normalizeAttendanceDeviceEnrollment,
  normalizeAttendanceOutageMutation,
  normalizeLiveKitWebhookEvent,
  reduceAttendanceSession,
  splitAndUnionAttendanceIntervals,
} = require('./roomAttendanceCore');

const base = {
  eventId: 'event-1',
  occurredAtMillis: 1_000,
  participantSid: 'PA_1',
  roomId: 'room-1',
  uid: 'user-1',
};

describe('roomAttendanceCore', () => {
  it('normalizes only signed-webhook event shapes the projector understands', () => {
    expect(normalizeLiveKitWebhookEvent({
      createdAt: 12,
      event: 'participant_joined',
      id: 'event-1',
      participant: { identity: 'user-1', sid: 'PA_1' },
      room: { name: 'room-1' },
    })).toMatchObject({ ok: true, value: { occurredAtMillis: 12_000, uid: 'user-1' } });
    expect(normalizeLiveKitWebhookEvent({
      createdAt: 12,
      event: 'track_muted',
      id: 'event-2',
      participant: { identity: 'user-1', sid: 'PA_1' },
      room: { name: 'room-1' },
    })).toEqual({ ok: false, code: 'UNSUPPORTED_EVENT' });
  });

  it('opens only when connected, authoritatively seated, and publishing a microphone', () => {
    let state;
    for (const event of [
      { ...base, kind: 'participant_joined' },
      { ...base, eventId: 'seat', kind: 'seat-state', occurredAtMillis: 2_000, seated: true, seatId: '01' },
      { ...base, eventId: 'track', kind: 'track_published', occurredAtMillis: 3_000, track: { microphone: true, muted: false, sid: 'TR_1' } },
    ]) {
      const result = reduceAttendanceSession(state, event);
      state = result.value.session;
      if (event.kind === 'track_published') {
        expect(result.value.actions).toEqual([expect.objectContaining({ kind: 'open', startAtMillis: 3_000 })]);
      }
    }
    expect(state.activeIntervalId).toMatch(/^rai_/);
  });

  it('credits mute grace through 4:59 and closes exactly at five minutes', () => {
    const sessionId = createAttendanceSessionId('room-1', 'user-1');
    const active = {
      activeIntervalId: `rai_${'a'.repeat(40)}`,
      activeIntervalStartedAtMillis: 1_000,
      connected: true,
      lastObservedAtMillis: 1_000,
      microphonePublished: true,
      muteStartedAtMillis: 2_000,
      muted: true,
      participantSid: 'PA_1',
      roomId: 'room-1',
      schemaVersion: 1,
      seated: true,
      seatId: '01',
      sessionId,
      uid: 'user-1',
    };
    const before = reduceAttendanceSession(active, { ...base, eventId: 'before', kind: 'mute-deadline', occurredAtMillis: 301_999 });
    expect(before.value.actions).toEqual([]);
    const deadline = reduceAttendanceSession(before.value.session, { ...base, eventId: 'deadline', kind: 'mute-deadline', occurredAtMillis: 302_000 });
    expect(deadline.value.actions).toEqual([expect.objectContaining({
      endAtMillis: 302_000, kind: 'close', reason: 'muted-over-grace',
    })]);
  });

  it('ignores stale events and closes on seat leave or disconnect', () => {
    const active = {
      activeIntervalId: `rai_${'b'.repeat(40)}`,
      activeIntervalStartedAtMillis: 1_000,
      connected: true,
      lastObservedAtMillis: 5_000,
      microphonePublished: true,
      muted: false,
      participantSid: 'PA_1',
      roomId: 'room-1',
      seated: true,
      seatId: '01',
      sessionId: createAttendanceSessionId('room-1', 'user-1'),
      uid: 'user-1',
    };
    expect(reduceAttendanceSession(active, { ...base, occurredAtMillis: 4_999, kind: 'participant_left' }).value)
      .toMatchObject({ ignored: true, reason: 'stale-event' });
    expect(reduceAttendanceSession(active, { ...base, occurredAtMillis: 6_000, kind: 'seat-state', seated: false, seatId: '' }).value.actions)
      .toEqual([expect.objectContaining({ endAtMillis: 6_000, reason: 'not-seated' })]);
  });

  it('unions overlaps across devices/rooms and clips at the daily boundary', () => {
    const result = splitAndUnionAttendanceIntervals([
      { startAtMillis: 0, endAtMillis: 150 },
      { startAtMillis: 120, endAtMillis: 240 },
      { startAtMillis: 260, endAtMillis: 400 },
    ], {
      dayEndAtMillis: 300,
      dayStartAtMillis: 100,
      outageWindows: [{ startAtMillis: 280, endAtMillis: 320 }],
    });
    expect(result.value).toMatchObject({ qualifiedMillis: 180, excusedMillis: 20 });
    expect(result.value.intervals).toEqual([
      { startAtMillis: 100, endAtMillis: 240 },
      { startAtMillis: 260, endAtMillis: 300 },
    ]);
  });

  it('groups short reconnects for evidence without crediting the disconnected gap', () => {
    expect(groupReconnectIntervals([
      { startAtMillis: 1_000, endAtMillis: 10_000 },
      { startAtMillis: 20_000, endAtMillis: 30_000 },
    ])).toEqual([{
      endAtMillis: 30_000,
      intervalCount: 2,
      qualifiedMillis: 19_000,
      startAtMillis: 1_000,
    }]);
  });

  it('flags repeated mute-grace reset patterns without inspecting speech', () => {
    const events = Array.from({ length: 4 }, (_, index) => [
      { kind: 'muted', occurredAtMillis: index * 60_000 },
      { kind: 'unmuted', occurredAtMillis: index * 60_000 + 59_000 },
    ]).flat();
    expect(detectMuteGraceCycling(events)).toMatchObject({ flagged: true, resetCount: 4 });
  });

  it('accepts an opaque Play Integrity enrollment and rejects hardware identifiers', () => {
    expect(normalizeAttendanceDeviceEnrollment({
      attestationProvider: 'play-integrity',
      attestationVerdictId: 'verdict-1',
      installationId: 'random-installation-1',
      platform: 'android',
      state: 'pending-review',
      uid: 'user-1',
    })).toMatchObject({ ok: true, value: { platform: 'android', state: 'pending-review' } });
    expect(normalizeAttendanceDeviceEnrollment({
      attestationProvider: 'play-integrity',
      attestationVerdictId: 'verdict-1',
      imei: 'forbidden',
      installationId: 'random-installation-1',
      platform: 'android',
      state: 'active',
      uid: 'user-1',
    })).toEqual({ ok: false, code: 'INVALID_DEVICE_ENROLLMENT' });
  });

  it('bounds excused outage windows and requires an auditable reason', () => {
    expect(normalizeAttendanceOutageMutation({
      endAtMillis: 20_000,
      operation: 'create',
      reason: 'LiveKit regional outage',
      requestId: 'outage-request-1',
      startAtMillis: 10_000,
    })).toMatchObject({ ok: true, value: { outageId: 'outage-request-1' } });
    expect(normalizeAttendanceOutageMutation({
      endAtMillis: 10_000,
      operation: 'create',
      reason: 'no',
      requestId: 'outage-request-2',
      startAtMillis: 20_000,
    })).toEqual({ ok: false, code: 'INVALID_OUTAGE' });
  });
});
