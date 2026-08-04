const {
  buildOwnershipFingerprint,
  normalizeRoomOwnershipBody,
  ownershipError,
  resolveOwnershipOffer,
  resolveOwnershipResponse,
  timestampToMillis,
  validateRoomOwnershipRequest,
} = require('./roomOwnershipCore');

async function executeRoomOwnershipCommand({
  body,
  clock = systemClock,
  db,
  decodedToken,
  fieldValue,
}) {
  const validation = validateRoomOwnershipRequest(normalizeRoomOwnershipBody(body));
  if (!validation.ok) return validation;
  const command = validation.value;
  const fingerprint = buildOwnershipFingerprint(decodedToken.uid, command);

  return db.runTransaction(async (transaction) => {
    const roomRef = db.doc(`rooms/${command.roomId}`);
    const requestRef = roomRef.collection('ownershipTransferRequests').doc(command.requestId);
    const featureRef = db.doc('appConfig/voiceRoomFeatures');
    const actorMemberRef = roomRef.collection('members').doc(decodedToken.uid);
    const actorPrivateRef = db.doc(`users/${decodedToken.uid}`);
    const actorPublicRef = db.doc(`publicProfiles/${decodedToken.uid}`);
    const transferRef = command.action === 'offer-ownership-transfer'
      ? null
      : roomRef.collection('ownershipTransfers').doc(command.transferId);
    const [requestSnapshot, featureSnapshot, roomSnapshot, actorMemberSnapshot, actorPrivateSnapshot, actorPublicSnapshot, transferSnapshot] =
      await Promise.all([
        transaction.get(requestRef),
        transaction.get(featureRef),
        transaction.get(roomRef),
        transaction.get(actorMemberRef),
        transaction.get(actorPrivateRef),
        transaction.get(actorPublicRef),
        transferRef ? transaction.get(transferRef) : Promise.resolve(null),
      ]);

    if (requestSnapshot.exists) {
      const previous = requestSnapshot.data();
      if (previous.actorUid !== decodedToken.uid || previous.fingerprint !== fingerprint) {
        return ownershipError('REQUEST_ID_CONFLICT', 409, 'This request ID belongs to another command.');
      }
      return { ...previous.response, replayed: true };
    }

    const timestamp = fieldValue.serverTimestamp();
    const nowMs = clock.nowMillis();
    const room = roomSnapshot.exists ? roomSnapshot.data() : undefined;
    const actorMembership = actorMemberSnapshot.exists ? actorMemberSnapshot.data() : undefined;
    const actorPrivateProfile = actorPrivateSnapshot.exists ? actorPrivateSnapshot.data() : undefined;
    const actorPublicProfile = actorPublicSnapshot.exists ? actorPublicSnapshot.data() : undefined;
    const featureFlags = featureSnapshot.exists ? featureSnapshot.data() : undefined;
    let resolution;
    let effectiveTransferRef = transferRef;
    let targetMembership;
    let targetPublicProfile;
    let currentOwnerMembership;

    if (command.action === 'offer-ownership-transfer') {
      const targetMemberRef = roomRef.collection('members').doc(command.targetUid);
      const targetPrivateRef = db.doc(`users/${command.targetUid}`);
      const targetPublicRef = db.doc(`publicProfiles/${command.targetUid}`);
      const actorBlocksTargetRef = db.doc(`blocks/${decodedToken.uid}/blocked/${command.targetUid}`);
      const targetBlocksActorRef = db.doc(`blocks/${command.targetUid}/blocked/${decodedToken.uid}`);
      const [
        targetMemberSnapshot,
        targetPrivateSnapshot,
        targetPublicSnapshot,
        actorBlocksTargetSnapshot,
        targetBlocksActorSnapshot,
      ] = await Promise.all([
        transaction.get(targetMemberRef),
        transaction.get(targetPrivateRef),
        transaction.get(targetPublicRef),
        transaction.get(actorBlocksTargetRef),
        transaction.get(targetBlocksActorRef),
      ]);
      targetMembership = targetMemberSnapshot.exists ? targetMemberSnapshot.data() : undefined;
      targetPublicProfile = targetPublicSnapshot.exists ? targetPublicSnapshot.data() : undefined;
      resolution = resolveOwnershipOffer({
        actorMembership,
        actorPrivateProfile,
        actorPublicProfile,
        blocksExist: actorBlocksTargetSnapshot.exists || targetBlocksActorSnapshot.exists,
        command,
        decodedToken,
        featureFlags,
        nowMs,
        room,
        targetMembership,
        targetPrivateProfile: targetPrivateSnapshot.exists ? targetPrivateSnapshot.data() : undefined,
        targetPublicProfile,
      });
      if (resolution.ok) {
        effectiveTransferRef = roomRef.collection('ownershipTransfers').doc(resolution.value.transferId);
      }
    } else {
      const transfer = transferSnapshot?.exists
        ? { ...transferSnapshot.data(), id: transferSnapshot.id || transferSnapshot.ref.path.split('/').at(-1) }
        : undefined;
      const currentOwnerUid = transfer?.fromUid || room?.ownerUid || room?.hostId || '';
      const currentOwnerMemberRef = currentOwnerUid
        ? roomRef.collection('members').doc(currentOwnerUid)
        : null;
      const currentOwnerPublicRef = currentOwnerUid
        ? db.doc(`publicProfiles/${currentOwnerUid}`)
        : null;
      const actorBlocksOwnerRef = currentOwnerUid
        ? db.doc(`blocks/${decodedToken.uid}/blocked/${currentOwnerUid}`)
        : null;
      const ownerBlocksActorRef = currentOwnerUid
        ? db.doc(`blocks/${currentOwnerUid}/blocked/${decodedToken.uid}`)
        : null;
      const [
        currentOwnerMemberSnapshot,
        currentOwnerPublicSnapshot,
        actorBlocksOwnerSnapshot,
        ownerBlocksActorSnapshot,
      ] = await Promise.all([
        currentOwnerMemberRef ? transaction.get(currentOwnerMemberRef) : Promise.resolve(null),
        currentOwnerPublicRef ? transaction.get(currentOwnerPublicRef) : Promise.resolve(null),
        actorBlocksOwnerRef ? transaction.get(actorBlocksOwnerRef) : Promise.resolve(null),
        ownerBlocksActorRef ? transaction.get(ownerBlocksActorRef) : Promise.resolve(null),
      ]);
      currentOwnerMembership = currentOwnerMemberSnapshot?.exists ? currentOwnerMemberSnapshot.data() : undefined;
      resolution = resolveOwnershipResponse({
        actorMembership,
        actorPrivateProfile,
        actorPublicProfile,
        blocksExist: actorBlocksOwnerSnapshot?.exists || ownerBlocksActorSnapshot?.exists,
        command,
        currentOwnerMembership,
        currentOwnerPublicProfile: currentOwnerPublicSnapshot?.exists ? currentOwnerPublicSnapshot.data() : undefined,
        decodedToken,
        featureFlags,
        nowMs,
        room,
        transfer,
      });
    }

    if (!resolution.ok) {
      const response = sanitizeResponse(resolution);
      transaction.create(requestRef, {
        action: command.action,
        actorUid: decodedToken.uid,
        createdAt: timestamp,
        fingerprint,
        response,
        roomId: command.roomId,
        status: 'denied',
        transferId: command.transferId,
        updatedAt: timestamp,
      });
      return { ...response, replayed: false };
    }

    let result;
    if (command.action === 'offer-ownership-transfer') {
      const offer = resolution.value;
      const expiresAt = clock.timestampFromMillis(offer.expiresAtMs);
      const nextRevision = (Number.isInteger(room.revision) ? room.revision : 1) + 1;
      const transfer = {
        createdAt: timestamp,
        expiresAt,
        fromOwnershipRevision: offer.fromOwnershipRevision,
        fromUid: offer.fromUid,
        id: offer.transferId,
        roomId: command.roomId,
        status: 'pending',
        toUid: offer.toUid,
        updatedAt: timestamp,
      };
      transaction.create(effectiveTransferRef, transfer);
      transaction.update(roomRef, {
        pendingOwnershipTransferExpiresAt: expiresAt,
        pendingOwnershipTransferId: offer.transferId,
        revision: nextRevision,
        updatedAt: timestamp,
        updatedBy: decodedToken.uid,
      });
      createOwnershipNotification(transaction, db, {
        actorUid: decodedToken.uid,
        kind: 'room-ownership-offered',
        recipientUid: offer.toUid,
        roomId: command.roomId,
        timestamp,
        transferId: offer.transferId,
      });
      result = {
        action: command.action,
        expiresAtMs: offer.expiresAtMs,
        ownershipRevision: room.ownershipRevision,
        requestId: command.requestId,
        revision: nextRevision,
        roomId: command.roomId,
        status: 'pending',
        targetUid: offer.toUid,
        transferId: offer.transferId,
      };
    } else {
      const transfer = transferSnapshot.data();
      const disposition = resolution.value.disposition;
      if (disposition === 'accepted') {
        const currentOwnerRef = roomRef.collection('members').doc(transfer.fromUid);
        const recipientWasModerator = actorMembership.authorityRole === 'moderator';
        const actorKeepsAudio = Boolean(
          currentOwnerMembership?.seatId
          && currentOwnerMembership.canPublishAudio === true
          && currentOwnerMembership.forceMuted !== true
          && room.audioLockdown !== true,
        );
        const moderatorCount = Number(room.moderatorCount || 0)
          + (recipientWasModerator ? 0 : 1);
        transaction.update(currentOwnerRef, {
          authorityRole: 'moderator',
          canPublishAudio: actorKeepsAudio,
          role: actorKeepsAudio ? 'speaker' : 'listener',
          schemaVersion: 2,
          updatedAt: timestamp,
          updatedBy: decodedToken.uid,
        });
        transaction.update(actorMemberRef, {
          authorityRole: 'owner',
          canPublishAudio: actorMembership.canPublishAudio === true,
          role: 'host',
          schemaVersion: 2,
          updatedAt: timestamp,
          updatedBy: decodedToken.uid,
        });
        transaction.update(roomRef, {
          hostAvatarLabel: actorPrivateProfile.avatarLabel,
          hostDisplayName: actorPrivateProfile.displayName,
          hostId: decodedToken.uid,
          lastOwnershipTransferredAt: timestamp,
          lastOwnershipTransferId: command.transferId,
          moderatorCount,
          ownerAvatarLabel: actorPrivateProfile.avatarLabel,
          ownerDisplayName: actorPrivateProfile.displayName,
          ownerUid: decodedToken.uid,
          ownershipRevision: resolution.value.nextOwnershipRevision,
          ownershipTransferCooldownUntil: clock.timestampFromMillis(resolution.value.cooldownUntilMs),
          pendingOwnershipTransferExpiresAt: fieldValue.delete(),
          pendingOwnershipTransferId: fieldValue.delete(),
          revision: resolution.value.nextRevision,
          updatedAt: timestamp,
          updatedBy: decodedToken.uid,
        });
        transaction.update(effectiveTransferRef, {
          acceptedAt: timestamp,
          acceptedBy: decodedToken.uid,
          completedOwnershipRevision: resolution.value.nextOwnershipRevision,
          status: 'accepted',
          updatedAt: timestamp,
        });
        if (featureFlags.voice_room_chat === true) {
          transaction.create(roomRef.collection('messages').doc(`system_${command.transferId}`), {
            createdAt: timestamp,
            evidenceHold: false,
            expireAt: clock.timestampFromMillis(nowMs + 30 * 24 * 60 * 60 * 1000),
            id: `system_${command.transferId}`,
            kind: 'system',
            metadata: {
              fromUid: transfer.fromUid,
              toUid: transfer.toUid,
              type: 'ownership-transferred',
            },
            revision: 1,
            roomId: command.roomId,
            senderUid: '',
            status: 'active',
            text: 'تم نقل ملكية الغرفة.',
            updatedAt: timestamp,
          });
        }
        createOwnershipNotification(transaction, db, {
          actorUid: decodedToken.uid,
          kind: 'room-ownership-accepted',
          recipientUid: transfer.fromUid,
          roomId: command.roomId,
          timestamp,
          transferId: command.transferId,
        });
      } else {
        transaction.update(effectiveTransferRef, {
          [`${disposition}At`]: timestamp,
          [`${disposition}By`]: decodedToken.uid,
          status: disposition,
          updatedAt: timestamp,
        });
        transaction.update(roomRef, {
          pendingOwnershipTransferExpiresAt: fieldValue.delete(),
          pendingOwnershipTransferId: fieldValue.delete(),
          revision: (Number.isInteger(room.revision) ? room.revision : 1) + 1,
          updatedAt: timestamp,
          updatedBy: decodedToken.uid,
        });
        createOwnershipNotification(transaction, db, {
          actorUid: decodedToken.uid,
          kind: `room-ownership-${disposition}`,
          recipientUid: disposition === 'declined' ? transfer.fromUid : transfer.toUid,
          roomId: command.roomId,
          timestamp,
          transferId: command.transferId,
        });
      }
      result = {
        action: command.action,
        ownershipRevision: disposition === 'accepted'
          ? resolution.value.nextOwnershipRevision
          : room.ownershipRevision,
        requestId: command.requestId,
        revision: disposition === 'accepted'
          ? resolution.value.nextRevision
          : (Number.isInteger(room.revision) ? room.revision : 1) + 1,
        roomId: command.roomId,
        status: disposition,
        targetUid: transfer.toUid,
        transferId: command.transferId,
      };
    }

    const eventRef = roomRef.collection('moderationEvents').doc(`ownership_${command.requestId}`);
    transaction.create(eventRef, {
      action: command.action,
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      requestId: command.requestId,
      roomId: command.roomId,
      source: 'room-ownership-v1',
      status: result.status,
      targetUid: result.targetUid,
      transferId: result.transferId,
    });
    const response = { ok: true, result };
    transaction.create(requestRef, {
      action: command.action,
      actorUid: decodedToken.uid,
      createdAt: timestamp,
      fingerprint,
      response,
      roomId: command.roomId,
      status: 'applied',
      transferId: result.transferId,
      updatedAt: timestamp,
    });
    return { ...response, replayed: false };
  });
}

async function expireRoomOwnershipTransfers({
  clock = systemClock,
  db,
  fieldValue,
  limit = 100,
}) {
  const now = clock.timestampFromMillis(clock.nowMillis());
  const snapshot = await db.collectionGroup('ownershipTransfers')
    .where('status', '==', 'pending')
    .where('expiresAt', '<=', now)
    .orderBy('expiresAt', 'asc')
    .limit(limit)
    .get();
  let expired = 0;

  for (const document of snapshot.docs) {
    const didExpire = await db.runTransaction(async (transaction) => {
      const latest = await transaction.get(document.ref);
      if (!latest.exists || latest.data().status !== 'pending' || timestampToMillis(latest.data().expiresAt) > clock.nowMillis()) {
        return false;
      }
      const transfer = latest.data();
      const roomRef = db.doc(`rooms/${transfer.roomId}`);
      const roomSnapshot = await transaction.get(roomRef);
      const timestamp = fieldValue.serverTimestamp();
      transaction.update(document.ref, {
        expiredAt: timestamp,
        status: 'expired',
        updatedAt: timestamp,
      });
      if (roomSnapshot.exists && roomSnapshot.data().pendingOwnershipTransferId === document.id) {
        transaction.update(roomRef, {
          pendingOwnershipTransferExpiresAt: fieldValue.delete(),
          pendingOwnershipTransferId: fieldValue.delete(),
          revision: (Number.isInteger(roomSnapshot.data().revision) ? roomSnapshot.data().revision : 1) + 1,
          updatedAt: timestamp,
          updatedBy: 'system',
        });
      }
      return true;
    });
    if (didExpire) expired += 1;
  }
  return { expired, scanned: snapshot.size ?? snapshot.docs.length };
}

function createOwnershipNotification(transaction, db, {
  actorUid,
  kind,
  recipientUid,
  roomId,
  timestamp,
  transferId,
}) {
  const notificationRef = db.doc(`roomOwnershipNotifications/${recipientUid}/items/${transferId}_${kind}`);
  transaction.create(notificationRef, {
    actorUid,
    createdAt: timestamp,
    kind,
    readAt: null,
    recipientUid,
    roomId,
    transferId,
  });
}

function sanitizeResponse(result) {
  return {
    ok: false,
    code: result.code,
    status: result.status,
    error: result.error,
    ...(result.details ? { details: result.details } : {}),
  };
}

const systemClock = {
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => new Date(value),
};

module.exports = {
  executeRoomOwnershipCommand,
  expireRoomOwnershipTransfers,
};
