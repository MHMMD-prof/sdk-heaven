import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildRoomDocument,
  buildRoomMemberDocument,
  resolveJoinRoomAdmission,
  validateRoomAdmissionRequest,
} = require('./roomAdmissionCore');

const profile = {
  avatarLabel: 'S',
  displayName: 'Salem',
  email: 'salem@example.test',
  uid: 'uid-1',
};
const publicProfile = { moderationStatus: 'active' };
const decodedToken = { email: profile.email, uid: profile.uid };

describe('roomAdmissionCore', () => {
  it('normalizes a valid private create command and rejects malformed requests', () => {
    expect(validateRoomAdmissionRequest({
      action: 'create-room',
      countryCode: 'iq',
      inviteCode: ' ab-c123 ',
      requestId: 'admission_create_0001',
      type: 'voice',
      visibility: 'private',
    })).toMatchObject({
      ok: true,
      value: { countryCode: 'IQ', inviteCode: 'ABC123', visibility: 'private' },
    });
    expect(validateRoomAdmissionRequest({ action: 'join-room', requestId: 'short', roomId: 'room-1' }))
      .toMatchObject({ code: 'INVALID_REQUEST', ok: false });
  });

  it('builds server-authoritative room and member documents', () => {
    const room = buildRoomDocument({
      id: 'room-private',
      input: { countryCode: 'IQ', inviteCode: '', title: '  Majlis  ', type: 'voice', visibility: 'private' },
      profile,
    });
    expect(room).toMatchObject({
      hostId: 'uid-1',
      inviteCode: 'ROOMPRIV',
      ownerUid: 'uid-1',
      participantCount: 1,
      schemaVersion: 2,
      title: '  Majlis  ',
    });
    expect(buildRoomMemberDocument({ profile, role: 'host' })).toMatchObject({
      authorityRole: 'owner',
      canPublishAudio: true,
      role: 'host',
      uid: 'uid-1',
    });
  });

  it('enforces private invites, bans, and paused-join reconnect behavior', () => {
    const base = {
      command: { inviteCode: 'WRONG1', roomId: 'room-1' },
      decodedToken,
      featureFlags: { voice_room_new_joins: true },
      privateProfile: profile,
      publicProfile,
      room: { id: 'room-1', inviteCode: 'SECRET1', status: 'active', visibility: 'private' },
    };
    expect(resolveJoinRoomAdmission(base)).toMatchObject({ code: 'INVITE_INVALID', ok: false });
    expect(resolveJoinRoomAdmission({ ...base, ban: { status: 'active' } }))
      .toMatchObject({ code: 'ROOM_BANNED', ok: false });
    expect(resolveJoinRoomAdmission({
      ...base,
      command: { inviteCode: '', roomId: 'room-1' },
      existingMember: { role: 'speaker', status: 'active', uid: 'uid-1', canPublishAudio: true },
      featureFlags: { voice_room_new_joins: false },
      nowMs: 1_000,
      presence: { leaseExpiresAt: 2_000, status: 'reconnecting' },
    })).toMatchObject({
      ok: true,
      value: { member: { role: 'speaker', canPublishAudio: true } },
    });
  });
});
