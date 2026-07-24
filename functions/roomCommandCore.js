const ROOM_COMMAND_ACTIONS = Object.freeze([
  'promote-speaker',
  'demote-listener',
  'mute-member',
  'unmute-member',
  'remove-member',
  'ban-member',
  'unban-member',
  'assign-moderator',
  'remove-moderator',
  'grant-dj',
  'revoke-dj',
  'transfer-ownership',
  'lock-audio',
  'unlock-audio',
  'close-room',
  'remove-room',
  'update-room-settings',
  'report-member',
]);

const ROOM_COUNTRY_CODES = Object.freeze([
  'IQ', 'SA', 'SY', 'LB', 'YE', 'DZ', 'EG', 'JO', 'PS', 'AE', 'KW',
  'QA', 'BH', 'OM', 'MA', 'TN', 'LY', 'SD', 'SO', 'DJ', 'MR', 'KM',
]);

const TARGET_ACTIONS = new Set([
  'promote-speaker', 'demote-listener', 'mute-member', 'unmute-member',
  'remove-member', 'ban-member', 'assign-moderator', 'remove-moderator',
  'grant-dj', 'revoke-dj', 'transfer-ownership', 'report-member',
]);
const BAN_TARGET_ACTIONS = new Set(['unban-member']);

const ROLE_ACTIONS = new Set(['assign-moderator', 'remove-moderator', 'transfer-ownership']);
const NON_MUTATING_ACTIONS = new Set(['report-member']);
const COMMAND_CENTER_ACTIONS = new Set(['remove-room', 'unban-member', 'update-room-settings']);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const FIRESTORE_ID_PATTERN = /^[^/]{1,128}$/;
const ROOM_SETTING_KEYS = new Set([
  'announcement',
  'chatMode',
  'effectsPolicy',
  'historyVisibility',
  'keywordFilterMode',
  'slowModeSeconds',
  'themeId',
  'welcomeMessage',
]);
const ROOM_CHAT_MODES = new Set(['everyone', 'followers', 'off']);
const ROOM_EFFECTS_POLICIES = new Set(['full', 'reduced', 'off']);
const ROOM_HISTORY_VISIBILITIES = new Set(['everyone', 'after-join', 'hidden']);
const ROOM_KEYWORD_FILTER_MODES = new Set(['off', 'standard', 'strict']);
const ROOM_SLOW_MODE_SECONDS = new Set([0, 5, 10, 30, 60]);
const ROOM_THEME_IDS = new Set(['midnight', 'royal', 'ocean', 'emerald']);

const AUTHORITY_ACTIONS = Object.freeze({
  member: new Set(['report-member']),
  moderator: new Set([
    'promote-speaker', 'demote-listener', 'mute-member', 'unmute-member',
    'remove-member', 'ban-member', 'unban-member', 'grant-dj', 'revoke-dj', 'report-member',
  ]),
  owner: new Set([
    'promote-speaker', 'demote-listener', 'mute-member', 'unmute-member',
    'remove-member', 'ban-member', 'unban-member', 'assign-moderator', 'remove-moderator',
    'grant-dj', 'revoke-dj', 'transfer-ownership', 'lock-audio', 'unlock-audio',
    'close-room', 'remove-room', 'update-room-settings', 'report-member',
  ]),
  'super-moderator': new Set([
    'promote-speaker', 'demote-listener', 'mute-member', 'unmute-member',
    'remove-member', 'ban-member', 'unban-member', 'lock-audio', 'unlock-audio', 'close-room', 'remove-room',
    'report-member',
  ]),
  'platform-owner': new Set(ROOM_COMMAND_ACTIONS),
});

function normalizeRoomCommandBody(body = {}) {
  return {
    action: typeof body.action === 'string' ? body.action.trim() : '',
    expectedRevision: Number.isInteger(body.expectedRevision) && body.expectedRevision >= 1
      ? body.expectedRevision
      : null,
    reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 240) : '',
    requestId: typeof body.requestId === 'string' ? body.requestId.trim() : '',
    roomId: typeof body.roomId === 'string' ? body.roomId.trim() : '',
    settings: normalizeRoomSettingsPatch(body.settings),
    targetUid: typeof body.targetUid === 'string' ? body.targetUid.trim() : '',
  };
}

function normalizeRoomSettingsPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, value: {} };
  }
  const keys = Object.keys(value);
  if (!keys.length || keys.some((key) => !ROOM_SETTING_KEYS.has(key))) {
    return { ok: false, value: {} };
  }

  const normalized = {};
  for (const key of keys) {
    const input = value[key];
    if (key === 'announcement' || key === 'welcomeMessage') {
      if (typeof input !== 'string') return { ok: false, value: {} };
      const limit = key === 'announcement' ? 160 : 200;
      const text = input.trim();
      if (text.length > limit) return { ok: false, value: {} };
      normalized[key] = text;
    } else if (key === 'chatMode') {
      if (!ROOM_CHAT_MODES.has(input)) return { ok: false, value: {} };
      normalized[key] = input;
    } else if (key === 'effectsPolicy') {
      if (!ROOM_EFFECTS_POLICIES.has(input)) return { ok: false, value: {} };
      normalized[key] = input;
    } else if (key === 'historyVisibility') {
      if (!ROOM_HISTORY_VISIBILITIES.has(input)) return { ok: false, value: {} };
      normalized[key] = input;
    } else if (key === 'keywordFilterMode') {
      if (!ROOM_KEYWORD_FILTER_MODES.has(input)) return { ok: false, value: {} };
      normalized[key] = input;
    } else if (key === 'slowModeSeconds') {
      if (!ROOM_SLOW_MODE_SECONDS.has(input)) return { ok: false, value: {} };
      normalized[key] = input;
    } else if (key === 'themeId') {
      if (!ROOM_THEME_IDS.has(input)) return { ok: false, value: {} };
      normalized[key] = input;
    }
  }
  return { ok: true, value: normalized };
}

function isValidRoomCommandAction(action) {
  return ROOM_COMMAND_ACTIONS.includes(action);
}

function isValidRoomCommandRequestId(requestId) {
  return REQUEST_ID_PATTERN.test(requestId);
}

function isActiveMembership(membership, uid) {
  return Boolean(membership && membership.uid === uid && membership.status !== 'removed');
}

function isActiveHostMembership(membership, uid, room = {}) {
  return isActiveMembership(membership, uid)
    && resolveMemberAuthority(membership, uid, room) === 'owner';
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

function resolveMemberAuthority(membership, uid, room = {}) {
  const ownerUid = room.ownerUid || room.hostId || '';
  if (uid && uid === ownerUid) return 'owner';
  if (membership?.authorityRole === 'moderator') return 'moderator';
  return 'member';
}

function resolveStaffRoomAuthority({ decodedToken = {}, operatorProfile, room }) {
  if (decodedToken.admin !== true) return { authority: null };
  if (decodedToken.adminRole === 'owner' || !decodedToken.adminRole) {
    return { authority: 'platform-owner' };
  }
  if (decodedToken.adminRole !== 'super-moderator') return { authority: null };

  if (!ROOM_COUNTRY_CODES.includes(room?.countryCode)) {
    return deniedScope('Room region is missing or unsupported.');
  }
  if (
    !operatorProfile ||
    operatorProfile.uid !== decodedToken.uid ||
    operatorProfile.role !== 'super-moderator' ||
    operatorProfile.status !== 'active' ||
    !Array.isArray(operatorProfile.regionCodes) ||
    !operatorProfile.regionCodes.includes(room.countryCode)
  ) {
    return deniedScope('This room is outside the operator region scope.');
  }
  return { authority: 'super-moderator', regionCode: room.countryCode };
}

function resolveRoomCommand({
  actorMembership,
  body = {},
  decodedToken = {},
  featureFlags,
  operatorProfile,
  profile,
  room,
  targetBan,
  targetMembership,
}) {
  const command = normalizeRoomCommandBody(body);

  if (
    !FIRESTORE_ID_PATTERN.test(command.roomId) ||
    (command.targetUid && !FIRESTORE_ID_PATTERN.test(command.targetUid)) ||
    !isValidRoomCommandAction(command.action) ||
    !isValidRoomCommandRequestId(command.requestId)
  ) {
    return roomCommandError('INVALID_REQUEST', 400, 'A valid room command, room ID, and request ID are required.');
  }
  if (!isCompleteProfile(profile, decodedToken.uid, decodedToken.email)) {
    return roomCommandError('PROFILE_REQUIRED', 403, 'A complete profile is required.');
  }
  if (
    !room ||
    room.id !== command.roomId ||
    room.status !== 'active' ||
    (room.availability !== undefined && room.availability !== 'active')
  ) {
    return roomCommandError('ROOM_NOT_ACTIVE', 409, 'The room is not active.');
  }

  const staff = resolveStaffRoomAuthority({ decodedToken, operatorProfile, room });
  if (staff.denied) return roomCommandError('REGION_SCOPE_DENIED', 403, staff.error);

  let authority = staff.authority;
  if (!authority) {
    if (!isActiveMembership(actorMembership, decodedToken.uid)) {
      return roomCommandError('MEMBERSHIP_REQUIRED', 403, 'Active room membership is required.');
    }
    authority = resolveMemberAuthority(actorMembership, decodedToken.uid, room);
  }

  if (!AUTHORITY_ACTIONS[authority]?.has(command.action)) {
    return roomCommandError('FORBIDDEN', 403, 'This room role cannot perform the requested action.');
  }
  if (COMMAND_CENTER_ACTIONS.has(command.action) && featureFlags?.voice_room_command_center !== true) {
    return roomCommandError('FEATURE_DISABLED', 503, 'The room Command Center is not enabled.');
  }
  if (command.action === 'transfer-ownership' && authority !== 'owner') {
    return roomCommandError('FORBIDDEN', 403, 'Only the current room owner can transfer ownership.');
  }
  if (command.action === 'update-room-settings') {
    if (authority !== 'owner' && authority !== 'platform-owner') {
      return roomCommandError('FORBIDDEN', 403, 'Only the room owner can change room settings.');
    }
    if (!command.settings.ok) {
      return roomCommandError('ROOM_SETTINGS_INVALID', 400, 'The room settings patch is invalid.');
    }
  }
  if (command.action === 'remove-room' && command.reason.length < 4) {
    return roomCommandError('REASON_REQUIRED', 400, 'A removal reason is required.');
  }
  if (!NON_MUTATING_ACTIONS.has(command.action)) {
    const revision = positiveInteger(room.revision) ? room.revision : 1;
    if (command.expectedRevision === null) {
      return roomCommandError('REVISION_REQUIRED', 409, 'Refresh the room before performing this action.');
    }
    if (command.expectedRevision !== revision) {
      return roomCommandError('REVISION_CONFLICT', 409, 'The room changed. Refresh it before trying again.', { revision });
    }
  }
  if (ROLE_ACTIONS.has(command.action) && room.schemaVersion !== 2) {
    return roomCommandError('ROOM_MIGRATION_REQUIRED', 409, 'This room must finish its schema migration first.');
  }
  if (command.action === 'promote-speaker' && room.seatEngineVersion === 1) {
    return roomCommandError('SEAT_COMMAND_REQUIRED', 409, 'Use an authoritative microphone seat command in this room.');
  }

  if (TARGET_ACTIONS.has(command.action)) {
    if (!command.targetUid || command.targetUid === decodedToken.uid || !isActiveMembership(targetMembership, command.targetUid)) {
      return roomCommandError('TARGET_INVALID', 400, 'An active target member is required.');
    }
    const targetAuthority = resolveMemberAuthority(targetMembership, command.targetUid, room);
    if (authority === 'moderator' && targetAuthority !== 'member') {
      return roomCommandError('TARGET_PROTECTED', 403, 'Moderators cannot act on the owner or another moderator.');
    }
    if (authority === 'owner' && targetAuthority === 'owner') {
      return roomCommandError('TARGET_PROTECTED', 403, 'The room owner cannot be targeted by this action.');
    }
    if (command.action === 'assign-moderator' && targetAuthority !== 'member') {
      return roomCommandError('TARGET_INVALID', 409, 'Only a regular member can become a moderator.');
    }
    if (command.action === 'assign-moderator' && Number(room.moderatorCount || 0) >= 20) {
      return roomCommandError('MODERATOR_LIMIT_REACHED', 409, 'This room already has the maximum number of moderators.');
    }
    if (command.action === 'remove-moderator' && targetAuthority !== 'moderator') {
      return roomCommandError('TARGET_INVALID', 409, 'The target is not a moderator.');
    }
    if (command.action === 'transfer-ownership' && targetAuthority !== 'member' && targetAuthority !== 'moderator') {
      return roomCommandError('TARGET_INVALID', 409, 'Ownership requires an active non-owner member.');
    }
  }
  if (BAN_TARGET_ACTIONS.has(command.action)) {
    if (!command.targetUid || command.targetUid === decodedToken.uid) {
      return roomCommandError('TARGET_INVALID', 400, 'A banned target member is required.');
    }
    if (!targetBan || targetBan.status !== 'active' || targetBan.targetUid !== command.targetUid) {
      return roomCommandError('ROOM_BAN_NOT_ACTIVE', 409, 'The target does not have an active room ban.');
    }
  }

  const currentRevision = positiveInteger(room.revision) ? room.revision : 1;
  return {
    ok: true,
    value: {
      ...command,
      actorAuthority: authority,
      currentRevision,
      nextRevision: NON_MUTATING_ACTIONS.has(command.action) ? currentRevision : currentRevision + 1,
      regionCode: staff.regionCode || room.countryCode || '',
    },
  };
}

function buildRoomCommandFingerprint(actorUid, command) {
  return [
    actorUid,
    command.roomId,
    command.action,
    command.targetUid,
    command.expectedRevision ?? '',
    command.reason,
    JSON.stringify(command.settings?.value || {}),
  ].join('|');
}

function buildRoomCommandMutationPlan({ actorMembership, command, room, targetMembership }) {
  const roomPatch = NON_MUTATING_ACTIONS.has(command.action)
    ? null
    : { revision: command.nextRevision };
  const plan = {
    actorMemberPatch: null,
    ban: null,
    banPatch: null,
    liveKit: { type: 'none' },
    roomPatch,
    targetMemberDelete: false,
    targetMemberPatch: null,
  };
  const targetUid = command.targetUid;

  if (command.action === 'promote-speaker') {
    plan.targetMemberPatch = { role: 'speaker', status: 'active', canPublishAudio: true, forceMuted: false };
    plan.liveKit = permissionSync(targetUid, room.audioLockdown !== true);
  } else if (command.action === 'demote-listener') {
    plan.targetMemberPatch = { role: 'listener', status: 'active', canPublishAudio: false, seatId: null };
    plan.liveKit = permissionSync(targetUid, false);
  } else if (command.action === 'mute-member') {
    plan.targetMemberPatch = { canPublishAudio: false, forceMuted: true };
    plan.liveKit = permissionSync(targetUid, false);
  } else if (command.action === 'unmute-member') {
    const canPublishAudio = targetMembership?.role === 'host' || targetMembership?.role === 'speaker';
    plan.targetMemberPatch = { canPublishAudio, forceMuted: false };
    plan.liveKit = permissionSync(targetUid, canPublishAudio && room.audioLockdown !== true);
  } else if (command.action === 'remove-member' || command.action === 'ban-member') {
    plan.targetMemberPatch = {
      status: 'removed',
      canPublishAudio: false,
      forceMuted: true,
      seatId: null,
    };
    plan.roomPatch.participantCount = Math.max(0, Number(room.participantCount || 0) - 1);
    plan.liveKit = { type: 'remove-participant', targetUid };
    if (command.action === 'ban-member') plan.ban = { status: 'active', targetUid };
  } else if (command.action === 'assign-moderator') {
    plan.targetMemberPatch = upgradeMemberAuthority(targetMembership, 'moderator');
    plan.roomPatch.moderatorCount = Number(room.moderatorCount || 0) + 1;
  } else if (command.action === 'remove-moderator') {
    plan.targetMemberPatch = upgradeMemberAuthority(targetMembership, 'member');
    plan.roomPatch.moderatorCount = Math.max(0, Number(room.moderatorCount || 0) - 1);
  } else if (command.action === 'grant-dj' || command.action === 'revoke-dj') {
    plan.targetMemberPatch = {
      privileges: {
        canManageMusic: command.action === 'grant-dj',
      },
    };
  } else if (command.action === 'transfer-ownership') {
    const actorKeepsAudio = typeof actorMembership?.seatId === 'string'
      && actorMembership.seatId.length > 0
      && actorMembership.canPublishAudio === true
      && actorMembership.forceMuted !== true
      && room.audioLockdown !== true;
    plan.roomPatch = {
      ...plan.roomPatch,
      ownerUid: targetUid,
      hostId: targetUid,
      ownerDisplayName: targetMembership.displayName,
      hostDisplayName: targetMembership.displayName,
      ownerAvatarLabel: targetMembership.avatarLabel,
      hostAvatarLabel: targetMembership.avatarLabel,
      ownershipRevision: positiveInteger(room.ownershipRevision) ? room.ownershipRevision + 1 : 2,
      ...(targetMembership.authorityRole === 'moderator'
        ? { moderatorCount: Math.max(0, Number(room.moderatorCount || 0) - 1) }
        : {}),
    };
    plan.actorMemberPatch = {
      authorityRole: 'member',
      role: actorKeepsAudio ? 'speaker' : 'listener',
      canPublishAudio: actorKeepsAudio,
    };
    plan.targetMemberPatch = {
      ...upgradeMemberAuthority(targetMembership, 'owner'),
      role: 'host',
      canPublishAudio: targetMembership.canPublishAudio === true,
    };
    plan.liveKit = actorKeepsAudio ? { type: 'none' } : permissionSync(actorMembership.uid, false);
  } else if (command.action === 'lock-audio' || command.action === 'unlock-audio') {
    plan.roomPatch.audioLockdown = command.action === 'lock-audio';
    plan.liveKit = command.action === 'lock-audio' ? { type: 'mute-all' } : { type: 'refresh-all' };
  } else if (command.action === 'close-room') {
    plan.roomPatch.status = 'closed';
    plan.liveKit = { type: 'close-room' };
  } else if (command.action === 'remove-room') {
    plan.roomPatch.status = 'closed';
    plan.roomPatch.availability = 'removed';
    plan.roomPatch.removalReason = command.reason;
    plan.liveKit = { type: 'close-room' };
  } else if (command.action === 'update-room-settings') {
    Object.assign(plan.roomPatch, command.settings.value);
  } else if (command.action === 'unban-member') {
    plan.banPatch = { status: 'revoked', targetUid };
    plan.targetMemberDelete = targetMembership?.status === 'removed';
  }

  return plan;
}

function upgradeMemberAuthority(membership, authorityRole) {
  return {
    schemaVersion: 2,
    authorityRole,
    seatId: typeof membership?.seatId === 'string' ? membership.seatId : null,
    privileges: {
      canManageMusic: membership?.privileges?.canManageMusic === true,
    },
  };
}

function permissionSync(targetUid, canPublish) {
  return { type: 'update-permission', targetUid, canPublish };
}

function roomCommandError(code, status, error, details = undefined) {
  return { ok: false, code, status, error, ...(details ? { details } : {}) };
}

function deniedScope(error) {
  return { authority: null, denied: true, error };
}

function positiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

module.exports = {
  AUTHORITY_ACTIONS,
  ROOM_COMMAND_ACTIONS,
  ROOM_COUNTRY_CODES,
  buildRoomCommandFingerprint,
  buildRoomCommandMutationPlan,
  isActiveHostMembership,
  isActiveMembership,
  isCompleteProfile,
  isValidRoomCommandAction,
  isValidRoomCommandRequestId,
  normalizeRoomCommandBody,
  normalizeRoomSettingsPatch,
  resolveMemberAuthority,
  resolveRoomCommand,
  resolveStaffRoomAuthority,
  roomCommandError,
};
