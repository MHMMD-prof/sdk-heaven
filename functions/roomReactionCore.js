const { createHash } = require('node:crypto');

const ROOM_REACTION_ACTIONS = Object.freeze(['send-room-reaction']);
const ROOM_REACTION_TOPIC = 'sdk-heaven.room-reaction.v1';
const ROOM_REACTION_ENVELOPE_VERSION = 1;
const ROOM_REACTION_TTL_MS = 4_000;
const ROOM_REACTION_RETENTION_MS = 24 * 60 * 60 * 1000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const FIRESTORE_ID_PATTERN = /^[^/]{1,128}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/;
const VERSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,95}$/;
const REACTION_FORMATS = Object.freeze(['png', 'lottie-json', 'legacy-webp']);

function normalizeRoomReactionBody(body = {}) {
  return {
    action: typeof body.action === 'string' ? body.action.trim() : '',
    assetId: typeof body.assetId === 'string' ? body.assetId.trim() : '',
    assetVersionId: typeof body.assetVersionId === 'string' ? body.assetVersionId.trim() : '',
    requestId: typeof body.requestId === 'string' ? body.requestId.trim() : '',
    roomId: typeof body.roomId === 'string' ? body.roomId.trim() : '',
    sessionId: typeof body.sessionId === 'string' ? body.sessionId.trim() : '',
  };
}

function validateRoomReactionRequest(command) {
  if (
    !ROOM_REACTION_ACTIONS.includes(command.action)
    || !ASSET_ID_PATTERN.test(command.assetId)
    || !VERSION_ID_PATTERN.test(command.assetVersionId)
    || !REQUEST_ID_PATTERN.test(command.requestId)
    || !FIRESTORE_ID_PATTERN.test(command.roomId)
    || !SESSION_ID_PATTERN.test(command.sessionId)
  ) {
    return reactionError('INVALID_REQUEST', 400, 'A valid room-reaction command is required.');
  }
  return { ok: true, value: command };
}

function resolveRoomReaction({
  approval,
  assetSummary,
  assetVersion,
  command,
  cosmeticsFlags,
  nowMs,
  publicProfile,
  room,
  senderUid,
}) {
  if (cosmeticsFlags?.room_reactions !== true) {
    return reactionError('FEATURE_DISABLED', 503, 'Room reactions are not enabled.');
  }
  if (
    !Array.isArray(cosmeticsFlags.room_reaction_catalog)
    || !cosmeticsFlags.room_reaction_catalog.some((reference) => (
      reference
      && reference.assetId === command.assetId
      && reference.assetVersionId === command.assetVersionId
    ))
  ) {
    return reactionError('REACTION_NOT_AVAILABLE', 409, 'The reaction is not in the active room catalog.');
  }
  if (!room || room.status !== 'active' || (room.availability !== undefined && room.availability !== 'active')) {
    return reactionError('ROOM_NOT_ACTIVE', 409, 'The room is not available for reactions.');
  }
  if (
    room.effectsPolicy === 'off'
    || room.roomCustomizationSuspended === true
    || (room.staffLockdown && typeof room.staffLockdown === 'object')
  ) {
    return reactionError('ROOM_EFFECTS_DISABLED', 409, 'Room effects are disabled.');
  }
  if (
    !publicProfile
    || publicProfile.uid !== senderUid
    || publicProfile.moderationStatus !== 'active'
  ) {
    return reactionError('ACCOUNT_RESTRICTED', 403, 'An active profile is required.');
  }

  const approvalId = `${command.assetId}__${command.assetVersionId}`;
  if (
    !assetSummary
    || !assetVersion
    || !approval
    || assetSummary.assetId !== command.assetId
    || assetSummary.moderationStatus !== 'approved'
    || assetSummary.publicationStatus !== 'published'
    || assetSummary.renderingEnabled !== true
    || assetSummary.publishedVersionId !== command.assetVersionId
    || assetSummary.approvedVersionId !== command.assetVersionId
    || assetSummary.approvalId !== approvalId
    || assetVersion.assetId !== command.assetId
    || assetVersion.assetVersionId !== command.assetVersionId
    || assetVersion.category !== 'room-reaction'
    || !REACTION_FORMATS.includes(assetVersion.format)
    || typeof assetVersion.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/i.test(assetVersion.sha256)
    || approval.decision !== 'approved'
    || approval.assetId !== command.assetId
    || approval.assetVersionId !== command.assetVersionId
    || approval.checksum !== assetVersion.sha256
  ) {
    return reactionError('REACTION_ASSET_UNAVAILABLE', 409, 'The reaction asset is not approved for playback.');
  }

  const eventId = createRoomReactionEventId(command.roomId, senderUid, command.requestId);
  return {
    ok: true,
    value: {
      envelope: {
        assetId: command.assetId,
        assetVersionId: command.assetVersionId,
        checksum: assetVersion.sha256,
        count: 1,
        createdAtMs: nowMs,
        eventId,
        expiresAtMs: nowMs + ROOM_REACTION_TTL_MS,
        format: assetVersion.format,
        roomId: command.roomId,
        senderUid,
        type: 'room-reaction',
        version: ROOM_REACTION_ENVELOPE_VERSION,
      },
      topic: ROOM_REACTION_TOPIC,
    },
  };
}

function createRoomReactionEventId(roomId, senderUid, requestId) {
  return `rr_${createHash('sha256').update(`${roomId}|${senderUid}|${requestId}`).digest('hex').slice(0, 24)}`;
}

function buildRoomReactionFingerprint(uid, command) {
  return createHash('sha256')
    .update([
      uid,
      command.action,
      command.assetId,
      command.assetVersionId,
      command.roomId,
      command.sessionId,
      command.requestId,
    ].join('|'))
    .digest('hex');
}

function encodeRoomReactionEnvelope(envelope) {
  return Buffer.from(JSON.stringify(envelope), 'utf8');
}

function reactionError(code, status, error, details) {
  return {
    ok: false,
    code,
    status,
    error,
    ...(details ? { details } : {}),
  };
}

module.exports = {
  ROOM_REACTION_ACTIONS,
  ROOM_REACTION_ENVELOPE_VERSION,
  ROOM_REACTION_RETENTION_MS,
  ROOM_REACTION_TOPIC,
  ROOM_REACTION_TTL_MS,
  buildRoomReactionFingerprint,
  createRoomReactionEventId,
  encodeRoomReactionEnvelope,
  normalizeRoomReactionBody,
  reactionError,
  resolveRoomReaction,
  validateRoomReactionRequest,
};
