import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  extractBearerToken,
  isActiveRoom,
  isCompleteMembership,
  isCompleteProfile,
  isValidRoomId,
  resolveTokenRequest,
} = require('./livekitTokenCore');

const decodedToken = {
  email: 'salem@example.com',
  uid: 'uid-1',
};

const profile = {
  avatarLabel: 'S',
  displayName: 'Salem',
  email: 'salem@example.com',
  uid: 'uid-1',
};
const room = {
  id: 'room-1',
  status: 'active',
  hostId: 'uid-1',
  title: 'Test Room',
};
const hostMembership = {
  avatarLabel: 'S',
  canPublishAudio: true,
  displayName: 'Salem',
  role: 'host',
  status: 'active',
  uid: 'uid-1',
};
const listenerMembership = {
  ...hostMembership,
  canPublishAudio: false,
  role: 'listener',
};

describe('livekitTokenCore', () => {
  it('extracts bearer tokens from authorization headers', () => {
    expect(extractBearerToken({ authorization: 'Bearer token-1' })).toBe('token-1');
    expect(extractBearerToken({ Authorization: 'bearer token-2' })).toBe('token-2');
    expect(extractBearerToken({ authorization: 'Basic token-1' })).toBe('');
  });

  it('validates room ids conservatively', () => {
    expect(isValidRoomId('room-1')).toBe(true);
    expect(isValidRoomId('DG:room_1')).toBe(true);
    expect(isValidRoomId('')).toBe(false);
    expect(isValidRoomId('../room')).toBe(false);
  });

  it('requires a complete profile matching the decoded token identity', () => {
    expect(isCompleteProfile(profile, 'uid-1', 'salem@example.com')).toBe(true);
    expect(isCompleteProfile({ ...profile, uid: 'other' }, 'uid-1', 'salem@example.com')).toBe(false);
    expect(isCompleteProfile({ ...profile, avatarLabel: 'SS' }, 'uid-1', 'salem@example.com')).toBe(false);
  });

  it('requires an active room and complete membership', () => {
    expect(isActiveRoom(room, 'room-1')).toBe(true);
    expect(isActiveRoom({ ...room, status: 'closed' }, 'room-1')).toBe(false);
    expect(isCompleteMembership(hostMembership, 'uid-1')).toBe(true);
    expect(isCompleteMembership({ ...hostMembership, uid: 'other' }, 'uid-1')).toBe(false);
    expect(isCompleteMembership({ ...hostMembership, status: 'removed' }, 'uid-1')).toBe(false);
  });

  it('resolves a trusted token request from decoded token, profile, and membership data', () => {
    expect(
      resolveTokenRequest({
        body: {
          displayName: 'Spoofed',
          roomId: 'room-1',
          userId: 'spoofed-user',
        },
        decodedToken,
        membership: hostMembership,
        profile,
        room,
      }),
    ).toEqual({
      ok: true,
      value: {
        authorityRole: 'owner',
        avatarLabel: 'S',
        canPublish: true,
        displayName: 'Salem',
        participantId: 'uid-1',
        role: 'host',
        roomId: 'room-1',
        seatId: '',
      },
    });
  });

  it('allows completed unverified accounts to request room tokens', () => {
    expect(
      resolveTokenRequest({
        body: { roomId: 'room-1' },
        decodedToken: { ...decodedToken, email_verified: false },
        membership: hostMembership,
        profile,
        room,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        participantId: 'uid-1',
        roomId: 'room-1',
      },
    });
  });

  it('rejects invalid room id, missing profile, and missing membership', () => {
    expect(resolveTokenRequest({ body: {}, decodedToken, profile })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(resolveTokenRequest({ body: { roomId: 'room-1' }, decodedToken, room })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(resolveTokenRequest({ body: { roomId: 'room-1' }, decodedToken, profile, room })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(
      resolveTokenRequest({
        body: { roomId: 'room-1' },
        decodedToken,
        membership: hostMembership,
        profile,
        room: { ...room, status: 'closed' },
      }),
    ).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(
      resolveTokenRequest({
        body: { roomId: 'room-1' },
        decodedToken,
        membership: { ...hostMembership, status: 'removed' },
        profile,
        room,
      }),
    ).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(
      resolveTokenRequest({
        body: { roomId: 'room-1', canPublishAudio: true },
        decodedToken,
        membership: listenerMembership,
        profile,
        room,
      }),
    ).toMatchObject({
      ok: true,
      value: {
        canPublish: false,
        role: 'listener',
      },
    });
  });

  it('derives publishing from authoritative seat, mute, lockdown, and ban state', () => {
    const seated = { ...listenerMembership, seatId: '01', canPublishAudio: true, role: 'speaker' };
    const seat = { seatNumber: 1, state: 'occupied', occupantUid: 'uid-1' };
    const input = { body: { roomId: 'room-1', canPublishAudio: false }, decodedToken, membership: seated, profile, room, seat };

    expect(resolveTokenRequest(input)).toMatchObject({ ok: true, value: { canPublish: true, seatId: '01' } });
    expect(resolveTokenRequest({ ...input, membership: { ...seated, forceMuted: true } })).toMatchObject({
      ok: true,
      value: { canPublish: false },
    });
    expect(resolveTokenRequest({ ...input, room: { ...room, audioLockdown: true } })).toMatchObject({
      ok: true,
      value: { canPublish: false },
    });
    expect(resolveTokenRequest({ ...input, seat: { ...seat, occupantUid: 'other' } })).toMatchObject({
      ok: true,
      value: { canPublish: false },
    });
    expect(resolveTokenRequest({ ...input, ban: { status: 'active' } })).toMatchObject({ ok: false, status: 403 });
    expect(resolveTokenRequest({
      body: { roomId: 'room-1' }, decodedToken, membership: hostMembership, profile,
      room: { ...room, seatEngineVersion: 1 },
    })).toMatchObject({ ok: true, value: { canPublish: false, seatId: '' } });
  });
});
