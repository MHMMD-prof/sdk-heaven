const {
  normalizeRoomMediaCommandBody,
  resolveRoomMediaCommand,
  validateRoomImageObject,
} = require('./roomMediaCore');
const { roomCommandError } = require('./roomCommandCore');
const sharp = require('sharp');

async function executeRoomMediaCommand({
  body,
  bucket,
  db,
  decodedToken,
  fieldValue,
}) {
  const normalized = normalizeRoomMediaCommandBody(body);
  const fingerprint = buildRoomMediaFingerprint(decodedToken.uid, normalized);
  const submittedFile = normalized.action === 'submit-room-image' && normalized.mediaPath
    ? bucket.file(normalized.mediaPath)
    : null;
  if (
    /^[^/]{1,128}$/.test(normalized.roomId)
    && /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/.test(normalized.requestId)
  ) {
    const previousSnapshot = await db.doc(
      `rooms/${normalized.roomId}/mediaRequests/${normalized.requestId}`,
    ).get();
    if (previousSnapshot.exists) {
      const previous = previousSnapshot.data();
      if (previous.actorUid !== decodedToken.uid || previous.fingerprint !== fingerprint) {
        return roomCommandError('REQUEST_ID_CONFLICT', 409, 'This request ID belongs to a different media command.');
      }
      return { ...previous.response, replayed: true };
    }
  }
  const preflight = await loadAuthorityState(db, decodedToken.uid, normalized.roomId);
  const preflightResolution = resolveWithState({
    body,
    decodedToken,
    state: preflight,
  });
  if (!preflightResolution.ok) {
    await deleteUncommittedRoomImage({
      db,
      file: submittedFile,
      mediaId: normalized.mediaId,
      roomId: normalized.roomId,
    });
    return preflightResolution;
  }

  let verifiedObject;
  if (normalized.action === 'submit-room-image') {
    const file = submittedFile;
    let metadata;
    let buffer;
    try {
      [[metadata], [buffer]] = await Promise.all([file.getMetadata(), file.download()]);
    } catch (error) {
      if (isObjectNotFound(error)) {
        return roomCommandError('ROOM_IMAGE_NOT_FOUND', 404, 'The uploaded room image was not found.');
      }
      throw error;
    }
    const size = Number(metadata.size);
    let decoded;
    try {
      decoded = await sharp(buffer, {
        failOn: 'warning',
        limitInputPixels: 4096 * 4096,
      }).metadata();
    } catch {
      await deleteUncommittedRoomImage({
        db,
        file,
        mediaId: normalized.mediaId,
        roomId: normalized.roomId,
      });
      return roomCommandError('ROOM_IMAGE_INVALID', 400, 'The uploaded room image could not be decoded.');
    }
    const validation = validateRoomImageObject({
      buffer,
      contentType: metadata.contentType,
      decodedFormat: decoded.format,
      decodedHeight: decoded.height,
      decodedWidth: decoded.width,
      size,
      uploaderUid: metadata.metadata?.uploaderUid,
    });
    if (!validation.ok) {
      await deleteUncommittedRoomImage({
        db,
        file,
        mediaId: normalized.mediaId,
        roomId: normalized.roomId,
      });
      return validation;
    }
    if (validation.value.uploaderUid !== decodedToken.uid) {
      await deleteUncommittedRoomImage({
        db,
        file,
        mediaId: normalized.mediaId,
        roomId: normalized.roomId,
      });
      return roomCommandError('FORBIDDEN', 403, 'The room image uploader does not match the room owner.');
    }
    verifiedObject = {
      ...validation.value,
      generation: typeof metadata.generation === 'string' ? metadata.generation : '',
    };
  }

  let result;
  try {
    result = await db.runTransaction(async (transaction) => {
    const roomRef = db.doc(`rooms/${normalized.roomId}`);
    const requestRef = roomRef.collection('mediaRequests').doc(normalized.requestId);
    const mediaRef = normalized.mediaId
      ? roomRef.collection('media').doc(normalized.mediaId)
      : null;
    const [
      requestSnapshot,
      roomSnapshot,
      profileSnapshot,
      publicProfileSnapshot,
      operatorProfileSnapshot,
      featureFlagsSnapshot,
      actorMemberSnapshot,
      mediaSnapshot,
    ] = await Promise.all([
      transaction.get(requestRef),
      transaction.get(roomRef),
      transaction.get(db.doc(`users/${decodedToken.uid}`)),
      transaction.get(db.doc(`publicProfiles/${decodedToken.uid}`)),
      transaction.get(db.doc(`adminProfiles/${decodedToken.uid}`)),
      transaction.get(db.doc('appConfig/voiceRoomFeatures')),
      transaction.get(roomRef.collection('members').doc(decodedToken.uid)),
      mediaRef ? transaction.get(mediaRef) : Promise.resolve(null),
    ]);

    if (requestSnapshot.exists) {
      const previous = requestSnapshot.data();
      if (previous.actorUid !== decodedToken.uid || previous.fingerprint !== fingerprint) {
        return roomCommandError('REQUEST_ID_CONFLICT', 409, 'This request ID belongs to a different media command.');
      }
      return { ...previous.response, replayed: true };
    }

    const state = {
      actorMembership: actorMemberSnapshot.exists ? actorMemberSnapshot.data() : undefined,
      featureFlags: featureFlagsSnapshot.exists ? featureFlagsSnapshot.data() : undefined,
      operatorProfile: operatorProfileSnapshot.exists ? operatorProfileSnapshot.data() : undefined,
      profile: profileSnapshot.exists ? profileSnapshot.data() : undefined,
      publicProfile: publicProfileSnapshot.exists ? publicProfileSnapshot.data() : undefined,
      room: roomSnapshot.exists ? roomSnapshot.data() : undefined,
    };
    const resolution = resolveWithState({ body, decodedToken, state });
    const timestamp = fieldValue.serverTimestamp();
    if (!resolution.ok) {
      const response = sanitizeErrorResponse(resolution);
      transaction.create(requestRef, {
        action: normalized.action,
        actorUid: decodedToken.uid,
        createdAt: timestamp,
        fingerprint,
        mediaId: normalized.mediaId,
        response,
        roomId: normalized.roomId,
        status: 'denied',
        updatedAt: timestamp,
      });
      return { ...response, replayed: false };
    }

    const command = resolution.value;
    const room = state.room;
    const media = mediaSnapshot?.exists ? mediaSnapshot.data() : undefined;
    const previousActiveMediaRef = command.action === 'approve-room-image'
      && room.activeRoomImageId
      && room.activeRoomImageId !== command.mediaId
      ? roomRef.collection('media').doc(room.activeRoomImageId)
      : null;
    const previousActiveMediaSnapshot = previousActiveMediaRef
      ? await transaction.get(previousActiveMediaRef)
      : null;
    const roomPatch = {
      revision: command.nextRevision,
      updatedAt: timestamp,
      updatedBy: decodedToken.uid,
    };
    let mediaPatch;
    let createMedia = false;

    if (command.action === 'submit-room-image') {
      if (mediaSnapshot?.exists) {
        return roomCommandError('ROOM_IMAGE_ALREADY_SUBMITTED', 409, 'This room image was already submitted.');
      }
      createMedia = true;
      mediaPatch = {
        ...verifiedObject,
        createdAt: timestamp,
        mediaId: command.mediaId,
        ownerUid: decodedToken.uid,
        path: command.mediaPath,
        roomId: command.roomId,
        status: 'pending',
        submittedBy: decodedToken.uid,
        updatedAt: timestamp,
      };
      Object.assign(roomPatch, {
        pendingRoomImageId: command.mediaId,
        pendingRoomImagePath: command.mediaPath,
        roomImageReviewStatus: 'pending',
      });
    } else if (command.action === 'approve-room-image') {
      if (!media || media.status !== 'pending') {
        return roomCommandError('ROOM_IMAGE_NOT_PENDING', 409, 'The room image is not pending review.');
      }
      mediaPatch = {
        approvedAt: timestamp,
        approvedBy: decodedToken.uid,
        status: 'approved',
        updatedAt: timestamp,
      };
      Object.assign(roomPatch, {
        activeRoomImageId: command.mediaId,
        activeRoomImagePath: media.path,
        lastRoomImageReviewStatus: 'approved',
        pendingRoomImageId: fieldValue.delete(),
        pendingRoomImagePath: fieldValue.delete(),
        roomImageReviewStatus: 'approved',
      });
    } else if (command.action === 'reject-room-image') {
      if (!media || media.status !== 'pending') {
        return roomCommandError('ROOM_IMAGE_NOT_PENDING', 409, 'The room image is not pending review.');
      }
      mediaPatch = {
        moderationReason: command.reason,
        rejectedAt: timestamp,
        rejectedBy: decodedToken.uid,
        status: 'rejected',
        updatedAt: timestamp,
      };
      Object.assign(roomPatch, {
        lastRoomImageReviewStatus: 'rejected',
        pendingRoomImageId: fieldValue.delete(),
        pendingRoomImagePath: fieldValue.delete(),
        roomImageReviewStatus: room.activeRoomImageId ? 'approved' : 'rejected',
      });
    } else if (command.action === 'remove-room-image') {
      if (!media || media.status !== 'approved' || room.activeRoomImageId !== command.mediaId) {
        return roomCommandError('ROOM_IMAGE_NOT_ACTIVE', 409, 'The room image is not active.');
      }
      mediaPatch = {
        moderationReason: command.reason,
        removedAt: timestamp,
        removedBy: decodedToken.uid,
        status: 'removed',
        updatedAt: timestamp,
      };
      Object.assign(roomPatch, {
        activeRoomImageId: fieldValue.delete(),
        activeRoomImagePath: fieldValue.delete(),
        lastRoomImageReviewStatus: 'removed',
        roomCustomizationSuspended: command.suspendCustomization,
        roomImageReviewStatus: 'removed',
      });
    } else if (command.action === 'restore-room-customization') {
      if (room.roomCustomizationSuspended !== true) {
        return roomCommandError('ROOM_CUSTOMIZATION_NOT_SUSPENDED', 409, 'Room customization is not suspended.');
      }
      Object.assign(roomPatch, {
        roomCustomizationSuspended: false,
      });
    }

    transaction.update(roomRef, roomPatch);
    if (mediaRef && mediaPatch) {
      if (createMedia) transaction.create(mediaRef, mediaPatch);
      else transaction.update(mediaRef, mediaPatch);
    }
    if (previousActiveMediaRef && previousActiveMediaSnapshot?.exists) {
      transaction.update(previousActiveMediaRef, {
        status: 'superseded',
        supersededAt: timestamp,
        supersededBy: decodedToken.uid,
        supersededByMediaId: command.mediaId,
        updatedAt: timestamp,
      });
    }

    const eventRef = roomRef.collection('moderationEvents').doc(`media_${command.requestId}`);
    transaction.create(eventRef, {
      action: command.action,
      actorAuthority: command.actorAuthority,
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      fromRevision: command.currentRevision,
      mediaId: command.mediaId,
      reason: command.reason,
      regionCode: command.regionCode || room.countryCode || '',
      requestId: command.requestId,
      roomId: command.roomId,
      source: 'room-media-v1',
      status: 'applied',
      targetUid: room.ownerUid || room.hostId,
      toRevision: command.nextRevision,
    });

    const response = {
      ok: true,
      result: {
        action: command.action,
        mediaId: command.mediaId,
        requestId: command.requestId,
        revision: command.nextRevision,
        roomId: command.roomId,
        status: 'applied',
      },
    };
    transaction.create(requestRef, {
      action: command.action,
      actorAuthority: command.actorAuthority,
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      fingerprint,
      mediaId: command.mediaId,
      response,
      roomId: command.roomId,
      status: 'applied',
      updatedAt: timestamp,
    });
    return { ...response, replayed: false };
    });
  } catch (error) {
    await deleteUncommittedRoomImage({
      db,
      file: submittedFile,
      mediaId: normalized.mediaId,
      roomId: normalized.roomId,
    });
    throw error;
  }
  if (normalized.action === 'submit-room-image' && !result.ok) {
    await deleteUncommittedRoomImage({
      db,
      file: submittedFile,
      mediaId: normalized.mediaId,
      roomId: normalized.roomId,
    });
  }
  return result;
}

async function cleanupOrphanedRoomMedia({
  bucket,
  db,
  maxAgeMs = 2 * 60 * 60 * 1000,
  maxResults = 200,
  now = Date.now(),
  retentionAgeMs = 30 * 24 * 60 * 60 * 1000,
}) {
  const flagsSnapshot = await db.doc('appConfig/voiceRoomFeatures').get();
  const flags = flagsSnapshot.exists ? flagsSnapshot.data() : {};
  if (flags.voice_room_command_center !== true || flags.voice_room_media !== true) {
    return { deleted: 0, inspected: 0, skipped: true };
  }
  const [files] = await bucket.getFiles({
    autoPaginate: false,
    maxResults,
    prefix: 'room-media/',
  });
  let deleted = 0;
  let inspected = 0;
  let purged = 0;
  for (const file of files) {
    const match = /^room-media\/([^/]+)\/([A-Za-z0-9][A-Za-z0-9_-]{15,79})\/source$/.exec(file.name);
    if (!match) continue;
    inspected += 1;
    const [metadata] = await file.getMetadata();
    const createdAt = Date.parse(metadata.timeCreated || metadata.updated || '');
    if (!Number.isFinite(createdAt) || now - createdAt < maxAgeMs) continue;
    const mediaSnapshot = await db.doc(`rooms/${match[1]}/media/${match[2]}`).get();
    if (!mediaSnapshot.exists) {
      await file.delete({ ignoreNotFound: true });
      deleted += 1;
      continue;
    }
    const media = mediaSnapshot.data();
    const updatedAt = timestampMillis(media.updatedAt);
    if (
      ['rejected', 'removed', 'superseded'].includes(media.status)
      && updatedAt > 0
      && now - updatedAt >= retentionAgeMs
    ) {
      await file.delete({ ignoreNotFound: true });
      await mediaSnapshot.ref.set({
        objectDeletedAt: new Date(now),
      }, { merge: true });
      purged += 1;
    }
  }
  return { deleted, inspected, purged, skipped: false };
}

async function deleteUncommittedRoomImage({ db, file, mediaId, roomId }) {
  if (!file || !roomId || !mediaId || typeof file.delete !== 'function') return;
  try {
    const mediaSnapshot = await db.doc(`rooms/${roomId}/media/${mediaId}`).get();
    if (!mediaSnapshot.exists) await file.delete({ ignoreNotFound: true });
  } catch (error) {
    console.warn('[roomMediaService] orphan cleanup failed', {
      code: error?.code || '',
      mediaId,
      roomId,
    });
  }
}

async function loadAuthorityState(db, uid, roomId) {
  const roomRef = db.doc(`rooms/${roomId}`);
  const [
    roomSnapshot,
    profileSnapshot,
    publicProfileSnapshot,
    operatorProfileSnapshot,
    featureFlagsSnapshot,
    actorMemberSnapshot,
  ] = await Promise.all([
    roomRef.get(),
    db.doc(`users/${uid}`).get(),
    db.doc(`publicProfiles/${uid}`).get(),
    db.doc(`adminProfiles/${uid}`).get(),
    db.doc('appConfig/voiceRoomFeatures').get(),
    roomRef.collection('members').doc(uid).get(),
  ]);
  return {
    actorMembership: actorMemberSnapshot.exists ? actorMemberSnapshot.data() : undefined,
    featureFlags: featureFlagsSnapshot.exists ? featureFlagsSnapshot.data() : undefined,
    operatorProfile: operatorProfileSnapshot.exists ? operatorProfileSnapshot.data() : undefined,
    profile: profileSnapshot.exists ? profileSnapshot.data() : undefined,
    publicProfile: publicProfileSnapshot.exists ? publicProfileSnapshot.data() : undefined,
    room: roomSnapshot.exists ? roomSnapshot.data() : undefined,
  };
}

function resolveWithState({ body, decodedToken, state }) {
  if (state.publicProfile?.moderationStatus !== 'active') {
    return roomCommandError('ACCOUNT_RESTRICTED', 403, 'This account cannot perform room media commands.');
  }
  return resolveRoomMediaCommand({
    actorMembership: state.actorMembership,
    body,
    decodedToken,
    featureFlags: state.featureFlags,
    operatorProfile: state.operatorProfile,
    profile: state.profile,
    room: state.room,
  });
}

function buildRoomMediaFingerprint(actorUid, command) {
  return [
    actorUid,
    command.action,
    command.roomId,
    command.mediaId,
    command.mediaPath,
    command.expectedRevision ?? '',
    command.reason,
    command.suspendCustomization,
  ].join('|');
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

function isObjectNotFound(error) {
  const value = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return value.includes('404') || value.includes('not found') || value.includes('no such object');
}

function timestampMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return typeof value === 'string' ? Date.parse(value) : 0;
}

module.exports = {
  buildRoomMediaFingerprint,
  cleanupOrphanedRoomMedia,
  executeRoomMediaCommand,
};
