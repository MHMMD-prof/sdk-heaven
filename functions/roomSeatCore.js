const { resolveMemberAuthority, resolveStaffRoomAuthority, roomCommandError } = require('./roomCommandCore');

const ROOM_SEAT_COMMAND_ACTIONS = Object.freeze([
  'claim-seat',
  'leave-seat',
  'request-seat',
  'cancel-seat-request',
  'approve-seat-request',
  'reject-seat-request',
  'invite-to-seat',
  'accept-seat-invite',
  'decline-seat-invite',
  'lock-seat',
  'unlock-seat',
  'set-seat-mode',
  'resize-seats',
  'reserve-seat',
  'resume-seat',
]);

const ROOM_SEAT_MODES = Object.freeze(['open', 'request', 'invite', 'locked']);
const ROOM_SEAT_COUNTS = Object.freeze([5, 10, 15, 20]);
const SELF_ACTIONS = new Set([
  'claim-seat', 'leave-seat', 'request-seat', 'cancel-seat-request',
  'accept-seat-invite', 'decline-seat-invite', 'reserve-seat', 'resume-seat',
]);
const MODERATOR_ACTIONS = new Set([
  'approve-seat-request', 'reject-seat-request', 'invite-to-seat', 'lock-seat', 'unlock-seat',
]);
const OWNER_ACTIONS = new Set(['set-seat-mode', 'resize-seats']);
const SEAT_ID_PATTERN = /^(0[1-9]|1[0-9]|20)$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const FIRESTORE_ID_PATTERN = /^[^/]{1,128}$/;

const ROOM_SEAT_RECONNECT_MS = 45_000;
const ROOM_SEAT_REQUEST_TTL_MS = 90_000;
const ROOM_SEAT_INVITE_TTL_MS = 90_000;

function normalizeRoomSeatCommandBody(body = {}) {
  return {
    action: typeof body.action === 'string' ? body.action.trim() : '',
    expectedRevision: positiveInteger(body.expectedRevision) ? body.expectedRevision : null,
    reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 240) : '',
    requestId: typeof body.requestId === 'string' ? body.requestId.trim() : '',
    roomId: typeof body.roomId === 'string' ? body.roomId.trim() : '',
    seatId: typeof body.seatId === 'string' ? body.seatId.trim() : '',
    seatMode: typeof body.seatMode === 'string' ? body.seatMode.trim() : '',
    seatTargetCount: Number.isInteger(body.seatTargetCount) ? body.seatTargetCount : null,
    sessionId: typeof body.sessionId === 'string' ? body.sessionId.trim().slice(0, 96) : '',
    targetUid: typeof body.targetUid === 'string' ? body.targetUid.trim() : '',
  };
}

function isValidRoomSeatCommandAction(action) {
  return ROOM_SEAT_COMMAND_ACTIONS.includes(action);
}

function isValidSeatId(seatId) {
  return SEAT_ID_PATTERN.test(seatId);
}

function resolveRoomSeatCommand({
  actorMembership,
  body = {},
  decodedToken = {},
  operatorProfile,
  room,
  targetMembership,
}) {
  const command = normalizeRoomSeatCommandBody(body);
  if (
    !FIRESTORE_ID_PATTERN.test(command.roomId) ||
    !REQUEST_ID_PATTERN.test(command.requestId) ||
    !isValidRoomSeatCommandAction(command.action) ||
    (command.targetUid && !FIRESTORE_ID_PATTERN.test(command.targetUid))
  ) {
    return roomCommandError('INVALID_REQUEST', 400, 'A valid seat command, room ID, and request ID are required.');
  }
  if (!room || room.id !== command.roomId || room.schemaVersion !== 2) {
    return roomCommandError('ROOM_MIGRATION_REQUIRED', 409, 'This room must finish its schema migration first.');
  }
  if (room.seatEngineVersion !== 1) {
    return roomCommandError('SEAT_ENGINE_NOT_ACTIVE', 409, 'The microphone seat engine is not active for this room.');
  }
  if (room.status !== 'active' || (room.availability !== undefined && room.availability !== 'active')) {
    return roomCommandError('ROOM_NOT_ACTIVE', 409, 'The room is not active.');
  }
  if (!actorMembership || actorMembership.uid !== decodedToken.uid || actorMembership.status !== 'active') {
    return roomCommandError('MEMBERSHIP_REQUIRED', 403, 'Active room membership is required.');
  }

  const staff = resolveStaffRoomAuthority({ decodedToken, operatorProfile, room });
  if (staff.denied) return roomCommandError('REGION_SCOPE_DENIED', 403, staff.error);
  const authority = staff.authority || resolveMemberAuthority(actorMembership, decodedToken.uid, room);
  if (SELF_ACTIONS.has(command.action)) {
    if (command.targetUid && command.targetUid !== decodedToken.uid) {
      return roomCommandError('TARGET_INVALID', 400, 'Self-service seat commands cannot target another member.');
    }
    command.targetUid = decodedToken.uid;
  } else if (MODERATOR_ACTIONS.has(command.action)) {
    if (!['owner', 'moderator', 'super-moderator', 'platform-owner'].includes(authority)) {
      return roomCommandError('FORBIDDEN', 403, 'This room role cannot manage microphone seats.');
    }
  } else if (OWNER_ACTIONS.has(command.action)) {
    if (!['owner', 'platform-owner'].includes(authority)) {
      return roomCommandError('FORBIDDEN', 403, 'Only the room owner can change the seat configuration.');
    }
    const revision = positiveInteger(room.revision) ? room.revision : 1;
    if (command.expectedRevision === null) {
      return roomCommandError('REVISION_REQUIRED', 409, 'Refresh the room before changing its seat configuration.');
    }
    if (command.expectedRevision !== revision) {
      return roomCommandError('REVISION_CONFLICT', 409, 'The room changed. Refresh it before trying again.', { revision });
    }
  }

  if (actionNeedsSeat(command.action) && !isValidSeatId(command.seatId)) {
    return roomCommandError('SEAT_INVALID', 400, 'A valid microphone seat is required.');
  }
  if (command.action === 'set-seat-mode' && !ROOM_SEAT_MODES.includes(command.seatMode)) {
    return roomCommandError('SEAT_MODE_INVALID', 400, 'The microphone seat mode is invalid.');
  }
  if (command.action === 'resize-seats' && !ROOM_SEAT_COUNTS.includes(command.seatTargetCount)) {
    return roomCommandError('SEAT_COUNT_INVALID', 400, 'The microphone seat count is invalid.');
  }
  if (actionNeedsOtherMember(command.action)) {
    if (!command.targetUid || command.targetUid === decodedToken.uid || !targetMembership || targetMembership.uid !== command.targetUid || targetMembership.status !== 'active') {
      return roomCommandError('TARGET_INVALID', 400, 'An active target member is required.');
    }
  }

  const currentRevision = positiveInteger(room.revision) ? room.revision : 1;
  return {
    ok: true,
    value: {
      ...command,
      actorAuthority: authority,
      currentRevision,
      nextRevision: currentRevision + 1,
      regionCode: staff.regionCode || room.countryCode || '',
    },
  };
}

function buildRoomSeatCommandFingerprint(actorUid, command) {
  return [
    actorUid,
    command.roomId,
    command.action,
    command.targetUid,
    command.seatId,
    command.seatMode,
    command.seatTargetCount ?? '',
    command.sessionId,
    command.expectedRevision ?? '',
    command.reason,
  ].join('|');
}

function occupiedSeatState(seat) {
  return Boolean(seat && ['occupied', 'reconnecting', 'retiring'].includes(seat.state));
}

function seatIsReconnectable(seat, uid, nowMs) {
  if (!occupiedSeatState(seat) || seat.occupantUid !== uid) return false;
  if (seat.state !== 'reconnecting' && seat.occupancyState !== 'reconnecting') return true;
  const expiry = timestampToMillis(seat.reservationExpiresAt);
  return expiry !== undefined && expiry > nowMs;
}

function releaseSeatPatch(seat, seatTargetCount) {
  const retired = seat.seatNumber > seatTargetCount || seat.retired === true || seat.state === 'retiring';
  const manuallyLocked = seat.manuallyLocked === true;
  return {
    state: retired || manuallyLocked ? 'locked' : 'open',
    retired,
    revision: positiveInteger(seat.revision) ? seat.revision + 1 : 1,
    occupantUid: null,
    occupancyState: null,
    reservationExpiresAt: null,
    sessionId: null,
  };
}

function resizeSeatPatch(seat, targetCount) {
  const aboveTarget = seat.seatNumber > targetCount;
  if (aboveTarget && occupiedSeatState(seat)) {
    return {
      state: 'retiring',
      retired: true,
      occupancyState: seat.state === 'reconnecting' || seat.occupancyState === 'reconnecting'
        ? 'reconnecting'
        : 'occupied',
      revision: positiveInteger(seat.revision) ? seat.revision + 1 : 1,
    };
  }
  if (aboveTarget) {
    return {
      state: 'locked',
      retired: true,
      revision: positiveInteger(seat.revision) ? seat.revision + 1 : 1,
    };
  }
  if (seat.retired === true && !occupiedSeatState(seat)) {
    return {
      state: seat.manuallyLocked === true ? 'locked' : 'open',
      retired: false,
      revision: positiveInteger(seat.revision) ? seat.revision + 1 : 1,
    };
  }
  return null;
}

function planSeatEngineActivation(room, members, seats) {
  if (!room || room.schemaVersion !== 2) return { ok: false, code: 'ROOM_MIGRATION_REQUIRED' };
  if (room.seatEngineVersion === 1) return { ok: true, status: 'ready', memberPatches: [], seatPatches: [] };
  if (!Array.isArray(members) || !Array.isArray(seats) || seats.length !== 20) {
    return { ok: false, code: 'SEAT_MAP_INCOMPLETE' };
  }
  const activeMembers = members.filter((member) => member?.status === 'active');
  const membersByUid = new Map(activeMembers.map((member) => [member.uid, member]));
  const occupiedByUid = new Map();
  for (const seat of seats) {
    if (!Number.isInteger(seat?.seatNumber) || seat.seatNumber < 1 || seat.seatNumber > 20) {
      return { ok: false, code: 'SEAT_MAP_INVALID' };
    }
    if (!occupiedSeatState(seat)) continue;
    if (!membersByUid.has(seat.occupantUid) || occupiedByUid.has(seat.occupantUid)) {
      return { ok: false, code: 'SEAT_OCCUPANCY_INVALID' };
    }
    occupiedByUid.set(seat.occupantUid, seat);
  }
  for (const member of activeMembers) {
    if (!member.seatId) continue;
    const occupiedSeat = occupiedByUid.get(member.uid);
    if (!occupiedSeat || String(occupiedSeat.seatNumber).padStart(2, '0') !== member.seatId) {
      return { ok: false, code: 'MEMBER_SEAT_MISMATCH' };
    }
  }

  const availableSeats = seats
    .filter((seat) => !occupiedSeatState(seat) && seat.state === 'open' && seat.manuallyLocked !== true)
    .sort((left, right) => left.seatNumber - right.seatNumber);
  const publishers = activeMembers
    .filter((member) => !member.seatId && ['host', 'speaker'].includes(member.role) && member.canPublishAudio === true)
    .sort((left, right) => left.uid.localeCompare(right.uid));
  if (publishers.length > availableSeats.length) return { ok: false, code: 'SEAT_CAPACITY_EXCEEDED' };
  const targetCount = room.seatTargetCount || 10;
  const memberPatches = [];
  const seatPatches = [];
  for (let index = 0; index < publishers.length; index += 1) {
    const member = publishers[index];
    const seat = availableSeats[index];
    const seatId = String(seat.seatNumber).padStart(2, '0');
    const retired = seat.seatNumber > targetCount;
    memberPatches.push({ uid: member.uid, patch: { seatId } });
    seatPatches.push({
      seatId,
      patch: {
        occupantUid: member.uid,
        occupancyState: 'occupied',
        retired,
        revision: positiveInteger(seat.revision) ? seat.revision + 1 : 1,
        state: retired ? 'retiring' : 'occupied',
      },
    });
  }
  return {
    ok: true,
    status: 'activate',
    memberPatches,
    seatPatches,
    speakerCount: occupiedByUid.size + publishers.length,
  };
}

function actionNeedsSeat(action) {
  return [
    'claim-seat', 'request-seat', 'approve-seat-request', 'invite-to-seat',
    'accept-seat-invite', 'lock-seat', 'unlock-seat',
  ].includes(action);
}

function actionNeedsOtherMember(action) {
  return ['approve-seat-request', 'reject-seat-request', 'invite-to-seat'].includes(action);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

function timestampToMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.seconds === 'number') return value.seconds * 1000;
  return undefined;
}

module.exports = {
  ROOM_SEAT_COMMAND_ACTIONS,
  ROOM_SEAT_COUNTS,
  ROOM_SEAT_INVITE_TTL_MS,
  ROOM_SEAT_MODES,
  ROOM_SEAT_RECONNECT_MS,
  ROOM_SEAT_REQUEST_TTL_MS,
  buildRoomSeatCommandFingerprint,
  isValidRoomSeatCommandAction,
  isValidSeatId,
  normalizeRoomSeatCommandBody,
  occupiedSeatState,
  planSeatEngineActivation,
  releaseSeatPatch,
  resizeSeatPatch,
  resolveRoomSeatCommand,
  seatIsReconnectable,
  timestampToMillis,
};
