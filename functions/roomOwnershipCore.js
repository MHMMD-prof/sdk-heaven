const { createHash } = require('node:crypto');

const ROOM_OWNERSHIP_ACTIONS = Object.freeze([
  'offer-ownership-transfer',
  'accept-ownership-transfer',
  'decline-ownership-transfer',
  'cancel-ownership-transfer',
]);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const FIRESTORE_ID_PATTERN = /^[^/]{1,128}$/;
const OFFER_TTL_MS = 15 * 60 * 1000;
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_AUTH_MAX_AGE_MS = 10 * 60 * 1000;

function normalizeRoomOwnershipBody(body = {}) {
  return {
    action: typeof body.action === 'string' ? body.action.trim() : '',
    expectedOwnershipRevision:
      Number.isInteger(body.expectedOwnershipRevision) && body.expectedOwnershipRevision >= 1
        ? body.expectedOwnershipRevision
        : null,
    requestId: typeof body.requestId === 'string' ? body.requestId.trim() : '',
    roomId: typeof body.roomId === 'string' ? body.roomId.trim() : '',
    targetUid: typeof body.targetUid === 'string' ? body.targetUid.trim() : '',
    transferId: typeof body.transferId === 'string' ? body.transferId.trim() : '',
  };
}

function validateRoomOwnershipRequest(command) {
  if (
    !ROOM_OWNERSHIP_ACTIONS.includes(command.action)
    || !FIRESTORE_ID_PATTERN.test(command.roomId)
    || !REQUEST_ID_PATTERN.test(command.requestId)
  ) {
    return ownershipError('INVALID_REQUEST', 400, 'A valid ownership command is required.');
  }
  if (command.action === 'offer-ownership-transfer') {
    if (
      !FIRESTORE_ID_PATTERN.test(command.targetUid)
      || command.expectedOwnershipRevision === null
      || command.transferId
    ) {
      return ownershipError('INVALID_REQUEST', 400, 'A target and ownership revision are required.');
    }
  } else if (!FIRESTORE_ID_PATTERN.test(command.transferId) || command.targetUid) {
    return ownershipError('INVALID_REQUEST', 400, 'A valid transfer ID is required.');
  }
  return { ok: true, value: command };
}

function resolveOwnershipOffer({
  actorMembership,
  actorPrivateProfile,
  actorPublicProfile,
  blocksExist,
  command,
  decodedToken,
  featureFlags,
  nowMs,
  room,
  targetMembership,
  targetPrivateProfile,
  targetPublicProfile,
}) {
  const common = resolveCommon({ actorPublicProfile, featureFlags, room });
  if (!common.ok) return common;
  if (!isCompletePrivateProfile(actorPrivateProfile, decodedToken.uid)) {
    return ownershipError('ACCOUNT_RESTRICTED', 403, 'A complete owner profile is required.');
  }
  if (!isRecentAuth(decodedToken, nowMs)) {
    return ownershipError('RECENT_AUTH_REQUIRED', 401, 'Sign in again before transferring room ownership.');
  }
  const ownerUid = room.ownerUid || room.hostId;
  if (decodedToken.uid !== ownerUid || !isActiveMembership(actorMembership, decodedToken.uid)) {
    return ownershipError('OWNER_REQUIRED', 403, 'Only the current room owner can create an ownership offer.');
  }
  if (command.targetUid === decodedToken.uid) {
    return ownershipError('TARGET_INVALID', 400, 'Room ownership cannot be transferred to the current owner.');
  }
  if (command.expectedOwnershipRevision !== positiveInteger(room.ownershipRevision)) {
    return ownershipError('OWNERSHIP_REVISION_CONFLICT', 409, 'Room ownership changed. Refresh and try again.', {
      ownershipRevision: positiveInteger(room.ownershipRevision),
    });
  }
  if (typeof room.pendingOwnershipTransferId === 'string' && room.pendingOwnershipTransferId) {
    return ownershipError('TRANSFER_ALREADY_PENDING', 409, 'This room already has a pending ownership offer.');
  }
  const cooldownUntilMs = timestampToMillis(room.ownershipTransferCooldownUntil);
  if (cooldownUntilMs > nowMs) {
    return ownershipError('OWNERSHIP_COOLDOWN_ACTIVE', 409, 'Room ownership is in its transfer cooldown.', {
      cooldownUntilMs,
    });
  }
  if (
    !isActiveMembership(targetMembership, command.targetUid)
    || !isEligiblePublicProfile(targetPublicProfile, command.targetUid)
    || !isCompletePrivateProfile(targetPrivateProfile, command.targetUid)
  ) {
    return ownershipError('TARGET_NOT_ELIGIBLE', 409, 'The selected member is not eligible to own this room.');
  }
  if (blocksExist) {
    return ownershipError('BLOCK_RESTRICTION', 409, 'Ownership cannot be transferred between blocked accounts.');
  }
  if (
    targetMembership.authorityRole !== 'moderator'
    && Number(room.moderatorCount || 0) >= 20
  ) {
    return ownershipError('MODERATOR_LIMIT_REACHED', 409, 'Remove a moderator before transferring ownership.');
  }
  return {
    ok: true,
    value: {
      expiresAtMs: nowMs + OFFER_TTL_MS,
      fromOwnershipRevision: room.ownershipRevision,
      fromUid: decodedToken.uid,
      toUid: command.targetUid,
      transferId: createOwnershipTransferId(command.requestId),
    },
  };
}

function resolveOwnershipResponse({
  actorMembership,
  actorPrivateProfile,
  actorPublicProfile,
  blocksExist,
  command,
  currentOwnerMembership,
  currentOwnerPublicProfile,
  decodedToken,
  featureFlags,
  nowMs,
  room,
  transfer,
}) {
  const common = resolveCommon({ actorPublicProfile, featureFlags, room });
  if (!common.ok) return common;
  if (!isCompletePrivateProfile(actorPrivateProfile, decodedToken.uid)) {
    return ownershipError('ACCOUNT_RESTRICTED', 403, 'A complete recipient profile is required.');
  }
  if (!transfer || transfer.id !== command.transferId || transfer.roomId !== command.roomId) {
    return ownershipError('TRANSFER_NOT_FOUND', 404, 'The ownership offer was not found.');
  }
  if (transfer.status !== 'pending') {
    return ownershipError('TRANSFER_NOT_PENDING', 409, 'This ownership offer is no longer pending.');
  }
  if (timestampToMillis(transfer.expiresAt) <= nowMs) {
    return ownershipError('TRANSFER_EXPIRED', 409, 'This ownership offer has expired.');
  }
  if (
    room.pendingOwnershipTransferId !== command.transferId
    || (room.ownerUid || room.hostId) !== transfer.fromUid
    || room.ownershipRevision !== transfer.fromOwnershipRevision
  ) {
    return ownershipError('TRANSFER_STALE', 409, 'Room ownership changed after this offer was created.');
  }

  if (command.action === 'cancel-ownership-transfer') {
    if (decodedToken.uid !== transfer.fromUid) {
      return ownershipError('OWNER_REQUIRED', 403, 'Only the offering owner can cancel this transfer.');
    }
    return { ok: true, value: { disposition: 'cancelled' } };
  }
  if (decodedToken.uid !== transfer.toUid || !isActiveMembership(actorMembership, decodedToken.uid)) {
    return ownershipError('RECIPIENT_REQUIRED', 403, 'Only the selected recipient can answer this offer.');
  }
  if (command.action === 'decline-ownership-transfer') {
    return { ok: true, value: { disposition: 'declined' } };
  }
  if (!isRecentAuth(decodedToken, nowMs)) {
    return ownershipError('RECENT_AUTH_REQUIRED', 401, 'Sign in again before accepting room ownership.');
  }
  if (
    !isActiveMembership(currentOwnerMembership, transfer.fromUid)
    || !isEligiblePublicProfile(currentOwnerPublicProfile, transfer.fromUid)
    || blocksExist
  ) {
    return ownershipError('TRANSFER_STALE', 409, 'The owner or recipient is no longer eligible for this transfer.');
  }
  if (
    actorMembership.authorityRole !== 'moderator'
    && Number(room.moderatorCount || 0) >= 20
  ) {
    return ownershipError('MODERATOR_LIMIT_REACHED', 409, 'The room cannot add the former owner as a moderator.');
  }
  return {
    ok: true,
    value: {
      cooldownUntilMs: nowMs + COOLDOWN_MS,
      disposition: 'accepted',
      nextOwnershipRevision: room.ownershipRevision + 1,
      nextRevision: (positiveInteger(room.revision) || 1) + 1,
    },
  };
}

function resolveCommon({ actorPublicProfile, featureFlags, room }) {
  if (featureFlags?.voice_room_ownership_transfer !== true) {
    return ownershipError('FEATURE_DISABLED', 503, 'Room ownership transfer is not enabled.');
  }
  if (
    !room
    || room.schemaVersion !== 2
    || room.status !== 'active'
    || (room.availability !== undefined && room.availability !== 'active')
  ) {
    return ownershipError('ROOM_NOT_ACTIVE', 409, 'The room is not active and eligible for ownership transfer.');
  }
  if (!isEligiblePublicProfile(actorPublicProfile, actorPublicProfile?.uid)) {
    return ownershipError('ACCOUNT_RESTRICTED', 403, 'This account cannot transfer room ownership.');
  }
  return { ok: true };
}

function isRecentAuth(decodedToken, nowMs) {
  const authTimeMs = Number(decodedToken?.auth_time) * 1000;
  return Number.isFinite(authTimeMs)
    && authTimeMs <= nowMs + 30_000
    && nowMs - authTimeMs <= RECENT_AUTH_MAX_AGE_MS;
}

function isActiveMembership(membership, uid) {
  return Boolean(membership && membership.uid === uid && membership.status === 'active');
}

function isCompletePrivateProfile(profile, uid) {
  return Boolean(
    profile
    && profile.uid === uid
    && typeof profile.email === 'string'
    && profile.email.trim()
    && typeof profile.displayName === 'string'
    && profile.displayName.trim().length >= 2
    && profile.displayName.trim().length <= 32
    && typeof profile.avatarLabel === 'string'
    && [...profile.avatarLabel.trim()].length === 1,
  );
}

function isEligiblePublicProfile(profile, uid) {
  return Boolean(
    profile
    && profile.uid === uid
    && profile.moderationStatus === 'active'
    && typeof profile.displayName === 'string'
    && profile.displayName.trim().length >= 2
    && typeof profile.countryCode === 'string'
    && /^[A-Z]{2}$/.test(profile.countryCode),
  );
}

function createOwnershipTransferId(requestId) {
  return `ownership_${createHash('sha256').update(`room-ownership-v1\0${requestId}`).digest('hex').slice(0, 32)}`;
}

function buildOwnershipFingerprint(actorUid, command) {
  return [
    actorUid,
    command.roomId,
    command.action,
    command.targetUid,
    command.transferId,
    command.expectedOwnershipRevision ?? '',
  ].join('|');
}

function timestampToMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  return 0;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value >= 1 ? value : 0;
}

function ownershipError(code, status, error, details = undefined) {
  return { ok: false, code, status, error, ...(details ? { details } : {}) };
}

module.exports = {
  COOLDOWN_MS,
  OFFER_TTL_MS,
  RECENT_AUTH_MAX_AGE_MS,
  ROOM_OWNERSHIP_ACTIONS,
  buildOwnershipFingerprint,
  createOwnershipTransferId,
  isRecentAuth,
  normalizeRoomOwnershipBody,
  ownershipError,
  resolveOwnershipOffer,
  resolveOwnershipResponse,
  timestampToMillis,
  validateRoomOwnershipRequest,
};
