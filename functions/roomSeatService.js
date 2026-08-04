const {
  ROOM_SEAT_INVITE_TTL_MS,
  ROOM_SEAT_RECONNECT_MS,
  ROOM_SEAT_REQUEST_TTL_MS,
  buildRoomSeatCommandFingerprint,
  isValidRoomSeatCommandAction,
  normalizeRoomSeatCommandBody,
  occupiedSeatState,
  releaseSeatPatch,
  resizeSeatPatch,
  resolveRoomSeatCommand,
  timestampToMillis,
} = require('./roomSeatCore');
const { isCompleteProfile, isValidRoomCommandRequestId, roomCommandError } = require('./roomCommandCore');
const { VOICE_ROOM_COMMAND_RECORD_RETENTION_MS } = require('./voiceRoomRateLimitCore');
const { FieldPath } = require('firebase-admin/firestore');

async function executeRoomSeatCommand({ body, clock, db, decodedToken, fieldValue }) {
  const normalized = normalizeRoomSeatCommandBody(body);
  if (
    !normalized.roomId ||
    normalized.roomId.includes('/') ||
    !isValidRoomCommandRequestId(normalized.requestId) ||
    !isValidRoomSeatCommandAction(normalized.action)
  ) {
    return roomCommandError('INVALID_REQUEST', 400, 'A valid seat command, room ID, and request ID are required.');
  }
  const nowMs = clock.nowMillis();
  const requestPurgeAfter = clock.timestampFromMillis(
    nowMs + VOICE_ROOM_COMMAND_RECORD_RETENTION_MS,
  );
  const fingerprint = buildRoomSeatCommandFingerprint(decodedToken.uid, normalized);

  return db.runTransaction(async (transaction) => {
    const roomRef = db.doc(`rooms/${normalized.roomId}`);
    const requestRef = roomRef.collection('commandRequests').doc(normalized.requestId);
    const actorMemberRef = roomRef.collection('members').doc(decodedToken.uid);
    const targetMemberRef = normalized.targetUid
      ? roomRef.collection('members').doc(normalized.targetUid)
      : null;
    const seatRef = normalized.seatId ? roomRef.collection('seats').doc(normalized.seatId) : null;
    const [
      previousRequestSnapshot,
      profileSnapshot,
      publicProfileSnapshot,
      featureSnapshot,
      operatorProfileSnapshot,
      roomSnapshot,
      actorMemberSnapshot,
      targetMemberSnapshot,
      seatSnapshot,
    ] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(db.doc(`users/${decodedToken.uid}`)),
      transaction.get(db.doc(`publicProfiles/${decodedToken.uid}`)),
      transaction.get(db.doc('appConfig/voiceRoomFeatures')),
      transaction.get(db.doc(`adminProfiles/${decodedToken.uid}`)),
      transaction.get(roomRef),
      transaction.get(actorMemberRef),
      targetMemberRef ? transaction.get(targetMemberRef) : Promise.resolve(null),
      seatRef ? transaction.get(seatRef) : Promise.resolve(null),
    ]);

    if (previousRequestSnapshot.exists) {
      const previous = previousRequestSnapshot.data();
      if (previous.actorUid !== decodedToken.uid || previous.fingerprint !== fingerprint) {
        return roomCommandError('REQUEST_ID_CONFLICT', 409, 'This request ID belongs to a different command.');
      }
      return { ...previous.response, replayed: true, liveKit: previous.liveKit || { type: 'none' } };
    }

    const room = roomSnapshot.exists ? roomSnapshot.data() : undefined;
    let resolution;
    const shutdownSafeAction = [
      'leave-seat', 'reserve-seat', 'resume-seat', 'cancel-seat-request', 'decline-seat-invite',
    ].includes(normalized.action);
    if (
      !shutdownSafeAction &&
      (
        !featureSnapshot.exists ||
        featureSnapshot.data()?.voice_room_v2_mutations !== true ||
        featureSnapshot.data()?.voice_room_seats !== true
      )
    ) {
      resolution = roomCommandError('FEATURE_DISABLED', 503, 'Microphone seat mutations are temporarily disabled.');
    } else if (!isCompleteProfile(profileSnapshot.exists ? profileSnapshot.data() : undefined, decodedToken.uid, decodedToken.email)) {
      resolution = roomCommandError('PROFILE_REQUIRED', 403, 'A complete profile is required.');
    } else if (!publicProfileSnapshot.exists || publicProfileSnapshot.data()?.moderationStatus !== 'active') {
      resolution = roomCommandError('ACCOUNT_RESTRICTED', 403, 'This account cannot perform room commands.');
    } else {
      resolution = resolveRoomSeatCommand({
        actorMembership: actorMemberSnapshot.exists ? actorMemberSnapshot.data() : undefined,
        body,
        decodedToken,
        operatorProfile: operatorProfileSnapshot.exists ? operatorProfileSnapshot.data() : undefined,
        room,
        targetMembership: targetMemberSnapshot?.exists ? targetMemberSnapshot.data() : undefined,
      });
    }

    const timestamp = fieldValue.serverTimestamp();
    if (!resolution.ok) {
      return recordDeniedSeatCommand({
        decodedToken,
        fieldValue,
        fingerprint,
        normalized,
        requestRef,
        requestPurgeAfter,
        resolution,
        roomRef,
        timestamp,
        transaction,
      });
    }

    const command = resolution.value;
    const actorMember = actorMemberSnapshot.data();
    const targetMember = targetMemberSnapshot?.exists ? targetMemberSnapshot.data() : undefined;
    let seat = seatSnapshot?.exists ? seatSnapshot.data() : undefined;
    let effectiveSeatRef = seatRef;
    let effectiveSeatId = normalized.seatId;
    const memberSeatId = actorMember.seatId;
    if (['leave-seat', 'reserve-seat', 'resume-seat'].includes(command.action)) {
      if (typeof memberSeatId === 'string' && memberSeatId) {
        effectiveSeatId = memberSeatId;
        effectiveSeatRef = roomRef.collection('seats').doc(memberSeatId);
        const memberSeatSnapshot = normalized.seatId === memberSeatId && seatSnapshot
          ? seatSnapshot
          : await transaction.get(effectiveSeatRef);
        seat = memberSeatSnapshot.exists ? memberSeatSnapshot.data() : undefined;
      } else {
        seat = undefined;
        effectiveSeatRef = null;
        effectiveSeatId = '';
      }
    }

    const seatRequestRef = roomRef.collection('seatRequests').doc(
      ['approve-seat-request', 'reject-seat-request'].includes(command.action) ? command.targetUid : decodedToken.uid,
    );
    const seatInviteRef = roomRef.collection('seatInvites').doc(
      command.action === 'invite-to-seat' ? command.targetUid : decodedToken.uid,
    );
    const seatRequestSnapshot = ['request-seat', 'cancel-seat-request', 'approve-seat-request', 'reject-seat-request'].includes(command.action)
      ? await transaction.get(seatRequestRef)
      : null;
    const seatInviteSnapshot = ['invite-to-seat', 'accept-seat-invite', 'decline-seat-invite'].includes(command.action)
      ? await transaction.get(seatInviteRef)
      : null;

    const mutation = resolveSeatMutation({
      actorMember,
      clock,
      command,
      nowMs,
      room,
      seat,
      seatInvite: seatInviteSnapshot?.exists ? seatInviteSnapshot.data() : undefined,
      seatRequest: seatRequestSnapshot?.exists ? seatRequestSnapshot.data() : undefined,
      targetMember,
    });
    if (!mutation.ok) {
      return recordDeniedSeatCommand({
        decodedToken,
        fieldValue,
        fingerprint,
        normalized,
        requestRef,
        requestPurgeAfter,
        resolution: mutation,
        roomRef,
        timestamp,
        transaction,
      });
    }

    if (command.action === 'resize-seats') {
      const allSeats = [];
      for (let seatNumber = 1; seatNumber <= 20; seatNumber += 1) {
        const id = String(seatNumber).padStart(2, '0');
        const ref = roomRef.collection('seats').doc(id);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return recordDeniedSeatCommand({
          decodedToken,
          fieldValue,
          fingerprint,
          normalized,
          requestRef,
          requestPurgeAfter,
          resolution: roomCommandError('SEAT_STATE_INVALID', 409, 'The room seat map is incomplete.'),
          roomRef,
          timestamp,
          transaction,
        });
        allSeats.push({ ref, seat: snapshot.data() });
      }
      for (const entry of allSeats) {
        const patch = resizeSeatPatch(entry.seat, command.seatTargetCount);
        if (patch) transaction.update(entry.ref, { ...patch, updatedAt: timestamp, updatedBy: decodedToken.uid });
      }
    } else if (mutation.seatPatch && effectiveSeatRef) {
      transaction.update(effectiveSeatRef, {
        ...mutation.seatPatch,
        updatedAt: timestamp,
        updatedBy: decodedToken.uid,
      });
    }

    if (mutation.actorMemberPatch) transaction.update(actorMemberRef, {
      ...mutation.actorMemberPatch,
      updatedAt: timestamp,
      updatedBy: decodedToken.uid,
    });
    if (mutation.targetMemberPatch && targetMemberRef) transaction.update(targetMemberRef, {
      ...mutation.targetMemberPatch,
      updatedAt: timestamp,
      updatedBy: decodedToken.uid,
    });
    if (mutation.seatRequestPatch) transaction.set(seatRequestRef, {
      ...mutation.seatRequestPatch,
      roomId: command.roomId,
      updatedAt: timestamp,
    }, { merge: true });
    if (mutation.seatInvitePatch) transaction.set(seatInviteRef, {
      ...mutation.seatInvitePatch,
      roomId: command.roomId,
      updatedAt: timestamp,
    }, { merge: true });

    const roomPatch = {
      revision: command.nextRevision,
      ...mutation.roomPatch,
      updatedAt: timestamp,
      updatedBy: decodedToken.uid,
    };
    transaction.update(roomRef, roomPatch);

    const liveKit = mutation.liveKit || { type: 'none' };
    const liveKitSyncStatus = liveKit.type === 'none' ? 'not-required' : 'pending';
    const result = {
      action: command.action,
      liveKitSyncStatus,
      requestId: command.requestId,
      revision: command.nextRevision,
      roomId: command.roomId,
      seatId: mutation.resultSeatId || effectiveSeatId || command.seatId || '',
      status: 'applied',
      targetUid: command.targetUid,
    };
    const response = { ok: true, result };
    const event = {
      action: command.action,
      actorAuthority: command.actorAuthority,
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      fromRevision: command.currentRevision,
      liveKitSyncStatus,
      reason: command.reason,
      regionCode: command.regionCode,
      requestId: command.requestId,
      roomId: command.roomId,
      seatId: result.seatId,
      source: 'room-seat-v1',
      status: 'applied',
      targetUid: command.targetUid,
      toRevision: command.nextRevision,
    };
    transaction.create(roomRef.collection('moderationEvents').doc(`command_${command.requestId}`), event);
    transaction.create(requestRef, {
      ...event,
      fingerprint,
      liveKit,
      liveKitSyncAttempts: 0,
      purgeAfter: requestPurgeAfter,
      response,
    });
    return { ...response, replayed: false, liveKit };
  });
}

function resolveSeatMutation({ actorMember, clock, command, nowMs, room, seat, seatInvite, seatRequest, targetMember }) {
  const targetCount = room.seatTargetCount || 10;
  const seatAvailable = () => Boolean(
    seat && seat.state === 'open' && seat.retired !== true && seat.seatNumber <= targetCount && !seat.occupantUid,
  );
  const incrementedSeatRevision = () => Number.isInteger(seat?.revision) ? seat.revision + 1 : 1;
  const seatedMemberPatch = (member, seatId) => ({
    canPublishAudio: true,
    role: member.uid === (room.ownerUid || room.hostId) ? 'host' : 'speaker',
    seatId,
  });
  const listenerPatch = (member) => ({
    canPublishAudio: false,
    role: member.uid === (room.ownerUid || room.hostId) ? 'host' : 'listener',
    seatId: null,
  });
  const claimedSeatPatch = (uid, sessionId) => ({
    state: seat.seatNumber > targetCount ? 'retiring' : 'occupied',
    retired: seat.seatNumber > targetCount,
    occupantUid: uid,
    occupancyState: 'occupied',
    reservationExpiresAt: null,
    revision: incrementedSeatRevision(),
    sessionId: sessionId || null,
  });
  const permissionPlan = (member, canPublish) => ({
    type: 'update-permission',
    targetUid: member.uid,
    canPublish: canPublish && member.forceMuted !== true && room.audioLockdown !== true,
  });

  if (command.action === 'claim-seat') {
    if (room.seatMode !== 'open') return seatError('SEAT_MODE_DENIED', 'This room does not allow immediate microphone claims.');
    if (actorMember.seatId) return seatError('ALREADY_SEATED', 'This member already occupies a microphone seat.');
    if (!seatAvailable()) return seatError('SEAT_UNAVAILABLE', 'This microphone seat is unavailable.');
    return seatMutation({
      actorMemberPatch: seatedMemberPatch(actorMember, command.seatId),
      liveKit: permissionPlan(actorMember, true),
      roomPatch: { speakerCount: Math.max(0, Number(room.speakerCount || 0)) + 1 },
      seatPatch: claimedSeatPatch(actorMember.uid, command.sessionId),
      resultSeatId: command.seatId,
    });
  }
  if (command.action === 'leave-seat') {
    if (!actorMember.seatId || !seat || seat.occupantUid !== actorMember.uid || !occupiedSeatState(seat)) {
      return seatError('NOT_SEATED', 'This member does not occupy a microphone seat.');
    }
    return seatMutation({
      actorMemberPatch: listenerPatch(actorMember),
      liveKit: permissionPlan(actorMember, false),
      roomPatch: { speakerCount: Math.max(0, Number(room.speakerCount || 0) - 1) },
      seatPatch: releaseSeatPatch(seat, targetCount),
      resultSeatId: actorMember.seatId,
    });
  }
  if (command.action === 'request-seat') {
    if (room.seatMode !== 'request') return seatError('SEAT_MODE_DENIED', 'This room is not accepting microphone requests.');
    if (actorMember.seatId) return seatError('ALREADY_SEATED', 'This member already occupies a microphone seat.');
    if (!seatAvailable()) return seatError('SEAT_UNAVAILABLE', 'This microphone seat is unavailable.');
    if (seatRequest?.status === 'pending' && timestampToMillis(seatRequest.expiresAt) > nowMs) {
      return seatError('SEAT_REQUEST_PENDING', 'A microphone request is already pending.');
    }
    return seatMutation({ seatRequestPatch: {
      createdAt: clock.timestampFromMillis(nowMs),
      expiresAt: clock.timestampFromMillis(nowMs + ROOM_SEAT_REQUEST_TTL_MS),
      requestedSeatId: command.seatId,
      requesterUid: actorMember.uid,
      status: 'pending',
    } });
  }
  if (command.action === 'cancel-seat-request') {
    if (!seatRequest || seatRequest.status !== 'pending') return seatError('SEAT_REQUEST_NOT_PENDING', 'No microphone request is pending.');
    return seatMutation({ seatRequestPatch: {
      purgeAfter: clock.timestampFromMillis(nowMs + 24 * 60 * 60 * 1000),
      resolvedAt: clock.timestampFromMillis(nowMs),
      status: 'cancelled',
    } });
  }
  if (command.action === 'approve-seat-request') {
    if (room.seatMode !== 'request') return seatError('SEAT_MODE_DENIED', 'This room is not accepting microphone requests.');
    if (!seatRequest || seatRequest.status !== 'pending' || seatRequest.requesterUid !== targetMember.uid) {
      return seatError('SEAT_REQUEST_NOT_PENDING', 'No matching microphone request is pending.');
    }
    if (timestampToMillis(seatRequest.expiresAt) <= nowMs) return seatError('SEAT_REQUEST_EXPIRED', 'The microphone request expired.');
    if (seatRequest.requestedSeatId !== command.seatId) return seatError('SEAT_REQUEST_MISMATCH', 'The requested microphone seat changed.');
    if (targetMember.seatId) return seatError('ALREADY_SEATED', 'This member already occupies a microphone seat.');
    if (!seatAvailable()) return seatError('SEAT_UNAVAILABLE', 'This microphone seat is unavailable.');
    return seatMutation({
      liveKit: permissionPlan(targetMember, true),
      roomPatch: { speakerCount: Math.max(0, Number(room.speakerCount || 0)) + 1 },
      seatPatch: claimedSeatPatch(targetMember.uid, ''),
      seatRequestPatch: {
        approvedByUid: actorMember.uid,
        purgeAfter: clock.timestampFromMillis(nowMs + 24 * 60 * 60 * 1000),
        resolvedAt: clock.timestampFromMillis(nowMs),
        status: 'approved',
      },
      targetMemberPatch: seatedMemberPatch(targetMember, command.seatId),
      resultSeatId: command.seatId,
    });
  }
  if (command.action === 'reject-seat-request') {
    if (!seatRequest || seatRequest.status !== 'pending' || seatRequest.requesterUid !== targetMember.uid) {
      return seatError('SEAT_REQUEST_NOT_PENDING', 'No matching microphone request is pending.');
    }
    return seatMutation({ seatRequestPatch: {
      rejectedByUid: actorMember.uid,
      purgeAfter: clock.timestampFromMillis(nowMs + 24 * 60 * 60 * 1000),
      resolvedAt: clock.timestampFromMillis(nowMs),
      status: 'rejected',
    } });
  }
  if (command.action === 'invite-to-seat') {
    if (room.seatMode !== 'invite') return seatError('SEAT_MODE_DENIED', 'This room is not using invitation-only microphones.');
    if (targetMember.seatId) return seatError('ALREADY_SEATED', 'This member already occupies a microphone seat.');
    if (!seatAvailable()) return seatError('SEAT_UNAVAILABLE', 'This microphone seat is unavailable.');
    if (seatInvite?.status === 'pending' && timestampToMillis(seatInvite.expiresAt) > nowMs) {
      return seatError('SEAT_INVITE_PENDING', 'This member already has a pending microphone invitation.');
    }
    return seatMutation({ seatInvitePatch: {
      createdAt: clock.timestampFromMillis(nowMs),
      expiresAt: clock.timestampFromMillis(nowMs + ROOM_SEAT_INVITE_TTL_MS),
      invitedByUid: actorMember.uid,
      seatId: command.seatId,
      status: 'pending',
      targetUid: targetMember.uid,
    } });
  }
  if (command.action === 'accept-seat-invite') {
    if (!seatInvite || seatInvite.status !== 'pending' || seatInvite.targetUid !== actorMember.uid) {
      return seatError('SEAT_INVITE_NOT_PENDING', 'No matching microphone invitation is pending.');
    }
    if (timestampToMillis(seatInvite.expiresAt) <= nowMs) return seatError('SEAT_INVITE_EXPIRED', 'The microphone invitation expired.');
    if (seatInvite.seatId !== command.seatId) return seatError('SEAT_INVITE_MISMATCH', 'The invited microphone seat changed.');
    if (actorMember.seatId) return seatError('ALREADY_SEATED', 'This member already occupies a microphone seat.');
    if (!seatAvailable()) return seatError('SEAT_UNAVAILABLE', 'This microphone seat is unavailable.');
    return seatMutation({
      actorMemberPatch: seatedMemberPatch(actorMember, command.seatId),
      liveKit: permissionPlan(actorMember, true),
      roomPatch: { speakerCount: Math.max(0, Number(room.speakerCount || 0)) + 1 },
      seatInvitePatch: {
        purgeAfter: clock.timestampFromMillis(nowMs + 24 * 60 * 60 * 1000),
        resolvedAt: clock.timestampFromMillis(nowMs),
        status: 'accepted',
      },
      seatPatch: claimedSeatPatch(actorMember.uid, command.sessionId),
      resultSeatId: command.seatId,
    });
  }
  if (command.action === 'decline-seat-invite') {
    if (!seatInvite || seatInvite.status !== 'pending' || seatInvite.targetUid !== actorMember.uid) {
      return seatError('SEAT_INVITE_NOT_PENDING', 'No matching microphone invitation is pending.');
    }
    return seatMutation({ seatInvitePatch: {
      purgeAfter: clock.timestampFromMillis(nowMs + 24 * 60 * 60 * 1000),
      resolvedAt: clock.timestampFromMillis(nowMs),
      status: 'declined',
    } });
  }
  if (command.action === 'lock-seat') {
    if (!seat || occupiedSeatState(seat)) return seatError('SEAT_UNAVAILABLE', 'An occupied microphone seat cannot be locked.');
    return seatMutation({ seatPatch: {
      manuallyLocked: true,
      revision: incrementedSeatRevision(),
      state: 'locked',
    } });
  }
  if (command.action === 'unlock-seat') {
    if (!seat || occupiedSeatState(seat)) return seatError('SEAT_UNAVAILABLE', 'An occupied microphone seat cannot be unlocked.');
    return seatMutation({ seatPatch: {
      manuallyLocked: false,
      revision: incrementedSeatRevision(),
      state: seat.seatNumber > targetCount || seat.retired === true ? 'locked' : 'open',
    } });
  }
  if (command.action === 'set-seat-mode') return seatMutation({ roomPatch: { seatMode: command.seatMode } });
  if (command.action === 'resize-seats') return seatMutation({ roomPatch: { seatTargetCount: command.seatTargetCount } });
  if (command.action === 'reserve-seat') {
    if (!actorMember.seatId || !seat || seat.occupantUid !== actorMember.uid || !occupiedSeatState(seat)) {
      return seatError('NOT_SEATED', 'This member does not occupy a microphone seat.');
    }
    if (seat.state === 'reconnecting' || seat.occupancyState === 'reconnecting') {
      return seatMutation({ resultSeatId: actorMember.seatId });
    }
    return seatMutation({
      liveKit: permissionPlan(actorMember, false),
      seatPatch: {
        occupancyState: 'reconnecting',
        reservationExpiresAt: clock.timestampFromMillis(nowMs + ROOM_SEAT_RECONNECT_MS),
        revision: incrementedSeatRevision(),
        sessionId: command.sessionId || seat.sessionId || null,
        state: seat.state === 'retiring' ? 'retiring' : 'reconnecting',
      },
      resultSeatId: actorMember.seatId,
    });
  }
  if (command.action === 'resume-seat') {
    if (!actorMember.seatId || !seat || seat.occupantUid !== actorMember.uid || !occupiedSeatState(seat)) {
      return seatError('SEAT_RESERVATION_MISSING', 'The microphone seat reservation no longer exists.');
    }
    if (seat.state !== 'reconnecting' && seat.occupancyState !== 'reconnecting') {
      return seatMutation({ resultSeatId: actorMember.seatId });
    }
    if (timestampToMillis(seat.reservationExpiresAt) <= nowMs) return seatError('SEAT_RESERVATION_EXPIRED', 'The microphone seat reservation expired.');
    return seatMutation({
      liveKit: permissionPlan(actorMember, true),
      seatPatch: {
        occupancyState: 'occupied',
        reservationExpiresAt: null,
        revision: incrementedSeatRevision(),
        sessionId: command.sessionId || seat.sessionId || null,
        state: seat.retired === true ? 'retiring' : 'occupied',
      },
      resultSeatId: actorMember.seatId,
    });
  }
  return seatError('INVALID_REQUEST', 'This microphone seat command is unsupported.');
}

async function recoverExpiredRoomSeats({ clock, db, fieldValue, limit = 100 }) {
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);
  const snapshot = await db.collectionGroup('seats').where('reservationExpiresAt', '<=', now).limit(limit).get();
  let released = 0;
  for (const document of snapshot.docs) {
    const roomRef = document.ref.parent.parent;
    if (!roomRef) continue;
    const didRelease = await db.runTransaction(async (transaction) => {
      const seatSnapshot = await transaction.get(document.ref);
      if (!seatSnapshot.exists) return false;
      const seat = seatSnapshot.data();
      const expiryMs = timestampToMillis(seat.reservationExpiresAt);
      if (!occupiedSeatState(seat) || expiryMs === undefined || expiryMs > nowMs || !seat.occupantUid) return false;
      const memberRef = roomRef.collection('members').doc(seat.occupantUid);
      const [roomSnapshot, memberSnapshot] = await Promise.all([
        transaction.get(roomRef),
        transaction.get(memberRef),
      ]);
      if (!roomSnapshot.exists) return false;
      const room = roomSnapshot.data();
      const timestamp = fieldValue.serverTimestamp();
      const nextRevision = Number.isInteger(room.revision) ? room.revision + 1 : 1;
      const recoveryId = `seat_recovery_${document.id}_${seat.revision || 0}`;
      const requestRef = roomRef.collection('commandRequests').doc(recoveryId);
      const requestSnapshot = await transaction.get(requestRef);
      if (requestSnapshot.exists) return false;
      transaction.update(document.ref, {
        ...releaseSeatPatch(seat, room.seatTargetCount || 10),
        updatedAt: timestamp,
        updatedBy: 'system-seat-recovery',
      });
      if (memberSnapshot.exists && memberSnapshot.data().seatId === document.id) {
        const member = memberSnapshot.data();
        transaction.update(memberRef, {
          canPublishAudio: false,
          role: member.uid === (room.ownerUid || room.hostId) ? 'host' : 'listener',
          seatId: null,
          updatedAt: timestamp,
          updatedBy: 'system-seat-recovery',
        });
      }
      transaction.update(roomRef, {
        revision: nextRevision,
        speakerCount: Math.max(0, Number(room.speakerCount || 0) - 1),
        updatedAt: timestamp,
        updatedBy: 'system-seat-recovery',
      });
      const liveKit = { type: 'update-permission', targetUid: seat.occupantUid, canPublish: false };
      const result = {
        action: 'release-expired-seat', liveKitSyncStatus: 'pending', requestId: recoveryId,
        revision: nextRevision, roomId: roomRef.id, seatId: document.id, status: 'applied', targetUid: seat.occupantUid,
      };
      const event = {
        action: result.action, actorAuthority: 'system', actorUid: 'system', createdAt: timestamp,
        fromRevision: nextRevision - 1, liveKitSyncStatus: 'pending', reason: 'reconnect-expired',
        requestId: recoveryId, roomId: roomRef.id, seatId: document.id, source: 'room-seat-recovery-v1',
        status: 'applied', targetUid: seat.occupantUid, toRevision: nextRevision,
      };
      transaction.create(roomRef.collection('moderationEvents').doc(`command_${recoveryId}`), event);
      transaction.create(requestRef, {
        ...event,
        fingerprint: recoveryId,
        liveKit,
        liveKitSyncAttempts: 0,
        purgeAfter: clock.timestampFromMillis(
          nowMs + VOICE_ROOM_COMMAND_RECORD_RETENTION_MS,
        ),
        response: { ok: true, result },
        updatedAt: timestamp,
      });
      return true;
    });
    if (didRelease) released += 1;
  }
  return { released, scanned: snapshot.size };
}

async function expireRoomSeatOffers({ clock, db, fieldValue, limit = 200 }) {
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);
  let expired = 0;
  let purged = 0;
  for (const collectionName of ['seatRequests', 'seatInvites']) {
    const pending = await db.collectionGroup(collectionName)
      .where('status', '==', 'pending')
      .where('expiresAt', '<=', now)
      .limit(limit)
      .get();
    for (const document of pending.docs) {
      const changed = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(document.ref);
        if (!snapshot.exists) return false;
        const record = snapshot.data();
        if (record.status !== 'pending' || timestampToMillis(record.expiresAt) > nowMs) return false;
        transaction.update(document.ref, {
          purgeAfter: clock.timestampFromMillis(nowMs + 24 * 60 * 60 * 1000),
          resolvedAt: fieldValue.serverTimestamp(),
          status: 'expired',
          updatedAt: fieldValue.serverTimestamp(),
        });
        return true;
      });
      if (changed) expired += 1;
    }
    const terminalStatuses = collectionName === 'seatRequests'
      ? ['expired', 'cancelled', 'approved', 'rejected']
      : ['expired', 'accepted', 'declined'];
    const terminal = await db.collectionGroup(collectionName)
      .where('status', 'in', terminalStatuses)
      .where('purgeAfter', '<=', now)
      .limit(limit)
      .get();
    for (const document of terminal.docs) {
      const deleted = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(document.ref);
        if (!snapshot.exists) return false;
        const record = snapshot.data();
        if (!terminalStatuses.includes(record.status) || timestampToMillis(record.purgeAfter) > nowMs) return false;
        transaction.delete(document.ref);
        return true;
      });
      if (deleted) purged += 1;
    }
  }
  return { expired, purged };
}

async function recoverStaleRoomPresence({ clock, db, fieldValue, limit = 200 }) {
  const nowMs = clock.nowMillis();
  const snapshot = await db.collectionGroup('presence')
    .where('status', 'in', ['online', 'reconnecting'])
    .where('leaseExpiresAt', '<=', clock.timestampFromMillis(nowMs))
    .orderBy('leaseExpiresAt', 'asc')
    .limit(limit)
    .get();
  let reserved = 0;
  let stale = 0;
  for (const document of snapshot.docs) {
    const roomRef = document.ref.parent.parent;
    if (!roomRef) continue;
    const outcome = await db.runTransaction(async (transaction) => {
      const presenceSnapshot = await transaction.get(document.ref);
      if (!presenceSnapshot.exists) return { reserved: false, stale: false };
      const presence = presenceSnapshot.data();
      if (presence.status === 'stale' || timestampToMillis(presence.leaseExpiresAt) > nowMs) return { reserved: false, stale: false };
      const memberRef = roomRef.collection('members').doc(document.id);
      const [roomSnapshot, memberSnapshot] = await Promise.all([transaction.get(roomRef), transaction.get(memberRef)]);
      const timestamp = fieldValue.serverTimestamp();
      if (!roomSnapshot.exists || !memberSnapshot.exists || !memberSnapshot.data().seatId) {
        transaction.update(document.ref, { status: 'stale', staleAt: timestamp, updatedAt: timestamp });
        return { reserved: false, stale: true };
      }
      const member = memberSnapshot.data();
      const seatRef = roomRef.collection('seats').doc(member.seatId);
      const seatSnapshot = await transaction.get(seatRef);
      if (!seatSnapshot.exists) {
        transaction.update(document.ref, { status: 'stale', staleAt: timestamp, updatedAt: timestamp });
        return { reserved: false, stale: true };
      }
      const seat = seatSnapshot.data();
      if (!occupiedSeatState(seat) || seat.occupantUid !== document.id || seat.state === 'reconnecting' || seat.occupancyState === 'reconnecting') {
        transaction.update(document.ref, { status: 'stale', staleAt: timestamp, updatedAt: timestamp });
        return { reserved: false, stale: true };
      }
      const recoveryId = `presence_recovery_${document.id}_${seat.revision || 0}`;
      const requestRef = roomRef.collection('commandRequests').doc(recoveryId);
      const requestSnapshot = await transaction.get(requestRef);
      transaction.update(document.ref, { status: 'stale', staleAt: timestamp, updatedAt: timestamp });
      if (requestSnapshot.exists) return { reserved: false, stale: true };
      const room = roomSnapshot.data();
      const nextRevision = Number.isInteger(room.revision) ? room.revision + 1 : 1;
      transaction.update(seatRef, {
        occupancyState: 'reconnecting',
        reservationExpiresAt: clock.timestampFromMillis(nowMs + ROOM_SEAT_RECONNECT_MS),
        revision: Number.isInteger(seat.revision) ? seat.revision + 1 : 1,
        state: seat.state === 'retiring' ? 'retiring' : 'reconnecting',
        updatedAt: timestamp,
        updatedBy: 'system-presence-recovery',
      });
      transaction.update(roomRef, {
        revision: nextRevision,
        updatedAt: timestamp,
        updatedBy: 'system-presence-recovery',
      });
      const liveKit = { type: 'update-permission', targetUid: document.id, canPublish: false };
      const result = {
        action: 'reserve-stale-presence-seat', liveKitSyncStatus: 'pending', requestId: recoveryId,
        revision: nextRevision, roomId: roomRef.id, seatId: member.seatId, status: 'applied', targetUid: document.id,
      };
      const event = {
        action: result.action, actorAuthority: 'system', actorUid: 'system', createdAt: timestamp,
        fromRevision: nextRevision - 1, liveKitSyncStatus: 'pending', reason: 'presence-lease-expired',
        requestId: recoveryId, roomId: roomRef.id, seatId: member.seatId, source: 'room-presence-recovery-v1',
        status: 'applied', targetUid: document.id, toRevision: nextRevision,
      };
      transaction.create(roomRef.collection('moderationEvents').doc(`command_${recoveryId}`), event);
      transaction.create(requestRef, {
        ...event,
        fingerprint: recoveryId,
        liveKit,
        liveKitSyncAttempts: 0,
        purgeAfter: clock.timestampFromMillis(
          nowMs + VOICE_ROOM_COMMAND_RECORD_RETENTION_MS,
        ),
        response: { ok: true, result },
        updatedAt: timestamp,
      });
      return { reserved: true, stale: true };
    });
    if (outcome.stale) stale += 1;
    if (outcome.reserved) reserved += 1;
  }
  return { reserved, scanned: snapshot.size, stale };
}

async function reconcileRoomPresenceCounts({ clock, db, fieldValue, limit = 50 }) {
  const stateRef = db.doc('appOperationalState/roomPresenceReconciliation');
  const stateSnapshot = await stateRef.get();
  const cursor = stateSnapshot.exists && typeof stateSnapshot.data()?.lastRoomId === 'string'
    ? stateSnapshot.data().lastRoomId
    : '';
  const baseQuery = () => db.collection('rooms')
    .where('status', '==', 'active')
    .orderBy(FieldPath.documentId())
    .limit(limit);
  let rooms = await (cursor ? baseQuery().startAfter(cursor) : baseQuery()).get();
  let wrapped = false;
  if (rooms.empty && cursor) {
    rooms = await baseQuery().get();
    wrapped = true;
  }
  const nowMs = clock.nowMillis();
  let repaired = 0;
  for (const roomDocument of rooms.docs) {
    const [presenceSnapshot, seatSnapshot] = await Promise.all([
      roomDocument.ref.collection('presence').where('status', '==', 'online').get(),
      roomDocument.ref.collection('seats').get(),
    ]);
    const participantCount = presenceSnapshot.docs.filter((document) => timestampToMillis(document.data().leaseExpiresAt) > nowMs).length;
    const speakerCount = seatSnapshot.docs.filter((document) => occupiedSeatState(document.data())).length;
    const room = roomDocument.data();
    if (room.participantCount === participantCount && room.speakerCount === speakerCount) continue;
    await roomDocument.ref.set({
      participantCount,
      speakerCount,
      countsReconciledAt: fieldValue.serverTimestamp(),
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true });
    repaired += 1;
  }
  const lastRoomId = rooms.docs.at(-1)?.id || '';
  await stateRef.set({
    lastRoomId,
    lastRunAt: fieldValue.serverTimestamp(),
    wrapped,
  }, { merge: true });
  return { lastRoomId, repaired, scanned: rooms.size, wrapped };
}

function recordDeniedSeatCommand({
  decodedToken,
  fingerprint,
  normalized,
  requestRef,
  requestPurgeAfter,
  resolution,
  roomRef,
  timestamp,
  transaction,
}) {
  const response = {
    ok: false,
    code: resolution.code,
    status: resolution.status,
    error: resolution.error,
    ...(resolution.details ? { details: resolution.details } : {}),
  };
  transaction.create(requestRef, {
    action: normalized.action,
    actorUid: decodedToken.uid,
    createdAt: timestamp,
    fingerprint,
    liveKit: { type: 'none' },
    liveKitSyncStatus: 'not-required',
    purgeAfter: requestPurgeAfter,
    response,
    roomId: normalized.roomId,
    seatId: normalized.seatId,
    source: 'room-seat-v1',
    status: 'denied',
    targetUid: normalized.targetUid,
    updatedAt: timestamp,
  });
  transaction.create(roomRef.collection('moderationEvents').doc(`denied_${normalized.requestId}`), {
    action: normalized.action,
    actorUid: decodedToken.uid,
    code: resolution.code,
    createdAt: timestamp,
    requestId: normalized.requestId,
    roomId: normalized.roomId,
    seatId: normalized.seatId,
    source: 'room-seat-v1',
    status: 'denied',
    targetUid: normalized.targetUid,
  });
  return { ...response, replayed: false, liveKit: { type: 'none' } };
}

function seatMutation(value = {}) {
  return { ok: true, ...value };
}

function seatError(code, error, status = 409) {
  return roomCommandError(code, status, error);
}

module.exports = {
  executeRoomSeatCommand,
  expireRoomSeatOffers,
  reconcileRoomPresenceCounts,
  recoverExpiredRoomSeats,
  recoverStaleRoomPresence,
  resolveSeatMutation,
};
