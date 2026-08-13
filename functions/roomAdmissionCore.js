const { createHash } = require('node:crypto');

const ROOM_ADMISSION_ACTIONS = Object.freeze(['create-room', 'join-room']);
const ROOM_COUNTRY_CODES = new Set([
  'IQ', 'SA', 'SY', 'LB', 'YE', 'DZ', 'EG', 'JO', 'PS', 'AE', 'KW',
  'QA', 'BH', 'OM', 'MA', 'TN', 'LY', 'SD', 'SO', 'DJ', 'MR', 'KM',
]);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const ROOM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const ROOM_SCHEMA_VERSION = 2;
const DEFAULT_ROOM_THEME_ID = 'majlis-default';

function normalizeRoomAdmissionBody(body = {}) {
  const countryCode = typeof body.countryCode === 'string'
    ? body.countryCode.trim().toUpperCase()
    : '';
  const visibility = body.visibility === 'private' ? 'private' : 'public';
  return {
    action: typeof body.action === 'string' ? body.action.trim() : '',
    clientVersion: typeof body.clientVersion === 'string' ? body.clientVersion.trim().slice(0, 40) : '',
    countryCode,
    inviteCode: normalizeInviteCode(body.inviteCode),
    requestId: typeof body.requestId === 'string' ? body.requestId.trim() : '',
    roomId: typeof body.roomId === 'string' ? body.roomId.trim() : '',
    title: typeof body.title === 'string' ? body.title.trim().slice(0, 48) : '',
    type: body.type === 'game' ? 'game' : body.type === 'voice' ? 'voice' : '',
    visibility,
  };
}

function validateRoomAdmissionRequest(body = {}) {
  const command = normalizeRoomAdmissionBody(body);
  if (!ROOM_ADMISSION_ACTIONS.includes(command.action) || !REQUEST_ID_PATTERN.test(command.requestId)) {
    return admissionError('INVALID_REQUEST', 400, 'A valid admission action and request ID are required.');
  }
  if (command.action === 'create-room') {
    if (!command.type || !ROOM_COUNTRY_CODES.has(command.countryCode)) {
      return admissionError('INVALID_REQUEST', 400, 'A valid room type and country are required.');
    }
    if (command.visibility === 'private' && command.inviteCode && !isValidInviteCode(command.inviteCode)) {
      return admissionError('INVITE_INVALID', 400, 'Private room invite codes must contain 6 to 12 letters or numbers.');
    }
  } else if (!ROOM_ID_PATTERN.test(command.roomId)) {
    return admissionError('INVALID_REQUEST', 400, 'A valid room ID is required.');
  }
  return { ok: true, value: command };
}

function resolveCreateRoomAdmission({
  command,
  decodedToken = {},
  featureFlags,
  privateProfile,
  publicProfile,
  restriction,
  nowMs = Date.now(),
}) {
  const profileError = validateAdmissionProfile({ decodedToken, privateProfile, publicProfile });
  if (profileError) return profileError;
  if (featureFlags?.voice_room_new_joins === false) {
    return admissionError('NEW_JOINS_PAUSED', 503, 'Creating rooms is temporarily paused.');
  }
  if (isActiveRestriction(restriction, nowMs)) {
    return admissionError('ACCOUNT_RESTRICTED', 403, 'This account cannot create a voice room while voice access is restricted.');
  }
  return {
    ok: true,
    value: {
      profile: trustedProfile(privateProfile, decodedToken.uid),
      roomInput: {
        countryCode: command.countryCode,
        inviteCode: command.inviteCode,
        title: command.title,
        type: command.type,
        visibility: command.visibility,
      },
    },
  };
}

function resolveJoinRoomAdmission({
  ban,
  command,
  decodedToken = {},
  existingMember,
  featureFlags,
  nowMs = Date.now(),
  presence,
  privateProfile,
  publicProfile,
  room,
}) {
  const profileError = validateAdmissionProfile({ decodedToken, privateProfile, publicProfile });
  if (profileError) return profileError;
  if (!room || room.id !== command.roomId) {
    return admissionError('ROOM_NOT_FOUND', 404, 'Room was not found.');
  }
  if (room.schemaVersion !== undefined && ![1, ROOM_SCHEMA_VERSION].includes(room.schemaVersion)) {
    return admissionError('ROOM_UPGRADE_REQUIRED', 426, 'This room requires a newer app version.');
  }
  if (room.status !== 'active' || (room.availability !== undefined && room.availability !== 'active')) {
    return admissionError('ROOM_NOT_ACTIVE', 409, 'Room is not available.');
  }
  if (room.softMatch === true) {
    return admissionError('ROOM_NOT_AVAILABLE', 403, 'This room cannot be joined directly.');
  }
  if (isActiveBan(ban, nowMs)) {
    return admissionError('ROOM_BANNED', 403, 'This account is banned from the room.');
  }
  const activeExistingMember = isActiveMember(existingMember, decodedToken.uid);
  if (
    featureFlags?.voice_room_new_joins === false
    && !(activeExistingMember && isReconnectablePresence(presence, nowMs))
  ) {
    return admissionError('NEW_JOINS_PAUSED', 503, 'Joining rooms is temporarily paused.');
  }
  if (
    room.visibility === 'private'
    && !activeExistingMember
    && (!room.inviteCode || command.inviteCode !== room.inviteCode)
  ) {
    return admissionError('INVITE_INVALID', 403, 'Private room invite is invalid.');
  }
  const role = activeExistingMember && ['host', 'speaker'].includes(existingMember.role)
    ? existingMember.role
    : 'listener';
  return {
    ok: true,
    value: {
      existingMember: activeExistingMember ? existingMember : undefined,
      member: buildRoomMemberDocument({
        existingMember: activeExistingMember ? existingMember : undefined,
        inviteCode: command.inviteCode,
        profile: trustedProfile(privateProfile, decodedToken.uid),
        role,
      }),
    },
  };
}

function buildRoomDocument({ id, input, profile }) {
  const title = input.title || (input.type === 'game' ? 'Game Room' : 'Voice Room');
  const room = {
    announcement: '',
    audioLockdown: false,
    availability: 'active',
    chatMode: 'everyone',
    countryCode: input.countryCode,
    effectsPolicy: 'full',
    historyVisibility: 'after-join',
    hostAvatarLabel: profile.avatarLabel,
    hostDisplayName: profile.displayName,
    hostId: profile.uid,
    id,
    keywordFilterMode: 'standard',
    moderatorCount: 0,
    ownerAvatarLabel: profile.avatarLabel,
    ownerDisplayName: profile.displayName,
    ownerUid: profile.uid,
    ownershipRevision: 1,
    participantCount: 1,
    revision: 1,
    roomCustomizationSuspended: false,
    roomImageReviewStatus: 'none',
    schemaVersion: ROOM_SCHEMA_VERSION,
    seatMode: 'open',
    seatTargetCount: 10,
    slowModeSeconds: 0,
    speakerCount: 0,
    status: 'active',
    themeId: DEFAULT_ROOM_THEME_ID,
    title: title.slice(0, 48),
    type: input.type,
    visibility: input.visibility,
    welcomeMessage: '',
  };
  if (input.visibility === 'private') {
    room.inviteCode = isValidInviteCode(input.inviteCode)
      ? input.inviteCode
      : createDefaultInviteCode(id);
  }
  if (input.type === 'game') room.currentGameId = 'carrom-royal';
  return room;
}

function buildRoomMemberDocument({ existingMember, inviteCode, profile, role }) {
  const member = {
    authorityRole: role === 'host' ? 'owner' : 'member',
    avatarLabel: profile.avatarLabel,
    canPublishAudio: role === 'host' || role === 'speaker',
    displayName: profile.displayName,
    privileges: { canManageMusic: false },
    role,
    schemaVersion: ROOM_SCHEMA_VERSION,
    seatId: null,
    status: 'active',
    uid: profile.uid,
  };
  if (existingMember) {
    member.authorityRole = existingMember.authorityRole === 'moderator'
      ? 'moderator'
      : existingMember.authorityRole === 'owner' || existingMember.role === 'host'
        ? 'owner'
        : 'member';
    member.canPublishAudio = existingMember.canPublishAudio === true;
    member.privileges = {
      canManageMusic: existingMember.privileges?.canManageMusic === true,
    };
    member.role = ['host', 'speaker', 'listener'].includes(existingMember.role)
      ? existingMember.role
      : role;
    member.seatId = typeof existingMember.seatId === 'string' ? existingMember.seatId : null;
  }
  if (role === 'listener' && isValidInviteCode(inviteCode)) member.inviteCodeUsed = inviteCode;
  return member;
}

function buildVacantRoomSeatDocument(seatNumber) {
  if (!Number.isInteger(seatNumber) || seatNumber < 1 || seatNumber > 20) {
    throw new RangeError('Seat number must be between 1 and 20.');
  }
  return { revision: 1, schemaVersion: ROOM_SCHEMA_VERSION, seatNumber, state: 'open' };
}

function buildAdmissionFingerprint(uid, command) {
  return createHash('sha256').update([
    uid,
    command.action,
    command.roomId,
    command.type,
    command.countryCode,
    command.title,
    command.visibility,
    command.inviteCode,
  ].join('|')).digest('hex');
}

function validateAdmissionProfile({ decodedToken, privateProfile, publicProfile }) {
  if (
    !privateProfile
    || privateProfile.uid !== decodedToken.uid
    || privateProfile.email !== decodedToken.email
    || typeof privateProfile.displayName !== 'string'
    || privateProfile.displayName.trim().length < 2
    || privateProfile.displayName.trim().length > 32
    || typeof privateProfile.avatarLabel !== 'string'
    || [...privateProfile.avatarLabel.trim()].length !== 1
  ) {
    return admissionError('PROFILE_REQUIRED', 403, 'A complete signed-in profile is required.');
  }
  if (!publicProfile || publicProfile.moderationStatus !== 'active') {
    return admissionError('ACCOUNT_RESTRICTED', 403, 'This account is not allowed to join voice rooms.');
  }
  return null;
}

function trustedProfile(profile, uid) {
  return {
    avatarLabel: profile.avatarLabel.trim(),
    displayName: profile.displayName.trim(),
    uid,
  };
}

function normalizeInviteCode(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
    : '';
}

function isValidInviteCode(value) {
  return /^[A-Z0-9]{6,12}$/.test(value || '');
}

function createDefaultInviteCode(roomId) {
  return normalizeInviteCode(roomId).padEnd(6, 'X').slice(0, 8);
}

function isActiveMember(member, uid) {
  return Boolean(member && member.uid === uid && member.status !== 'removed');
}

function isReconnectablePresence(presence, nowMs) {
  const leaseExpiresAtMs = timestampToMillis(presence?.leaseExpiresAt);
  return Boolean(
    presence
    && ['online', 'reconnecting'].includes(presence.status)
    && leaseExpiresAtMs !== undefined
    && leaseExpiresAtMs >= nowMs,
  );
}

function isActiveBan(ban, nowMs) {
  if (!ban || ban.status !== 'active') return false;
  const expiresAtMs = timestampToMillis(ban.expiresAt);
  return expiresAtMs === undefined || expiresAtMs > nowMs;
}

function isActiveRestriction(restriction, nowMs) {
  const mutedUntilMs = timestampToMillis(restriction?.mutedUntil);
  return mutedUntilMs !== undefined && mutedUntilMs > nowMs;
}

function timestampToMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.seconds === 'number') return value.seconds * 1000;
  return undefined;
}

function admissionError(code, status, error, details) {
  return { code, error, ok: false, status, ...(details ? { details } : {}) };
}

module.exports = {
  ROOM_ADMISSION_ACTIONS,
  buildAdmissionFingerprint,
  buildRoomDocument,
  buildRoomMemberDocument,
  buildVacantRoomSeatDocument,
  createDefaultInviteCode,
  isActiveBan,
  isActiveMember,
  isActiveRestriction,
  isReconnectablePresence,
  isValidInviteCode,
  normalizeInviteCode,
  normalizeRoomAdmissionBody,
  resolveCreateRoomAdmission,
  resolveJoinRoomAdmission,
  timestampToMillis,
  validateRoomAdmissionRequest,
};
