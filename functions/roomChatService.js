const { createFriendshipId } = require('./socialFriendsCore');
const { createDirectConversationId } = require('./directChatCore');
const {
  buildRoomChatFingerprint,
  filterChatText,
  isActiveMembership,
  normalizeRoomChatBody,
  resolveRoomChatAuthority,
  resolveSendMessage,
  roomChatError,
  validateRoomChatRequest,
} = require('./roomChatCore');
const { preserveVoiceReportEvidenceInTransaction } = require('./roomRecordingService');

const MESSAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const REPORT_RATE_WINDOW_MS = 60 * 60 * 1_000;
const REPORT_RATE_LIMIT = 10;

async function executeRoomChatCommand({
  body,
  clock = defaultClock,
  db,
  decodedToken,
  fieldValue,
}) {
  const command = normalizeRoomChatBody(body);
  const validation = validateRoomChatRequest(command);
  if (!validation.ok) return validation;
  const actorUid = decodedToken.uid;
  if (
    command.targetUid === actorUid
    && ['block-user', 'unblock-user'].includes(command.action)
  ) {
    return roomChatError('TARGET_INVALID', 400, 'You cannot target yourself.');
  }

  const fingerprint = buildRoomChatFingerprint(actorUid, command);
  return db.runTransaction(async (transaction) => {
    const roomRef = db.doc(`rooms/${command.roomId}`);
    const requestRef = roomRef.collection('chatRequests').doc(command.requestId);
    const requestSnapshot = await transaction.get(requestRef);
    if (requestSnapshot.exists) {
      const previous = requestSnapshot.data();
      if (previous.actorUid !== actorUid || previous.fingerprint !== fingerprint) {
        return roomChatError('REQUEST_ID_CONFLICT', 409, 'This request ID belongs to another action.');
      }
      return { ...previous.response, replayed: true };
    }

    const resultMessageId = command.action === 'send-message'
      ? `chat_${command.requestId}`
      : '';
    const lookupMessageId = command.action === 'send-message'
      ? command.replyToMessageId
      : command.messageId;
    const messageRef = lookupMessageId
      ? roomRef.collection('messages').doc(lookupMessageId)
      : null;
    const actorMemberRef = roomRef.collection('members').doc(actorUid);
    const targetMemberRef = command.targetUid
      ? roomRef.collection('members').doc(command.targetUid)
      : null;
    const profileRef = db.doc(`users/${actorUid}`);
    const publicProfileRef = db.doc(`publicProfiles/${actorUid}`);
    const operatorProfileRef = db.doc(`adminProfiles/${actorUid}`);
    const flagsRef = db.doc('appConfig/voiceRoomFeatures');
    const moderationConfigRef = db.doc('appConfig/voiceRoomModeration');
    const rateRef = roomRef.collection('chatRateLimits').doc(actorUid);
    const chatStateRef = roomRef.collection('chatState').doc('current');
    const blockRef = command.targetUid
      ? db.doc(`blocks/${actorUid}/blocked/${command.targetUid}`)
      : null;
    const reverseBlockRef = command.targetUid
      ? db.doc(`blocks/${command.targetUid}/blocked/${actorUid}`)
      : null;
    const targetProfileRef = command.targetUid
      ? db.doc(`publicProfiles/${command.targetUid}`)
      : null;
    const safetyRateRef = db.doc(`roomSafetyRateLimits/${actorUid}`);
    const mediaRef = command.mediaId
      ? roomRef.collection('media').doc(command.mediaId)
      : null;
    const giftRef = command.giftEventId
      ? roomRef.collection('giftEvents').doc(command.giftEventId)
      : null;
    const directConversationId = command.action === 'block-user' && command.targetUid
      ? createDirectConversationId(actorUid, command.targetUid)
      : '';
    const directConversationRef = directConversationId
      ? db.doc(`directConversations/${directConversationId}`)
      : null;
    const directRequestRef = directConversationId
      ? db.doc(`directMessageRequests/${directConversationId}`)
      : null;

    const [
      roomSnapshot,
      actorMemberSnapshot,
      profileSnapshot,
      publicProfileSnapshot,
      operatorProfileSnapshot,
      flagsSnapshot,
      moderationConfigSnapshot,
      rateSnapshot,
      chatStateSnapshot,
      messageSnapshot,
      targetMemberSnapshot,
      blockSnapshot,
      reverseBlockSnapshot,
      targetProfileSnapshot,
      safetyRateSnapshot,
      mediaSnapshot,
      giftSnapshot,
      directConversationSnapshot,
      directRequestSnapshot,
    ] = await Promise.all([
      transaction.get(roomRef),
      transaction.get(actorMemberRef),
      transaction.get(profileRef),
      transaction.get(publicProfileRef),
      transaction.get(operatorProfileRef),
      transaction.get(flagsRef),
      transaction.get(moderationConfigRef),
      transaction.get(rateRef),
      transaction.get(chatStateRef),
      messageRef ? transaction.get(messageRef) : Promise.resolve(null),
      targetMemberRef ? transaction.get(targetMemberRef) : Promise.resolve(null),
      blockRef ? transaction.get(blockRef) : Promise.resolve(null),
      reverseBlockRef ? transaction.get(reverseBlockRef) : Promise.resolve(null),
      targetProfileRef ? transaction.get(targetProfileRef) : Promise.resolve(null),
      command.action === 'report-content' ? transaction.get(safetyRateRef) : Promise.resolve(null),
      mediaRef ? transaction.get(mediaRef) : Promise.resolve(null),
      giftRef ? transaction.get(giftRef) : Promise.resolve(null),
      directConversationRef ? transaction.get(directConversationRef) : Promise.resolve(null),
      directRequestRef ? transaction.get(directRequestRef) : Promise.resolve(null),
    ]);

    const room = roomSnapshot.exists ? roomSnapshot.data() : undefined;
    let recordingSessionSnapshot = null;
    if (command.action === 'report-content' && command.subjectType === 'voice') {
      const activeRecordingSessionId = typeof room?.activeRecordingSessionId === 'string'
        ? room.activeRecordingSessionId.trim()
        : '';
      if (activeRecordingSessionId) {
        recordingSessionSnapshot = await transaction.get(
          roomRef.collection('recordingSessions').doc(activeRecordingSessionId),
        );
      }
    }
    const membership = actorMemberSnapshot.exists ? actorMemberSnapshot.data() : undefined;
    const profile = profileSnapshot.exists ? profileSnapshot.data() : undefined;
    const publicProfile = publicProfileSnapshot.exists ? publicProfileSnapshot.data() : undefined;
    const featureFlags = flagsSnapshot.exists ? flagsSnapshot.data() : undefined;
    const authority = resolveRoomChatAuthority({
      decodedToken,
      featureFlags,
      membership,
      operatorProfile: operatorProfileSnapshot.exists ? operatorProfileSnapshot.data() : undefined,
      room,
    });
    const nowMs = clock.nowMillis();
    let resolution = resolveCommonAccess({
      action: command.action,
      authority,
      featureFlags,
      membership,
      publicProfile,
      room,
    });
    let friendSnapshot = null;
    if (
      resolution.ok
      && command.action === 'send-message'
      && room?.chatMode === 'followers'
      && typeof room.ownerUid === 'string'
      && room.ownerUid !== actorUid
    ) {
      friendSnapshot = await transaction.get(db.doc(`friendships/${createFriendshipId(actorUid, room.ownerUid)}`));
    }
    if (resolution.ok && command.action === 'send-message') {
      resolution = resolveSendMessage({
        authority: authority.authority,
        featureFlags,
        isFriendOfOwner: friendSnapshot?.exists === true,
        membership,
        nowMs,
        profile,
        publicProfile,
        rate: rateSnapshot.exists ? rateSnapshot.data() : undefined,
        room,
        text: command.text,
      });
      if (resolution.ok) {
        const moderationConfig = moderationConfigSnapshot.exists
          ? moderationConfigSnapshot.data()
          : {};
        const filterResult = filterChatText(
          command.text,
          room.keywordFilterMode || 'standard',
          moderationConfig.keywordTerms,
        );
        if (!filterResult.ok) resolution = filterResult;
      }
      if (
        resolution.ok
        && command.replyToMessageId
        && (!messageSnapshot?.exists || messageSnapshot.data().status !== 'active')
      ) {
        resolution = roomChatError('REPLY_TARGET_UNAVAILABLE', 409, 'The reply target is unavailable.');
      }
    } else if (resolution.ok) {
      resolution = resolveMutationAccess({
        actorUid,
        authority,
        block: blockSnapshot?.exists ? blockSnapshot.data() : undefined,
        chatState: chatStateSnapshot.exists ? chatStateSnapshot.data() : undefined,
        command,
        gift: giftSnapshot?.exists ? giftSnapshot.data() : undefined,
        media: mediaSnapshot?.exists ? mediaSnapshot.data() : undefined,
        message: messageSnapshot?.exists ? messageSnapshot.data() : undefined,
        targetProfile: targetProfileSnapshot?.exists ? targetProfileSnapshot.data() : undefined,
      });
    }

    if (
      resolution.ok
      && command.action === 'report-content'
    ) {
      resolution = resolveReportRateLimit(
        safetyRateSnapshot?.exists ? safetyRateSnapshot.data() : undefined,
        nowMs,
      );
    }

    const timestamp = fieldValue.serverTimestamp();
    if (!resolution.ok) {
      return writeDeniedRequest({
        actorUid,
        command,
        fingerprint,
        requestRef,
        resolution,
        timestamp,
        transaction,
      });
    }

    if (command.action === 'send-message') {
      const createdAt = clock.timestampFromMillis(nowMs);
      transaction.create(roomRef.collection('messages').doc(resultMessageId), {
        createdAt,
        evidenceHold: false,
        expireAt: clock.timestampFromMillis(nowMs + MESSAGE_RETENTION_MS),
        id: resultMessageId,
        kind: 'chat',
        replyToMessageId: command.replyToMessageId || '',
        revision: 1,
        roomId: command.roomId,
        schemaVersion: 2,
        senderAvatarLabel: resolution.value.senderAvatarLabel,
        ...(resolution.value.senderAvatarFrame ? { senderAvatarFrame: resolution.value.senderAvatarFrame } : {}),
        senderDisplayName: resolution.value.senderDisplayName,
        senderUid: actorUid,
        status: 'active',
        text: command.text,
        updatedAt: createdAt,
      });
      transaction.set(rateRef, {
        lastSentAt: clock.timestampFromMillis(resolution.value.nextRate.lastSentAtMs),
        messageCount: resolution.value.nextRate.messageCount,
        windowStartedAt: clock.timestampFromMillis(resolution.value.nextRate.windowStartedAtMs),
      });
    } else if (command.action === 'delete-message') {
      transaction.update(messageRef, {
        deletedAt: timestamp,
        deletedBy: actorUid,
        deletionAuthority: authority.authority,
        revision: Number(messageSnapshot.data().revision || 1) + 1,
        status: 'deleted',
        text: '',
        updatedAt: timestamp,
      });
      if (chatStateSnapshot.data()?.pinnedMessageId === command.messageId) {
        transaction.set(chatStateRef, {
          pinnedMessageId: '',
          updatedAt: timestamp,
          updatedBy: actorUid,
        }, { merge: true });
      }
    } else if (command.action === 'pin-message') {
      transaction.set(chatStateRef, {
        pinnedAt: timestamp,
        pinnedBy: actorUid,
        pinnedMessageId: command.messageId,
        updatedAt: timestamp,
        updatedBy: actorUid,
      }, { merge: true });
    } else if (command.action === 'unpin-message') {
      transaction.set(chatStateRef, {
        pinnedMessageId: '',
        unpinnedAt: timestamp,
        updatedAt: timestamp,
        updatedBy: actorUid,
      }, { merge: true });
    } else if (command.action === 'block-user') {
      transaction.create(blockRef, {
        blockedUid: command.targetUid,
        blockerUid: actorUid,
        createdAt: timestamp,
        roomId: command.roomId,
        source: 'voice-room',
      });
      const friendshipId = createFriendshipId(actorUid, command.targetUid);
      transaction.delete(db.doc(`friendships/${friendshipId}`));
      transaction.delete(db.doc(`friendRequests/${friendshipId}`));
      if (directRequestSnapshot?.exists && directRequestSnapshot.data()?.status === 'pending') {
        transaction.set(directRequestRef, {
          blockedAt: timestamp,
          blockedByUid: actorUid,
          status: 'blocked',
          updatedAt: timestamp,
        }, { merge: true });
        if (directConversationSnapshot?.exists) {
          transaction.set(directConversationRef, {
            requestState: 'blocked',
            updatedAt: timestamp,
          }, { merge: true });
        }
      }
    } else if (command.action === 'unblock-user') {
      transaction.delete(blockRef);
    } else if (command.action === 'report-content') {
      const reportId = `room_${command.requestId}`;
      const reportTarget = resolveReportTarget({
        command,
        gift: giftSnapshot?.exists ? giftSnapshot.data() : undefined,
        media: mediaSnapshot?.exists ? mediaSnapshot.data() : undefined,
        message: messageSnapshot?.exists ? messageSnapshot.data() : undefined,
      });
      let evidenceMeta = { audioStatus: 'missing', created: false, evidenceId: null };
      if (command.subjectType === 'voice') {
        const recordingSession = recordingSessionSnapshot?.exists
          ? { sessionId: recordingSessionSnapshot.id, ...recordingSessionSnapshot.data() }
          : undefined;
        evidenceMeta = preserveVoiceReportEvidenceInTransaction({
          clock,
          db,
          featureFlags,
          fieldValue,
          nowMs,
          reportId,
          roomId: command.roomId,
          senderUid: actorUid,
          session: recordingSession,
          timestamp,
          transaction,
        });
      }
      transaction.create(db.doc(`reports/${reportId}`), {
        assignedTo: '',
        category: command.category,
        contentExcerpt: reportTarget.messageSnapshot?.text || command.details,
        createdAt: timestamp,
        details: command.details,
        evidenceAudioStatus: evidenceMeta.audioStatus,
        evidenceId: evidenceMeta.evidenceId || '',
        evidencePreservationRequested: command.subjectType === 'voice',
        giftEventId: command.giftEventId,
        mediaId: command.mediaId,
        messageId: command.messageId,
        messageSnapshot: reportTarget.messageSnapshot,
        reason: command.category,
        reporterPublicId: typeof publicProfile?.publicId === 'string' ? publicProfile.publicId : '',
        reporterUid: actorUid,
        resolutionNote: '',
        roomId: command.roomId,
        severity: reportSeverity(command.category),
        source: 'voice-room-safety-v1',
        status: 'open',
        subjectType: command.subjectType,
        targetUid: reportTarget.targetUid,
        updatedAt: timestamp,
      });
      if (command.subjectType === 'message' && messageSnapshot?.exists) {
        transaction.update(messageRef, {
          evidenceHold: true,
          updatedAt: timestamp,
        });
      }
      const nextReportRate = resolution.value;
      transaction.set(safetyRateRef, {
        reportCount: nextReportRate.reportCount,
        windowStartedAt: clock.timestampFromMillis(nextReportRate.windowStartedAtMs),
      });
    }

    if (['delete-message', 'pin-message', 'unpin-message'].includes(command.action)) {
      transaction.create(roomRef.collection('moderationEvents').doc(`chat_${command.requestId}`), {
        action: command.action,
        actorAuthority: authority.authority,
        actorUid,
        createdAt: timestamp,
        messageId: command.messageId,
        reason: command.details,
        regionCode: room.countryCode || '',
        requestId: command.requestId,
        roomId: command.roomId,
        source: 'room-chat-v1',
        status: 'applied',
        targetUid: messageSnapshot?.data()?.senderUid || '',
      });
    }

    const response = {
      ok: true,
      result: {
        action: command.action,
        messageId: resultMessageId || command.messageId || '',
        requestId: command.requestId,
        roomId: command.roomId,
        status: 'applied',
        targetUid: command.targetUid,
      },
    };
    transaction.create(requestRef, {
      action: command.action,
      actorUid,
      createdAt: timestamp,
      fingerprint,
      response,
      roomId: command.roomId,
      status: 'applied',
      updatedAt: timestamp,
    });
    return { ...response, replayed: false };
  });
}

async function cleanupExpiredRoomChatMessages({
  clock = defaultClock,
  db,
  limit = 200,
}) {
  const now = clock.timestampFromMillis(clock.nowMillis());
  const snapshot = await db.collectionGroup('messages')
    .where('evidenceHold', '==', false)
    .where('expireAt', '<=', now)
    .orderBy('expireAt', 'asc')
    .limit(limit)
    .get();
  if (snapshot.empty) return { deleted: 0, scanned: 0 };
  const batch = db.batch();
  for (const document of snapshot.docs) batch.delete(document.ref);
  await batch.commit();
  return { deleted: snapshot.size, scanned: snapshot.size };
}

function resolveCommonAccess({ action, authority, featureFlags, membership, publicProfile, room }) {
  const requiresChat = ['send-message', 'delete-message', 'pin-message', 'unpin-message'].includes(action);
  const flagEnabled = requiresChat
    ? featureFlags?.voice_room_chat === true
    : featureFlags?.voice_room_safety === true;
  if (!flagEnabled) return roomChatError('FEATURE_DISABLED', 403, 'This room feature is not enabled.');
  if (publicProfile?.moderationStatus !== 'active') {
    return roomChatError('ACCOUNT_RESTRICTED', 403, 'This account cannot use room chat or safety tools.');
  }
  if (!room || room.status !== 'active' || room.availability === 'removed') {
    return roomChatError('ROOM_NOT_ACTIVE', 409, 'This room is not active.');
  }
  if (!authority.authority) return roomChatError('MEMBERSHIP_REQUIRED', 403, 'Active room membership is required.');
  if (
    ['send-message', 'block-user', 'unblock-user', 'report-content'].includes(action)
    && !isActiveMembership(membership)
  ) {
    return roomChatError('MEMBERSHIP_REQUIRED', 403, 'Active room membership is required.');
  }
  return { ok: true };
}

function resolveMutationAccess({
  actorUid,
  authority,
  block,
  chatState,
  command,
  gift,
  media,
  message,
  targetProfile,
}) {
  if (command.action === 'delete-message') {
    if (!message || message.status !== 'active') {
      return roomChatError('MESSAGE_UNAVAILABLE', 409, 'The message is unavailable.');
    }
    if (!authority.canManage && message.senderUid !== actorUid) {
      return roomChatError('FORBIDDEN', 403, 'You cannot delete this message.');
    }
  }
  if (command.action === 'pin-message') {
    if (!authority.canManage) return roomChatError('FORBIDDEN', 403, 'Room management authority is required.');
    if (!message || message.status !== 'active') {
      return roomChatError('MESSAGE_UNAVAILABLE', 409, 'The message is unavailable.');
    }
  }
  if (command.action === 'unpin-message') {
    if (!authority.canManage) return roomChatError('FORBIDDEN', 403, 'Room management authority is required.');
    if (!chatState || chatState.pinnedMessageId !== command.messageId) {
      return roomChatError('MESSAGE_NOT_PINNED', 409, 'This message is not pinned.');
    }
  }
  if (command.action === 'block-user') {
    if (!targetProfile || targetProfile.moderationStatus === 'removed') {
      return roomChatError('TARGET_INVALID', 409, 'The target user is unavailable.');
    }
    if (block) return roomChatError('ALREADY_BLOCKED', 409, 'This user is already blocked.');
  }
  if (command.action === 'unblock-user' && !block) {
    return roomChatError('NOT_BLOCKED', 409, 'This user is not blocked.');
  }
  if (command.action === 'report-content') {
    if (
      (command.subjectType === 'user' || command.subjectType === 'voice')
      && (!targetProfile || targetProfile.moderationStatus === 'removed')
    ) {
      return roomChatError('TARGET_INVALID', 409, 'The reported user is unavailable.');
    }
    if (command.subjectType === 'message' && !message) {
      return roomChatError('MESSAGE_UNAVAILABLE', 409, 'The reported message is unavailable.');
    }
    if (command.subjectType === 'room-image' && !media) {
      return roomChatError('MEDIA_UNAVAILABLE', 409, 'The reported image is unavailable.');
    }
    if (command.subjectType === 'gift' && !gift) {
      return roomChatError('GIFT_UNAVAILABLE', 409, 'The reported gift is unavailable.');
    }
  }
  return { ok: true };
}

function resolveReportRateLimit(rate, nowMs) {
  const windowStartedAtMs = timestampToMillis(rate?.windowStartedAt);
  const sameWindow = windowStartedAtMs !== undefined
    && nowMs - windowStartedAtMs < REPORT_RATE_WINDOW_MS;
  const reportCount = sameWindow ? Number(rate?.reportCount || 0) : 0;
  if (reportCount >= REPORT_RATE_LIMIT) {
    return roomChatError('REPORT_RATE_LIMITED', 429, 'Too many reports were submitted.');
  }
  return {
    ok: true,
    value: {
      reportCount: reportCount + 1,
      windowStartedAtMs: sameWindow ? windowStartedAtMs : nowMs,
    },
  };
}

function resolveReportTarget({ command, gift, media, message }) {
  const targetUid = command.targetUid
    || message?.senderUid
    || media?.ownerUid
    || gift?.senderUid
    || '';
  return {
    targetUid,
    messageSnapshot: command.subjectType === 'message' && message
      ? {
        createdAt: message.createdAt || null,
        kind: message.kind || 'chat',
        senderUid: message.senderUid || '',
        status: message.status || '',
        text: typeof message.text === 'string' ? message.text.slice(0, 280) : '',
      }
      : null,
  };
}

function reportSeverity(category) {
  return ['sexual-content', 'threat', 'underage'].includes(category) ? 'high' : 'medium';
}

function writeDeniedRequest({
  actorUid,
  command,
  fingerprint,
  requestRef,
  resolution,
  timestamp,
  transaction,
}) {
  const response = {
    ok: false,
    code: resolution.code,
    error: resolution.error,
    status: resolution.status,
    ...(resolution.details ? { details: resolution.details } : {}),
  };
  transaction.create(requestRef, {
    action: command.action,
    actorUid,
    createdAt: timestamp,
    fingerprint,
    response,
    roomId: command.roomId,
    status: 'denied',
    updatedAt: timestamp,
  });
  return { ...response, replayed: false };
}

function timestampToMillis(value) {
  if (Number.isFinite(value)) return Number(value);
  if (!value || typeof value !== 'object') return undefined;
  if (typeof value.toMillis === 'function') {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : undefined;
  }
  return Number.isFinite(value.seconds)
    ? (value.seconds * 1_000) + Math.floor(Number(value.nanoseconds || 0) / 1_000_000)
    : undefined;
}

const defaultClock = {
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => value,
};

module.exports = {
  MESSAGE_RETENTION_MS,
  cleanupExpiredRoomChatMessages,
  executeRoomChatCommand,
  resolveCommonAccess,
  resolveMutationAccess,
  resolveReportRateLimit,
  resolveReportTarget,
};
