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
    typeof room.hostId === 'string' &&
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

function resolveTokenRequest({ body = {}, decodedToken, membership, profile, room }) {
  const roomId = typeof body.roomId === 'string' ? body.roomId.trim() : '';

  if (!isValidRoomId(roomId)) {
    return {
      ok: false,
      status: 400,
      error: 'roomId is required.',
    };
  }

  if (!decodedToken.email_verified) {
    return {
      ok: false,
      status: 403,
      error: 'Email verification is required.',
    };
  }

  if (!isCompleteProfile(profile, decodedToken.uid, decodedToken.email)) {
    return {
      ok: false,
      status: 403,
      error: 'A complete profile is required.',
    };
  }

  if (!isActiveRoom(room, roomId)) {
    return {
      ok: false,
      status: 403,
      error: 'Room membership is required.',
    };
  }

  if (!isCompleteMembership(membership, decodedToken.uid)) {
    return {
      ok: false,
      status: 403,
      error: 'Room membership is required.',
    };
  }

  if (membership.role === 'listener' && body.canPublishAudio !== false) {
    return {
      ok: false,
      status: 403,
      error: 'Audio publishing is not allowed for this room membership.',
    };
  }

  const membershipCanPublish = membership.role !== 'listener' && membership.canPublishAudio === true;
  const canPublish = membershipCanPublish && body.canPublishAudio !== false;

  return {
    ok: true,
    value: {
      avatarLabel: membership.avatarLabel.trim(),
      canPublish,
      displayName: membership.displayName.trim(),
      participantId: decodedToken.uid,
      roomId,
      role: membership.role,
    },
  };
}

module.exports = {
  extractBearerToken,
  isActiveRoom,
  isCompleteMembership,
  isCompleteProfile,
  isValidRoomId,
  resolveTokenRequest,
};
