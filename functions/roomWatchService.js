'use strict';

const { mapGrowthFeatures } = require('./growthRolloutCore');
const {
  buildRoomWatchFingerprint,
  createRoomWatchLeaseId,
  isLeaseExpired,
  listRoomWatchCatalog,
  mapLeasePublic,
  normalizeRoomWatchBody,
  resolveClaimWatchLease,
  resolveHeartbeatWatchLease,
  resolveStopWatch,
  resolveUpdateWatchPlayback,
  roomWatchError,
  validateRoomWatchRequest,
  WATCH_COMMAND_RETENTION_MS,
  WATCH_LEASE_RETENTION_MS,
} = require('./roomWatchCore');
const {
  ROOM_WATCH_RATE_LIMIT,
  ROOM_WATCH_RATE_WINDOW_MS,
  resolveSlidingWindowRateLimit,
  timestampToMillis,
} = require('./voiceRoomRateLimitCore');

const systemClock = {
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => {
    const { Timestamp } = require('firebase-admin/firestore');
    return Timestamp.fromMillis(value);
  },
};

async function executeRoomWatchCommand({
  body,
  clock = systemClock,
  db,
  decodedToken,
  fieldValue,
}) {
  const validation = validateRoomWatchRequest(normalizeRoomWatchBody(body));
  if (!validation.ok) return validation;
  const command = validation.value;
  const fingerprint = buildRoomWatchFingerprint(decodedToken.uid, command);
  const persistsReplay = !['heartbeat-watch-lease', 'list-room-watch-catalog'].includes(command.action);

  return db.runTransaction(async (transaction) => {
    const roomRef = db.doc(`rooms/${command.roomId}`);
    const requestRef = roomRef.collection('watchCommandRequests').doc(command.requestId);
    const rateLimitRef = db.doc(`roomWatchRateLimits/${decodedToken.uid}`);
    const growthRef = db.doc('appConfig/growthFeatures');
    const featureRef = db.doc('appConfig/voiceRoomFeatures');
    const memberRef = roomRef.collection('members').doc(decodedToken.uid);
    const publicRef = db.doc(`publicProfiles/${decodedToken.uid}`);
    const adminRef = db.doc(`adminProfiles/${decodedToken.uid}`);

    const [
      requestSnapshot,
      growthSnapshot,
      featureSnapshot,
      roomSnapshot,
      memberSnapshot,
      publicSnapshot,
      adminSnapshot,
      rateLimitSnapshot,
    ] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(growthRef),
      transaction.get(featureRef),
      transaction.get(roomRef),
      transaction.get(memberRef),
      transaction.get(publicRef),
      transaction.get(adminRef),
      transaction.get(rateLimitRef),
    ]);

    const growthFlags = mapGrowthFeatures(growthSnapshot.exists ? growthSnapshot.data() : {});
    const featureFlags = featureSnapshot.exists ? featureSnapshot.data() : undefined;
    const roomData = roomSnapshot.exists ? { id: command.roomId, ...roomSnapshot.data() } : undefined;
    const membership = memberSnapshot.exists
      ? { uid: decodedToken.uid, ...memberSnapshot.data() }
      : undefined;
    const publicProfile = publicSnapshot.exists ? publicSnapshot.data() : undefined;
    const storedOperatorProfile = adminSnapshot.exists ? adminSnapshot.data() : undefined;
    const operatorRoleMatches = decodedToken.admin === true
      && storedOperatorProfile?.status === 'active'
      && decodedToken.adminRole === storedOperatorProfile.role;
    const operatorProfile = operatorRoleMatches && (
      decodedToken.adminRole === 'owner'
      || (
        decodedToken.adminRole === 'super-moderator'
        && featureFlags?.voice_room_super_moderation === true
        && Array.isArray(storedOperatorProfile.regionCodes)
        && storedOperatorProfile.regionCodes.includes(roomData?.countryCode)
      )
    )
      ? storedOperatorProfile
      : undefined;
    const nowMs = clock.nowMillis();
    const timestamp = fieldValue.serverTimestamp();
    const purgeAfter = clock.timestampFromMillis(nowMs + WATCH_COMMAND_RETENTION_MS);
    const rateLimit = resolveSlidingWindowRateLimit({
      limit: ROOM_WATCH_RATE_LIMIT,
      nowMs,
      rate: rateLimitSnapshot.exists ? rateLimitSnapshot.data() : undefined,
      windowMs: ROOM_WATCH_RATE_WINDOW_MS,
    });
    if (!rateLimit.ok) return rateLimit;
    let rateLimitWritten = false;
    const writeRateLimit = () => {
      if (rateLimitWritten) return;
      rateLimitWritten = true;
      transaction.set(rateLimitRef, {
        attemptsMs: rateLimit.value.attemptsMs,
        count: rateLimit.value.count,
        purgeAfter,
        roomId: command.roomId,
        uid: decodedToken.uid,
        updatedAt: timestamp,
        windowStartedAt: clock.timestampFromMillis(rateLimit.value.windowStartedAtMs),
      }, { merge: true });
    };
    const deny = (error) => {
      writeRateLimit();
      return error;
    };

    if (!roomSnapshot.exists || roomData?.status !== 'active' || roomData?.availability === 'removed') {
      return deny(roomWatchError('ROOM_NOT_ACTIVE', 409, 'The room is not available for watch.'));
    }
    const isPlatformStaff = operatorProfile?.status === 'active'
      && ['owner', 'super-moderator'].includes(operatorProfile.role);
    const isActiveMember = membership?.uid === decodedToken.uid && membership?.status === 'active';
    const hasActiveProfile = publicProfile?.uid === decodedToken.uid
      && publicProfile?.moderationStatus === 'active';
    if (!isPlatformStaff && (!isActiveMember || !hasActiveProfile)) {
      return deny(roomWatchError('MEMBERSHIP_REQUIRED', 403, 'Active room membership is required.'));
    }
    if (requestSnapshot.exists) {
      const previous = requestSnapshot.data();
      if (previous.actorUid !== decodedToken.uid || previous.fingerprint !== fingerprint) {
        return deny(roomWatchError('REQUEST_ID_CONFLICT', 409, 'This request ID belongs to another command.'));
      }
      writeRateLimit();
      return { ...previous.response, replayed: true };
    }

    if (command.action === 'list-room-watch-catalog') {
      if (!isActiveMember || !hasActiveProfile) {
        return deny(roomWatchError('MEMBERSHIP_REQUIRED', 403, 'Active room membership is required.'));
      }
      const listed = listRoomWatchCatalog({ growthFlags });
      if (!listed.ok) return deny(listed);
      const response = {
        ok: true,
        result: {
          action: command.action,
          catalog: listed.value.catalog,
          deviceFilesEnabled: listed.value.deviceFilesEnabled,
          leaseTtlMs: listed.value.leaseTtlMs,
          note: listed.value.note,
          requestId: command.requestId,
          roomId: command.roomId,
          syncMode: listed.value.syncMode,
        },
      };
      writeRateLimit();
      return response;
    }

    const activeLeaseId = typeof roomData?.activeWatchLeaseId === 'string'
      ? roomData.activeWatchLeaseId.trim()
      : '';
    let activeLeaseSnapshot;
    if (activeLeaseId) {
      activeLeaseSnapshot = await transaction.get(roomRef.collection('watchLeases').doc(activeLeaseId));
    }
    let activeLease = activeLeaseSnapshot?.exists
      ? { leaseId: activeLeaseId, ...activeLeaseSnapshot.data() }
      : undefined;

    if (activeLease && isLeaseExpired(activeLease, nowMs)) {
      const expiredRef = roomRef.collection('watchLeases').doc(activeLeaseId);
      transaction.update(expiredRef, {
        endedAt: clock.timestampFromMillis(nowMs),
        endReason: 'expired',
        status: 'expired',
        purgeAfter: clock.timestampFromMillis(nowMs + WATCH_LEASE_RETENTION_MS),
        updatedAt: timestamp,
      });
      transaction.update(roomRef, {
        activeWatchHostUid: null,
        activeWatchLeaseId: null,
        updatedAt: timestamp,
      });
      if (command.action !== 'claim-watch-lease') {
        return deny(roomWatchError('LEASE_EXPIRED', 409, 'The previous watch lease expired.'));
      }
      activeLease = undefined;
      roomData.activeWatchLeaseId = null;
      roomData.activeWatchHostUid = null;
    }

    let response;

    if (command.action === 'claim-watch-lease') {
      const leaseId = createRoomWatchLeaseId(command.roomId, command.requestId);
      const resolution = resolveClaimWatchLease({
        actorMembership: membership,
        activeLease,
        command,
        growthFlags,
        leaseId,
        nowMs,
        operatorProfile,
        publicProfile,
        room: roomData,
        senderUid: decodedToken.uid,
      });
      if (!resolution.ok) return deny(resolution);
      const lease = resolution.value.lease;
      const leaseRef = roomRef.collection('watchLeases').doc(leaseId);
      response = {
        ok: true,
        result: {
          action: command.action,
          lease: mapLeasePublic(lease),
          leaseId,
          requestId: command.requestId,
          roomId: command.roomId,
        },
      };
      transaction.create(leaseRef, {
        expiresAt: clock.timestampFromMillis(lease.expiresAtMs),
        expiresAtMs: lease.expiresAtMs,
        hostDisplayName: lease.hostDisplayName,
        hostUid: lease.hostUid,
        leaseId,
        nowPlaying: lease.nowPlaying,
        revision: lease.revision,
        roomId: command.roomId,
        status: 'active',
        updatedAt: timestamp,
        createdAt: timestamp,
      });
      if (activeLeaseId && activeLeaseId !== leaseId && activeLeaseSnapshot?.exists) {
        transaction.update(roomRef.collection('watchLeases').doc(activeLeaseId), {
          endedAt: clock.timestampFromMillis(nowMs),
          endReason: 'replaced',
          status: 'stopped',
          updatedAt: timestamp,
        });
      }
      transaction.update(roomRef, {
        activeWatchHostUid: lease.hostUid,
        activeWatchLeaseId: leaseId,
        updatedAt: timestamp,
      });
    } else if (command.action === 'heartbeat-watch-lease') {
      const resolution = resolveHeartbeatWatchLease({
        actorMembership: membership,
        command,
        growthFlags,
        lease: activeLease,
        nowMs,
        operatorProfile,
        room: roomData,
        senderUid: decodedToken.uid,
      });
      if (!resolution.ok) return deny(resolution);
      const leaseRef = roomRef.collection('watchLeases').doc(command.leaseId);
      response = {
        ok: true,
        result: {
          action: command.action,
          expiresAtMs: resolution.value.expiresAtMs,
          leaseId: command.leaseId,
          requestId: command.requestId,
          revision: resolution.value.revision,
          roomId: command.roomId,
        },
      };
      transaction.update(leaseRef, {
        expiresAt: clock.timestampFromMillis(resolution.value.expiresAtMs),
        expiresAtMs: resolution.value.expiresAtMs,
        revision: resolution.value.revision,
        updatedAt: timestamp,
      });
    } else if (command.action === 'update-watch-playback') {
      const resolution = resolveUpdateWatchPlayback({
        actorMembership: membership,
        command,
        growthFlags,
        lease: activeLease,
        nowMs,
        operatorProfile,
        room: roomData,
        senderUid: decodedToken.uid,
      });
      if (!resolution.ok) return deny(resolution);
      const leaseRef = roomRef.collection('watchLeases').doc(command.leaseId);
      response = {
        ok: true,
        result: {
          action: command.action,
          lease: mapLeasePublic({
            ...activeLease,
            expiresAtMs: resolution.value.expiresAtMs,
            nowPlaying: resolution.value.nowPlaying,
            revision: resolution.value.revision,
          }),
          leaseId: command.leaseId,
          requestId: command.requestId,
          roomId: command.roomId,
        },
      };
      transaction.update(leaseRef, {
        expiresAt: clock.timestampFromMillis(resolution.value.expiresAtMs),
        expiresAtMs: resolution.value.expiresAtMs,
        nowPlaying: resolution.value.nowPlaying,
        revision: resolution.value.revision,
        updatedAt: timestamp,
      });
    } else if (command.action === 'stop-watch') {
      const resolution = resolveStopWatch({
        actorMembership: membership,
        command,
        lease: activeLease,
        operatorProfile,
        room: roomData,
        senderUid: decodedToken.uid,
      });
      if (!resolution.ok) return deny(resolution);
      const leaseRef = roomRef.collection('watchLeases').doc(command.leaseId);
      response = {
        ok: true,
        result: {
          action: command.action,
          leaseId: command.leaseId,
          requestId: command.requestId,
          roomId: command.roomId,
          stopped: true,
        },
      };
      transaction.update(leaseRef, {
        endedAt: clock.timestampFromMillis(nowMs),
        endedBy: decodedToken.uid,
        endReason: 'stopped',
        nowPlaying: activeLease?.nowPlaying
          ? { ...activeLease.nowPlaying, playbackState: 'stopped', updatedAtMs: nowMs }
          : null,
        revision: resolution.value.revision,
        status: 'stopped',
        purgeAfter: clock.timestampFromMillis(nowMs + WATCH_LEASE_RETENTION_MS),
        updatedAt: timestamp,
      });
      transaction.update(roomRef, {
        activeWatchHostUid: null,
        activeWatchLeaseId: null,
        updatedAt: timestamp,
      });
    } else {
      return deny(roomWatchError('INVALID_REQUEST', 400, 'A valid room watch command is required.'));
    }

    if (persistsReplay) {
      transaction.create(requestRef, {
        action: command.action,
        actorUid: decodedToken.uid,
        createdAt: timestamp,
        fingerprint,
        purgeAfter,
        requestId: command.requestId,
        response,
      });
    }
    writeRateLimit();
    return response;
  });
}

async function expireRoomWatchLeases({
  clock = systemClock,
  db,
  limit = 100,
}) {
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);
  const snapshot = await db.collectionGroup('watchLeases')
    .where('expiresAt', '<=', now)
    .orderBy('expiresAt', 'asc')
    .limit(limit)
    .get();
  let expired = 0;
  for (const candidate of snapshot.docs) {
    const changed = await db.runTransaction(async (transaction) => {
      const leaseRef = candidate.ref;
      const roomRef = leaseRef.parent?.parent;
      if (!roomRef) return false;
      const [leaseSnapshot, roomSnapshot] = await Promise.all([
        transaction.get(leaseRef),
        transaction.get(roomRef),
      ]);
      if (!leaseSnapshot.exists) return false;
      const lease = leaseSnapshot.data();
      if (lease.status !== 'active' || timestampToMillis(lease.expiresAt) > nowMs) return false;
      const timestamp = clock.timestampFromMillis(nowMs);
      transaction.update(leaseRef, {
        endedAt: timestamp,
        endedBy: 'system',
        endReason: 'expired',
        nowPlaying: lease.nowPlaying
          ? { ...lease.nowPlaying, playbackState: 'stopped', updatedAtMs: nowMs }
          : null,
        purgeAfter: clock.timestampFromMillis(nowMs + WATCH_LEASE_RETENTION_MS),
        status: 'expired',
        updatedAt: timestamp,
      });
      if (roomSnapshot.exists && roomSnapshot.data()?.activeWatchLeaseId === leaseRef.id) {
        transaction.update(roomRef, {
          activeWatchHostUid: null,
          activeWatchLeaseId: null,
          updatedAt: timestamp,
        });
      }
      return true;
    });
    if (changed) expired += 1;
  }
  return { expired };
}

async function cleanupExpiredRoomWatchRecords({
  clock = systemClock,
  db,
  limit = 200,
}) {
  const now = clock.timestampFromMillis(clock.nowMillis());
  let cleaned = 0;
  for (const path of ['watchLeases', 'watchCommandRequests']) {
    const snapshot = await db.collectionGroup(path)
      .where('purgeAfter', '<=', now)
      .orderBy('purgeAfter', 'asc')
      .limit(limit)
      .get()
      .catch(() => null);
    if (!snapshot) continue;
    for (const doc of snapshot.docs) {
      await doc.ref.delete().catch(() => undefined);
      cleaned += 1;
    }
  }
  return { cleaned };
}

module.exports = {
  cleanupExpiredRoomWatchRecords,
  executeRoomWatchCommand,
  expireRoomWatchLeases,
};
