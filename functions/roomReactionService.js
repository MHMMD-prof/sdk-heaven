const {
  ROOM_REACTION_RETENTION_MS,
  buildRoomReactionFingerprint,
  normalizeRoomReactionBody,
  reactionError,
  resolveRoomReaction,
  validateRoomReactionRequest,
} = require('./roomReactionCore');
const {
  ROOM_REACTION_RATE_LIMIT,
  ROOM_REACTION_RATE_WINDOW_MS,
  ROOM_REACTION_ROOM_RATE_LIMIT,
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

async function executeRoomReactionCommand({
  body,
  clock = systemClock,
  db,
  decodedToken,
  fieldValue,
}) {
  const validation = validateRoomReactionRequest(normalizeRoomReactionBody(body));
  if (!validation.ok) return validation;
  const command = validation.value;
  const fingerprint = buildRoomReactionFingerprint(decodedToken.uid, command);

  return db.runTransaction(async (transaction) => {
    const roomRef = db.doc(`rooms/${command.roomId}`);
    const requestRef = roomRef.collection('reactionRequests').doc(command.requestId);
    const userRateRef = roomRef.collection('reactionRateLimits').doc(decodedToken.uid);
    const roomRateRef = roomRef.collection('reactionRoomRateLimits').doc('default');
    const assetRef = db.doc(`cosmeticAssets/${command.assetId}`);
    const versionRef = db.doc(`cosmeticAssets/${command.assetId}/versions/${command.assetVersionId}`);
    const approvalRef = db.doc(`cosmeticAssetApprovals/${command.assetId}__${command.assetVersionId}`);

    const [
      requestSnapshot,
      featureSnapshot,
      roomSnapshot,
      memberSnapshot,
      presenceSnapshot,
      publicSnapshot,
      userRateSnapshot,
      roomRateSnapshot,
      assetSnapshot,
      versionSnapshot,
      approvalSnapshot,
    ] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(db.doc('appConfig/cosmeticsFeatures')),
      transaction.get(roomRef),
      transaction.get(roomRef.collection('members').doc(decodedToken.uid)),
      transaction.get(roomRef.collection('presence').doc(decodedToken.uid)),
      transaction.get(db.doc(`publicProfiles/${decodedToken.uid}`)),
      transaction.get(userRateRef),
      transaction.get(roomRateRef),
      transaction.get(assetRef),
      transaction.get(versionRef),
      transaction.get(approvalRef),
    ]);

    let replayResponse;
    if (requestSnapshot.exists) {
      const previous = requestSnapshot.data();
      if (previous.actorUid !== decodedToken.uid || previous.fingerprint !== fingerprint) {
        return reactionError('REQUEST_ID_CONFLICT', 409, 'This request ID belongs to another command.');
      }
      replayResponse = { ...previous.response, replayed: true };
    }

    const nowMs = clock.nowMillis();
    const membership = memberSnapshot.exists ? memberSnapshot.data() : undefined;
    const presence = presenceSnapshot.exists ? presenceSnapshot.data() : undefined;
    if (!membership || membership.uid !== decodedToken.uid || membership.status !== 'active') {
      return reactionError('MEMBERSHIP_REQUIRED', 403, 'Active room membership is required.');
    }
    if (
      !presence
      || presence.uid !== decodedToken.uid
      || presence.sessionId !== command.sessionId
      || presence.status !== 'online'
      || (timestampToMillis(presence.leaseExpiresAt) ?? 0) <= nowMs
    ) {
      return reactionError('SESSION_MISMATCH', 409, 'Room reactions require the current presence session.');
    }

    const resolution = resolveRoomReaction({
      approval: approvalSnapshot.exists ? approvalSnapshot.data() : undefined,
      assetSummary: assetSnapshot.exists ? assetSnapshot.data() : undefined,
      assetVersion: versionSnapshot.exists ? versionSnapshot.data() : undefined,
      command,
      cosmeticsFlags: featureSnapshot.exists ? featureSnapshot.data() : undefined,
      nowMs,
      publicProfile: publicSnapshot.exists ? publicSnapshot.data() : undefined,
      room: roomSnapshot.exists ? roomSnapshot.data() : undefined,
      senderUid: decodedToken.uid,
    });
    if (replayResponse) return resolution.ok ? replayResponse : resolution;

    const userRate = resolveSlidingWindowRateLimit({
      limit: ROOM_REACTION_RATE_LIMIT,
      nowMs,
      rate: userRateSnapshot.exists ? userRateSnapshot.data() : undefined,
      windowMs: ROOM_REACTION_RATE_WINDOW_MS,
    });
    if (!userRate.ok) return userRate;
    const roomRate = resolveSlidingWindowRateLimit({
      limit: ROOM_REACTION_ROOM_RATE_LIMIT,
      nowMs,
      rate: roomRateSnapshot.exists ? roomRateSnapshot.data() : undefined,
      windowMs: ROOM_REACTION_RATE_WINDOW_MS,
    });
    if (!roomRate.ok) return roomRate;

    const timestamp = fieldValue.serverTimestamp();
    const purgeAfter = clock.timestampFromMillis(nowMs + ROOM_REACTION_RETENTION_MS);
    if (!resolution.ok) {
      writeRateLimit(transaction, userRateRef, userRate.value, {
        clock,
        purgeAfter,
        timestamp,
        uid: decodedToken.uid,
      });
      writeRateLimit(transaction, roomRateRef, roomRate.value, {
        clock,
        purgeAfter,
        roomId: command.roomId,
        timestamp,
      });
      return resolution;
    }
    const response = {
      ok: true,
      result: {
        action: command.action,
        envelope: resolution.value.envelope,
        requestId: command.requestId,
        roomId: command.roomId,
        topic: resolution.value.topic,
      },
    };

    transaction.create(requestRef, {
      action: command.action,
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      fingerprint,
      purgeAfter,
      requestId: command.requestId,
      response,
      sessionId: command.sessionId,
    });
    writeRateLimit(transaction, userRateRef, userRate.value, {
      clock,
      purgeAfter,
      timestamp,
      uid: decodedToken.uid,
    });
    writeRateLimit(transaction, roomRateRef, roomRate.value, {
      clock,
      purgeAfter,
      roomId: command.roomId,
      timestamp,
    });
    return response;
  });
}

function writeRateLimit(transaction, reference, value, metadata) {
  transaction.set(reference, {
    attemptsMs: value.attemptsMs,
    count: value.count,
    purgeAfter: metadata.purgeAfter,
    updatedAt: metadata.timestamp,
    windowStartedAt: metadata.clock.timestampFromMillis(value.windowStartedAtMs),
    ...(metadata.uid ? { uid: metadata.uid } : {}),
    ...(metadata.roomId ? { roomId: metadata.roomId } : {}),
  }, { merge: true });
}

async function cleanupExpiredRoomReactionRecords({
  clock = systemClock,
  db,
  limit = 300,
}) {
  const now = clock.timestampFromMillis(clock.nowMillis());
  const pageSize = Math.max(1, Math.min(400, limit));
  let deleted = 0;
  for (const collectionGroup of ['reactionRequests', 'reactionRateLimits', 'reactionRoomRateLimits']) {
    while (true) {
      const snapshot = await db.collectionGroup(collectionGroup)
        .where('purgeAfter', '<=', now)
        .orderBy('purgeAfter', 'asc')
        .limit(pageSize)
        .get();
      if (!snapshot.docs.length) break;
      const batch = db.batch();
      snapshot.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
      deleted += snapshot.docs.length;
      if (snapshot.docs.length < pageSize) break;
    }
  }
  return { deleted, scanned: deleted };
}

module.exports = {
  cleanupExpiredRoomReactionRecords,
  executeRoomReactionCommand,
};
