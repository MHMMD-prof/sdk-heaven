const {
  buildAdmissionFingerprint,
  buildRoomDocument,
  buildRoomMemberDocument,
  buildVacantRoomSeatDocument,
  resolveCreateRoomAdmission,
  resolveJoinRoomAdmission,
  timestampToMillis,
  validateRoomAdmissionRequest,
} = require('./roomAdmissionCore');
const { resolveSlidingWindowRateLimit } = require('./voiceRoomRateLimitCore');

const CREATE_RATE_LIMIT = 5;
const CREATE_RATE_WINDOW_MS = 10 * 60 * 1000;
const JOIN_RATE_LIMIT = 30;
const JOIN_RATE_WINDOW_MS = 60 * 1000;
const ADMISSION_RECORD_RETENTION_MS = 24 * 60 * 60 * 1000;

async function executeRoomAdmissionCommand({
  body,
  clock = systemClock,
  db,
  decodedToken,
  fieldValue,
}) {
  const validation = validateRoomAdmissionRequest(body);
  if (!validation.ok) return validation;
  const command = validation.value;
  const fingerprint = buildAdmissionFingerprint(decodedToken.uid, command);
  const nowMs = clock.nowMillis();
  const purgeAfter = clock.timestampFromMillis(nowMs + ADMISSION_RECORD_RETENTION_MS);
  const roomRef = command.action === 'create-room'
    ? db.collection('rooms').doc()
    : db.doc(`rooms/${command.roomId}`);

  return db.runTransaction(async (transaction) => {
    const receiptRef = db.doc(`voiceRoomAdmissionRequests/${decodedToken.uid}_${command.requestId}`);
    const rateRef = db.doc(`voiceRoomAdmissionRateLimits/${command.action}_${decodedToken.uid}`);
    const privateProfileRef = db.doc(`users/${decodedToken.uid}`);
    const publicProfileRef = db.doc(`publicProfiles/${decodedToken.uid}`);
    const restrictionRef = db.doc(`adminUserRestrictions/${decodedToken.uid}`);
    const featureRef = db.doc('appConfig/voiceRoomFeatures');
    const hostLockRef = db.doc(`voiceRoomActiveHosts/${decodedToken.uid}`);
    const memberRef = roomRef.collection('members').doc(decodedToken.uid);
    const banRef = roomRef.collection('bans').doc(decodedToken.uid);
    const presenceRef = roomRef.collection('presence').doc(decodedToken.uid);

    const [
      receiptSnapshot,
      rateSnapshot,
      privateProfileSnapshot,
      publicProfileSnapshot,
      restrictionSnapshot,
      featureSnapshot,
      roomSnapshot,
      memberSnapshot,
      banSnapshot,
      presenceSnapshot,
      hostLockSnapshot,
    ] = await Promise.all([
      transaction.get(receiptRef),
      transaction.get(rateRef),
      transaction.get(privateProfileRef),
      transaction.get(publicProfileRef),
      transaction.get(restrictionRef),
      transaction.get(featureRef),
      command.action === 'join-room' ? transaction.get(roomRef) : Promise.resolve(null),
      command.action === 'join-room' ? transaction.get(memberRef) : Promise.resolve(null),
      command.action === 'join-room' ? transaction.get(banRef) : Promise.resolve(null),
      command.action === 'join-room' ? transaction.get(presenceRef) : Promise.resolve(null),
      command.action === 'create-room' ? transaction.get(hostLockRef) : Promise.resolve(null),
    ]);

    if (receiptSnapshot.exists) {
      const previous = receiptSnapshot.data();
      if (previous.actorUid !== decodedToken.uid || previous.fingerprint !== fingerprint) {
        return admissionError('REQUEST_ID_CONFLICT', 409, 'This request ID belongs to another admission request.');
      }
      return { ...previous.response, replayed: true };
    }

    let lockedRoomSnapshot = null;
    if (command.action === 'create-room' && hostLockSnapshot?.exists) {
      const lockedRoomId = hostLockSnapshot.data()?.roomId;
      if (typeof lockedRoomId === 'string' && lockedRoomId) {
        lockedRoomSnapshot = await transaction.get(db.doc(`rooms/${lockedRoomId}`));
      }
    }

    const rateLimit = resolveAdmissionRateLimit(command.action, rateSnapshot?.data(), nowMs);
    if (!rateLimit.ok) {
      return recordAdmissionOutcome({
        command,
        decodedToken,
        fingerprint,
        purgeAfter,
        receiptRef,
        response: rateLimit,
        timestamp: fieldValue.serverTimestamp(),
        transaction,
      });
    }

    const privateProfile = privateProfileSnapshot.exists ? privateProfileSnapshot.data() : undefined;
    const publicProfile = publicProfileSnapshot.exists ? publicProfileSnapshot.data() : undefined;
    const featureFlags = featureSnapshot.exists ? featureSnapshot.data() : undefined;
    const timestamp = fieldValue.serverTimestamp();
    let resolution;

    if (command.action === 'create-room') {
      const lockedRoom = lockedRoomSnapshot?.exists ? lockedRoomSnapshot.data() : undefined;
      if (
        lockedRoom
        && lockedRoom.status === 'active'
        && (lockedRoom.ownerUid === decodedToken.uid || lockedRoom.hostId === decodedToken.uid)
      ) {
        resolution = admissionError('ACTIVE_ROOM_EXISTS', 409, 'Close your active room before creating another room.', {
          roomId: lockedRoomSnapshot.id,
        });
      } else {
        resolution = resolveCreateRoomAdmission({
          command,
          decodedToken,
          featureFlags,
          nowMs,
          privateProfile,
          publicProfile,
          restriction: restrictionSnapshot.exists ? restrictionSnapshot.data() : undefined,
        });
      }
    } else {
      const rawRoom = roomSnapshot?.exists ? roomSnapshot.data() : undefined;
      resolution = resolveJoinRoomAdmission({
        ban: banSnapshot?.exists ? banSnapshot.data() : undefined,
        command,
        decodedToken,
        existingMember: memberSnapshot?.exists ? memberSnapshot.data() : undefined,
        featureFlags,
        nowMs,
        presence: presenceSnapshot?.exists ? presenceSnapshot.data() : undefined,
        privateProfile,
        publicProfile,
        room: rawRoom ? { ...rawRoom, id: rawRoom.id || roomRef.id } : undefined,
      });
    }

    if (!resolution.ok) {
      writeAdmissionRateLimit({
        action: command.action,
        fieldValue,
        purgeAfter,
        rateLimit,
        rateRef,
        timestamp,
        transaction,
        uid: decodedToken.uid,
      });
      return recordAdmissionOutcome({
        command,
        decodedToken,
        fingerprint,
        purgeAfter,
        receiptRef,
        response: resolution,
        timestamp,
        transaction,
      });
    }

    let roomDocument;
    let memberDocument;
    if (command.action === 'create-room') {
      roomDocument = buildRoomDocument({
        id: roomRef.id,
        input: resolution.value.roomInput,
        profile: resolution.value.profile,
      });
      memberDocument = buildRoomMemberDocument({ profile: resolution.value.profile, role: 'host' });
      transaction.create(roomRef, { ...roomDocument, createdAt: timestamp, updatedAt: timestamp });
      transaction.create(memberRef, { ...memberDocument, joinedAt: timestamp, updatedAt: timestamp });
      for (let seatNumber = 1; seatNumber <= 20; seatNumber += 1) {
        transaction.create(
          roomRef.collection('seats').doc(String(seatNumber).padStart(2, '0')),
          { ...buildVacantRoomSeatDocument(seatNumber), updatedAt: timestamp },
        );
      }
      transaction.set(hostLockRef, {
        ownerUid: decodedToken.uid,
        roomId: roomRef.id,
        status: 'active',
        updatedAt: timestamp,
      });
    } else {
      roomDocument = { ...roomSnapshot.data(), id: roomSnapshot.data()?.id || roomRef.id };
      memberDocument = resolution.value.member;
      transaction.set(memberRef, {
        ...memberDocument,
        joinedAt: memberSnapshot?.exists && memberSnapshot.data()?.joinedAt
          ? memberSnapshot.data().joinedAt
          : timestamp,
        updatedAt: timestamp,
      }, { merge: true });
      if (!resolution.value.existingMember) {
        transaction.update(roomRef, {
          participantCount: fieldValue.increment(1),
          updatedAt: timestamp,
        });
        roomDocument.participantCount = Math.max(0, Number(roomDocument.participantCount || 0)) + 1;
      }
    }

    const result = {
      action: command.action,
      localMember: memberDocument,
      requestId: command.requestId,
      room: serializeRoomDocument(roomDocument, nowMs),
      status: 'applied',
    };
    const response = { ok: true, replayed: false, result };
    writeAdmissionRateLimit({
      action: command.action,
      fieldValue,
      purgeAfter,
      rateLimit,
      rateRef,
      timestamp,
      transaction,
      uid: decodedToken.uid,
    });
    transaction.create(receiptRef, {
      action: command.action,
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      fingerprint,
      purgeAfter,
      response,
      roomId: roomRef.id,
      status: 'applied',
      updatedAt: timestamp,
    });
    return response;
  });
}

function resolveAdmissionRateLimit(action, rate, nowMs) {
  return resolveSlidingWindowRateLimit({
    limit: action === 'create-room' ? CREATE_RATE_LIMIT : JOIN_RATE_LIMIT,
    nowMs,
    rate,
    windowMs: action === 'create-room' ? CREATE_RATE_WINDOW_MS : JOIN_RATE_WINDOW_MS,
  });
}

function writeAdmissionRateLimit({
  action,
  fieldValue,
  purgeAfter,
  rateLimit,
  rateRef,
  timestamp,
  transaction,
  uid,
}) {
  if (!rateLimit.ok) return;
  transaction.set(rateRef, {
    action,
    attemptsMs: rateLimit.value.attemptsMs,
    count: rateLimit.value.count,
    purgeAfter,
    uid,
    updatedAt: timestamp,
    windowStartedAt: fieldValue.serverTimestamp(),
  }, { merge: true });
}

function recordAdmissionOutcome({
  command,
  decodedToken,
  fingerprint,
  purgeAfter,
  receiptRef,
  response,
  timestamp,
  transaction,
}) {
  const sanitized = {
    code: response.code || 'ADMISSION_DENIED',
    error: response.error || 'Room admission was denied.',
    ok: false,
    status: response.status || 409,
    ...(response.details ? { details: response.details } : {}),
  };
  transaction.create(receiptRef, {
    action: command.action,
    actorUid: decodedToken.uid,
    createdAt: timestamp,
    fingerprint,
    purgeAfter,
    response: sanitized,
    roomId: command.roomId,
    status: 'denied',
    updatedAt: timestamp,
  });
  return { ...sanitized, replayed: false };
}

function serializeRoomDocument(room, nowMs) {
  const serialized = { ...room };
  const createdAtMs = timestampToMillis(room.createdAt) ?? nowMs;
  const updatedAtMs = timestampToMillis(room.updatedAt) ?? nowMs;
  delete serialized.createdAt;
  delete serialized.updatedAt;
  return { ...serialized, createdAt: createdAtMs, updatedAt: updatedAtMs };
}

function admissionError(code, status, error, details) {
  return { code, error, ok: false, status, ...(details ? { details } : {}) };
}

const systemClock = {
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => new Date(value),
};

module.exports = {
  ADMISSION_RECORD_RETENTION_MS,
  CREATE_RATE_LIMIT,
  CREATE_RATE_WINDOW_MS,
  JOIN_RATE_LIMIT,
  JOIN_RATE_WINDOW_MS,
  executeRoomAdmissionCommand,
  resolveAdmissionRateLimit,
  serializeRoomDocument,
};
