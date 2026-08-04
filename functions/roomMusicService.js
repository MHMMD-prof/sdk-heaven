const {
  buildRoomMusicFingerprint,
  createRoomMusicLeaseId,
  isLeaseExpired,
  listRoomMusicCatalog,
  mapLeasePublic,
  MUSIC_COMMAND_RETENTION_MS,
  MUSIC_LEASE_RETENTION_MS,
  normalizeRoomMusicBody,
  resolveClaimDjLease,
  resolveHeartbeatDjLease,
  resolveStopMusic,
  resolveUpdateNowPlaying,
  roomMusicError,
  validateRoomMusicRequest,
} = require('./roomMusicCore');
const {
  ROOM_MUSIC_RATE_LIMIT,
  ROOM_MUSIC_RATE_WINDOW_MS,
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

async function executeRoomMusicCommand({
  body,
  clock = systemClock,
  db,
  decodedToken,
  fieldValue,
}) {
  const validation = validateRoomMusicRequest(normalizeRoomMusicBody(body));
  if (!validation.ok) return validation;
  const command = validation.value;
  const fingerprint = buildRoomMusicFingerprint(decodedToken.uid, command);
  const persistsReplay = !['heartbeat-dj-lease', 'list-room-music-catalog'].includes(command.action);

  return db.runTransaction(async (transaction) => {
    const roomRef = db.doc(`rooms/${command.roomId}`);
    const requestRef = roomRef.collection('musicCommandRequests').doc(command.requestId);
    const rateLimitRef = db.doc(`roomMusicRateLimits/${decodedToken.uid}`);
    const featureRef = db.doc('appConfig/voiceRoomFeatures');
    const memberRef = roomRef.collection('members').doc(decodedToken.uid);
    const publicRef = db.doc(`publicProfiles/${decodedToken.uid}`);
    const adminRef = db.doc(`adminProfiles/${decodedToken.uid}`);

    const [
      requestSnapshot,
      featureSnapshot,
      roomSnapshot,
      memberSnapshot,
      publicSnapshot,
      adminSnapshot,
      rateLimitSnapshot,
    ] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(featureRef),
      transaction.get(roomRef),
      transaction.get(memberRef),
      transaction.get(publicRef),
      transaction.get(adminRef),
      transaction.get(rateLimitRef),
    ]);

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
    const purgeAfter = clock.timestampFromMillis(nowMs + MUSIC_COMMAND_RETENTION_MS);
    const rateLimit = resolveSlidingWindowRateLimit({
      limit: ROOM_MUSIC_RATE_LIMIT,
      nowMs,
      rate: rateLimitSnapshot.exists ? rateLimitSnapshot.data() : undefined,
      windowMs: ROOM_MUSIC_RATE_WINDOW_MS,
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
      return deny(roomMusicError('ROOM_NOT_ACTIVE', 409, 'The room is not available for music.'));
    }
    const isPlatformStaff = operatorProfile?.status === 'active'
      && ['owner', 'super-moderator'].includes(operatorProfile.role);
    const isActiveMember = membership?.uid === decodedToken.uid && membership?.status === 'active';
    const hasActiveProfile = publicProfile?.uid === decodedToken.uid
      && publicProfile?.moderationStatus === 'active';
    if (!isPlatformStaff && (!isActiveMember || !hasActiveProfile)) {
      return deny(roomMusicError('MEMBERSHIP_REQUIRED', 403, 'Active room membership is required.'));
    }
    if (requestSnapshot.exists) {
      const previous = requestSnapshot.data();
      if (previous.actorUid !== decodedToken.uid || previous.fingerprint !== fingerprint) {
        return deny(roomMusicError('REQUEST_ID_CONFLICT', 409, 'This request ID belongs to another command.'));
      }
      writeRateLimit();
      return { ...previous.response, replayed: true };
    }

    if (command.action === 'list-room-music-catalog') {
      if (!isActiveMember || !hasActiveProfile) {
        return deny(roomMusicError('MEMBERSHIP_REQUIRED', 403, 'Active room membership is required.'));
      }
      const listed = listRoomMusicCatalog({ featureFlags });
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
        liveKit: { type: 'none' },
      };
      writeRateLimit();
      return response;
    }

    const activeLeaseId = typeof roomData?.activeMusicLeaseId === 'string'
      ? roomData.activeMusicLeaseId.trim()
      : '';
    let activeLeaseSnapshot;
    if (activeLeaseId) {
      activeLeaseSnapshot = await transaction.get(roomRef.collection('musicLeases').doc(activeLeaseId));
    }
    let activeLease = activeLeaseSnapshot?.exists
      ? { leaseId: activeLeaseId, ...activeLeaseSnapshot.data() }
      : undefined;

    if (activeLease && isLeaseExpired(activeLease, nowMs)) {
      const expiredRef = roomRef.collection('musicLeases').doc(activeLeaseId);
      transaction.update(expiredRef, {
        endedAt: clock.timestampFromMillis(nowMs),
        endReason: 'expired',
        status: 'expired',
        purgeAfter: clock.timestampFromMillis(nowMs + MUSIC_LEASE_RETENTION_MS),
        updatedAt: timestamp,
      });
      transaction.update(roomRef, {
        activeDjUid: null,
        activeMusicLeaseId: null,
        updatedAt: timestamp,
      });
      if (!['claim-dj-lease'].includes(command.action)) {
        return deny(roomMusicError('LEASE_EXPIRED', 409, 'The previous music lease expired.'));
      }
      activeLease = undefined;
      roomData.activeMusicLeaseId = null;
      roomData.activeDjUid = null;
    }

    let liveKit = { type: 'none' };
    let response;

    if (command.action === 'claim-dj-lease') {
      const leaseId = createRoomMusicLeaseId(command.roomId, command.requestId);
      const resolution = resolveClaimDjLease({
        actorMembership: membership,
        activeLease,
        command,
        featureFlags,
        leaseId,
        nowMs,
        operatorProfile,
        publicProfile,
        room: roomData,
        senderUid: decodedToken.uid,
      });
      if (!resolution.ok) return deny(resolution);
      const lease = resolution.value.lease;
      liveKit = resolution.value.liveKit;
      const leaseRef = roomRef.collection('musicLeases').doc(leaseId);
      response = {
        ok: true,
        result: {
          action: command.action,
          lease: mapLeasePublic(lease),
          leaseId,
          requestId: command.requestId,
          roomId: command.roomId,
        },
        liveKit,
      };
      transaction.create(leaseRef, {
        djDisplayName: lease.djDisplayName,
        djUid: lease.djUid,
        expiresAt: clock.timestampFromMillis(lease.expiresAtMs),
        expiresAtMs: lease.expiresAtMs,
        leaseId,
        nowPlaying: lease.nowPlaying,
        publishedTrackSid: '',
        revision: lease.revision,
        roomId: command.roomId,
        status: 'active',
        updatedAt: timestamp,
        createdAt: timestamp,
      });
      if (activeLeaseId && activeLeaseId !== leaseId && activeLeaseSnapshot?.exists) {
        transaction.update(roomRef.collection('musicLeases').doc(activeLeaseId), {
          endedAt: clock.timestampFromMillis(nowMs),
          endReason: 'replaced',
          status: 'stopped',
          updatedAt: timestamp,
        });
      }
      transaction.update(roomRef, {
        activeDjUid: lease.djUid,
        activeMusicLeaseId: leaseId,
        musicPaused: false,
        updatedAt: timestamp,
      });
    } else if (command.action === 'heartbeat-dj-lease') {
      const resolution = resolveHeartbeatDjLease({
        actorMembership: membership,
        command,
        featureFlags,
        lease: activeLease,
        nowMs,
        operatorProfile,
        room: roomData,
        senderUid: decodedToken.uid,
      });
      if (!resolution.ok) return deny(resolution);
      liveKit = resolution.value.liveKit;
      const leaseRef = roomRef.collection('musicLeases').doc(command.leaseId);
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
        liveKit,
      };
      transaction.update(leaseRef, {
        expiresAt: clock.timestampFromMillis(resolution.value.expiresAtMs),
        expiresAtMs: resolution.value.expiresAtMs,
        revision: resolution.value.revision,
        updatedAt: timestamp,
      });
    } else if (command.action === 'update-now-playing') {
      const resolution = resolveUpdateNowPlaying({
        actorMembership: membership,
        command,
        featureFlags,
        lease: activeLease,
        nowMs,
        operatorProfile,
        room: roomData,
        senderUid: decodedToken.uid,
      });
      if (!resolution.ok) return deny(resolution);
      liveKit = resolution.value.liveKit;
      const leaseRef = roomRef.collection('musicLeases').doc(command.leaseId);
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
        liveKit,
      };
      transaction.update(leaseRef, {
        expiresAt: clock.timestampFromMillis(resolution.value.expiresAtMs),
        expiresAtMs: resolution.value.expiresAtMs,
        nowPlaying: resolution.value.nowPlaying,
        revision: resolution.value.revision,
        updatedAt: timestamp,
      });
    } else if (command.action === 'stop-music') {
      const resolution = resolveStopMusic({
        actorMembership: membership,
        command,
        featureFlags,
        lease: activeLease,
        nowMs,
        operatorProfile,
        room: roomData,
        senderUid: decodedToken.uid,
      });
      if (!resolution.ok) return deny(resolution);
      liveKit = resolution.value.liveKit;
      const leaseRef = roomRef.collection('musicLeases').doc(command.leaseId);
      response = {
        ok: true,
        result: {
          action: command.action,
          leaseId: command.leaseId,
          requestId: command.requestId,
          roomId: command.roomId,
          stopped: true,
        },
        liveKit,
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
        purgeAfter: clock.timestampFromMillis(nowMs + MUSIC_LEASE_RETENTION_MS),
        updatedAt: timestamp,
      });
      transaction.update(roomRef, {
        activeDjUid: null,
        activeMusicLeaseId: null,
        updatedAt: timestamp,
      });
    } else {
      return deny(roomMusicError('INVALID_REQUEST', 400, 'A valid room music command is required.'));
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

async function expireRoomMusicLeases({
  clock = systemClock,
  db,
  limit = 100,
}) {
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);
  const snapshot = await db.collectionGroup('musicLeases')
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
        purgeAfter: clock.timestampFromMillis(nowMs + MUSIC_LEASE_RETENTION_MS),
        status: 'expired',
        updatedAt: timestamp,
      });
      if (roomSnapshot.exists && roomSnapshot.data()?.activeMusicLeaseId === leaseRef.id) {
        transaction.update(roomRef, {
          activeDjUid: null,
          activeMusicLeaseId: null,
          updatedAt: timestamp,
        });
      }
      return true;
    });
    if (changed) expired += 1;
  }
  return { expired, scanned: snapshot.size };
}

async function cleanupExpiredRoomMusicRecords({
  clock = systemClock,
  db,
  limit = 300,
}) {
  const now = clock.timestampFromMillis(clock.nowMillis());
  const documents = [];
  for (const collectionGroup of ['musicCommandRequests', 'roomMusicRateLimits']) {
    const remaining = Math.max(0, limit - documents.length);
    if (!remaining) break;
    const snapshot = await db.collectionGroup(collectionGroup)
      .where('purgeAfter', '<=', now)
      .orderBy('purgeAfter', 'asc')
      .limit(remaining)
      .get();
    documents.push(...snapshot.docs);
  }
  const remaining = Math.max(0, limit - documents.length);
  if (remaining) {
    const leases = await db.collectionGroup('musicLeases')
      .where('purgeAfter', '<=', now)
      .orderBy('purgeAfter', 'asc')
      .limit(remaining)
      .get();
    documents.push(...leases.docs.filter((document) => (
      ['stopped', 'expired'].includes(document.data()?.status)
    )));
  }
  if (!documents.length) return { deleted: 0, scanned: 0 };
  const batch = db.batch();
  for (const document of documents) batch.delete(document.ref);
  await batch.commit();
  return { deleted: documents.length, scanned: documents.length };
}

async function applyRoomMusicLiveKit(roomService, roomId, liveKit) {
  if (!liveKit || liveKit.type === 'none') {
    return { status: 'not-required' };
  }
  if (liveKit.type === 'mute-track' && liveKit.targetUid && liveKit.trackSid) {
    await roomService.mutePublishedTrack(roomId, liveKit.targetUid, liveKit.trackSid, true);
    return { status: 'applied' };
  }
  return { status: 'ignored' };
}

module.exports = {
  applyRoomMusicLiveKit,
  cleanupExpiredRoomMusicRecords,
  executeRoomMusicCommand,
  expireRoomMusicLeases,
};
