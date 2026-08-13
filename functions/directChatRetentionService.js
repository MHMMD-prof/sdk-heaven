const { buildDirectChatProjection } = require('./directChatProjectionCore');
const { DIRECT_CHAT_MAX_EVIDENCE_SNAPSHOTS } = require('./directChatReportCore');
const {
  DIRECT_CHAT_RETENTION_POLICY_PATH,
  DIRECT_CHAT_RETENTION_SWEEP_PATH,
  buildDirectChatEvidenceExpiryPatch,
  buildDirectChatSweepState,
  directChatEvidenceObjectPath,
  mapDirectChatRetentionPolicy,
  resolveDirectChatEvidenceExpiry,
  resolveDirectChatMediaPurge,
  resolveDirectChatMessagePurge,
  resolveDirectChatRetentionCutoffs,
} = require('./directChatRetentionCore');

const defaultClock = {
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => {
    const { Timestamp } = require('firebase-admin/firestore');
    return Timestamp.fromMillis(value);
  },
};

const defaultFieldValue = {
  delete: () => {
    const { FieldValue } = require('firebase-admin/firestore');
    return FieldValue.delete();
  },
};

async function readDirectChatRetentionPolicy({ db }) {
  const snapshot = await db.doc(DIRECT_CHAT_RETENTION_POLICY_PATH).get();
  return mapDirectChatRetentionPolicy(snapshot.exists ? snapshot.data() : undefined);
}

// Pass A. Reported bytes still live under direct-chat-media, where they are reachable by the
// participants and tied to the message lifecycle. Copying them under the report's own prefix is
// what lets the message purge delete the original without destroying the evidence.
async function copyDirectChatEvidenceMedia({ bucket, clock = defaultClock, db, limit = 25 }) {
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);
  const snapshot = await db.collectionGroup('evidence')
    .where('evidenceMediaState', '==', 'pending')
    .orderBy('capturedAt', 'asc')
    .limit(limit)
    .get();
  let copied = 0;
  let missing = 0;
  for (const document of snapshot.docs) {
    const evidence = document.data();
    const sourcePath = readString(evidence.mediaPath, 512);
    const destinationPath = directChatEvidenceObjectPath(readString(evidence.reportId, 200), document.id, sourcePath);
    const transferred = destinationPath
      ? await copyStorageObject({ bucket, destinationPath, sourcePath })
      : false;
    if (transferred) {
      await document.ref.set({
        evidenceCopiedAt: now,
        evidenceMediaState: 'copied',
        evidencePath: destinationPath,
      }, { merge: true });
      copied += 1;
    } else {
      await document.ref.set({
        evidenceMediaState: 'missing',
        evidencePath: '',
        evidenceResolvedAt: now,
      }, { merge: true });
      missing += 1;
    }
    await releaseResolvedAttachment({ attachmentId: readString(evidence.attachmentId, 160), db, now });
  }
  return { copied, missing, scanned: snapshot.size };
}

// The hold on the upload is what keeps the live object alive while a copy is still owed. It is
// released once nothing is pending, including snapshots resolved as missing, because a source
// that no longer exists cannot be preserved by holding an object that is already gone.
async function releaseResolvedAttachment({ attachmentId, db, now }) {
  if (!attachmentId) return;
  const pending = await db.collectionGroup('evidence')
    .where('attachmentId', '==', attachmentId)
    .where('evidenceMediaState', '==', 'pending')
    .limit(1)
    .get();
  if (!pending.empty) return;
  await db.doc(`directChatUploads/${attachmentId}`).set({ evidenceCopiedAt: now, updatedAt: now }, { merge: true });
}

async function copyStorageObject({ bucket, destinationPath, sourcePath }) {
  if (!bucket || typeof bucket.file !== 'function' || !sourcePath || !destinationPath) return false;
  try {
    const destination = bucket.file(destinationPath);
    const [exists] = await destination.exists();
    if (exists) return true;
    await bucket.file(sourcePath).copy(destination);
    return true;
  } catch {
    return false;
  }
}

// Pass B. Conversations are swept round-robin through a persisted cursor rather than selected by
// an indexed expiry field, so conversations written before this wave need no backfill to become
// eligible.
async function cleanupDirectChatMessages({
  bucket,
  clock = defaultClock,
  conversationLimit = 25,
  db,
  messageLimit = 100,
  policy,
}) {
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);
  const cutoffs = resolveDirectChatRetentionCutoffs({
    nowMs,
    policy: policy || await readDirectChatRetentionPolicy({ db }),
  });
  const bounded = Math.min(Math.max(conversationLimit, 1), 100);
  const sweepRef = db.doc(DIRECT_CHAT_RETENTION_SWEEP_PATH);
  const sweepSnapshot = await sweepRef.get();
  const cursor = readString(sweepSnapshot.exists ? sweepSnapshot.data().cursor : '', 200);

  let query = db.collection('directConversations').orderBy('conversationId', 'asc');
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.limit(bounded).get();

  let deleted = 0;
  let mediaDeleted = 0;
  for (const document of snapshot.docs) {
    const outcome = await purgeConversationMessages({
      bucket,
      conversationRef: document.ref,
      cutoffMs: cutoffs.messageCutoffMs,
      db,
      messageLimit,
      now,
    });
    deleted += outcome.deleted;
    mediaDeleted += outcome.mediaDeleted;
  }

  const wrapped = snapshot.size < bounded;
  await sweepRef.set(buildDirectChatSweepState({
    cursor: wrapped ? '' : snapshot.docs.at(-1)?.id || '',
    nowMs,
    scanned: snapshot.size,
    wrapped,
  }), { merge: true });
  return { deleted, mediaDeleted, policyVersion: cutoffs.policy.policyVersion, scanned: snapshot.size, wrapped };
}

async function purgeConversationMessages({ bucket, conversationRef, cutoffMs, db, messageLimit, now }) {
  const bounded = Math.min(Math.max(messageLimit, 1), 200);
  const plan = await db.runTransaction(async (transaction) => {
    const conversationSnapshot = await transaction.get(conversationRef);
    if (!conversationSnapshot.exists) return { deleted: 0, purgeable: [] };
    const conversation = conversationSnapshot.data();
    const memberUids = Array.isArray(conversation.memberUids) ? conversation.memberUids : [];
    if (memberUids.length !== 2) return { deleted: 0, purgeable: [] };

    const messagesSnapshot = await transaction.get(conversationRef
      .collection('messages')
      .orderBy('sequence', 'asc')
      .limit(bounded));
    const messages = messagesSnapshot.docs.map((document) => ({ ...document.data(), id: document.id, ref: document.ref }));
    const projectionRefs = memberUids.map((uid) => db.doc(`directConversationMembers/${uid}/items/${conversationRef.id}`));
    const summaryRefs = memberUids.map((uid) => db.doc(`directChatInboxSummaries/${uid}`));
    const [projectionSnapshots, summarySnapshots] = await Promise.all([
      Promise.all(projectionRefs.map((reference) => transaction.get(reference))),
      Promise.all(summaryRefs.map((reference) => transaction.get(reference))),
    ]);
    const projections = projectionSnapshots.map((entry) => (entry.exists ? entry.data() : undefined));
    const memberFloors = Object.fromEntries(memberUids.map((uid, index) => [
      uid,
      Math.max(safeSequence(projections[index]?.lastReadSequence), safeSequence(projections[index]?.clearedThroughSequence)),
    ]));

    // Uploads are read before the purge is computed because an unresolved evidence hold decides
    // whether a row is eligible at all, not just whether its object can be deleted.
    const attachmentIds = [...new Set(messages
      .map((message) => (typeof message.attachmentId === 'string' ? message.attachmentId : ''))
      .filter(Boolean))];
    const uploadSnapshots = await Promise.all(attachmentIds
      .map((id) => transaction.get(db.doc(`directChatUploads/${id}`))));
    const uploads = new Map(uploadSnapshots
      .filter((entry) => entry.exists)
      .map((entry) => [entry.id, entry.data()]));

    const purge = resolveDirectChatMessagePurge({ conversation, cutoffMs, memberFloors, messages, uploads });
    if (purge.purged.length === 0) return { deleted: 0, purgeable: [] };
    const media = resolveDirectChatMediaPurge({ purged: purge.purged, uploads });

    for (const message of purge.purged) transaction.delete(message.ref);

    // lastSequence is deliberately left untouched. It is the allocator for new messages and the
    // ceiling every projection clamps against, so it must never move backwards as history ages out.
    const projectedConversation = {
      ...conversation,
      retentionPurgedThroughSequence: purge.purgedThroughSequence,
      updatedAt: now,
      ...(purge.lastMessagePurged
        ? { lastMessageId: '', lastMessageKind: '', lastMessagePreview: '', lastMessageSenderUid: '' }
        : {}),
    };
    transaction.set(conversationRef, projectedConversation, { merge: true });

    memberUids.forEach((memberUid, index) => {
      const existing = projections[index];
      const projection = buildDirectChatProjection({
        conversation: projectedConversation,
        existing,
        now,
        ownerUid: memberUid,
        peerUid: memberUids.find((uid) => uid !== memberUid) || '',
        unreadIncrement: -(purge.unreadDecrements[memberUid] || 0),
      });
      transaction.set(projectionRefs[index], projection, { merge: true });
      const summary = summarySnapshots[index].exists ? summarySnapshots[index].data() : undefined;
      transaction.set(summaryRefs[index], {
        totalUnreadCount: Math.max(
          0,
          safeSequence(summary?.totalUnreadCount) + safeSequence(projection.unreadCount) - safeSequence(existing?.unreadCount),
        ),
        uid: memberUid,
        updatedAt: now,
      }, { merge: true });
    });

    for (const entry of media.purgeable) {
      transaction.delete(db.doc(`directChatUploads/${entry.attachmentId}`));
      if (entry.uid) transaction.delete(db.doc(`directChatUploadAuthorizations/${entry.uid}/uploads/${entry.attachmentId}`));
    }
    return { deleted: purge.purged.length, purgeable: media.purgeable };
  });

  let mediaDeleted = 0;
  for (const entry of plan.purgeable) {
    if (!entry.mediaPath || !bucket || typeof bucket.file !== 'function') continue;
    await bucket.file(entry.mediaPath).delete({ ignoreNotFound: true }).catch(() => undefined);
    mediaDeleted += 1;
  }
  return { deleted: plan.deleted, mediaDeleted };
}

// Pass C. This is the wave exit gate: an evidence case under an active legal hold is excluded by
// the query, re-checked in the loop, and re-checked again inside the transaction so a hold applied
// mid-sweep still wins.
async function cleanupDirectChatEvidence({
  bucket,
  clock = defaultClock,
  db,
  fieldValue = defaultFieldValue,
  limit = 50,
}) {
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);
  const snapshot = await db.collection('directChatReports')
    .where('legalHold', '==', false)
    .where('retentionUntilMs', '<=', nowMs)
    .orderBy('retentionUntilMs', 'asc')
    .limit(limit)
    .get();
  let expired = 0;
  let objectsDeleted = 0;
  for (const document of snapshot.docs) {
    if (!resolveDirectChatEvidenceExpiry({ evidenceCase: document.data(), nowMs })) continue;
    const evidenceSnapshot = await document.ref
      .collection('evidence')
      .orderBy('sequence', 'asc')
      .limit(DIRECT_CHAT_MAX_EVIDENCE_SNAPSHOTS)
      .get();
    const objectPaths = evidenceSnapshot.docs
      .map((entry) => readString(entry.data().evidencePath, 512))
      .filter(Boolean);
    const applied = await db.runTransaction(async (transaction) => {
      const current = await transaction.get(document.ref);
      if (!current.exists || !resolveDirectChatEvidenceExpiry({ evidenceCase: current.data(), nowMs })) return false;
      for (const entry of evidenceSnapshot.docs) transaction.delete(entry.ref);
      transaction.set(document.ref, buildDirectChatEvidenceExpiryPatch({ fieldValue, now, nowMs }), { merge: true });
      return true;
    });
    if (!applied) continue;
    expired += 1;
    for (const path of objectPaths) {
      if (!bucket || typeof bucket.file !== 'function') continue;
      await bucket.file(path).delete({ ignoreNotFound: true }).catch(() => undefined);
      objectsDeleted += 1;
    }
  }
  return { expired, objectsDeleted, scanned: snapshot.size };
}

function safeSequence(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function readString(value, maxLength) {
  return typeof value === 'string' && value.length <= maxLength ? value : '';
}

module.exports = {
  cleanupDirectChatEvidence,
  cleanupDirectChatMessages,
  copyDirectChatEvidenceMedia,
  readDirectChatRetentionPolicy,
};
