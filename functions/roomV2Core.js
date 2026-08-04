const ROOM_SCHEMA_VERSION = 2;
const ROOM_SEAT_COUNTS = new Set([5, 10, 15, 20]);
const ROOM_SEAT_MODES = new Set(['open', 'request', 'invite', 'locked']);

function analyzeRoomV2Document(data, roomId) {
  if (!isObject(data)) return invalid('room-not-object');
  if (data.schemaVersion !== undefined && data.schemaVersion !== 1 && data.schemaVersion !== ROOM_SCHEMA_VERSION) {
    return invalid('unsupported-schema');
  }
  if (
    !nonEmpty(roomId) ||
    !nonEmpty(data.title) ||
    !['voice', 'game'].includes(data.type) ||
    !nonEmpty(data.hostId) ||
    !nonEmpty(data.hostDisplayName) ||
    !nonEmpty(data.hostAvatarLabel) ||
    !['active', 'closed'].includes(data.status) ||
    !Number.isInteger(data.participantCount) ||
    data.participantCount < 0
  ) {
    return invalid('malformed-room');
  }

  const ownerUid = data.schemaVersion === ROOM_SCHEMA_VERSION ? data.ownerUid : data.hostId;
  const ownerDisplayName = data.schemaVersion === ROOM_SCHEMA_VERSION ? data.ownerDisplayName : data.hostDisplayName;
  const ownerAvatarLabel = data.schemaVersion === ROOM_SCHEMA_VERSION ? data.ownerAvatarLabel : data.hostAvatarLabel;
  if (!nonEmpty(ownerUid) || !nonEmpty(ownerDisplayName) || !nonEmpty(ownerAvatarLabel)) {
    return invalid('malformed-owner');
  }

  const patch = {
    schemaVersion: ROOM_SCHEMA_VERSION,
    ownerUid,
    ownerDisplayName,
    ownerAvatarLabel,
    hostId: ownerUid,
    hostDisplayName: ownerDisplayName,
    hostAvatarLabel: ownerAvatarLabel,
    revision: positiveInteger(data.revision) ? data.revision : 1,
    ownershipRevision: positiveInteger(data.ownershipRevision) ? data.ownershipRevision : 1,
    moderatorCount: Number.isInteger(data.moderatorCount) && data.moderatorCount >= 0 && data.moderatorCount <= 20
      ? data.moderatorCount
      : 0,
    audioLockdown: data.audioLockdown === true,
    availability: ['active', 'suspended', 'removed'].includes(data.availability) ? data.availability : 'active',
    seatTargetCount: ROOM_SEAT_COUNTS.has(data.seatTargetCount) ? data.seatTargetCount : 10,
    seatMode: ROOM_SEAT_MODES.has(data.seatMode) ? data.seatMode : 'open',
    speakerCount: Number.isInteger(data.speakerCount) && data.speakerCount >= 0 ? data.speakerCount : 0,
    announcement: typeof data.announcement === 'string' && data.announcement.length <= 160 ? data.announcement : '',
    welcomeMessage: typeof data.welcomeMessage === 'string' && data.welcomeMessage.length <= 200 ? data.welcomeMessage : '',
    themeId: normalizeRoomThemeId(data.themeId),
    chatMode: ['everyone', 'followers', 'off'].includes(data.chatMode) ? data.chatMode : 'everyone',
    slowModeSeconds: [0, 5, 10, 30, 60].includes(data.slowModeSeconds) ? data.slowModeSeconds : 0,
    historyVisibility: ['everyone', 'after-join', 'hidden'].includes(data.historyVisibility)
      ? data.historyVisibility
      : 'after-join',
    keywordFilterMode: ['off', 'standard', 'strict'].includes(data.keywordFilterMode)
      ? data.keywordFilterMode
      : 'standard',
    effectsPolicy: ['full', 'reduced', 'off'].includes(data.effectsPolicy) ? data.effectsPolicy : 'full',
    roomImageReviewStatus: ['none', 'pending', 'approved', 'rejected', 'removed'].includes(data.roomImageReviewStatus)
      ? data.roomImageReviewStatus
      : 'none',
    roomCustomizationSuspended: data.roomCustomizationSuspended === true,
  };
  const ready = Object.entries(patch).every(([key, value]) => deepEqual(data[key], value));

  return { ok: true, status: ready ? 'ready' : 'migrate', ownerUid, patch };
}

function normalizeRoomThemeId(value) {
  if (value === 'royal') return 'royal-theater';
  if (['midnight', 'ocean', 'emerald'].includes(value)) return 'majlis-default';
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{2,63}$/.test(value)
    ? value
    : 'majlis-default';
}

function analyzeRoomMemberV2Document(data, uid, ownerUid) {
  if (!isObject(data) || !nonEmpty(uid) || !nonEmpty(ownerUid)) return invalid('member-not-object');
  if (
    data.uid !== uid ||
    !nonEmpty(data.displayName) ||
    !nonEmpty(data.avatarLabel) ||
    !['host', 'speaker', 'listener'].includes(data.role) ||
    !['active', 'removed'].includes(data.status) ||
    typeof data.canPublishAudio !== 'boolean'
  ) {
    return invalid('malformed-member');
  }
  if (data.schemaVersion !== undefined && data.schemaVersion !== 1 && data.schemaVersion !== ROOM_SCHEMA_VERSION) {
    return invalid('unsupported-member-schema');
  }

  const patch = {
    schemaVersion: ROOM_SCHEMA_VERSION,
    authorityRole: uid === ownerUid ? 'owner' : data.authorityRole === 'moderator' ? 'moderator' : 'member',
    seatId: typeof data.seatId === 'string' && data.seatId ? data.seatId : null,
    privileges: {
      canManageMusic: data.privileges?.canManageMusic === true,
    },
  };
  const ready = Object.entries(patch).every(([key, value]) => deepEqual(data[key], value));

  return { ok: true, status: ready ? 'ready' : 'migrate', patch };
}

function buildVacantRoomSeatV2Document(seatNumber) {
  if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > 20) {
    throw new RangeError('Seat number must be between 1 and 20.');
  }
  return {
    schemaVersion: ROOM_SCHEMA_VERSION,
    seatNumber,
    state: 'open',
    revision: 1,
  };
}

function analyzeRoomSeatV2Document(data, seatNumber) {
  if (!isObject(data)) return invalid('seat-not-object');
  if (
    data.schemaVersion !== ROOM_SCHEMA_VERSION ||
    data.seatNumber !== seatNumber ||
    !['open', 'locked', 'occupied', 'reconnecting', 'retiring'].includes(data.state) ||
    !positiveInteger(data.revision)
  ) {
    return invalid('malformed-seat');
  }
  const occupied = ['occupied', 'reconnecting', 'retiring'].includes(data.state);
  if (occupied !== nonEmpty(data.occupantUid)) return invalid('malformed-seat-occupant');
  return { ok: true, status: 'ready' };
}

function invalid(code) {
  return { ok: false, code };
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

module.exports = {
  ROOM_SCHEMA_VERSION,
  analyzeRoomMemberV2Document,
  analyzeRoomSeatV2Document,
  analyzeRoomV2Document,
  buildVacantRoomSeatV2Document,
};
