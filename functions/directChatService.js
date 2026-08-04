const { createFriendshipId } = require('./socialFriendsCore');
const {
  buildDirectChatFingerprint,
  createDirectConversationId,
  createDirectMessageId,
  createDirectSystemMessageId,
  directChatError,
  normalizeDirectChatCommand,
} = require('./directChatCore');
const {
  DIRECT_CHAT_COMMAND_RETENTION_MS,
  DIRECT_CHAT_REQUEST_COOLDOWN_MS,
  DIRECT_CHAT_REQUEST_EXPIRY_MS,
  canUnsendDirectMessage,
  filterDirectChatText,
  isAcceptedConversation,
  isPairFriendship,
  resolveDirectChatActorAccess,
  resolveDirectChatPairAccess,
  resolveDirectChatRateLimit,
  resolveDirectChatRequestStatus,
  safeDirectChatPreview,
  systemEventPreview,
  timestampToMillis,
} = require('./directChatPolicyCore');
const { executeDirectChatReadCommand } = require('./directChatQueryService');
const { executeDirectChatMediaCommand } = require('./directChatMediaService');
const { resolveStickerEntitlement, safeAttachmentPreview } = require('./directChatMediaCore');
const {
  buildDirectChatProjection,
  resolveDirectChatMarkRead,
} = require('./directChatProjectionCore');

const DIRECT_CHAT_MUTATION_ACTIONS = new Set([
  'send-direct-message',
  'send-message-request',
  'accept-message-request',
  'reject-message-request',
  'unsend-direct-message',
  'delete-conversation-for-me',
  'mark-direct-chat-read',
  'set-direct-chat-mute',
  'set-direct-chat-archive',
]);

const defaultClock = {
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => {
    const { Timestamp } = require('firebase-admin/firestore');
    return Timestamp.fromMillis(value);
  },
};

async function executeDirectChatCommand({ body, bucket, clock = defaultClock, db, decodedToken, safetyAdapter }) {
  const validation = normalizeDirectChatCommand(body, decodedToken?.uid);
  if (!decodedToken?.uid) return directChatError('AUTH_REQUIRED');
  if (decodedToken.email && decodedToken.email_verified !== true) {
    return directChatError('EMAIL_VERIFICATION_REQUIRED');
  }
  if (!validation.ok) return validation;
  if (validation.value.action === 'get-direct-chat-status') {
    return getDirectChatStatus({
      clock,
      command: validation.value,
      db,
      fingerprint: buildDirectChatFingerprint(validation),
      uid: decodedToken.uid,
    });
  }
  if (['get-direct-chat-inbox', 'get-direct-chat-thread'].includes(validation.value.action)) {
    return executeDirectChatReadCommand({
      clock,
      command: validation.value,
      db,
      fingerprint: buildDirectChatFingerprint(validation),
      uid: decodedToken.uid,
    });
  }
  if (['create-direct-chat-upload', 'finalize-direct-chat-upload'].includes(validation.value.action)) {
    return executeDirectChatMediaCommand({
      bucket,
      clock,
      command: validation.value,
      db,
      fingerprint: buildDirectChatFingerprint(validation),
      safetyAdapter,
      uid: decodedToken.uid,
    });
  }
  if (!DIRECT_CHAT_MUTATION_ACTIONS.has(validation.value.action)) {
    return directChatError('FEATURE_DISABLED');
  }
  return mutateDirectChat({
    clock,
    command: validation.value,
    db,
    fingerprint: buildDirectChatFingerprint(validation),
    uid: decodedToken.uid,
  });
}

async function getDirectChatStatus({ clock, command, db, fingerprint, uid }) {
  const targetUid = command.payload.targetUid;
  const conversationId = createDirectConversationId(uid, targetUid);
  const friendshipId = createFriendshipId(uid, targetUid);
  const refs = buildPairRefs({ conversationId, db, targetUid, uid });
  const commandRef = db.doc(`directChatCommands/${uid}/requests/${command.requestId}`);
  return db.runTransaction(async (transaction) => {
    const commandSnapshot = await transaction.get(commandRef);
    if (commandSnapshot.exists) {
      const previous = commandSnapshot.data();
      if (previous.actorUid !== uid || previous.fingerprint !== fingerprint) return directChatError('REQUEST_CONFLICT');
      return { ...previous.response, replayed: true };
    }
    const snapshots = await Promise.all([
      transaction.get(refs.flags),
      transaction.get(refs.actorProfile),
      transaction.get(refs.targetProfile),
      transaction.get(refs.blockedByActor),
      transaction.get(refs.blockedByTarget),
      transaction.get(refs.actorRestriction),
      transaction.get(refs.targetRestriction),
      transaction.get(refs.friendship(friendshipId)),
      transaction.get(refs.conversation),
      transaction.get(refs.messageRequest),
    ]);
    const [flags, actorProfile, targetProfile, blockedByActor, blockedByTarget,
      actorRestriction, targetRestriction, friendship, conversation, messageRequest] = snapshots;
    const nowMs = clock.nowMillis();
    const now = clock.timestampFromMillis(nowMs);
    const access = resolveDirectChatPairAccess({
      actorProfile: dataOf(actorProfile),
      actorRestriction: dataOf(actorRestriction),
      blockedByActor: blockedByActor.exists,
      blockedByTarget: blockedByTarget.exists,
      featureFlags: dataOf(flags),
      nowMs,
      targetProfile: dataOf(targetProfile),
      targetRestriction: dataOf(targetRestriction),
    });
    let response = access;
    if (access.ok) {
      const conversationData = dataOf(conversation);
      const friendshipData = dataOf(friendship);
      const requestStatus = resolveDirectChatRequestStatus(dataOf(messageRequest), nowMs);
      const accepted = isAcceptedConversation(conversationData, friendshipData);
      const isFriend = isPairFriendship(friendshipData, [uid, targetUid]);
      const requesterUid = conversationData?.requesterUid || dataOf(messageRequest)?.senderUid || '';
      const recipientUid = conversationData?.recipientUid || dataOf(messageRequest)?.recipientUid || '';
      response = {
        ok: true,
        result: {
          action: command.action,
          accepted,
          canSendDirectly: accepted || isFriend,
          conversationId,
          conversationState: conversationData?.lifecycleState || 'none',
          isFriend,
          recipientUid,
          requestDirection: requestStatus === 'pending'
            ? recipientUid === uid ? 'incoming' : requesterUid === uid ? 'outgoing' : 'none'
            : 'none',
          requestId: command.requestId,
          requestStatus,
          requesterUid,
          requiresRequest: !accepted && !isFriend,
          targetUid,
        },
      };
    }
    return recordDirectChatCommand({ clock, command, commandRef, conversationId, fingerprint, now, response, transaction, uid });
  });
}

async function mutateDirectChat({ clock, command, db, fingerprint, uid }) {
  const targetUid = command.payload.targetUid;
  const conversationId = createDirectConversationId(uid, targetUid);
  const friendshipId = createFriendshipId(uid, targetUid);
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);
  const refs = buildPairRefs({ conversationId, db, targetUid, uid });
  const commandRef = db.doc(`directChatCommands/${uid}/requests/${command.requestId}`);

  return db.runTransaction(async (transaction) => {
    const commandSnapshot = await transaction.get(commandRef);
    if (commandSnapshot.exists) {
      const previous = commandSnapshot.data();
      if (previous.actorUid !== uid || previous.fingerprint !== fingerprint) {
        return directChatError('REQUEST_CONFLICT');
      }
      return { ...previous.response, replayed: true };
    }

    const messageRef = command.action === 'unsend-direct-message'
      ? refs.conversation.collection('messages').doc(command.payload.messageId)
      : null;
    const replyRef = command.action === 'send-direct-message' && command.payload.replyToMessageId
      ? refs.conversation.collection('messages').doc(command.payload.replyToMessageId)
      : null;
    const friendshipRef = refs.friendship(friendshipId);
    const memberItemRef = db.doc(`directConversationMembers/${uid}/items/${conversationId}`);
    const targetMemberItemRef = db.doc(`directConversationMembers/${targetUid}/items/${conversationId}`);
    const memberSummaryRef = db.doc(`directChatInboxSummaries/${uid}`);
    const targetMemberSummaryRef = db.doc(`directChatInboxSummaries/${targetUid}`);
    const memberReceiptRef = refs.conversation.collection('receipts').doc(uid);
    const stickerOwnershipRef = command.action === 'send-direct-message' && command.payload.kind === 'sticker'
      ? db.doc(`storeOwnerships/${uid}/items/${command.payload.stickerItemId}`)
      : null;
    const stickerCatalogRef = command.action === 'send-direct-message' && command.payload.kind === 'sticker'
      ? db.doc(`storeCatalog/${command.payload.stickerItemId}`)
      : null;
    const snapshots = await Promise.all([
      transaction.get(refs.flags),
      transaction.get(refs.moderation),
      transaction.get(refs.actorProfile),
      transaction.get(refs.targetProfile),
      transaction.get(refs.blockedByActor),
      transaction.get(refs.blockedByTarget),
      transaction.get(refs.actorRestriction),
      transaction.get(refs.targetRestriction),
      transaction.get(friendshipRef),
      transaction.get(refs.conversation),
      transaction.get(refs.messageRequest),
      transaction.get(refs.rate),
      messageRef ? transaction.get(messageRef) : Promise.resolve(null),
      replyRef ? transaction.get(replyRef) : Promise.resolve(null),
      transaction.get(memberItemRef),
      transaction.get(targetMemberItemRef),
      transaction.get(memberSummaryRef),
      transaction.get(targetMemberSummaryRef),
      stickerOwnershipRef ? transaction.get(stickerOwnershipRef) : Promise.resolve(null),
      stickerCatalogRef ? transaction.get(stickerCatalogRef) : Promise.resolve(null),
    ]);
    const [flagsSnapshot, moderationSnapshot, actorProfileSnapshot, targetProfileSnapshot,
      blockedByActorSnapshot, blockedByTargetSnapshot, actorRestrictionSnapshot,
      targetRestrictionSnapshot, friendshipSnapshot, conversationSnapshot,
      messageRequestSnapshot, rateSnapshot, messageSnapshot, replySnapshot,
      memberItemSnapshot, targetMemberItemSnapshot, memberSummarySnapshot,
      targetMemberSummarySnapshot, stickerOwnershipSnapshot, stickerCatalogSnapshot] = snapshots;
    const stickerCatalog = dataOf(stickerCatalogSnapshot);
    let stickerAssetSummary;
    let stickerAssetVersion;
    if (stickerCatalog?.stickerAsset?.assetId && stickerCatalog?.stickerAsset?.assetVersionId) {
      const [summarySnapshot, versionSnapshot] = await Promise.all([
        transaction.get(db.doc(`cosmeticAssets/${stickerCatalog.stickerAsset.assetId}`)),
        transaction.get(db.doc(`cosmeticAssets/${stickerCatalog.stickerAsset.assetId}/versions/${stickerCatalog.stickerAsset.assetVersionId}`)),
      ]);
      stickerAssetSummary = dataOf(summarySnapshot);
      stickerAssetVersion = dataOf(versionSnapshot);
    }
    const context = {
      actorProfile: dataOf(actorProfileSnapshot),
      actorRestriction: dataOf(actorRestrictionSnapshot),
      blockedByActor: blockedByActorSnapshot.exists,
      blockedByTarget: blockedByTargetSnapshot.exists,
      conversation: dataOf(conversationSnapshot),
      conversationSnapshot,
      featureFlags: dataOf(flagsSnapshot),
      friendship: dataOf(friendshipSnapshot),
      memberItem: dataOf(memberItemSnapshot),
      message: dataOf(messageSnapshot),
      messageRequest: dataOf(messageRequestSnapshot),
      moderation: dataOf(moderationSnapshot),
      rate: dataOf(rateSnapshot),
      reply: dataOf(replySnapshot),
      targetProfile: dataOf(targetProfileSnapshot),
      targetRestriction: dataOf(targetRestrictionSnapshot),
      targetMemberItem: dataOf(targetMemberItemSnapshot),
      memberSummary: dataOf(memberSummarySnapshot),
      targetMemberSummary: dataOf(targetMemberSummarySnapshot),
      memberItemRef,
      targetMemberItemRef,
      memberSummaryRef,
      targetMemberSummaryRef,
      memberReceiptRef,
      stickerOwnership: dataOf(stickerOwnershipSnapshot),
      stickerAssetSummary,
      stickerAssetVersion,
      stickerCatalog,
    };

    const actorOnly = [
      'delete-conversation-for-me',
      'mark-direct-chat-read',
      'set-direct-chat-archive',
      'set-direct-chat-mute',
      'unsend-direct-message',
    ].includes(command.action);
    const access = actorOnly
      ? resolveDirectChatActorAccess({
        actorProfile: context.actorProfile,
        actorRestriction: context.actorRestriction,
        featureFlags: context.featureFlags,
        nowMs,
      })
      : resolveDirectChatPairAccess({
        actorProfile: context.actorProfile,
        actorRestriction: context.actorRestriction,
        blockedByActor: context.blockedByActor,
        blockedByTarget: context.blockedByTarget,
        featureFlags: context.featureFlags,
        nowMs,
        requireRequests: command.action === 'send-message-request',
        targetProfile: context.targetProfile,
        targetRestriction: context.targetRestriction,
      });
    if (!access.ok) {
      return recordDirectChatCommand({ clock, command, commandRef, conversationId, fingerprint, now, response: access, transaction, uid });
    }

    let response;
    if (command.action === 'send-direct-message') {
      response = applyDirectMessageSend({ clock, command, context, conversationId, db, now, nowMs, refs, transaction, uid });
    } else if (command.action === 'send-message-request') {
      response = applyMessageRequestSend({ clock, command, context, conversationId, now, nowMs, refs, transaction, uid });
    } else if (command.action === 'accept-message-request' || command.action === 'reject-message-request') {
      response = applyMessageRequestDecision({ clock, command, context, conversationId, db, now, nowMs, refs, transaction, uid });
    } else if (command.action === 'unsend-direct-message') {
      response = applyDirectMessageUnsend({ command, context, conversationId, now, nowMs, refs, transaction, uid });
    } else if (command.action === 'delete-conversation-for-me') {
      response = applyDeleteConversationForMe({ command, context, conversationId, memberItemRef, now, transaction, uid });
    } else {
      response = applyProjectionPreference({ command, context, conversationId, now, transaction, uid });
    }
    return recordDirectChatCommand({ clock, command, commandRef, conversationId, fingerprint, now, response, transaction, uid });
  });
}

function applyDirectMessageSend({ clock, command, context, conversationId, now, nowMs, refs, transaction, uid }) {
  if (['image', 'voice-note'].includes(command.payload.kind)) return directChatError('UPLOAD_INVALID');
  if (!['text', 'emoji', 'sticker'].includes(command.payload.kind)) return directChatError('MEDIA_DISABLED');
  if (['text', 'emoji'].includes(command.payload.kind)) {
    const filtered = filterDirectChatText(command.payload.text, context.moderation);
    if (!filtered.ok) return filtered;
  }
  const sticker = command.payload.kind === 'sticker'
    ? resolveStickerEntitlement({
      assetSummary: context.stickerAssetSummary,
      assetVersion: context.stickerAssetVersion,
      catalog: context.stickerCatalog,
      nowMs,
      ownership: context.stickerOwnership,
      stickerItemId: command.payload.stickerItemId,
      uid,
    })
    : undefined;
  if (sticker && !sticker.ok) return directChatError('STICKER_UNAVAILABLE');
  const memberUids = [uid, command.payload.targetUid].sort();
  const isFriend = isPairFriendship(context.friendship, memberUids);
  if (!isFriend && !isAcceptedConversation(context.conversation, context.friendship)) {
    return directChatError('NOT_FRIEND');
  }
  const replyValidation = validateReplyTarget(context.reply, context.memberItem);
  if (command.payload.replyToMessageId && !replyValidation.ok) return replyValidation;
  const rate = resolveDirectChatRateLimit({ isNewNonFriendRecipient: false, nowMs, rate: context.rate, targetUid: command.payload.targetUid });
  if (!rate.ok) return rate;

  let sequence = safeSequence(context.conversation?.lastSequence);
  const promotedPendingRequest = isFriend && resolveDirectChatRequestStatus(context.messageRequest, nowMs) === 'pending';
  if (promotedPendingRequest) {
    sequence = appendSystemEvent({ actorUid: uid, command, conversationId, eventType: 'request-accepted', now, refs, sequence, transaction, unreadForUids: [command.payload.targetUid] });
    transaction.set(refs.messageRequest, { acceptedAt: now, status: 'accepted', updatedAt: now }, { merge: true });
  }
  const messageId = createDirectMessageId({ conversationId, requestId: command.requestId, senderUid: uid });
  sequence += 1;
  transaction.create(refs.conversation.collection('messages').doc(messageId), buildUserMessage({
    command,
    conversationId,
    createdAt: now,
    messageId,
    sequence,
    uid,
    sticker: sticker?.value,
  }));
  const conversationDocument = {
    ...baseConversationDocument({ command, conversationId, memberUids, now, uid }),
    lastMessageId: messageId,
    lastMessageKind: command.payload.kind,
    lastMessagePreview: command.payload.kind === 'sticker'
      ? safeAttachmentPreview('sticker')
      : safeDirectChatPreview(command.payload.kind, command.payload.text),
    lastMessageSenderUid: uid,
    lastSequence: sequence,
    requestState: 'accepted',
    updatedAt: now,
  };
  writeConversation(transaction, refs.conversation, context.conversationSnapshot.exists, conversationDocument);
  writePairProjections({
    context,
    conversation: conversationDocument,
    now,
    targetUnreadIncrement: promotedPendingRequest ? 2 : 1,
    transaction,
    uid,
  });
  writeRate(clock, transaction, refs.rate, rate.value, now, uid);
  return success(command, conversationId, { messageId, requestState: 'accepted', sequence });
}

function applyMessageRequestSend({ clock, command, context, conversationId, now, nowMs, refs, transaction, uid }) {
  const filtered = filterDirectChatText(command.payload.text, context.moderation);
  if (!filtered.ok) return filtered;
  const memberUids = [uid, command.payload.targetUid].sort();
  const isFriend = isPairFriendship(context.friendship, memberUids);
  const accepted = isAcceptedConversation(context.conversation, context.friendship);
  const requestStatus = resolveDirectChatRequestStatus(context.messageRequest, nowMs);
  if (!isFriend && !accepted && requestStatus === 'pending') return directChatError('REQUEST_PENDING');
  const cooldownUntilMs = timestampToMillis(context.messageRequest?.cooldownUntil);
  if (!isFriend && !accepted && requestStatus === 'rejected' && Number.isFinite(cooldownUntilMs) && nowMs < cooldownUntilMs) {
    return directChatError('REQUEST_COOLDOWN');
  }
  const rate = resolveDirectChatRateLimit({
    isNewNonFriendRecipient: !isFriend && !accepted,
    nowMs,
    rate: context.rate,
    targetUid: command.payload.targetUid,
  });
  if (!rate.ok) return rate;

  let sequence = safeSequence(context.conversation?.lastSequence);
  let systemEventAdded = false;
  if (isFriend && requestStatus === 'pending') {
    sequence = appendSystemEvent({ actorUid: uid, command, conversationId, eventType: 'request-accepted', now, refs, sequence, transaction, unreadForUids: [command.payload.targetUid] });
    systemEventAdded = true;
  } else if (!isFriend && !accepted && requestStatus === 'expired') {
    sequence = appendSystemEvent({ actorUid: uid, command, conversationId, eventType: 'request-expired', now, refs, sequence, transaction, unreadForUids: [command.payload.targetUid] });
    systemEventAdded = true;
  }
  const messageId = createDirectMessageId({ conversationId, requestId: command.requestId, senderUid: uid });
  sequence += 1;
  transaction.create(refs.conversation.collection('messages').doc(messageId), {
    conversationId,
    createdAt: now,
    id: messageId,
    kind: 'text',
    replyToMessageId: '',
    senderUid: uid,
    sequence,
    text: command.payload.text,
    unreadForUids: [command.payload.targetUid],
    visibilityState: 'visible',
  });
  const requestState = isFriend || accepted ? 'accepted' : 'pending';
  const conversationDocument = {
    ...baseConversationDocument({ command, conversationId, memberUids, now, uid }),
    lastMessageId: messageId,
    lastMessageKind: 'text',
    lastMessagePreview: safeDirectChatPreview('text', command.payload.text),
    lastMessageSenderUid: uid,
    lastSequence: sequence,
    recipientUid: requestState === 'pending' ? command.payload.targetUid : '',
    requesterUid: requestState === 'pending' ? uid : '',
    requestState,
    updatedAt: now,
  };
  writeConversation(transaction, refs.conversation, context.conversationSnapshot.exists, conversationDocument);
  writePairProjections({
    context,
    conversation: conversationDocument,
    now,
    targetUnreadIncrement: systemEventAdded ? 2 : 1,
    transaction,
    uid,
  });
  if (requestState === 'pending') {
    const requestDocument = {
      conversationId,
      createdAt: now,
      expiresAt: clock.timestampFromMillis(nowMs + DIRECT_CHAT_REQUEST_EXPIRY_MS),
      initialMessageId: messageId,
      memberUids,
      recipientUid: command.payload.targetUid,
      senderUid: uid,
      status: 'pending',
      updatedAt: now,
    };
    transaction.set(refs.messageRequest, requestDocument, { merge: true });
  } else if (context.messageRequest) {
    transaction.set(refs.messageRequest, { acceptedAt: now, status: 'accepted', updatedAt: now }, { merge: true });
  }
  writeRate(clock, transaction, refs.rate, rate.value, now, uid);
  return success(command, conversationId, { messageId, requestState, sequence });
}

function applyMessageRequestDecision({ clock, command, context, conversationId, now, nowMs, refs, transaction, uid }) {
  if (!context.conversation || !context.messageRequest) return directChatError('NOT_FOUND');
  const requestStatus = resolveDirectChatRequestStatus(context.messageRequest, nowMs);
  if (context.messageRequest.recipientUid !== uid || context.messageRequest.senderUid !== command.payload.targetUid) {
    return directChatError('PERMISSION_DENIED');
  }
  if (requestStatus === 'expired') {
    expireRequestInTransaction({ actorUid: 'system-expiry', command, context, conversationId, now, refs, transaction });
    return directChatError('REQUEST_EXPIRED');
  }
  if (requestStatus !== 'pending') return directChatError('NOT_FOUND');
  const accepting = command.action === 'accept-message-request';
  const eventType = accepting ? 'request-accepted' : 'request-rejected';
  const sequence = appendSystemEvent({ actorUid: uid, command, conversationId, eventType, now, refs, sequence: safeSequence(context.conversation.lastSequence), transaction, unreadForUids: [command.payload.targetUid] });
  const requestState = accepting ? 'accepted' : 'rejected';
  transaction.set(refs.messageRequest, {
    ...(accepting
      ? { acceptedAt: now }
      : { cooldownUntil: clock.timestampFromMillis(nowMs + DIRECT_CHAT_REQUEST_COOLDOWN_MS), rejectedAt: now }),
    decidedByUid: uid,
    status: requestState,
    updatedAt: now,
  }, { merge: true });
  const conversationDocument = {
    ...context.conversation,
    lastMessageId: createDirectSystemMessageId({ actorUid: uid, conversationId, eventType, requestId: command.requestId }),
    lastMessageKind: 'system',
    lastMessagePreview: systemEventPreview(eventType),
    lastMessageSenderUid: 'system',
    lastSequence: sequence,
    requestState,
    updatedAt: now,
  };
  transaction.set(refs.conversation, conversationDocument, { merge: true });
  writePairProjections({
    context,
    conversation: conversationDocument,
    now,
    targetUnreadIncrement: 1,
    transaction,
    uid,
  });
  return success(command, conversationId, { requestState, sequence });
}

function applyDirectMessageUnsend({ command, context, conversationId, now, nowMs, refs, transaction, uid }) {
  if (!context.conversation || !Array.isArray(context.conversation.memberUids) || !context.conversation.memberUids.includes(uid)) {
    return directChatError('NOT_FOUND');
  }
  const allowed = canUnsendDirectMessage({ actorUid: uid, message: context.message, nowMs });
  if (!allowed.ok) return allowed;
  transaction.update(refs.conversation.collection('messages').doc(command.payload.messageId), {
    text: '',
    unreadForUids: [],
    unsentAt: now,
    unsentByUid: uid,
    visibilityState: 'unsent',
  });
  const targetWasUnread = Array.isArray(context.message.unreadForUids)
    && context.message.unreadForUids.includes(command.payload.targetUid)
    && safeSequence(context.targetMemberItem?.lastReadSequence) < safeSequence(context.message.sequence);
  let projectedConversation = context.conversation;
  if (context.conversation.lastMessageId === command.payload.messageId) {
    projectedConversation = {
      ...context.conversation,
      lastMessageKind: 'unsent',
      lastMessagePreview: safeDirectChatPreview('unsent'),
      updatedAt: now,
    };
    transaction.set(refs.conversation, projectedConversation, { merge: true });
  }
  writePairProjections({
    context,
    conversation: projectedConversation,
    now,
    targetUnreadIncrement: targetWasUnread ? -1 : 0,
    transaction,
    uid,
  });
  return success(command, conversationId, { messageId: command.payload.messageId, sequence: context.message.sequence, visibilityState: 'unsent' });
}

function applyDeleteConversationForMe({ command, context, conversationId, memberItemRef, now, transaction, uid }) {
  if (!context.conversation || !Array.isArray(context.conversation.memberUids) || !context.conversation.memberUids.includes(uid)) {
    return directChatError('NOT_FOUND');
  }
  const clearedThroughSequence = safeSequence(context.conversation.lastSequence);
  const projection = buildDirectChatProjection({
    conversation: context.conversation,
    existing: context.memberItem,
    now,
    ownerUid: uid,
    peerUid: command.payload.targetUid,
  });
  const nextProjection = {
    ...projection,
    archived: true,
    clearedThroughSequence,
    lastReadSequence: Math.max(projection.lastReadSequence, clearedThroughSequence),
    unreadCount: 0,
    updatedAt: now,
  };
  transaction.set(memberItemRef, nextProjection, { merge: true });
  writeUnreadSummary({
    existingProjection: context.memberItem,
    existingSummary: context.memberSummary,
    nextProjection,
    now,
    summaryRef: context.memberSummaryRef,
    transaction,
    uid,
  });
  writeReadReceipt({ conversationId, lastReadSequence: clearedThroughSequence, now, receiptRef: context.memberReceiptRef, transaction, uid });
  return success(command, conversationId, { clearedThroughSequence });
}

function applyProjectionPreference({ command, context, conversationId, now, transaction, uid }) {
  if (!context.conversation || !Array.isArray(context.conversation.memberUids) || !context.conversation.memberUids.includes(uid)) {
    return directChatError('NOT_FOUND');
  }
  const base = buildDirectChatProjection({
    conversation: context.conversation,
    existing: context.memberItem,
    now,
    ownerUid: uid,
    peerUid: command.payload.targetUid,
  });
  let patch;
  let result;
  if (command.action === 'mark-direct-chat-read') {
    const resolution = resolveDirectChatMarkRead({
      conversation: context.conversation,
      projection: context.memberItem,
      throughSequence: command.payload.throughSequence,
    });
    if (!resolution.ok) return resolution;
    patch = {
      ...base,
      archived: context.memberItem?.archived === true,
      lastReadSequence: resolution.value.lastReadSequence,
      unreadCount: resolution.value.unreadCount,
    };
    result = { changed: resolution.value.changed, lastReadSequence: resolution.value.lastReadSequence, unreadCount: resolution.value.unreadCount };
  } else if (command.action === 'set-direct-chat-mute') {
    patch = { ...base, archived: context.memberItem?.archived === true, muted: command.payload.muted };
    result = { muted: command.payload.muted };
  } else {
    patch = { ...base, archived: command.payload.archived };
    result = { archived: command.payload.archived };
  }
  transaction.set(context.memberItemRef, patch, { merge: true });
  writeUnreadSummary({
    existingProjection: context.memberItem,
    existingSummary: context.memberSummary,
    nextProjection: patch,
    now,
    summaryRef: context.memberSummaryRef,
    transaction,
    uid,
  });
  if (command.action === 'mark-direct-chat-read') {
    writeReadReceipt({ conversationId, lastReadSequence: patch.lastReadSequence, now, receiptRef: context.memberReceiptRef, transaction, uid });
  }
  return success(command, conversationId, result);
}

function writePairProjections({ context, conversation, now, targetUnreadIncrement, transaction, uid }) {
  const targetUid = conversation.memberUids.find((memberUid) => memberUid !== uid);
  const actorProjection = buildDirectChatProjection({
    conversation,
    existing: context.memberItem,
    now,
    ownerUid: uid,
    peerUid: targetUid,
    unreadIncrement: 0,
  });
  const targetProjection = buildDirectChatProjection({
    conversation,
    existing: context.targetMemberItem,
    now,
    ownerUid: targetUid,
    peerUid: uid,
    unreadIncrement: targetUnreadIncrement,
  });
  transaction.set(context.memberItemRef, actorProjection, { merge: true });
  transaction.set(context.targetMemberItemRef, targetProjection, { merge: true });
  writeUnreadSummary({
    existingProjection: context.memberItem,
    existingSummary: context.memberSummary,
    nextProjection: actorProjection,
    now,
    summaryRef: context.memberSummaryRef,
    transaction,
    uid,
  });
  writeUnreadSummary({
    existingProjection: context.targetMemberItem,
    existingSummary: context.targetMemberSummary,
    nextProjection: targetProjection,
    now,
    summaryRef: context.targetMemberSummaryRef,
    transaction,
    uid: targetUid,
  });
}

function writeUnreadSummary({ existingProjection, existingSummary, nextProjection, now, summaryRef, transaction, uid }) {
  const previousUnreadCount = safeSequence(existingProjection?.unreadCount);
  const nextUnreadCount = safeSequence(nextProjection?.unreadCount);
  const totalUnreadCount = Math.max(0, safeSequence(existingSummary?.totalUnreadCount) + nextUnreadCount - previousUnreadCount);
  transaction.set(summaryRef, { totalUnreadCount, uid, updatedAt: now }, { merge: true });
}

function writeReadReceipt({ conversationId, lastReadSequence, now, receiptRef, transaction, uid }) {
  transaction.set(
    receiptRef,
    { conversationId, lastReadSequence: safeSequence(lastReadSequence), uid, updatedAt: now },
    { merge: true },
  );
}

function validateReplyTarget(reply, memberItem) {
  if (!reply || reply.visibilityState !== 'visible' || !Number.isSafeInteger(reply.sequence)) {
    return directChatError('REPLY_TARGET_UNAVAILABLE');
  }
  if (reply.sequence <= safeSequence(memberItem?.clearedThroughSequence)) {
    return directChatError('REPLY_TARGET_UNAVAILABLE');
  }
  return { ok: true };
}

function buildUserMessage({ command, conversationId, createdAt, messageId, sequence, sticker, uid }) {
  return {
    conversationId,
    createdAt,
    id: messageId,
    kind: command.payload.kind,
    replyToMessageId: command.payload.replyToMessageId || '',
    senderUid: uid,
    sequence,
    ...(sticker ? { sticker } : {}),
    text: command.payload.text || '',
    unreadForUids: [command.payload.targetUid],
    visibilityState: 'visible',
  };
}

function baseConversationDocument({ command, conversationId, memberUids, now, uid }) {
  return {
    conversationId,
    createdAt: now,
    createdByUid: uid,
    creationSource: command.action === 'send-message-request' ? 'request' : 'friend',
    lifecycleState: 'active',
    friendshipId: createFriendshipId(memberUids[0], memberUids[1]),
    memberUids,
    schemaVersion: 1,
  };
}

function appendSystemEvent({ actorUid, command, conversationId, eventType, now, refs, sequence, transaction, unreadForUids = [] }) {
  const messageId = createDirectSystemMessageId({ actorUid, conversationId, eventType, requestId: command.requestId });
  const nextSequence = sequence + 1;
  transaction.create(refs.conversation.collection('messages').doc(messageId), {
    actorUid,
    conversationId,
    createdAt: now,
    id: messageId,
    kind: 'system',
    senderUid: 'system',
    sequence: nextSequence,
    systemType: eventType,
    text: '',
    unreadForUids,
    visibilityState: 'visible',
  });
  return nextSequence;
}

function expireRequestInTransaction({ actorUid, command, context, conversationId, now, refs, transaction }) {
  const eventType = 'request-expired';
  const sequence = appendSystemEvent({ actorUid, command, conversationId, eventType, now, refs, sequence: safeSequence(context.conversation.lastSequence), transaction, unreadForUids: [command.payload.targetUid] });
  const messageId = createDirectSystemMessageId({ actorUid, conversationId, eventType, requestId: command.requestId });
  transaction.set(refs.messageRequest, { expiredAt: now, status: 'expired', updatedAt: now }, { merge: true });
  const conversationDocument = {
    ...context.conversation,
    lastMessageId: messageId,
    lastMessageKind: 'system',
    lastMessagePreview: systemEventPreview(eventType),
    lastMessageSenderUid: 'system',
    lastSequence: sequence,
    requestState: 'expired',
    updatedAt: now,
  };
  transaction.set(refs.conversation, conversationDocument, { merge: true });
  writePairProjections({ context, conversation: conversationDocument, now, targetUnreadIncrement: 1, transaction, uid: context.messageRequest.recipientUid });
}

function writeConversation(transaction, reference, exists, value) {
  if (!exists) {
    transaction.create(reference, value);
    return;
  }
  const { createdAt, createdByUid, creationSource, ...patch } = value;
  transaction.set(reference, patch, { merge: true });
}

function writeRate(clock, transaction, reference, rate, now, uid) {
  transaction.set(reference, {
    newRecipientUids: rate.newRecipientUids,
    requestDayKey: rate.requestDayKey,
    sendCount: rate.sendCount,
    sendWindowStartedAt: clock.timestampFromMillis(rate.sendWindowStartedAtMs),
    uid,
    updatedAt: now,
  }, { merge: true });
}

function recordDirectChatCommand({ clock, command, commandRef, conversationId, fingerprint, now, response, transaction, uid }) {
  transaction.create(commandRef, {
    action: command.action,
    actorUid: uid,
    commandKind: 'direct-chat',
    conversationId,
    createdAt: now,
    fingerprint,
    purgeAfter: clock.timestampFromMillis(clock.nowMillis() + DIRECT_CHAT_COMMAND_RETENTION_MS),
    requestId: command.requestId,
    response,
    status: response.ok ? 'applied' : 'denied',
  });
  return { ...response, replayed: false };
}

function success(command, conversationId, value = {}) {
  return {
    ok: true,
    result: {
      action: command.action,
      conversationId,
      requestId: command.requestId,
      targetUid: command.payload.targetUid,
      ...value,
    },
  };
}

function buildPairRefs({ conversationId, db, targetUid, uid }) {
  return {
    actorProfile: db.doc(`publicProfiles/${uid}`),
    actorRestriction: db.doc(`directChatRestrictions/${uid}`),
    blockedByActor: db.doc(`blocks/${uid}/blocked/${targetUid}`),
    blockedByTarget: db.doc(`blocks/${targetUid}/blocked/${uid}`),
    conversation: db.doc(`directConversations/${conversationId}`),
    flags: db.doc('appConfig/socialFeatures'),
    friendship: (friendshipId) => db.doc(`friendships/${friendshipId}`),
    messageRequest: db.doc(`directMessageRequests/${conversationId}`),
    moderation: db.doc('appConfig/voiceRoomModeration'),
    rate: db.doc(`directChatRateLimits/${uid}`),
    targetProfile: db.doc(`publicProfiles/${targetUid}`),
    targetRestriction: db.doc(`directChatRestrictions/${targetUid}`),
  };
}

async function expirePendingDirectMessageRequests({ clock = defaultClock, db, limit = 100 }) {
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);
  const snapshot = await db.collection('directMessageRequests')
    .where('status', '==', 'pending')
    .where('expiresAt', '<=', now)
    .orderBy('expiresAt', 'asc')
    .limit(limit)
    .get();
  let expired = 0;
  for (const document of snapshot.docs) {
    const changed = await db.runTransaction(async (transaction) => {
      const requestSnapshot = await transaction.get(document.ref);
      if (!requestSnapshot.exists || resolveDirectChatRequestStatus(requestSnapshot.data(), nowMs) !== 'expired') return false;
      const request = requestSnapshot.data();
      const conversationRef = db.doc(`directConversations/${document.id}`);
      const conversationSnapshot = await transaction.get(conversationRef);
      if (!conversationSnapshot.exists || conversationSnapshot.data()?.requestState !== 'pending') {
        transaction.set(document.ref, { expiredAt: now, status: 'expired', updatedAt: now }, { merge: true });
        return true;
      }
      const requestId = `expiry_${document.id.slice(0, 32)}`;
      const actorUid = 'system-expiry';
      const eventType = 'request-expired';
      const messageId = createDirectSystemMessageId({ actorUid, conversationId: document.id, eventType, requestId });
      const messageRef = conversationRef.collection('messages').doc(messageId);
      const senderProjectionRef = db.doc(`directConversationMembers/${request.senderUid}/items/${document.id}`);
      const recipientProjectionRef = db.doc(`directConversationMembers/${request.recipientUid}/items/${document.id}`);
      const senderSummaryRef = db.doc(`directChatInboxSummaries/${request.senderUid}`);
      const recipientSummaryRef = db.doc(`directChatInboxSummaries/${request.recipientUid}`);
      const [messageSnapshot, senderProjectionSnapshot, recipientProjectionSnapshot, senderSummarySnapshot, recipientSummarySnapshot] = await Promise.all([
        transaction.get(messageRef),
        transaction.get(senderProjectionRef),
        transaction.get(recipientProjectionRef),
        transaction.get(senderSummaryRef),
        transaction.get(recipientSummaryRef),
      ]);
      const sequence = safeSequence(conversationSnapshot.data().lastSequence) + 1;
      if (!messageSnapshot.exists) {
        transaction.create(messageRef, {
          actorUid,
          conversationId: document.id,
          createdAt: now,
          id: messageId,
          kind: 'system',
          senderUid: 'system',
          sequence,
          systemType: eventType,
          text: '',
          unreadForUids: [request.senderUid],
          visibilityState: 'visible',
        });
      }
      transaction.set(document.ref, { expiredAt: now, status: 'expired', updatedAt: now }, { merge: true });
      const conversationDocument = {
        ...conversationSnapshot.data(),
        lastMessageId: messageId,
        lastMessageKind: 'system',
        lastMessagePreview: systemEventPreview(eventType),
        lastMessageSenderUid: 'system',
        lastSequence: messageSnapshot.exists ? messageSnapshot.data().sequence : sequence,
        requestState: 'expired',
        updatedAt: now,
      };
      transaction.set(conversationRef, conversationDocument, { merge: true });
      const senderProjection = buildDirectChatProjection({
        conversation: conversationDocument,
        existing: dataOf(senderProjectionSnapshot),
        now,
        ownerUid: request.senderUid,
        peerUid: request.recipientUid,
        unreadIncrement: messageSnapshot.exists ? 0 : 1,
      });
      const recipientProjection = buildDirectChatProjection({
        conversation: conversationDocument,
        existing: dataOf(recipientProjectionSnapshot),
        now,
        ownerUid: request.recipientUid,
        peerUid: request.senderUid,
      });
      transaction.set(senderProjectionRef, senderProjection, { merge: true });
      transaction.set(recipientProjectionRef, recipientProjection, { merge: true });
      writeUnreadSummary({
        existingProjection: dataOf(senderProjectionSnapshot),
        existingSummary: dataOf(senderSummarySnapshot),
        nextProjection: senderProjection,
        now,
        summaryRef: senderSummaryRef,
        transaction,
        uid: request.senderUid,
      });
      writeUnreadSummary({
        existingProjection: dataOf(recipientProjectionSnapshot),
        existingSummary: dataOf(recipientSummarySnapshot),
        nextProjection: recipientProjection,
        now,
        summaryRef: recipientSummaryRef,
        transaction,
        uid: request.recipientUid,
      });
      return true;
    });
    if (changed) expired += 1;
  }
  return { expired, scanned: snapshot.size };
}

async function cleanupDirectChatCommands({ clock = defaultClock, db, limit = 200 }) {
  const now = clock.timestampFromMillis(clock.nowMillis());
  const snapshot = await db.collectionGroup('requests')
    .where('commandKind', '==', 'direct-chat')
    .where('purgeAfter', '<=', now)
    .orderBy('purgeAfter', 'asc')
    .limit(limit)
    .get();
  if (snapshot.empty) return { deleted: 0, scanned: 0 };
  const batch = db.batch();
  for (const document of snapshot.docs) batch.delete(document.ref);
  await batch.commit();
  return { deleted: snapshot.size, scanned: snapshot.size };
}

function dataOf(snapshot) {
  return snapshot?.exists ? snapshot.data() : undefined;
}

function safeSequence(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

module.exports = {
  cleanupDirectChatCommands,
  executeDirectChatCommand,
  expirePendingDirectMessageRequests,
};
