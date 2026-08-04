const {
  directChatError,
} = require('./directChatCore');
const {
  decodeInboxCursor,
  decodeThreadCursor,
  encodeInboxCursor,
  encodeThreadCursor,
  timestampToMillis,
} = require('./directChatPaginationCore');
const {
  mapDirectChatMessage,
  mapDirectChatProjection,
  safeSequence,
} = require('./directChatProjectionCore');
const {
  DIRECT_CHAT_COMMAND_RETENTION_MS,
  resolveDirectChatActorAccess,
} = require('./directChatPolicyCore');

async function executeDirectChatReadCommand({ clock, command, db, fingerprint, uid }) {
  if (command.action === 'get-direct-chat-inbox') {
    return getDirectChatInbox({ clock, command, db, fingerprint, uid });
  }
  if (command.action === 'get-direct-chat-thread') {
    return getDirectChatThread({ clock, command, db, fingerprint, uid });
  }
  return directChatError('INVALID_REQUEST');
}

async function getDirectChatInbox({ clock, command, db, fingerprint, uid }) {
  const commandRef = db.doc(`directChatCommands/${uid}/requests/${command.requestId}`);
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);
  return db.runTransaction(async (transaction) => {
    const commandSnapshot = await transaction.get(commandRef);
    const replay = resolveReplay(commandSnapshot, fingerprint, uid);
    if (replay) return replay;
    const [flagsSnapshot, profileSnapshot, restrictionSnapshot, summarySnapshot] = await Promise.all([
      transaction.get(db.doc('appConfig/socialFeatures')),
      transaction.get(db.doc(`publicProfiles/${uid}`)),
      transaction.get(db.doc(`directChatRestrictions/${uid}`)),
      transaction.get(db.doc(`directChatInboxSummaries/${uid}`)),
    ]);
    const access = resolveDirectChatActorAccess({
      actorProfile: dataOf(profileSnapshot),
      actorRestriction: dataOf(restrictionSnapshot),
      featureFlags: dataOf(flagsSnapshot),
      nowMs,
    });
    if (!access.ok) return recordReadCommand({ clock, command, commandRef, fingerprint, now, response: access, transaction, uid });
    const cursor = command.payload.cursor
      ? decodeInboxCursor(command.payload.cursor, uid)
      : undefined;
    if (command.payload.cursor && !cursor) {
      return recordReadCommand({ clock, command, commandRef, fingerprint, now, response: directChatError('CURSOR_INVALID'), transaction, uid });
    }
    let query = db.collection(`directConversationMembers/${uid}/items`)
      .where('archived', '==', false)
      .orderBy('updatedAt', 'desc')
      .orderBy('conversationId', 'desc');
    if (cursor) query = query.startAfter(clock.timestampFromMillis(cursor.updatedAtMs), cursor.conversationId);
    const requestedLimit = command.payload.limit;
    const snapshot = await transaction.get(query.limit(requestedLimit + 1));
    const mapped = snapshot.docs
      .map((document) => mapDirectChatProjection(document.data(), uid))
      .filter(Boolean);
    const hasMore = mapped.length > requestedLimit;
    const items = mapped.slice(0, requestedLimit);
    const last = items.at(-1);
    const nextCursor = hasMore && last
      ? encodeInboxCursor({ conversationId: last.conversationId, ownerUid: uid, updatedAtMs: timestampToMillis(last.updatedAt) })
      : '';
    const response = {
      ok: true,
      result: {
        action: command.action,
        hasMore,
        items,
        nextCursor,
        requestId: command.requestId,
        totalUnreadCount: safeSequence(dataOf(summarySnapshot)?.totalUnreadCount),
      },
    };
    return recordReadCommand({ clock, command, commandRef, fingerprint, now, response, transaction, uid });
  });
}

async function getDirectChatThread({ clock, command, db, fingerprint, uid }) {
  const targetUid = command.payload.targetUid;
  const { createDirectConversationId } = require('./directChatCore');
  const conversationId = createDirectConversationId(uid, targetUid);
  const commandRef = db.doc(`directChatCommands/${uid}/requests/${command.requestId}`);
  const conversationRef = db.doc(`directConversations/${conversationId}`);
  const projectionRef = db.doc(`directConversationMembers/${uid}/items/${conversationId}`);
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);
  return db.runTransaction(async (transaction) => {
    const commandSnapshot = await transaction.get(commandRef);
    const replay = resolveReplay(commandSnapshot, fingerprint, uid);
    if (replay) return replay;
    const [flagsSnapshot, profileSnapshot, restrictionSnapshot, conversationSnapshot, projectionSnapshot] = await Promise.all([
      transaction.get(db.doc('appConfig/socialFeatures')),
      transaction.get(db.doc(`publicProfiles/${uid}`)),
      transaction.get(db.doc(`directChatRestrictions/${uid}`)),
      transaction.get(conversationRef),
      transaction.get(projectionRef),
    ]);
    const access = resolveDirectChatActorAccess({
      actorProfile: dataOf(profileSnapshot),
      actorRestriction: dataOf(restrictionSnapshot),
      featureFlags: dataOf(flagsSnapshot),
      nowMs,
    });
    let response = access;
    const conversation = dataOf(conversationSnapshot);
    if (access.ok && (!conversation || !Array.isArray(conversation.memberUids) || !conversation.memberUids.includes(uid))) {
      response = directChatError('NOT_FOUND');
    }
    const cursor = command.payload.cursor
      ? decodeThreadCursor(command.payload.cursor, conversationId)
      : undefined;
    if (response.ok && command.payload.cursor && !cursor) response = directChatError('CURSOR_INVALID');
    if (!response.ok) return recordReadCommand({ clock, command, commandRef, conversationId, fingerprint, now, response, transaction, uid });

    const projection = dataOf(projectionSnapshot);
    const clearedThroughSequence = safeSequence(projection?.clearedThroughSequence);
    let query = conversationRef.collection('messages')
      .where('sequence', '>', clearedThroughSequence)
      .orderBy('sequence', 'desc');
    if (cursor) query = query.where('sequence', '<', cursor.sequence);
    const requestedLimit = command.payload.limit;
    const snapshot = await transaction.get(query.limit(requestedLimit + 1));
    const mappedDescending = snapshot.docs
      .map((document) => mapDirectChatMessage(document.data(), clearedThroughSequence))
      .filter(Boolean);
    const hasMore = mappedDescending.length > requestedLimit;
    const pageDescending = mappedDescending.slice(0, requestedLimit);
    const oldest = pageDescending.at(-1);
    const nextCursor = hasMore && oldest
      ? encodeThreadCursor({ conversationId, messageId: oldest.id, sequence: oldest.sequence })
      : '';
    response = {
      ok: true,
      result: {
        action: command.action,
        conversationId,
        hasMore,
        messages: [...pageDescending].reverse(),
        nextCursor,
        requestId: command.requestId,
        targetUid,
      },
    };
    return recordReadCommand({ clock, command, commandRef, conversationId, fingerprint, now, response, transaction, uid });
  });
}

function resolveReplay(snapshot, fingerprint, uid) {
  if (!snapshot.exists) return undefined;
  const previous = snapshot.data();
  if (previous.actorUid !== uid || previous.fingerprint !== fingerprint) return directChatError('REQUEST_CONFLICT');
  return { ...previous.response, replayed: true };
}

function recordReadCommand({ clock, command, commandRef, conversationId = '', fingerprint, now, response, transaction, uid }) {
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

function dataOf(snapshot) {
  return snapshot?.exists ? snapshot.data() : undefined;
}

module.exports = {
  executeDirectChatReadCommand,
  getDirectChatInbox,
  getDirectChatThread,
};
