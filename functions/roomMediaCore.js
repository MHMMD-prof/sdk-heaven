const {
  isActiveMembership,
  isCompleteProfile,
  resolveMemberAuthority,
  resolveStaffRoomAuthority,
  roomCommandError,
} = require('./roomCommandCore');

const ROOM_MEDIA_ACTIONS = Object.freeze([
  'submit-room-image',
  'approve-room-image',
  'reject-room-image',
  'remove-room-image',
  'restore-room-customization',
]);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const FIRESTORE_ID_PATTERN = /^[^/]{1,128}$/;
const MEDIA_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,79}$/;
const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_ROOM_IMAGE_BYTES = 4 * 1024 * 1024;
const MIN_ROOM_IMAGE_WIDTH = 800;
const MIN_ROOM_IMAGE_HEIGHT = 450;
const MAX_ROOM_IMAGE_DIMENSION = 4096;

function normalizeRoomMediaCommandBody(body = {}) {
  return {
    action: typeof body.action === 'string' ? body.action.trim() : '',
    expectedRevision: Number.isInteger(body.expectedRevision) && body.expectedRevision >= 1
      ? body.expectedRevision
      : null,
    mediaId: typeof body.mediaId === 'string' ? body.mediaId.trim() : '',
    mediaPath: typeof body.mediaPath === 'string' ? body.mediaPath.trim() : '',
    reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 240) : '',
    requestId: typeof body.requestId === 'string' ? body.requestId.trim() : '',
    roomId: typeof body.roomId === 'string' ? body.roomId.trim() : '',
    suspendCustomization: body.suspendCustomization !== false,
  };
}

function resolveRoomMediaCommand({
  actorMembership,
  body,
  decodedToken,
  featureFlags,
  operatorProfile,
  profile,
  room,
}) {
  const command = normalizeRoomMediaCommandBody(body);
  if (
    !ROOM_MEDIA_ACTIONS.includes(command.action)
    || !FIRESTORE_ID_PATTERN.test(command.roomId)
    || !REQUEST_ID_PATTERN.test(command.requestId)
    || (command.action !== 'restore-room-customization' && !MEDIA_ID_PATTERN.test(command.mediaId))
    || (command.action === 'submit-room-image' && command.mediaPath !== roomMediaPath(command.roomId, command.mediaId))
  ) {
    return roomCommandError('INVALID_REQUEST', 400, 'A valid room media command is required.');
  }
  if (!isCompleteProfile(profile, decodedToken.uid, decodedToken.email)) {
    return roomCommandError('PROFILE_REQUIRED', 403, 'A complete profile is required.');
  }
  if (!room || room.id !== command.roomId) {
    return roomCommandError('ROOM_NOT_FOUND', 404, 'The room was not found.');
  }
  if (
    featureFlags?.voice_room_command_center !== true
    || featureFlags?.voice_room_media !== true
  ) {
    return roomCommandError('FEATURE_DISABLED', 503, 'Room media is not enabled.');
  }
  const revision = positiveInteger(room.revision) ? room.revision : 1;
  if (command.expectedRevision === null) {
    return roomCommandError('REVISION_REQUIRED', 409, 'Refresh the room before performing this action.');
  }
  if (command.expectedRevision !== revision) {
    return roomCommandError('REVISION_CONFLICT', 409, 'The room changed. Refresh it before trying again.', { revision });
  }

  if (command.action === 'submit-room-image') {
    if (
      room.status !== 'active'
      || room.availability !== 'active'
      || !isActiveMembership(actorMembership, decodedToken.uid)
      || resolveMemberAuthority(actorMembership, decodedToken.uid, room) !== 'owner'
    ) {
      return roomCommandError('FORBIDDEN', 403, 'Only the active room owner can submit room media.');
    }
    if (room.roomCustomizationSuspended === true) {
      return roomCommandError('ROOM_CUSTOMIZATION_SUSPENDED', 403, 'Room customization is suspended.');
    }
    return {
      ok: true,
      value: {
        ...command,
        actorAuthority: 'owner',
        currentRevision: revision,
        nextRevision: revision + 1,
      },
    };
  }

  const staff = resolveStaffRoomAuthority({ decodedToken, operatorProfile, room });
  if (staff.denied) return roomCommandError('REGION_SCOPE_DENIED', 403, staff.error);
  if (staff.authority !== 'super-moderator' && staff.authority !== 'platform-owner') {
    return roomCommandError('FORBIDDEN', 403, 'Platform operations authority is required.');
  }
  if (
    ['reject-room-image', 'remove-room-image'].includes(command.action)
    && command.reason.length < 4
  ) {
    return roomCommandError('REASON_REQUIRED', 400, 'A moderation reason is required.');
  }
  return {
    ok: true,
    value: {
      ...command,
      actorAuthority: staff.authority,
      currentRevision: revision,
      nextRevision: revision + 1,
      regionCode: staff.regionCode || room.countryCode || '',
    },
  };
}

function validateRoomImageObject({
  buffer,
  contentType,
  decodedFormat,
  decodedHeight,
  decodedWidth,
  size,
  uploaderUid,
}) {
  if (
    !Buffer.isBuffer(buffer)
    || !ALLOWED_CONTENT_TYPES.has(contentType)
    || !Number.isInteger(size)
    || size < 1
    || size > MAX_ROOM_IMAGE_BYTES
    || buffer.length !== size
    || typeof uploaderUid !== 'string'
    || !uploaderUid
  ) {
    return roomCommandError('ROOM_IMAGE_INVALID', 400, 'The uploaded room image is invalid.');
  }
  const expectedFormat = contentType === 'image/jpeg' ? 'jpeg' : contentType.split('/')[1];
  const headerDimensions = readImageDimensions(buffer, contentType);
  if (
    !headerDimensions
    || decodedFormat !== expectedFormat
    || headerDimensions.width !== decodedWidth
    || headerDimensions.height !== decodedHeight
  ) {
    return roomCommandError('ROOM_IMAGE_INVALID', 400, 'The image bytes do not match the declared image type.');
  }
  const ratio = decodedWidth / decodedHeight;
  if (
    decodedWidth < MIN_ROOM_IMAGE_WIDTH
    || decodedHeight < MIN_ROOM_IMAGE_HEIGHT
    || decodedWidth > MAX_ROOM_IMAGE_DIMENSION
    || decodedHeight > MAX_ROOM_IMAGE_DIMENSION
    || ratio < 1.5
    || ratio > 2
  ) {
    return roomCommandError(
      'ROOM_IMAGE_DIMENSIONS_INVALID',
      400,
      'Room images must be landscape, at least 800x450, and no larger than 4096 pixels per side.',
    );
  }
  return {
    ok: true,
    value: {
      bytes: size,
      contentType,
      height: decodedHeight,
      uploaderUid,
      width: decodedWidth,
    },
  };
}

function readImageDimensions(buffer, contentType) {
  if (contentType === 'image/png') return readPngDimensions(buffer);
  if (contentType === 'image/jpeg') return readJpegDimensions(buffer);
  if (contentType === 'image/webp') return readWebpDimensions(buffer);
  return null;
}

function readPngDimensions(buffer) {
  if (
    buffer.length < 24
    || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || buffer.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return validDimensions(width, height);
}

function readJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) return null;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    if (startOfFrameMarkers.has(marker)) {
      if (length < 7) return null;
      return validDimensions(buffer.readUInt16BE(offset + 5), buffer.readUInt16BE(offset + 3));
    }
    offset += length;
  }
  return null;
}

function readWebpDimensions(buffer) {
  if (
    buffer.length < 30
    || buffer.subarray(0, 4).toString('ascii') !== 'RIFF'
    || buffer.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) return null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + chunkSize > buffer.length) return null;
    if (type === 'VP8X' && chunkSize >= 10) {
      return validDimensions(
        1 + buffer.readUIntLE(dataOffset + 4, 3),
        1 + buffer.readUIntLE(dataOffset + 7, 3),
      );
    }
    if (
      type === 'VP8 '
      && chunkSize >= 10
      && buffer[dataOffset + 3] === 0x9d
      && buffer[dataOffset + 4] === 0x01
      && buffer[dataOffset + 5] === 0x2a
    ) {
      return validDimensions(
        buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
      );
    }
    if (type === 'VP8L' && chunkSize >= 5 && buffer[dataOffset] === 0x2f) {
      const b1 = buffer[dataOffset + 1];
      const b2 = buffer[dataOffset + 2];
      const b3 = buffer[dataOffset + 3];
      const b4 = buffer[dataOffset + 4];
      return validDimensions(
        1 + b1 + ((b2 & 0x3f) << 8),
        1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
      );
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  return null;
}

function roomMediaPath(roomId, mediaId) {
  return `room-media/${roomId}/${mediaId}/source`;
}

function validDimensions(width, height) {
  return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0
    ? { height, width }
    : null;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

module.exports = {
  ALLOWED_CONTENT_TYPES,
  MAX_ROOM_IMAGE_BYTES,
  ROOM_MEDIA_ACTIONS,
  normalizeRoomMediaCommandBody,
  readImageDimensions,
  resolveRoomMediaCommand,
  roomMediaPath,
  validateRoomImageObject,
};
