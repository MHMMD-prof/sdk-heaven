const sharp = require('sharp');
const { createFriendshipId } = require('./socialFriendsCore');
const {
  createDirectConversationId,
  createDirectMessageId,
  directChatError,
} = require('./directChatCore');
const {
  DIRECT_CHAT_COMMAND_RETENTION_MS,
  isAcceptedConversation,
  isPairFriendship,
  resolveDirectChatPairAccess,
  resolveDirectChatRateLimit,
} = require('./directChatPolicyCore');
const { buildDirectChatProjection, safeSequence } = require('./directChatProjectionCore');
const {
  DIRECT_CHAT_DERIVATIVE_DIMENSION,
  DIRECT_CHAT_MAX_IMAGE_BYTES,
  DIRECT_CHAT_MEDIA_RETENTION_MS,
  DIRECT_CHAT_UPLOAD_TTL_MS,
  createDirectChatUploadId,
  directChatMediaPath,
  directChatQuarantinePath,
  inspectVoiceNote,
  safeAttachmentPreview,
  validateImageMetadata,
  validateUploadedObject,
} = require('./directChatMediaCore');

async function executeDirectChatMediaCommand({ bucket, clock, command, db, fingerprint, safetyAdapter, uid }) {
  if (command.action === 'create-direct-chat-upload') {
    return createDirectChatUpload({ clock, command, db, fingerprint, uid });
  }
  if (command.action === 'finalize-direct-chat-upload') {
    return finalizeDirectChatUpload({ bucket, clock, command, db, fingerprint, safetyAdapter, uid });
  }
  return directChatError('INVALID_REQUEST');
}

async function createDirectChatUpload({ clock, command, db, fingerprint, uid }) {
  const targetUid = command.payload.targetUid;
  const conversationId = createDirectConversationId(uid, targetUid);
  const uploadId = createDirectChatUploadId({ conversationId, requestId: command.requestId, uploaderUid: uid });
  const refs = pairRefs({ conversationId, db, targetUid, uid, uploadId });
  const commandRef = db.doc(`directChatCommands/${uid}/requests/${command.requestId}`);
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);
  return db.runTransaction(async (transaction) => {
    const commandSnapshot = await transaction.get(commandRef);
    const replay = resolveReplay(commandSnapshot, fingerprint, uid);
    if (replay) return replay;
    const snapshots = await Promise.all([
      transaction.get(refs.flags), transaction.get(refs.actorProfile), transaction.get(refs.targetProfile),
      transaction.get(refs.actorRestriction), transaction.get(refs.targetRestriction),
      transaction.get(refs.blockedByActor), transaction.get(refs.blockedByTarget),
      transaction.get(refs.friendship), transaction.get(refs.conversation),
      transaction.get(refs.upload), transaction.get(refs.authorization),
    ]);
    const [flags, actorProfile, targetProfile, actorRestriction, targetRestriction,
      blockedByActor, blockedByTarget, friendship, conversation, upload, authorization] = snapshots;
    const response = authorizeMediaPair({
      actorProfile: dataOf(actorProfile), actorRestriction: dataOf(actorRestriction), blockedByActor: blockedByActor.exists,
      blockedByTarget: blockedByTarget.exists, conversation: dataOf(conversation), featureFlags: dataOf(flags),
      friendship: dataOf(friendship), nowMs, targetProfile: dataOf(targetProfile), targetRestriction: dataOf(targetRestriction),
      uid, targetUid,
    });
    if (!response.ok) return recordCommand({ clock, command, commandRef, conversationId, fingerprint, now, response, transaction, uid });
    if (upload.exists || authorization.exists) {
      return recordCommand({ clock, command, commandRef, conversationId, fingerprint, now, response: directChatError('REQUEST_CONFLICT'), transaction, uid });
    }
    const expiresAt = clock.timestampFromMillis(nowMs + DIRECT_CHAT_UPLOAD_TTL_MS);
    const storagePath = directChatQuarantinePath(conversationId, uploadId);
    const authorizationDocument = {
      contentType: command.payload.contentType,
      conversationId,
      createdAt: now,
      expiresAt,
      kind: command.payload.kind,
      sizeBytes: command.payload.sizeBytes,
      state: 'active',
      storagePath,
      targetUid,
      uid,
      uploadId,
    };
    transaction.create(refs.authorization, authorizationDocument);
    transaction.create(refs.upload, {
      ...authorizationDocument,
      purgeAfter: clock.timestampFromMillis(nowMs + DIRECT_CHAT_MEDIA_RETENTION_MS),
      state: 'authorized',
      updatedAt: now,
    });
    return recordCommand({
      clock, command, commandRef, conversationId, fingerprint, now,
      response: success(command, conversationId, { contentType: command.payload.contentType, expiresAt, kind: command.payload.kind, sizeBytes: command.payload.sizeBytes, storagePath, uploadId }),
      transaction, uid,
    });
  });
}

async function finalizeDirectChatUpload({ bucket, clock, command, db, fingerprint, safetyAdapter, uid }) {
  if (!bucket || typeof bucket.file !== 'function') return directChatError('MEDIA_REJECTED');
  const targetUid = command.payload.targetUid;
  const conversationId = createDirectConversationId(uid, targetUid);
  const uploadId = command.payload.uploadId;
  const refs = pairRefs({ conversationId, db, targetUid, uid, uploadId });
  const commandRef = db.doc(`directChatCommands/${uid}/requests/${command.requestId}`);
  const existingCommand = await commandRef.get();
  const replay = resolveReplay(existingCommand, fingerprint, uid);
  if (replay) return replay;
  const [uploadSnapshot, authorizationSnapshot] = await db.getAll(refs.upload, refs.authorization);
  const upload = dataOf(uploadSnapshot);
  const authorization = dataOf(authorizationSnapshot);
  if (!upload || upload.state !== 'authorized' || upload.uid !== uid || upload.targetUid !== targetUid || upload.conversationId !== conversationId || !authorization) {
    return rejectUploadAndRecord({ bucket, clock, command, commandRef, conversationId, db, fingerprint, refs, response: directChatError('UPLOAD_INVALID'), uid });
  }
  const source = bucket.file(upload.storagePath);
  let metadata;
  let sourceBuffer;
  try {
    [[metadata], [sourceBuffer]] = await Promise.all([source.getMetadata(), source.download()]);
  } catch {
    return rejectUploadAndRecord({ bucket, clock, command, commandRef, conversationId, db, fingerprint, refs, response: directChatError('UPLOAD_INVALID'), uid });
  }
  const objectValidation = validateUploadedObject({ authorization, metadata, nowMs: clock.nowMillis() });
  if (!objectValidation.ok || sourceBuffer.length !== upload.sizeBytes) {
    return rejectUploadAndRecord({ bucket, clock, command, commandRef, conversationId, db, fingerprint, refs, response: directChatError('UPLOAD_INVALID'), uid });
  }

  const processed = await processMedia({ contentType: upload.contentType, kind: upload.kind, safetyAdapter, sourceBuffer });
  if (!processed.ok) {
    return rejectUploadAndRecord({ bucket, clock, command, commandRef, conversationId, db, fingerprint, refs, response: directChatError('MEDIA_REJECTED'), uid });
  }
  const mediaPath = directChatMediaPath(conversationId, uploadId, upload.kind, processed.value.contentType);
  const destination = bucket.file(mediaPath);
  let createdDerivative = false;
  try {
    await destination.save(processed.value.buffer, {
      metadata: {
        cacheControl: 'private,no-store,max-age=0',
        contentType: processed.value.contentType,
        metadata: { conversationId, kind: upload.kind, uploadId, uploaderUid: uid },
      },
      preconditionOpts: { ifGenerationMatch: 0 },
      resumable: false,
    });
    createdDerivative = true;
  } catch (error) {
    if (Number(error?.code) !== 412) return directChatError('MEDIA_REJECTED');
  }

  const response = await commitFinalizedUpload({
    clock, command, commandRef, conversationId, db, fingerprint, media: { ...processed.value, buffer: undefined, mediaPath }, refs, uid,
  });
  if (!response.ok && createdDerivative) await destination.delete({ ignoreNotFound: true }).catch(() => undefined);
  if (response.ok) await source.delete({ ignoreNotFound: true }).catch(() => undefined);
  return response;
}

async function processMedia({ contentType, kind, safetyAdapter, sourceBuffer }) {
  if (kind === 'voice-note') {
    const inspected = inspectVoiceNote(sourceBuffer, contentType);
    return inspected.ok ? { ok: true, value: { buffer: sourceBuffer, contentType: contentType === 'audio/x-m4a' ? 'audio/mp4' : contentType, durationMs: inspected.value.durationMs } } : inspected;
  }
  try {
    const pipeline = sharp(sourceBuffer, { animated: false, failOn: 'warning', limitInputPixels: 8_192 * 8_192 });
    const metadata = await pipeline.metadata();
    const valid = validateImageMetadata(metadata, contentType);
    if (!valid.ok) return valid;
    const derivative = await pipeline.rotate().resize({ fit: 'inside', height: DIRECT_CHAT_DERIVATIVE_DIMENSION, withoutEnlargement: true, width: DIRECT_CHAT_DERIVATIVE_DIMENSION }).toColorspace('srgb').webp({ effort: 4, quality: 82 }).toBuffer();
    if (derivative.length < 1 || derivative.length > DIRECT_CHAT_MAX_IMAGE_BYTES) return { ok: false, reason: 'image-derivative-size' };
    const safety = await safetyAdapter?.inspectImage?.({ buffer: derivative });
    if (!safety?.ok) return { ok: false, reason: safety?.reason || 'adapter-unavailable' };
    const derivativeMetadata = await sharp(derivative).metadata();
    return { ok: true, value: { buffer: derivative, contentType: 'image/webp', height: derivativeMetadata.height, safetyProvider: safety.provider || 'configured-adapter', width: derivativeMetadata.width } };
  } catch {
    return { ok: false, reason: 'image-decode' };
  }
}

async function commitFinalizedUpload({ clock, command, commandRef, conversationId, db, fingerprint, media, refs, uid }) {
  const targetUid = command.payload.targetUid;
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);
  return db.runTransaction(async (transaction) => {
    const replyRef = command.payload.replyToMessageId ? refs.conversation.collection('messages').doc(command.payload.replyToMessageId) : null;
    const snapshots = await Promise.all([
      transaction.get(commandRef), transaction.get(refs.flags), transaction.get(refs.actorProfile), transaction.get(refs.targetProfile),
      transaction.get(refs.actorRestriction), transaction.get(refs.targetRestriction), transaction.get(refs.blockedByActor),
      transaction.get(refs.blockedByTarget), transaction.get(refs.friendship), transaction.get(refs.conversation),
      transaction.get(refs.upload), transaction.get(refs.authorization), transaction.get(refs.actorProjection),
      transaction.get(refs.targetProjection), transaction.get(refs.actorSummary), transaction.get(refs.targetSummary),
      transaction.get(refs.rate), replyRef ? transaction.get(replyRef) : Promise.resolve(null),
    ]);
    const [commandSnapshot, flags, actorProfile, targetProfile, actorRestriction, targetRestriction, blockedByActor,
      blockedByTarget, friendship, conversationSnapshot, uploadSnapshot, authorizationSnapshot, actorProjectionSnapshot,
      targetProjectionSnapshot, actorSummarySnapshot, targetSummarySnapshot, rateSnapshot, replySnapshot] = snapshots;
    const replay = resolveReplay(commandSnapshot, fingerprint, uid);
    if (replay) return replay;
    const existingConversation = dataOf(conversationSnapshot);
    const conversation = existingConversation || {
      conversationId,
      createdAt: now,
      lastMessageId: '',
      lastMessageKind: '',
      lastMessagePreview: '',
      lastMessageSenderUid: '',
      lastSequence: 0,
      lifecycleState: 'active',
      memberUids: [uid, targetUid].sort(),
      recipientUid: '',
      requestState: 'accepted',
      requesterUid: '',
      updatedAt: now,
    };
    let response = authorizeMediaPair({
      actorProfile: dataOf(actorProfile), actorRestriction: dataOf(actorRestriction), blockedByActor: blockedByActor.exists,
      blockedByTarget: blockedByTarget.exists, conversation: existingConversation, featureFlags: dataOf(flags), friendship: dataOf(friendship),
      nowMs, targetProfile: dataOf(targetProfile), targetRestriction: dataOf(targetRestriction), uid, targetUid,
    });
    const upload = dataOf(uploadSnapshot);
    const authorization = dataOf(authorizationSnapshot);
    if (response.ok && (
      !upload || upload.state !== 'authorized' || upload.uid !== uid || upload.targetUid !== targetUid
      || upload.conversationId !== conversationId || !authorization || authorization.state !== 'active'
      || timestampMillis(authorization.expiresAt) <= nowMs
    )) response = directChatError('UPLOAD_INVALID');
    if (response.ok && command.payload.replyToMessageId && !validReply(dataOf(replySnapshot), dataOf(actorProjectionSnapshot))) response = directChatError('REPLY_TARGET_UNAVAILABLE');
    const rate = response.ok ? resolveDirectChatRateLimit({ isNewNonFriendRecipient: false, nowMs, rate: dataOf(rateSnapshot), targetUid }) : response;
    if (response.ok && !rate.ok) response = rate;
    if (!response.ok) return recordCommand({ clock, command, commandRef, conversationId, fingerprint, now, response, transaction, uid });

    const sequence = safeSequence(conversation.lastSequence) + 1;
    const messageId = createDirectMessageId({ conversationId, requestId: command.requestId, senderUid: uid });
    transaction.create(refs.conversation.collection('messages').doc(messageId), {
      attachmentId: command.payload.uploadId,
      conversationId,
      createdAt: now,
      id: messageId,
      kind: upload.kind,
      mediaContentType: media.contentType,
      mediaDurationMs: safeNumber(media.durationMs),
      mediaHeight: safeNumber(media.height),
      mediaPath: media.mediaPath,
      mediaWidth: safeNumber(media.width),
      replyToMessageId: command.payload.replyToMessageId || '',
      senderUid: uid,
      sequence,
      text: '',
      unreadForUids: [targetUid],
      visibilityState: 'visible',
    });
    const conversationDocument = {
      ...conversation,
      lastMessageId: messageId,
      lastMessageKind: upload.kind,
      lastMessagePreview: safeAttachmentPreview(upload.kind),
      lastMessageSenderUid: uid,
      lastSequence: sequence,
      updatedAt: now,
    };
    transaction.set(refs.conversation, conversationDocument, { merge: true });
    writePairProjections({
      actorProjection: dataOf(actorProjectionSnapshot), actorSummary: dataOf(actorSummarySnapshot), conversation: conversationDocument,
      now, refs, targetProjection: dataOf(targetProjectionSnapshot), targetSummary: dataOf(targetSummarySnapshot), targetUid, transaction, uid,
    });
    transaction.set(refs.upload, {
      approvedAt: now,
      contentType: media.contentType,
      durationMs: safeNumber(media.durationMs),
      height: safeNumber(media.height),
      mediaPath: media.mediaPath,
      messageId,
      purgeAfter: null,
      safetyProvider: media.safetyProvider || '',
      state: 'finalized',
      updatedAt: now,
      width: safeNumber(media.width),
    }, { merge: true });
    transaction.delete(refs.authorization);
    transaction.set(refs.rate, {
      newRecipientUids: rate.value.newRecipientUids,
      requestDayKey: rate.value.requestDayKey,
      sendCount: rate.value.sendCount,
      sendWindowStartedAt: clock.timestampFromMillis(rate.value.sendWindowStartedAtMs),
      uid,
      updatedAt: now,
    }, { merge: true });
    return recordCommand({
      clock, command, commandRef, conversationId, fingerprint, now,
      response: success(command, conversationId, { attachmentId: command.payload.uploadId, kind: upload.kind, messageId, sequence }),
      transaction, uid,
    });
  });
}

async function rejectUploadAndRecord({ bucket, clock, command, commandRef, conversationId, db, fingerprint, refs, response, uid }) {
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);
  const result = await db.runTransaction(async (transaction) => {
    const [commandSnapshot, uploadSnapshot] = await Promise.all([transaction.get(commandRef), transaction.get(refs.upload)]);
    const replay = resolveReplay(commandSnapshot, fingerprint, uid);
    if (replay) return replay;
    const upload = dataOf(uploadSnapshot);
    if (upload?.uid === uid) transaction.set(refs.upload, { purgeAfter: now, rejectedAt: now, state: 'rejected', updatedAt: now }, { merge: true });
    transaction.delete(refs.authorization);
    return recordCommand({ clock, command, commandRef, conversationId, fingerprint, now, response, transaction, uid });
  });
  const sourcePath = dataOf(await refs.upload.get())?.storagePath;
  if (sourcePath) await bucket.file(sourcePath).delete({ ignoreNotFound: true }).catch(() => undefined);
  return result;
}

async function cleanupDirectChatUploads({ bucket, clock, db, limit = 100 }) {
  const now = clock.timestampFromMillis(clock.nowMillis());
  const snapshot = await db.collection('directChatUploads').where('purgeAfter', '<=', now).orderBy('purgeAfter', 'asc').limit(limit).get();
  let deleted = 0;
  for (const document of snapshot.docs) {
    const upload = document.data();
    if (!['authorized', 'rejected'].includes(upload.state)) continue;
    await bucket.file(upload.storagePath).delete({ ignoreNotFound: true }).catch(() => undefined);
    const batch = db.batch();
    batch.delete(document.ref);
    batch.delete(db.doc(`directChatUploadAuthorizations/${upload.uid}/uploads/${document.id}`));
    await batch.commit();
    deleted += 1;
  }
  return { deleted, scanned: snapshot.size };
}

function authorizeMediaPair({ actorProfile, actorRestriction, blockedByActor, blockedByTarget, conversation, featureFlags, friendship, nowMs, targetProfile, targetRestriction, uid, targetUid }) {
  const access = resolveDirectChatPairAccess({ actorProfile, actorRestriction, blockedByActor, blockedByTarget, featureFlags, nowMs, targetProfile, targetRestriction });
  if (!access.ok) return access;
  if (featureFlags?.directMessageMedia !== true) return directChatError('MEDIA_DISABLED');
  const members = [uid, targetUid].sort();
  if (!isPairFriendship(friendship, members) && !isAcceptedConversation(conversation, friendship)) return directChatError('NOT_FRIEND');
  return { ok: true };
}

function pairRefs({ conversationId, db, targetUid, uid, uploadId }) {
  return {
    actorProfile: db.doc(`publicProfiles/${uid}`),
    actorProjection: db.doc(`directConversationMembers/${uid}/items/${conversationId}`),
    actorRestriction: db.doc(`directChatRestrictions/${uid}`),
    actorSummary: db.doc(`directChatInboxSummaries/${uid}`),
    authorization: db.doc(`directChatUploadAuthorizations/${uid}/uploads/${uploadId}`),
    blockedByActor: db.doc(`blocks/${uid}/blocked/${targetUid}`),
    blockedByTarget: db.doc(`blocks/${targetUid}/blocked/${uid}`),
    conversation: db.doc(`directConversations/${conversationId}`),
    flags: db.doc('appConfig/socialFeatures'),
    friendship: db.doc(`friendships/${createFriendshipId(uid, targetUid)}`),
    rate: db.doc(`directChatRateLimits/${uid}`),
    targetProfile: db.doc(`publicProfiles/${targetUid}`),
    targetProjection: db.doc(`directConversationMembers/${targetUid}/items/${conversationId}`),
    targetRestriction: db.doc(`directChatRestrictions/${targetUid}`),
    targetSummary: db.doc(`directChatInboxSummaries/${targetUid}`),
    upload: db.doc(`directChatUploads/${uploadId}`),
  };
}

function writePairProjections({ actorProjection, actorSummary, conversation, now, refs, targetProjection, targetSummary, targetUid, transaction, uid }) {
  const actorNext = buildDirectChatProjection({ conversation, existing: actorProjection, now, ownerUid: uid, peerUid: targetUid });
  const targetNext = buildDirectChatProjection({ conversation, existing: targetProjection, now, ownerUid: targetUid, peerUid: uid, unreadIncrement: 1 });
  transaction.set(refs.actorProjection, actorNext, { merge: true });
  transaction.set(refs.targetProjection, targetNext, { merge: true });
  transaction.set(refs.actorSummary, { totalUnreadCount: summaryTotal(actorSummary, actorProjection, actorNext), uid, updatedAt: now }, { merge: true });
  transaction.set(refs.targetSummary, { totalUnreadCount: summaryTotal(targetSummary, targetProjection, targetNext), uid: targetUid, updatedAt: now }, { merge: true });
}

function summaryTotal(summary, previous, next) {
  return Math.max(0, safeSequence(summary?.totalUnreadCount) + safeSequence(next?.unreadCount) - safeSequence(previous?.unreadCount));
}

function validReply(reply, projection) {
  return Boolean(reply && reply.visibilityState === 'visible' && Number.isSafeInteger(reply.sequence) && reply.sequence > safeSequence(projection?.clearedThroughSequence));
}

function resolveReplay(snapshot, fingerprint, uid) {
  if (!snapshot?.exists) return undefined;
  const previous = snapshot.data();
  return previous.actorUid === uid && previous.fingerprint === fingerprint ? { ...previous.response, replayed: true } : directChatError('REQUEST_CONFLICT');
}

function recordCommand({ clock, command, commandRef, conversationId, fingerprint, now, response, transaction, uid }) {
  transaction.create(commandRef, {
    action: command.action, actorUid: uid, commandKind: 'direct-chat', conversationId, createdAt: now, fingerprint,
    purgeAfter: clock.timestampFromMillis(clock.nowMillis() + DIRECT_CHAT_COMMAND_RETENTION_MS), requestId: command.requestId,
    response, status: response.ok ? 'applied' : 'denied',
  });
  return { ...response, replayed: false };
}

function success(command, conversationId, value) {
  return { ok: true, result: { action: command.action, conversationId, requestId: command.requestId, targetUid: command.payload.targetUid, ...value } };
}

function dataOf(snapshot) { return snapshot?.exists ? snapshot.data() : undefined; }
function timestampMillis(value) { return typeof value === 'number' ? value : value?.toMillis?.() ?? Number.NaN; }
function safeNumber(value) { return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0; }

module.exports = { cleanupDirectChatUploads, executeDirectChatMediaCommand, processMedia };
