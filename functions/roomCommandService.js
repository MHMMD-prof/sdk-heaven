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
const { Timestamp } = require('firebase-admin/firestore');
const { isActiveBan, resolveSeatCanPublish } = require('./livekitTokenCore');
const { randomUUID } = require('node:crypto');
const { ROOM_REMOVAL_RECOVERY_MS } = require('./roomLifecycleService');
const {
  GAME_SESSION_RETENTION_MS,
  LOBBY_TTL_MS,
} = require('./roomGameCore');
const { MUSIC_LEASE_RETENTION_MS } = require('./roomMusicCore');
const {
  LIVEKIT_SYNC_MAX_ATTEMPTS,
  ROOM_COMMAND_RATE_LIMIT,
  ROOM_COMMAND_RATE_WINDOW_MS,
  VOICE_ROOM_COMMAND_RECORD_RETENTION_MS,
  VOICE_ROOM_RATE_RECORD_RETENTION_MS,
  resolveSlidingWindowRateLimit,
  timestampToMillis,
} = require('./voiceRoomRateLimitCore');

const LIVEKIT_SYNC_LEASE_MS = 30_000;

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
    const rateLimitRef = roomRef.collection('commandRateLimits').doc(decodedToken.uid);
    const targetMemberRef = normalized.targetUid
      ? roomRef.collection('members').doc(normalized.targetUid)
      : null;
    const targetBanRef = normalized.action === 'unban-member' && normalized.targetUid
      ? roomRef.collection('bans').doc(normalized.targetUid)
      : null;
    const targetOperatorProfileRef = normalized.targetUid
      ? db.doc(`adminProfiles/${normalized.targetUid}`)
      : null;
    const [
      requestSnapshot,
      profileSnapshot,
      publicProfileSnapshot,
      operatorProfileSnapshot,
      featureFlagsSnapshot,
      roomSnapshot,
      actorMemberSnapshot,
      rateLimitSnapshot,
      targetMemberSnapshot,
      targetBanSnapshot,
      targetOperatorProfileSnapshot,
    ] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(profileRef),
      transaction.get(publicProfileRef),
      transaction.get(operatorProfileRef),
      transaction.get(featureFlagsRef),
      transaction.get(roomRef),
      transaction.get(actorMemberRef),
      transaction.get(rateLimitRef),
      targetMemberRef ? transaction.get(targetMemberRef) : Promise.resolve(null),
      targetBanRef ? transaction.get(targetBanRef) : Promise.resolve(null),
      targetOperatorProfileRef ? transaction.get(targetOperatorProfileRef) : Promise.resolve(null),
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
        nowMs: Date.now(),
        operatorProfile: operatorProfileSnapshot.exists ? operatorProfileSnapshot.data() : undefined,
        profile: profileSnapshot.exists ? profileSnapshot.data() : undefined,
        room,
        targetBan: targetBanSnapshot?.exists ? targetBanSnapshot.data() : undefined,
        targetMembership: targetMemberSnapshot?.exists ? targetMemberSnapshot.data() : undefined,
        targetOperatorProfile: targetOperatorProfileSnapshot?.exists
          ? targetOperatorProfileSnapshot.data()
          : undefined,
      })
      : roomCommandError('ACCOUNT_RESTRICTED', 403, 'This account cannot perform room commands.');

    const timestamp = fieldValue.serverTimestamp();
    const requestPurgeAfter = Timestamp.fromMillis(Date.now() + VOICE_ROOM_COMMAND_RECORD_RETENTION_MS);
    if (!resolution.ok) {
      const response = sanitizeErrorResponse(resolution);
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

    const rateLimit = resolveSlidingWindowRateLimit({
      limit: ROOM_COMMAND_RATE_LIMIT,
      nowMs: Date.now(),
      rate: rateLimitSnapshot.exists ? rateLimitSnapshot.data() : undefined,
      windowMs: ROOM_COMMAND_RATE_WINDOW_MS,
    });
    if (!rateLimit.ok) {
      const response = sanitizeErrorResponse(rateLimit);
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
        status: 'denied',
        targetUid: normalized.targetUid,
        updatedAt: timestamp,
      });
      return { ...response, replayed: false, liveKit: { type: 'none' } };
    }

    const command = resolution.value;
    const actorMembership = actorMemberSnapshot.exists ? actorMemberSnapshot.data() : undefined;
    const targetMembership = targetMemberSnapshot?.exists ? targetMemberSnapshot.data() : undefined;
    const targetSeatRef = targetMembership?.seatId
      ? roomRef.collection('seats').doc(targetMembership.seatId)
      : null;
    const activeGameSessionRef = (
      ['staff-lockdown', 'kick-everyone'].includes(command.action)
      || ['remove-member', 'ban-member'].includes(command.action)
    ) && room?.activeGameSessionId
      ? roomRef.collection('gameSessions').doc(room.activeGameSessionId)
      : null;
    const shouldReadMusicLease = Boolean(room?.activeMusicLeaseId) && (
      ['staff-lockdown', 'kick-everyone'].includes(command.action)
      || (command.action === 'revoke-dj' && room.activeDjUid === command.targetUid)
      || (['remove-member', 'ban-member'].includes(command.action)
        && room.activeDjUid === command.targetUid)
      || ['close-room', 'remove-room'].includes(command.action)
    );
    const activeMusicLeaseRef = shouldReadMusicLease
      ? roomRef.collection('musicLeases').doc(room.activeMusicLeaseId)
      : null;
    const [targetSeatSnapshot, activeGameSessionSnapshot, activeMusicLeaseSnapshot] = await Promise.all([
      targetSeatRef ? transaction.get(targetSeatRef) : Promise.resolve(null),
      activeGameSessionRef ? transaction.get(activeGameSessionRef) : Promise.resolve(null),
      activeMusicLeaseRef ? transaction.get(activeMusicLeaseRef) : Promise.resolve(null),
    ]);
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
    let gameSessionMemberPatch;
    if (
      ['remove-member', 'ban-member'].includes(command.action)
      && activeGameSessionSnapshot?.exists
    ) {
      const session = activeGameSessionSnapshot.data();
      const players = Array.isArray(session.playerUids) ? session.playerUids : [];
      if (['lobby', 'active'].includes(session.status) && players.includes(command.targetUid)) {
        const nextPlayers = players.filter((uid) => uid !== command.targetUid);
        if (!nextPlayers.length) {
          gameSessionMemberPatch = {
            endedAt: timestamp,
            endedBy: decodedToken.uid,
            endReason: command.action,
            hostUid: '',
            playerCount: 0,
            playerUids: [],
            purgeAfter: Timestamp.fromMillis(Date.now() + GAME_SESSION_RETENTION_MS),
            status: 'abandoned',
            updatedAt: timestamp,
          };
          plan.roomPatch.activeGameSessionId = null;
          plan.roomPatch.currentGameId = null;
        } else {
          const belowMinimum = nextPlayers.length < Number(session.minPlayers || 2);
          gameSessionMemberPatch = {
            ...(session.hostUid === command.targetUid ? { hostUid: nextPlayers[0] } : {}),
            ...(belowMinimum
              ? {
                  expiresAt: Timestamp.fromMillis(Date.now() + LOBBY_TTL_MS),
                  status: 'lobby',
                }
              : {}),
            playerCount: nextPlayers.length,
            playerUids: nextPlayers,
            updatedAt: timestamp,
          };
        }
      }
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

    transaction.set(rateLimitRef, {
      attemptsMs: rateLimit.value.attemptsMs,
      count: rateLimit.value.count,
      purgeAfter: Timestamp.fromMillis(Date.now() + VOICE_ROOM_RATE_RECORD_RETENTION_MS),
      uid: decodedToken.uid,
      updatedAt: timestamp,
      windowStartedAt: Timestamp.fromMillis(rateLimit.value.windowStartedAtMs),
    }, { merge: true });

    if (plan.roomPatch) {
      const patch = { ...plan.roomPatch };
      if (Object.prototype.hasOwnProperty.call(patch, 'staffLockdown') && patch.staffLockdown === null) {
        patch.staffLockdown = fieldValue.delete();
      }
      transaction.update(roomRef, {
        ...patch,
        ...(command.action === 'remove-room'
          ? {
            deletionStatus: 'recoverable',
            removedAt: timestamp,
            removedBy: decodedToken.uid,
            scheduledDeletionAt: new Date(Date.now() + ROOM_REMOVAL_RECOVERY_MS),
          }
          : {}),
        updatedAt: timestamp,
        updatedBy: decodedToken.uid,
      });
    }
    if (plan.clearActiveGameSession && activeGameSessionRef && activeGameSessionSnapshot?.exists) {
      const session = activeGameSessionSnapshot.data();
      if (['lobby', 'active'].includes(session.status)) {
        transaction.update(activeGameSessionRef, {
          endedAt: timestamp,
          endedBy: decodedToken.uid,
          endReason: command.action,
          purgeAfter: Timestamp.fromMillis(Date.now() + GAME_SESSION_RETENTION_MS),
          status: 'ended',
          updatedAt: timestamp,
        });
      }
    } else if (gameSessionMemberPatch && activeGameSessionRef) {
      transaction.update(activeGameSessionRef, gameSessionMemberPatch);
    }
    if (plan.clearActiveMusicLease && activeMusicLeaseRef && activeMusicLeaseSnapshot?.exists) {
      const lease = activeMusicLeaseSnapshot.data();
      if (lease.status === 'active') {
        transaction.update(activeMusicLeaseRef, {
          endedAt: timestamp,
          endedBy: decodedToken.uid,
          endReason: command.action === 'revoke-dj' ? 'dj-revoked' : command.action,
          nowPlaying: lease.nowPlaying
            ? { ...lease.nowPlaying, playbackState: 'stopped', updatedAtMs: Date.now() }
            : null,
          purgeAfter: Timestamp.fromMillis(Date.now() + MUSIC_LEASE_RETENTION_MS),
          status: 'stopped',
          updatedAt: timestamp,
        });
      }
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
    const recordsLockdownState = ['staff-lockdown', 'kick-everyone'].includes(command.action)
      || command.action === 'clear-staff-lockdown';
    const beforeLockdownState = recordsLockdownState
      ? {
        audioLockdown: room.audioLockdown === true,
        chatMode: room.chatMode || 'everyone',
        effectsPolicy: room.effectsPolicy || 'full',
        gamesPaused: room.gamesPaused === true,
        giftsPaused: room.giftsPaused === true,
        musicPaused: room.musicPaused === true,
        seatRequestsPaused: room.seatRequestsPaused === true,
        staffLockdown: room.staffLockdown || null,
      }
      : null;
    const afterLockdownState = recordsLockdownState
      ? {
        audioLockdown: plan.roomPatch.audioLockdown === true,
        chatMode: plan.roomPatch.chatMode || room.chatMode || 'everyone',
        effectsPolicy: plan.roomPatch.effectsPolicy || room.effectsPolicy || 'full',
        gamesPaused: plan.roomPatch.gamesPaused === true,
        giftsPaused: plan.roomPatch.giftsPaused === true,
        musicPaused: plan.roomPatch.musicPaused === true,
        seatRequestsPaused: plan.roomPatch.seatRequestsPaused === true,
        staffLockdown: plan.roomPatch.staffLockdown || null,
      }
      : null;
    transaction.create(eventRef, {
      action: command.action,
      actorAuthority: command.actorAuthority,
      actorRegionCodes: command.actorAuthority === 'super-moderator'
        ? operatorProfileSnapshot.data()?.regionCodes || []
        : [],
      actorUid: decodedToken.uid,
      affectedCount: command.targetUid ? 1 : Number(room.participantCount || 0),
      affectedScope: command.targetUid ? 'target-member' : recordsLockdownState ? 'all-active-members' : 'room',
      affectedUids: command.targetUid ? [command.targetUid] : [],
      ...(recordsLockdownState ? { after: afterLockdownState, before: beforeLockdownState } : {}),
      createdAt: timestamp,
      fromRevision: command.currentRevision,
      liveKitSyncStatus,
      reason: command.reason,
      regionCode: command.regionCode,
      reportId: command.reportId || '',
      requestId: command.requestId,
      roomId: command.roomId,
      source: 'room-command-v2',
      status: 'applied',
      targetUid: command.targetUid,
      toRevision: command.nextRevision,
    });
    if (['super-moderator', 'platform-owner'].includes(command.actorAuthority)) {
      const adminAuditRef = db.doc(`adminAuditEvents/room_command_${command.requestId}`);
      transaction.create(adminAuditRef, {
        action: `room-${command.action}`,
        actorEmail: decodedToken.email || '',
        actorRegionCodes: command.actorAuthority === 'super-moderator'
          ? operatorProfileSnapshot.data()?.regionCodes || []
          : [],
        actorRole: command.actorAuthority,
        actorUid: decodedToken.uid,
        affectedCount: command.targetUid ? 1 : Number(room.participantCount || 0),
        affectedScope: command.targetUid ? 'target-member' : recordsLockdownState ? 'all-active-members' : 'room',
        affectedUids: command.targetUid ? [command.targetUid] : [],
        ...(recordsLockdownState ? { after: afterLockdownState, before: beforeLockdownState } : {}),
        countryCode: command.regionCode || room.countryCode || '',
        createdAt: timestamp,
        eventPath: eventRef.path,
        kind: 'room-moderation',
        liveKitSyncStatus,
        note: command.reason,
        reportId: command.reportId || '',
        requestId: command.requestId,
        roomAction: command.action,
        roomId: command.roomId,
        source: 'room-command-v2',
        status: 'applied',
        targetUid: command.targetUid,
      });
    }
    if (
      command.actorAuthority === 'super-moderator'
      && ['close-room', 'kick-everyone', 'remove-room', 'staff-lockdown'].includes(command.action)
    ) {
      const ownerUid = room.ownerUid || room.hostId || '';
      if (ownerUid) {
        transaction.create(
          db.doc(`roomModerationNotifications/${ownerUid}/items/${command.requestId}`),
          {
            action: command.action,
            appealStatus: 'available',
            createdAt: timestamp,
            delayedDisclosure: false,
            ownerUid,
            reason: command.reason,
            reportId: command.reportId || '',
            requestId: command.requestId,
            roomId: command.roomId,
            status: 'unread',
          },
        );
        transaction.create(db.doc(`roomModerationAppeals/${command.roomId}_${command.requestId}`), {
          action: command.action,
          createdAt: timestamp,
          ownerUid,
          requestId: command.requestId,
          roomId: command.roomId,
          status: 'eligible',
        });
      }
      if (rateLimit.value.count >= 10) {
        transaction.create(db.doc(`adminSecurityAlerts/${command.requestId}`), {
          action: command.action,
          actorUid: decodedToken.uid,
          countInWindow: rateLimit.value.count,
          countryCode: command.regionCode || room.countryCode || '',
          createdAt: timestamp,
          kind: 'repeated-emergency-use',
          requestId: command.requestId,
          roomId: command.roomId,
          status: 'open',
          windowMs: ROOM_COMMAND_RATE_WINDOW_MS,
        });
      }
    }

    if (command.action === 'report-member') {
      transaction.create(db.doc(`reports/room_${command.requestId}`), {
        assignedTo: '',
        countryCode: command.regionCode || room.countryCode || '',
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
      purgeAfter: requestPurgeAfter,
      response,
      roomId: command.roomId,
      status: 'applied',
      targetUid: command.targetUid,
      updatedAt: timestamp,
    });

    return { ...response, replayed: false, liveKit: plan.liveKit };
  });
}

async function synchronizeRoomCommandLiveKit({
  db,
  fieldValue,
  requestId,
  roomId,
  roomService,
  liveKit,
  workerId = `livekit_${randomUUID()}`,
}) {
  if (!liveKit || liveKit.type === 'none') return 'not-required';
  const requestRef = db.doc(`rooms/${roomId}/commandRequests/${requestId}`);
  const eventRef = db.doc(`rooms/${roomId}/moderationEvents/command_${requestId}`);
  const claim = await claimRoomCommandLiveKitSync({
    db,
    fieldValue,
    requestRef,
    workerId,
  });
  if (!claim.claimed) return claim.status;
  const actorAuthority = claim.request?.actorAuthority || '';
  const adminAuditRef = ['super-moderator', 'platform-owner'].includes(actorAuthority)
    ? db.doc(`adminAuditEvents/room_command_${requestId}`)
    : null;
  const clearLease = {
    liveKitSyncLeaseOwner: typeof fieldValue.delete === 'function' ? fieldValue.delete() : null,
    liveKitSyncLeaseUntil: typeof fieldValue.delete === 'function' ? fieldValue.delete() : null,
  };
  try {
    await applyLiveKitPlan(roomService, roomId, liveKit, {
      resolveParticipantCanPublish: (uid) => resolveParticipantCanPublish(db, roomId, uid),
    });
    await Promise.all([
      requestRef.set({
        ...clearLease,
        liveKitSyncStatus: 'synced',
        liveKitSyncedAt: fieldValue.serverTimestamp(),
        updatedAt: fieldValue.serverTimestamp(),
      }, { merge: true }),
      eventRef.set({ liveKitSyncStatus: 'synced' }, { merge: true }),
      adminAuditRef ? adminAuditRef.set({ liveKitSyncStatus: 'synced' }, { merge: true }) : Promise.resolve(),
    ]);
    return 'synced';
  } catch (error) {
    if (isLiveKitNotFound(error)) {
      await Promise.all([
        requestRef.set({
          ...clearLease,
          liveKitSyncStatus: 'synced-offline',
          liveKitSyncedAt: fieldValue.serverTimestamp(),
          updatedAt: fieldValue.serverTimestamp(),
        }, { merge: true }),
        eventRef.set({ liveKitSyncStatus: 'synced-offline' }, { merge: true }),
        adminAuditRef ? adminAuditRef.set({ liveKitSyncStatus: 'synced-offline' }, { merge: true }) : Promise.resolve(),
      ]);
      return 'synced-offline';
    }
    const nextAttempts = Number(claim.request?.liveKitSyncAttempts || 0) + 1;
    const deadLettered = nextAttempts >= LIVEKIT_SYNC_MAX_ATTEMPTS;
    const nextStatus = deadLettered ? 'dead-letter' : 'pending';
    const safeError = safeErrorMessage(error);
    const alertRef = deadLettered
      ? db.doc(`adminSecurityAlerts/livekit_${roomId}_${requestId}`)
      : null;
    await Promise.all([
      requestRef.set({
        ...clearLease,
        ...(deadLettered ? { liveKitDeadLetteredAt: fieldValue.serverTimestamp() } : {}),
        liveKitSyncAttempts: nextAttempts,
        liveKitSyncError: safeError,
        liveKitSyncStatus: nextStatus,
        updatedAt: fieldValue.serverTimestamp(),
      }, { merge: true }),
      eventRef.set({ liveKitSyncError: safeError, liveKitSyncStatus: nextStatus }, { merge: true }),
      adminAuditRef
        ? adminAuditRef.set({ liveKitSyncError: safeError, liveKitSyncStatus: nextStatus }, { merge: true })
        : Promise.resolve(),
      alertRef
        ? alertRef.set({
          attempts: nextAttempts,
          createdAt: fieldValue.serverTimestamp(),
          error: safeError,
          kind: 'livekit-sync-dead-letter',
          requestId,
          roomId,
          status: 'open',
        }, { merge: true })
        : Promise.resolve(),
    ]);
    if (deadLettered) return 'dead-letter';
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
  let deadLetter = 0;
  let leased = 0;
  for (const document of snapshot.docs) {
    const data = document.data();
    const attempts = Number(data.liveKitSyncAttempts || 0);
    if (attempts >= LIVEKIT_SYNC_MAX_ATTEMPTS) {
      await markRoomCommandLiveKitDeadLetter({
        actorAuthority: data.actorAuthority,
        db,
        error: data.liveKitSyncError || 'Maximum LiveKit retry attempts reached.',
        fieldValue,
        requestId: document.id,
        roomId: data.roomId,
      });
      deadLetter += 1;
      continue;
    }
    try {
      const status = await synchronizeRoomCommandLiveKit({
        db,
        fieldValue,
        liveKit: data.liveKit,
        requestId: document.id,
        roomId: data.roomId,
        roomService,
      });
      if (status === 'dead-letter') deadLetter += 1;
      else if (status === 'leased') leased += 1;
      else synced += 1;
    } catch {
      failed += 1;
    }
  }
  return { deadLetter, failed, leased, scanned: snapshot.size, synced };
}

async function claimRoomCommandLiveKitSync({
  db,
  fieldValue,
  requestRef,
  workerId,
}) {
  const nowMs = Date.now();
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(requestRef);
    if (!snapshot.exists) return { claimed: false, status: 'missing' };
    const request = snapshot.data();
    if (request.liveKitSyncStatus !== 'pending') {
      return { claimed: false, status: request.liveKitSyncStatus || 'not-required' };
    }
    const leaseUntilMs = timestampToMillis(request.liveKitSyncLeaseUntil);
    if (leaseUntilMs !== undefined && leaseUntilMs > nowMs && request.liveKitSyncLeaseOwner !== workerId) {
      return { claimed: false, status: 'leased' };
    }
    transaction.set(requestRef, {
      liveKitSyncLeaseOwner: workerId,
      liveKitSyncLeaseUntil: Timestamp.fromMillis(nowMs + LIVEKIT_SYNC_LEASE_MS),
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true });
    return { claimed: true, request };
  });
}

async function markRoomCommandLiveKitDeadLetter({
  actorAuthority,
  db,
  error,
  fieldValue,
  requestId,
  roomId,
}) {
  const requestRef = db.doc(`rooms/${roomId}/commandRequests/${requestId}`);
  const eventRef = db.doc(`rooms/${roomId}/moderationEvents/command_${requestId}`);
  const auditRef = ['super-moderator', 'platform-owner'].includes(actorAuthority)
    ? db.doc(`adminAuditEvents/room_command_${requestId}`)
    : null;
  const alertRef = db.doc(`adminSecurityAlerts/livekit_${roomId}_${requestId}`);
  const safeError = safeErrorMessage(error);
  await Promise.all([
    requestRef.set({
      liveKitDeadLetteredAt: fieldValue.serverTimestamp(),
      liveKitSyncError: safeError,
      liveKitSyncLeaseOwner: typeof fieldValue.delete === 'function' ? fieldValue.delete() : null,
      liveKitSyncLeaseUntil: typeof fieldValue.delete === 'function' ? fieldValue.delete() : null,
      liveKitSyncStatus: 'dead-letter',
      updatedAt: fieldValue.serverTimestamp(),
    }, { merge: true }),
    eventRef.set({ liveKitSyncError: safeError, liveKitSyncStatus: 'dead-letter' }, { merge: true }),
    auditRef
      ? auditRef.set({ liveKitSyncError: safeError, liveKitSyncStatus: 'dead-letter' }, { merge: true })
      : Promise.resolve(),
    alertRef.set({
      createdAt: fieldValue.serverTimestamp(),
      error: safeError,
      kind: 'livekit-sync-dead-letter',
      requestId,
      roomId,
      status: 'open',
    }, { merge: true }),
  ]);
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
