import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  ROOM_SEAT_RECONNECT_MS,
  buildRoomSeatCommandFingerprint,
  normalizeRoomSeatCommandBody,
  planSeatEngineActivation,
  releaseSeatPatch,
  resizeSeatPatch,
  resolveRoomSeatCommand,
} = require('./roomSeatCore');

const room = {
  availability: 'active', countryCode: 'IQ', hostId: 'owner-1', id: 'room-1', ownerUid: 'owner-1',
  revision: 7, schemaVersion: 2, seatMode: 'open', seatTargetCount: 10, status: 'active',
  seatEngineVersion: 1,
};
const owner = { authorityRole: 'owner', role: 'host', status: 'active', uid: 'owner-1' };
const member = { authorityRole: 'member', role: 'listener', status: 'active', uid: 'member-1' };

function resolve(action, overrides = {}) {
  return resolveRoomSeatCommand({
    actorMembership: overrides.actorMembership || owner,
    body: {
      action,
      requestId: 'room_seat_request_0001',
      roomId: 'room-1',
      ...overrides.body,
    },
    decodedToken: overrides.decodedToken || { uid: owner.uid },
    room: overrides.room || room,
    targetMembership: overrides.targetMembership,
  });
}

describe('roomSeatCore', () => {
  it('normalizes every seat-specific idempotency field into the fingerprint', () => {
    const command = normalizeRoomSeatCommandBody({
      action: ' claim-seat ', requestId: ' room_seat_request_0001 ', roomId: ' room-1 ',
      seatId: ' 03 ', seatMode: ' open ', seatTargetCount: 10, sessionId: ' session-1 ',
    });
    expect(command).toMatchObject({ action: 'claim-seat', roomId: 'room-1', seatId: '03', seatMode: 'open' });
    expect(buildRoomSeatCommandFingerprint('owner-1', command)).toContain('|03|open|10|session-1|');
  });

  it('allows self-service actions without granting room configuration authority', () => {
    expect(resolve('claim-seat', {
      actorMembership: member,
      body: { seatId: '01' },
      decodedToken: { uid: 'member-1' },
    })).toMatchObject({ ok: true, value: { actorAuthority: 'member', targetUid: 'member-1' } });
    expect(resolve('resize-seats', {
      actorMembership: member,
      body: { expectedRevision: 7, seatTargetCount: 20 },
      decodedToken: { uid: 'member-1' },
    })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('allows moderators to manage requests and seats while the owner is offline', () => {
    const moderator = { authorityRole: 'moderator', role: 'listener', status: 'active', uid: 'mod-1' };
    expect(resolve('approve-seat-request', {
      actorMembership: moderator,
      body: { seatId: '04', targetUid: 'member-1' },
      decodedToken: { uid: 'mod-1' },
      room: { ...room, seatMode: 'request' },
      targetMembership: member,
    })).toMatchObject({ ok: true, value: { actorAuthority: 'moderator' } });
  });

  it('requires owner revision checks for mode and count changes', () => {
    expect(resolve('resize-seats', { body: { seatTargetCount: 20 } })).toMatchObject({ ok: false, code: 'REVISION_REQUIRED' });
    expect(resolve('resize-seats', { body: { expectedRevision: 6, seatTargetCount: 20 } })).toMatchObject({
      ok: false, code: 'REVISION_CONFLICT', details: { revision: 7 },
    });
    expect(resolve('set-seat-mode', { body: { expectedRevision: 7, seatMode: 'invite' } })).toMatchObject({
      ok: true, value: { nextRevision: 8 },
    });
  });

  it('retires occupied overflow seats without ejecting their occupants', () => {
    const occupied = { occupantUid: 'member-1', revision: 3, seatNumber: 20, state: 'occupied' };
    expect(resizeSeatPatch(occupied, 10)).toMatchObject({
      occupancyState: 'occupied', retired: true, revision: 4, state: 'retiring',
    });
    expect(releaseSeatPatch({ ...occupied, retired: true, state: 'retiring' }, 10)).toMatchObject({
      occupantUid: null, retired: true, state: 'locked',
    });
  });

  it('freezes the reconnect reservation at exactly 45 seconds', () => {
    expect(ROOM_SEAT_RECONNECT_MS).toBe(45_000);
  });

  it('builds a non-destructive activation plan for legacy speakers', () => {
    const seats = Array.from({ length: 20 }, (_, index) => ({
      revision: 1, seatNumber: index + 1, state: 'open',
    }));
    expect(planSeatEngineActivation(
      { ...room, seatEngineVersion: undefined, seatTargetCount: 5 },
      [
        { canPublishAudio: true, role: 'host', status: 'active', uid: 'owner-1' },
        { canPublishAudio: true, role: 'speaker', status: 'active', uid: 'member-1' },
      ],
      seats,
    )).toMatchObject({
      ok: true,
      speakerCount: 2,
      memberPatches: [{ uid: 'member-1', patch: { seatId: '01' } }, { uid: 'owner-1', patch: { seatId: '02' } }],
      seatPatches: [
        { seatId: '01', patch: { occupantUid: 'member-1', state: 'occupied' } },
        { seatId: '02', patch: { occupantUid: 'owner-1', state: 'occupied' } },
      ],
    });
  });
});
