const {
  buildRoomCommandFingerprint,
  buildRoomCommandMutationPlan,
  isValidRoomCommandAction,
  isValidRoomCommandRequestId,
  normalizeRoomCommandBody,
  resolveRoomCommand,
  roomCommandError,
} = require('./roomCommandCore');
const { TrackSource } = require('livekit-server-sdk');
const { isActiveBan, resolveSeatCanPublish } = require('./livekitTokenCore');
const { randomUUID } = require('node:crypto');

async function executeRoomCommand({ db, decodedToken, fieldValue, body }) {
  const legacyProtocol = typeof body?.requestId !== 'string' || !body.requestId.trim();
  const effectiveBody = legacyProtocol
    ? { ...body, requestId: `legacy_${randomUUID().replaceAll('-', '')}` }
    : body;
  const normalized = normalizeRoomCommandBody(effectiveBody);
  if (
    !normalized.roomId ||
    normalized.roomId.includes('/') ||
    !isValidRoomCommandAction(normalized.action) ||
    !isValidRoomCommandRequestId(normalized.requestId)
  ) {
    return roomCommandError('INVALID_REQUEST', 400, 'A valid room command, room ID, and request ID are required.');
  }

  const fingerprint = buildRoomCommandFingerprint(decodedToken.uid, normalized);
  return db.runTransaction(async (transaction) => {
    const roomRef = db.doc(`rooms/${normalized.roomId}`);
    const requestRef = roomRef.collection('commandRequests').doc(normalized.requestId);
    const profileRef = db.doc(`users/${decodedToken.uid}`);
    const publicProfileRef = db.doc(`publicProfiles/${decodedToken.uid}`);
    const operatorProfileRef = db.doc(`adminProfiles/${decodedToken.uid}`);
    const featureFlagsRef = db.doc('appConfig/voiceRoomFeatures');
    const actorMemberRef = roomRef.collection('members').doc(decodedToken.uid);
    const targetMemberRef = normalized.targetUid
      ? roomRef.collection('members').doc(normalized.targetUid)
      : null;
    const targetBanRef = normalized.action === 'unban-member' && normalized.targetUid
      ? roomRef.collection('bans').doc(normalized.targetUid)
      : null;
    const [
      requestSnapshot,
      profileSnapshot,
      publicProfileSnapshot,
      operatorProfileSnapshot,
      featureFlagsSnapshot,
      roomSnapshot,
      actorMemberSnapshot,
      targetMemberSnapshot,
      targetBanSnapshot,
    ] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(profileRef),
      transaction.get(publicProfileRef),
      transaction.get(operatorProfileRef),
      transaction.get(featureFlagsRef),
      transaction.get(roomRef),
      transaction.get(actorMemberRef),
      targetMemberRef ? transaction.get(targetMemberRef) : Promise.resolve(null),
      targetBanRef ? transaction.get(targetBanRef) : Promise.resolve(null),
    ]);

    if (requestSnapshot.exists) {
      const previous = requestSnapshot.data();
      if (previous.actorUid !== decodedToken.uid || previous.fingerprint !== fingerprint) {
        return roomCommandError('REQUEST_ID_CONFLICT', 409, 'This request ID belongs to a different command.');
      }
      return {
        ...previous.response,
        replayed: true,
        liveKit: previous.liveKit || { type: 'none' },
      };
    }

    const room = roomSnapshot.exists ? roomSnapshot.data() : undefined;
    const resolution = publicProfileSnapshot.exists && publicProfileSnapshot.data()?.moderationStatus === 'active'
      ? resolveRoomCommand({
        actorMembership: actorMemberSnapshot.exists ? actorMemberSnapshot.data() : undefined,
        body: legacyProtocol
          ? { ...effectiveBody, expectedRevision: Number.isInteger(room?.revision) ? room.revision : 1 }
          : effectiveBody,
        decodedToken,
        featureFlags: featureFlagsSnapshot.exists ? featureFlagsSnapshot.data() : undefined,
        operatorProfile: operatorProfileSnapshot.exists ? operatorProfileSnapshot.data() : undefined,
        profile: profileSnapshot.exists ? profileSnapshot.data() : undefined,
        room,
        targetBan: targetBanSnapshot?.exists ? targetBanSnapshot.data() : undefined,
        targetMembership: targetMemberSnapshot?.exists ? targetMemberSnapshot.data() : undefined,
      })
      : roomCommandError('ACCOUNT_RESTRICTED', 403, 'This account cannot perform room commands.');

    const timestamp = fieldValue.serverTimestamp();
    if (!resolution.ok) {
      const response = sanitizeErrorResponse(resolution);
      transaction.create(requestRef, {
        action: normalized.action,
        actorUid: decodedToken.uid,
        createdAt: timestamp,
        fingerprint,
        liveKit: { type: 'none' },
        liveKitSyncStatus: 'not-required',
        response,
        roomId: normalized.roomId,
        status: 'denied',
        targetUid: normalized.targetUid,
        updatedAt: timestamp,
      });
      if (resolution.code === 'REGION_SCOPE_DENIED' && roomSnapshot.exists) {
        transaction.create(roomRef.collection('moderationEvents').doc(`denied_${normalized.requestId}`), {
          action: normalized.action,
          actorAuthority: 'super-moderator',
          actorUid: decodedToken.uid,
          code: resolution.code,
          createdAt: timestamp,
          reason: normalized.reason,
          requestId: normalized.requestId,
          roomId: normalized.roomId,
          source: 'room-command-v2',
          status: 'denied',
          targetUid: normalized.targetUid,
        });
      }
      return { ...response, replayed: false, liveKit: { type: 'none' } };
    }

    const command = resolution.value;
    const actorMembership = actorMemberSnapshot.exists ? actorMemberSnapshot.data() : undefined;
    const targetMembership = targetMemberSnapshot?.exists ? targetMemberSnapshot.data() : undefined;
    const targetSeatRef = targetMembership?.seatId
      ? roomRef.collection('seats').doc(targetMembership.seatId)
      : null;
    const targetSeatSnapshot = targetSeatRef ? await transaction.get(targetSeatRef) : null;
    const plan = buildRoomCommandMutationPlan({ actorMembership, command, room, targetMembership });
    if (
      targetSeatRef &&
      targetSeatSnapshot?.exists &&
      targetSeatSnapshot.data().occupantUid === command.targetUid &&
      ['demote-listener', 'remove-member', 'ban-member'].includes(command.action)
    ) {
      const targetSeat = targetSeatSnapshot.data();
      const retired = targetSeat.seatNumber > Number(room.seatTargetCount || 10) || targetSeat.retired === true || targetSeat.state === 'retiring';
      transaction.update(targetSeatRef, {
        occupantUid: null,
        occupancyState: null,
        reservationExpiresAt: null,
        retired,
        revision: Number.isInteger(targetSeat.revision) ? targetSeat.revision + 1 : 1,
        sessionId: null,
        state: retired || targetSeat.manuallyLocked === true ? 'locked' : 'open',
        updatedAt: fieldValue.serverTimestamp(),
        updatedBy: decodedToken.uid,
      });
      plan.roomPatch.speakerCount = Math.max(0, Number(room.speakerCount || 0) - 1);
    }
    const liveKitSyncStatus = plan.liveKit.type === 'none' ? 'not-required' : 'pending';
    const result = {
      action: command.action,
      liveKitSyncStatus,
      requestId: command.requestId,
      revision: command.nextRevision,
      roomId: command.roomId,
      status: 'applied',
      targetUid: command.targetUid,
      protocolVersion: legacyProtocol ? 1 : 2,
    };
    const response = { ok: true, result };

    if (plan.roomPatch) {
      transaction.update(roomRef, {
        ...plan.roomPatch,
        ...(command.action === 'remove-room'
          ? { removedAt: timestamp, removedBy: decodedToken.uid }
          : {}),
        updatedAt: timestamp,
        updatedBy: decodedToken.uid,
      });
    }
    if (plan.actorMemberPatch) {
      transaction.update(actorMemberRef, {
        ...plan.actorMemberPatch,
        updatedAt: timestamp,
        updatedBy: decodedToken.uid,
      });
    }
    if (plan.targetMemberPatch && targetMemberRef) {
      transaction.update(targetMemberRef, {
        ...plan.targetMemberPatch,
        ...(plan.targetMemberPatch.status === 'removed'
          ? { removedAt: timestamp, removedBy: decodedToken.uid }
          : {}),
        updatedAt: timestamp,
        updatedBy: decodedToken.uid,
      });
    }
    if (plan.targetMemberDelete && targetMemberRef) {
      transaction.delete(targetMemberRef);
    }
    if (plan.ban && targetMemberRef) {
      transaction.set(roomRef.collection('bans').doc(plan.ban.targetUid), {
        actorUid: decodedToken.uid,
        createdAt: timestamp,
        reason: command.reason,
        roomId: command.roomId,
        status: 'active',
        targetUid: plan.ban.targetUid,
        updatedAt: timestamp,
      });
    }
    if (plan.banPatch && targetBanRef) {
      transaction.update(targetBanRef, {
        ...plan.banPatch,
        revokedAt: timestamp,
        revokedBy: decodedToken.uid,
        updatedAt: timestamp,
      });
    }

    const eventRef = roomRef.collection('moderationEvents').doc(`command_${command.requestId}`);
    transaction.create(eventRef, {
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
      source: 'room-command-v2',
      status: 'applied',
      targetUid: command.targetUid,
      toRevision: command.nextRevision,
    });

    if (command.action === 'report-member') {
      transaction.create(db.doc(`reports/room_${command.requestId}`), {
        assignedTo: '',
        createdAt: timestamp,
        reason: command.reason,
        reporterUid: decodedToken.uid,
        resolutionNote: '',
        roomId: command.roomId,
        source: 'room-command-v2',
        status: 'open',
        subjectType: 'member',
        targetUid: command.targetUid,
        updatedAt: timestamp,
      });
    }

    transaction.create(requestRef, {
      action: command.action,
      actorAuthority: command.actorAuthority,
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      fingerprint,
      liveKit: plan.liveKit,
      liveKitSyncAttempts: 0,
      liveKitSyncStatus,
      response,
      roomId: command.roomId,
      status: 'applied',
      targetUid: command.targetUid,
      updatedAt: timestamp,
    });

    return { ...response, replayed: false, liveKit: plan.liveKit };
  });
}

async function synchronizeRoomCommandLiveKit({ db, fieldValue, requestId, roomId, roomService, liveKit }) {
  if (!liveKit || liveKit.type === 'none') return 'not-required';
  const requestRef = db.doc(`rooms/${roomId}/commandRequests/${requestId}`);
  const eventRef = db.doc(`rooms/${roomId}/moderationEvents/command_${requestId}`);
  try {
    await applyLiveKitPlan(roomService, roomId, liveKit, {
      resolveParticipantCanPublish: (uid) => resolveParticipantCanPublish(db, roomId, uid),
    });
    await Promise.all([
      requestRef.set({ liveKitSyncStatus: 'synced', liveKitSyncedAt: fieldValue.serverTimestamp(), updatedAt: fieldValue.serverTimestamp() }, { merge: true }),
      eventRef.set({ liveKitSyncStatus: 'synced' }, { merge: true }),
    ]);
    return 'synced';
  } catch (error) {
    if (isLiveKitNotFound(error)) {
      await Promise.all([
        requestRef.set({ liveKitSyncStatus: 'synced-offline', liveKitSyncedAt: fieldValue.serverTimestamp(), updatedAt: fieldValue.serverTimestamp() }, { merge: true }),
        eventRef.set({ liveKitSyncStatus: 'synced-offline' }, { merge: true }),
      ]);
      return 'synced-offline';
    }
    await Promise.all([
      requestRef.set({
        liveKitSyncAttempts: fieldValue.increment(1),
        liveKitSyncError: safeErrorMessage(error),
        liveKitSyncStatus: 'pending',
        updatedAt: fieldValue.serverTimestamp(),
      }, { merge: true }),
      eventRef.set({ liveKitSyncStatus: 'pending' }, { merge: true }),
    ]);
    throw error;
  }
}

async function retryPendingRoomLiveKitSync({ db, fieldValue, roomService, limit = 50 }) {
  const snapshot = await db.collectionGroup('commandRequests')
    .where('liveKitSyncStatus', '==', 'pending')
    .orderBy('updatedAt', 'asc')
    .limit(limit)
    .get();
  let synced = 0;
  let failed = 0;
  for (const document of snapshot.docs) {
    const data = document.data();
    try {
      await synchronizeRoomCommandLiveKit({
        db,
        fieldValue,
        liveKit: data.liveKit,
        requestId: document.id,
        roomId: data.roomId,
        roomService,
      });
      synced += 1;
    } catch {
      failed += 1;
    }
  }
  return { failed, scanned: snapshot.size, synced };
}

async function applyLiveKitPlan(roomService, roomId, plan, options = {}) {
  if (plan.type === 'remove-participant') {
    await roomService.removeParticipant(roomId, plan.targetUid, {
      revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)),
    });
    return;
  }
  if (plan.type === 'update-permission') {
    await roomService.updateParticipant(roomId, plan.targetUid, {
      permission: participantPermission(plan.canPublish),
    });
    return;
  }
  if (plan.type === 'mute-all') {
    const participants = await roomService.listParticipants(roomId);
    await Promise.all(participants.map((participant) => roomService.updateParticipant(roomId, participant.identity, {
      permission: participantPermission(false),
    })));
    return;
  }
  if (plan.type === 'refresh-all') {
    const participants = await roomService.listParticipants(roomId);
    await Promise.all(participants.map(async (participant) => {
      const canPublish = options.resolveParticipantCanPublish
        ? await options.resolveParticipantCanPublish(participant.identity)
        : false;
      await roomService.updateParticipant(roomId, participant.identity, {
        permission: participantPermission(canPublish),
      });
    }));
    return;
  }
  if (plan.type === 'close-room') await roomService.deleteRoom(roomId);
}

async function resolveParticipantCanPublish(db, roomId, uid) {
  const [roomSnapshot, memberSnapshot, banSnapshot] = await Promise.all([
    db.doc(`rooms/${roomId}`).get(),
    db.doc(`rooms/${roomId}/members/${uid}`).get(),
    db.doc(`rooms/${roomId}/bans/${uid}`).get(),
  ]);
  if (!roomSnapshot.exists || !memberSnapshot.exists) return false;
  const room = roomSnapshot.data();
  const member = memberSnapshot.data();
  if (room.status !== 'active' || room.audioLockdown === true || member.status === 'removed' || member.forceMuted === true) return false;
  if (banSnapshot.exists && isActiveBan(banSnapshot.data())) return false;
  const seatSnapshot = typeof member.seatId === 'string' && member.seatId
    ? await db.doc(`rooms/${roomId}/seats/${member.seatId}`).get()
    : null;
  return resolveSeatCanPublish(member, seatSnapshot?.exists ? seatSnapshot.data() : undefined, room);
}

function participantPermission(canPublish) {
  return {
    canPublish,
    canPublishData: true,
    canPublishSources: canPublish ? [TrackSource.MICROPHONE] : [],
    canSubscribe: true,
  };
}

function sanitizeErrorResponse(error) {
  return {
    ok: false,
    code: error.code,
    status: error.status,
    error: error.error,
    ...(error.details ? { details: error.details } : {}),
  };
}

function isLiveKitNotFound(error) {
  const value = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return value.includes('not_found') || value.includes('not found') || value.includes('404');
}

function safeErrorMessage(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

module.exports = {
  applyLiveKitPlan,
  executeRoomCommand,
  retryPendingRoomLiveKitSync,
  synchronizeRoomCommandLiveKit,
};
