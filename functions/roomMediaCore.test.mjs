import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  normalizeRoomMediaCommandBody,
  readImageDimensions,
  resolveRoomMediaCommand,
  roomMediaPath,
  validateRoomImageObject,
} = require('./roomMediaCore');

const room = {
  availability: 'active',
  countryCode: 'IQ',
  hostId: 'owner-1',
  id: 'room-1',
  ownerUid: 'owner-1',
  revision: 4,
  status: 'active',
};
const ownerToken = { email: 'owner@example.com', uid: 'owner-1' };
const ownerProfile = {
  avatarLabel: 'O',
  displayName: 'Owner',
  email: 'owner@example.com',
  uid: 'owner-1',
};
const ownerMembership = {
  authorityRole: 'owner',
  status: 'active',
  uid: 'owner-1',
};
const flags = {
  voice_room_command_center: true,
  voice_room_media: true,
};

function body(action, extra = {}) {
  return {
    action,
    expectedRevision: 4,
    mediaId: 'media_request_000001',
    requestId: 'media_command_000001',
    roomId: 'room-1',
    ...extra,
  };
}

describe('roomMediaCore', () => {
  it('normalizes bounded media commands and derives immutable paths', () => {
    expect(roomMediaPath('room-1', 'media_request_000001')).toBe(
      'room-media/room-1/media_request_000001/source',
    );
    expect(normalizeRoomMediaCommandBody({
      ...body('reject-room-image'),
      reason: ` ${'x'.repeat(300)} `,
    }).reason).toHaveLength(240);
  });

  it('allows only the active owner to submit and fails closed on media flags', () => {
    const mediaPath = roomMediaPath('room-1', 'media_request_000001');
    expect(resolveRoomMediaCommand({
      actorMembership: ownerMembership,
      body: body('submit-room-image', { mediaPath }),
      decodedToken: ownerToken,
      featureFlags: flags,
      profile: ownerProfile,
      room,
    })).toMatchObject({
      ok: true,
      value: { actorAuthority: 'owner', currentRevision: 4, nextRevision: 5 },
    });
    expect(resolveRoomMediaCommand({
      actorMembership: ownerMembership,
      body: body('submit-room-image', { mediaPath }),
      decodedToken: ownerToken,
      featureFlags: { ...flags, voice_room_media: false },
      profile: ownerProfile,
      room,
    })).toMatchObject({ ok: false, code: 'FEATURE_DISABLED' });
    expect(resolveRoomMediaCommand({
      actorMembership: ownerMembership,
      body: body('submit-room-image', { mediaPath }),
      decodedToken: ownerToken,
      featureFlags: flags,
      profile: ownerProfile,
      room: { ...room, roomCustomizationSuspended: true },
    })).toMatchObject({ ok: false, code: 'ROOM_CUSTOMIZATION_SUSPENDED' });
  });

  it('allows only region-scoped staff to review room media', () => {
    const token = {
      admin: true,
      adminRole: 'super-moderator',
      email: 'staff@example.com',
      uid: 'staff-1',
    };
    const profile = {
      avatarLabel: 'S',
      displayName: 'Staff',
      email: 'staff@example.com',
      uid: 'staff-1',
    };
    expect(resolveRoomMediaCommand({
      body: body('approve-room-image'),
      decodedToken: token,
      featureFlags: flags,
      operatorProfile: {
        regionCodes: ['IQ'],
        role: 'super-moderator',
        status: 'active',
        uid: 'staff-1',
      },
      profile,
      room,
    })).toMatchObject({ ok: true, value: { actorAuthority: 'super-moderator' } });
    expect(resolveRoomMediaCommand({
      body: body('reject-room-image', { reason: 'unsafe image' }),
      decodedToken: token,
      featureFlags: flags,
      operatorProfile: {
        regionCodes: ['SA'],
        role: 'super-moderator',
        status: 'active',
        uid: 'staff-1',
      },
      profile,
      room,
    })).toMatchObject({ ok: false, code: 'REGION_SCOPE_DENIED' });
  });

  it('checks declared type, decoded dimensions, landscape ratio, and byte ceiling', () => {
    const png = Buffer.alloc(24);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(png, 0);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(1600, 16);
    png.writeUInt32BE(900, 20);
    expect(readImageDimensions(png, 'image/png')).toEqual({ width: 1600, height: 900 });
    expect(validateRoomImageObject({
      buffer: png,
      contentType: 'image/png',
      decodedFormat: 'png',
      decodedHeight: 900,
      decodedWidth: 1600,
      size: png.length,
      uploaderUid: 'owner-1',
    })).toMatchObject({ ok: true, value: { height: 900, width: 1600 } });
    expect(validateRoomImageObject({
      buffer: png,
      contentType: 'image/jpeg',
      decodedFormat: 'png',
      decodedHeight: 900,
      decodedWidth: 1600,
      size: png.length,
      uploaderUid: 'owner-1',
    })).toMatchObject({ ok: false, code: 'ROOM_IMAGE_INVALID' });
    expect(validateRoomImageObject({
      buffer: png,
      contentType: 'image/png',
      decodedFormat: 'png',
      decodedHeight: 100,
      decodedWidth: 100,
      size: png.length,
      uploaderUid: 'owner-1',
    })).toMatchObject({ ok: false, code: 'ROOM_IMAGE_INVALID' });
  });
});
