const ROOM_COMMAND_ACTIONS = [
  'promote-speaker',
  'demote-listener',
  'remove-member',
  'close-room',
  'report-member',
];

function normalizeRoomCommandBody(body = {}) {
  return {
    action: typeof body.action === 'string' ? body.action.trim() : '',
    reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 240) : '',
    roomId: typeof body.roomId === 'string' ? body.roomId.trim() : '',
    targetUid: typeof body.targetUid === 'string' ? body.targetUid.trim() : '',
  };
}

function isValidRoomCommandAction(action) {
  return ROOM_COMMAND_ACTIONS.includes(action);
}

function isActiveHostMembership(membership, uid) {
  return (
    membership &&
    membership.uid === uid &&
    membership.role === 'host' &&
    membership.status !== 'removed'
  );
}

function isActiveMembership(membership, uid) {
  return membership && membership.uid === uid && membership.status !== 'removed';
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

function resolveRoomCommand({ actorMembership, body = {}, decodedToken, profile, room, targetMembership }) {
  const command = normalizeRoomCommandBody(body);

  if (!decodedToken?.email_verified) {
    return { ok: false, status: 403, error: 'Email verification is required.' };
  }

  if (!isCompleteProfile(profile, decodedToken.uid, decodedToken.email)) {
    return { ok: false, status: 403, error: 'A complete profile is required.' };
  }

  if (!room || room.id !== command.roomId || room.status !== 'active') {
    return { ok: false, status: 400, error: 'Active room is required.' };
  }

  if (!isValidRoomCommandAction(command.action)) {
    return { ok: false, status: 400, error: 'Valid room command action is required.' };
  }

  if (!isActiveMembership(actorMembership, decodedToken.uid)) {
    return { ok: false, status: 403, error: 'Room membership is required.' };
  }

  if (command.action === 'report-member') {
    if (!command.targetUid || command.targetUid === decodedToken.uid || !isActiveMembership(targetMembership, command.targetUid)) {
      return { ok: false, status: 400, error: 'Valid target member is required.' };
    }

    return {
      ok: true,
      value: {
        action: command.action,
        reason: command.reason,
        roomId: command.roomId,
        targetUid: command.targetUid,
      },
    };
  }

  if (!isActiveHostMembership(actorMembership, decodedToken.uid)) {
    return { ok: false, status: 403, error: 'Host membership is required.' };
  }

  if (command.action === 'close-room') {
    return {
      ok: true,
      value: {
        action: command.action,
        roomId: command.roomId,
      },
    };
  }

  if (!command.targetUid || command.targetUid === decodedToken.uid || !isActiveMembership(targetMembership, command.targetUid)) {
    return { ok: false, status: 400, error: 'Valid target member is required.' };
  }

  if (targetMembership.role === 'host') {
    return { ok: false, status: 403, error: 'Host membership cannot be changed by this command.' };
  }

  return {
    ok: true,
    value: {
      action: command.action,
      reason: command.reason,
      roomId: command.roomId,
      targetUid: command.targetUid,
    },
  };
}

module.exports = {
  isActiveHostMembership,
  isActiveMembership,
  isCompleteProfile,
  isValidRoomCommandAction,
  normalizeRoomCommandBody,
  resolveRoomCommand,
};
