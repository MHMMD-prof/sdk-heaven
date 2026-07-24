const ROOM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

function extractBearerToken(headers = {}) {
  const headerValue = headers.authorization || headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(String(headerValue).trim());
  return match?.[1]?.trim() || '';
}

function isValidRoomId(roomId) {
  return typeof roomId === 'string' && ROOM_ID_PATTERN.test(roomId.trim());
}

function isCompleteProfile(profile, uid, email) {
  return (
    profile &&
    profile.uid === uid &&
    profile.email === email &&
    typeof profile.displayName === 'string' &&
    profile.displayName.trim().length >= 2 &&
    profile.displayName.trim().length <= 32 &&
    typeof profile.avatarLabel === 'string' &&
    [...profile.avatarLabel.trim()].length === 1
  );
}

function isActiveRoom(room, roomId) {
  return (
    room &&
    room.id === roomId &&
    room.status === 'active' &&
    (room.availability === undefined || room.availability === 'active') &&
    typeof (room.ownerUid || room.hostId) === 'string' &&
    typeof room.title === 'string'
  );
}

function isCompleteMembership(membership, uid) {
  return (
    membership &&
    membership.uid === uid &&
    typeof membership.displayName === 'string' &&
    membership.displayName.trim().length >= 2 &&
    membership.displayName.trim().length <= 32 &&
    typeof membership.avatarLabel === 'string' &&
    [...membership.avatarLabel.trim()].length === 1 &&
    ['host', 'speaker', 'listener'].includes(membership.role) &&
    membership.status !== 'removed' &&
    typeof membership.canPublishAudio === 'boolean'
  );
}

function resolveTokenRequest({ ban, body = {}, decodedToken, membership, profile, room, seat }) {
  const roomId = typeof body.roomId === 'string' ? body.roomId.trim() : '';
  if (!isValidRoomId(roomId)) return tokenError(400, 'roomId is required.');
  if (!isCompleteProfile(profile, decodedToken.uid, decodedToken.email)) {
    return tokenError(403, 'A complete profile is required.');
  }
  if (!isActiveRoom(room, roomId) || !isCompleteMembership(membership, decodedToken.uid)) {
    return tokenError(403, 'Room membership is required.');
  }
  if (isActiveBan(ban)) return tokenError(403, 'Room access is banned.');

  const seatCanPublish = resolveSeatCanPublish(membership, seat, room);
  const forceMuted = membership.forceMuted === true;
  const audioLockdown = room.audioLockdown === true;
  const canPublish = seatCanPublish && !forceMuted && !audioLockdown;

  return {
    ok: true,
    value: {
      authorityRole: resolveAuthorityRole(membership, decodedToken.uid, room),
      avatarLabel: membership.avatarLabel.trim(),
      canPublish,
      displayName: membership.displayName.trim(),
      participantId: decodedToken.uid,
      role: membership.role,
      roomId,
      seatId: typeof membership.seatId === 'string' ? membership.seatId : '',
    },
  };
}

function resolveSeatCanPublish(membership, seat, room = {}) {
  if (typeof membership.seatId === 'string' && membership.seatId) {
    return Boolean(
      seat &&
      String(seat.seatNumber).padStart(2, '0') === membership.seatId &&
      seat.occupantUid === membership.uid &&
      ['occupied', 'reconnecting', 'retiring'].includes(seat.state),
    );
  }
  if (room.seatEngineVersion === 1) return false;
  // Compatibility bridge for rooms that have not activated the Wave 3 seat engine.
  return membership.role !== 'listener' && membership.canPublishAudio === true;
}

function resolveAuthorityRole(membership, uid, room) {
  if (uid === (room.ownerUid || room.hostId)) return 'owner';
  return membership.authorityRole === 'moderator' ? 'moderator' : 'member';
}

function isActiveBan(ban) {
  if (!ban || ban.status !== 'active') return false;
  const expiresAt = timestampToMillis(ban.expiresAt);
  return expiresAt === undefined || expiresAt > Date.now();
}

function timestampToMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.seconds === 'number') return value.seconds * 1000;
  return undefined;
}

function tokenError(status, error) {
  return { ok: false, status, error };
}

module.exports = {
  extractBearerToken,
  isActiveBan,
  isActiveRoom,
  isCompleteMembership,
  isCompleteProfile,
  isValidRoomId,
  resolveSeatCanPublish,
  resolveTokenRequest,
};
