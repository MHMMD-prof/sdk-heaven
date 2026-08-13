const { buildDirectChatReconciliation } = require('./directChatReconciliationCore');
const { timestampToMillis } = require('./directChatPaginationCore');

const defaultClock = {
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => {
    const { Timestamp } = require('firebase-admin/firestore');
    return Timestamp.fromMillis(value);
  },
};

async function reconcileDirectChatBatch({ apply = false, clock = defaultClock, cursor = '', db, limit = 25 }) {
  let query = db.collection('directConversations').orderBy('conversationId', 'asc');
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.limit(Math.min(Math.max(limit, 1), 100)).get();
  const reports = [];
  for (const document of snapshot.docs) {
    reports.push(await reconcileDirectChatConversation({ apply, clock, db, document }));
  }
  return {
    applied: reports.filter((report) => report.applied).length,
    drifted: reports.filter((report) => report.drifted).length,
    nextCursor: snapshot.size === Math.min(Math.max(limit, 1), 100) ? snapshot.docs.at(-1)?.id || '' : '',
    reports,
    scanned: snapshot.size,
  };
}

async function reconcileDirectChatConversation({ apply, clock, db, document }) {
  const conversation = document.data();
  const memberUids = Array.isArray(conversation.memberUids) ? conversation.memberUids : [];
  if (memberUids.length !== 2) return { applied: false, conversationId: document.id, drifted: true, reasons: ['conversation-invalid'] };
  const latestSnapshot = await document.ref.collection('messages').orderBy('sequence', 'desc').limit(1).get();
  const latestMessage = latestSnapshot.docs[0]?.data();
  const projectionRefs = memberUids.map((uid) => db.doc(`directConversationMembers/${uid}/items/${document.id}`));
  const projectionSnapshots = await db.getAll(...projectionRefs);
  const projections = Object.fromEntries(memberUids.map((uid, index) => [uid, projectionSnapshots[index]?.exists ? projectionSnapshots[index].data() : undefined]));
  const unreadCounts = {};
  const retentionFloor = Number.isSafeInteger(conversation.retentionPurgedThroughSequence)
    ? conversation.retentionPurgedThroughSequence
    : 0;
  for (const uid of memberUids) {
    const floor = Math.max(
      Number.isSafeInteger(projections[uid]?.lastReadSequence) ? projections[uid].lastReadSequence : 0,
      Number.isSafeInteger(projections[uid]?.clearedThroughSequence) ? projections[uid].clearedThroughSequence : 0,
      retentionFloor,
    );
    const countSnapshot = await document.ref.collection('messages')
      .where('unreadForUids', 'array-contains', uid)
      .where('visibilityState', '==', 'visible')
      .where('sequence', '>', floor)
      .count()
      .get();
    unreadCounts[uid] = countSnapshot.data().count;
  }
  const reconciliation = buildDirectChatReconciliation({
    conversation,
    latestMessage,
    now: clock.timestampFromMillis(clock.nowMillis()),
    projections,
    unreadCounts,
  });
  let applied = false;
  let concurrent = false;
  if (apply && reconciliation.repairable && reconciliation.report.drifted) {
    applied = await db.runTransaction(async (transaction) => {
      const currentConversation = await transaction.get(document.ref);
      const currentProjections = await Promise.all(projectionRefs.map((reference) => transaction.get(reference)));
      if (
        !sameDocumentVersion(currentConversation, document)
        || currentProjections.some((snapshot, index) => !sameDocumentVersion(snapshot, projectionSnapshots[index]))
      ) return false;
      transaction.set(document.ref, reconciliation.expectedConversation, { merge: true });
      memberUids.forEach((uid, index) => transaction.set(
        projectionRefs[index],
        reconciliation.expectedProjections[uid],
        { merge: true },
      ));
      return true;
    });
    concurrent = !applied;
  }
  return {
    applied,
    concurrent,
    conversationId: document.id,
    drifted: reconciliation.report.drifted,
    reasons: reconciliation.report.reasons,
  };
}

function sameDocumentVersion(current, original) {
  if (current.exists !== original.exists) return false;
  if (!current.exists) return true;
  const currentVersion = documentVersion(current);
  const originalVersion = documentVersion(original);
  return Number.isFinite(currentVersion)
    && Number.isFinite(originalVersion)
    && currentVersion === originalVersion;
}

function documentVersion(snapshot) {
  const serverVersion = timestampToMillis(snapshot.updateTime);
  return Number.isFinite(serverVersion) ? serverVersion : timestampToMillis(snapshot.data().updatedAt);
}

module.exports = {
  reconcileDirectChatBatch,
  reconcileDirectChatConversation,
  sameDocumentVersion,
};
