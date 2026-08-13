const { assertFreshAdminAuth, mapAdminReportDocument } = require('./adminDashboardCore');
const { resolveAdminRole } = require('./adminClaimsCore');
const { buildDirectChatProjection } = require('./directChatProjectionCore');
const { safeDirectChatPreview } = require('./directChatPolicyCore');
const {
  DIRECT_CHAT_MAX_EVIDENCE_SNAPSHOTS,
  DIRECT_CHAT_REPORT_SOURCE,
} = require('./directChatReportCore');
const {
  DIRECT_CHAT_EVIDENCE_URL_TTL_MS,
  buildDirectChatRemovalPatch,
  buildDirectChatRestrictionClearDocument,
  buildDirectChatRestrictionDocument,
  resolveDirectChatLegalHold,
  resolveDirectChatRemovalTargets,
} = require('./directChatModerationCore');
const { mapDirectChatEvidenceMediaState } = require('./directChatRetentionCore');

const defaultClock = {
  nowMillis: () => Date.now(),
  timestampFromMillis: (value) => {
    const { Timestamp } = require('firebase-admin/firestore');
    return Timestamp.fromMillis(value);
  },
};

async function resolveDirectChatEvidence({
  assertReportScope,
  bucket,
  clock = defaultClock,
  db,
  decodedToken,
  request,
  scope = { ok: true, regionCodes: null },
}) {
  const nowMs = clock.nowMillis();
  const gate = await openDirectChatCase({ assertReportScope, db, decodedToken, reportId: request.reportId, scope });
  const evidenceSnapshot = await db
    .collection(`directChatReports/${request.reportId}/evidence`)
    .orderBy('sequence', 'asc')
    .limit(DIRECT_CHAT_MAX_EVIDENCE_SNAPSHOTS)
    .get();
  const snapshots = evidenceSnapshot.docs.map((document) => ({ ...document.data(), messageId: document.id }));
  const media = await resolveEvidenceMedia({ bucket, db, nowMs, snapshots });

  const auditRef = db.doc(`adminAuditEvents/direct_chat_evidence_view_${request.requestId}`);
  const mediaGranted = [...media.values()].filter((entry) => Boolean(entry.mediaUrl)).length;
  // The audit write is the product requirement, not a side effect: an unlogged view of private
  // message content is the failure mode this endpoint exists to prevent. A reused requestId is
  // therefore a hard 409 rather than a replay that would return content without a new log entry.
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(auditRef);
    if (existing.exists) {
      throw httpError(409, 'This request identifier was already used.', 'REQUEST_CONFLICT');
    }
    transaction.create(auditRef, {
      action: 'direct-chat-evidence-view',
      actorEmail: decodedToken.email || '',
      actorRegionCodes: scope.regionCodes || [],
      actorRole: resolveAdminRole(decodedToken),
      actorUid: decodedToken.uid,
      countryCode: gate.scopedReport.countryCode || '',
      createdAt: clock.timestampFromMillis(nowMs),
      kind: 'direct-chat-evidence-view',
      mediaGranted,
      reason: request.reason,
      reportId: request.reportId,
      requestId: request.requestId,
      snapshotCount: snapshots.length,
      targetUid: gate.report.targetUid || '',
    });
  });

  return {
    case: mapEvidenceCase(request.reportId, gate.evidenceCase),
    eventId: auditRef.id,
    mediaGranted,
    mediaUrlExpiresAt: new Date(nowMs + DIRECT_CHAT_EVIDENCE_URL_TTL_MS).toISOString(),
    snapshots: snapshots.map((snapshot) => mapEvidenceSnapshot(snapshot, media.get(snapshot.messageId))),
  };
}

async function executeDirectChatModerationAction({
  action,
  assertReportScope,
  clock = defaultClock,
  db,
  decodedToken,
  scope = { ok: true, regionCodes: null },
}) {
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);
  const gate = await openDirectChatCase({ assertReportScope, db, decodedToken, reportId: action.reportId, scope });
  const auditRef = db.doc(`adminAuditEvents/direct_chat_action_${action.requestId}`);
  const reportRef = db.doc(`reports/${action.reportId}`);
  const caseRef = db.doc(`directChatReports/${action.reportId}`);
  const targetUid = gate.report.targetUid;

  return db.runTransaction(async (transaction) => {
    const [auditSnapshot, reportSnapshot, caseSnapshot] = await Promise.all([
      transaction.get(auditRef),
      transaction.get(reportRef),
      transaction.get(caseRef),
    ]);
    if (auditSnapshot.exists) {
      const prior = auditSnapshot.data();
      if (prior.actorUid !== decodedToken.uid || prior.reportId !== action.reportId) {
        throw httpError(409, 'This request identifier was already used.', 'REQUEST_CONFLICT');
      }
      return auditRef.id;
    }
    if (!reportSnapshot.exists || !caseSnapshot.exists) {
      throw httpError(404, 'Direct chat evidence case was not found.');
    }
    const evidenceCase = caseSnapshot.data();
    const auditDetail = { targetUid };

    if (action.action === 'dismiss') {
      transaction.set(caseRef, {
        dismissedAt: now,
        dismissedBy: decodedToken.uid,
        status: 'dismissed',
        updatedAt: now,
      }, { merge: true });
      transaction.update(reportRef, {
        resolutionNote: action.note,
        resolvedAt: now,
        resolvedBy: decodedToken.uid,
        status: 'resolved',
        updatedAt: now,
        updatedBy: decodedToken.uid,
      });
      auditDetail.status = 'dismissed';
    }

    if (action.action === 'remove-direct-message') {
      const removal = resolveDirectChatRemovalTargets({ evidenceCase, messageIds: action.messageIds });
      if (!removal.ok) throw httpError(removal.status, removal.error);
      const removed = await applyDirectChatRemoval({
        conversationId: evidenceCase.conversationId,
        db,
        decodedToken,
        messageIds: removal.value.messageIds,
        now,
        transaction,
      });
      transaction.set(caseRef, {
        removedMessageIds: removed.messageIds,
        updatedAt: now,
      }, { merge: true });
      auditDetail.messageIds = removed.messageIds;
      auditDetail.removedCount = removed.messageIds.length;
    }

    if (action.action === 'restrict-direct-chat' || action.action === 'clear-direct-chat-restriction') {
      if (!targetUid) throw httpError(400, 'This report has no reported user to restrict.');
      const restrict = action.action === 'restrict-direct-chat';
      const document = restrict
        ? buildDirectChatRestrictionDocument({
          actorUid: decodedToken.uid,
          durationHours: action.durationHours,
          nowMs,
          reason: action.note,
          targetUid,
        })
        : buildDirectChatRestrictionClearDocument({
          actorUid: decodedToken.uid,
          nowMs,
          reason: action.note,
          targetUid,
        });
      // startsAt and endsAt must land as Timestamps: firestore.rules compares endsAt against
      // request.time when gating presence, and a raw millis number makes that comparison error.
      transaction.set(db.doc(`directChatRestrictions/${targetUid}`), {
        ...document,
        ...(document.endsAt === undefined ? {} : { endsAt: clock.timestampFromMillis(document.endsAt) }),
        reportId: action.reportId,
        startsAt: clock.timestampFromMillis(document.startsAt),
        updatedAt: now,
      }, { merge: false });
      auditDetail.restrictionState = document.state;
      if (document.endsAt !== undefined) auditDetail.restrictionEndsAtMs = document.endsAt;
    }

    if (action.action === 'set-direct-chat-legal-hold') {
      const hold = resolveDirectChatLegalHold({ evidenceCase, legalHold: action.legalHold, nowMs });
      transaction.set(caseRef, {
        legalHold: hold.legalHold,
        retentionUntil: clock.timestampFromMillis(hold.retentionUntilMs),
        retentionUntilMs: hold.retentionUntilMs,
        updatedAt: now,
      }, { merge: true });
      auditDetail.legalHold = hold.legalHold;
      auditDetail.retentionUntilMs = hold.retentionUntilMs;
    }

    transaction.create(auditRef, {
      ...auditDetail,
      action: `direct-chat-${action.action}`,
      actorEmail: decodedToken.email || '',
      actorRegionCodes: scope.regionCodes || [],
      actorRole: resolveAdminRole(decodedToken),
      actorUid: decodedToken.uid,
      conversationId: evidenceCase.conversationId || '',
      countryCode: gate.scopedReport.countryCode || '',
      createdAt: now,
      kind: 'direct-chat-moderation',
      note: action.note,
      reportId: action.reportId,
      requestId: action.requestId,
    });
    return auditRef.id;
  });
}

// Shared gate for both endpoints. The source check keeps these DM-only paths from being
// pointed at a voice-room or user report, which would leak a different report class into
// the direct-chat evidence tooling.
async function openDirectChatCase({ assertReportScope, db, decodedToken, reportId, scope }) {
  const reportSnapshot = await db.doc(`reports/${reportId}`).get();
  if (!reportSnapshot.exists) {
    throw httpError(404, 'Direct chat moderation requires an existing report.');
  }
  const report = mapAdminReportDocument(reportSnapshot.id, reportSnapshot.data());
  if (!report || report.source !== DIRECT_CHAT_REPORT_SOURCE) {
    throw httpError(400, 'This report is not a direct-message safety report.');
  }
  const scopedReport = await assertReportScope(db, scope, report);
  const freshness = assertFreshAdminAuth(decodedToken);
  if (!freshness.ok) throw httpError(freshness.status, freshness.error, freshness.code);
  const caseSnapshot = await db.doc(`directChatReports/${reportId}`).get();
  if (!caseSnapshot.exists) {
    throw httpError(404, 'Direct chat evidence case was not found.');
  }
  return { evidenceCase: caseSnapshot.data(), report, scopedReport };
}

async function resolveEvidenceMedia({ bucket, db, nowMs, snapshots }) {
  const media = new Map();
  const attachmentIds = [...new Set(snapshots.map((snapshot) => snapshot.attachmentId).filter(Boolean))]
    .slice(0, DIRECT_CHAT_MAX_EVIDENCE_SNAPSHOTS);
  if (attachmentIds.length === 0) return media;
  const uploadSnapshots = await db.getAll(...attachmentIds.map((id) => db.doc(`directChatUploads/${id}`)));
  const uploads = new Map(uploadSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => [snapshot.id, snapshot.data()]));

  for (const snapshot of snapshots) {
    const upload = uploads.get(snapshot.attachmentId);
    if (!snapshot.attachmentId) continue;
    // An isolated copy under the report's own prefix is authoritative once it exists: it outlives
    // both the hold and the message, so it is preferred over the live object.
    const isolatedPath = snapshot.evidenceMediaState === 'copied' ? readString(snapshot.evidencePath, 512) : '';
    // evidenceHold is what Wave 6A set to protect these exact bytes from the media purge.
    // Without it the object may already be gone, so no URL is minted rather than a broken one.
    const held = upload?.evidenceHold === true && upload?.state === 'finalized';
    const mediaPath = isolatedPath || (held ? readString(upload.mediaPath, 512) || readString(snapshot.mediaPath, 512) : '');
    media.set(snapshot.messageId, {
      held: Boolean(isolatedPath) || held,
      isolated: Boolean(isolatedPath),
      mediaUrl: mediaPath ? await signEvidenceUrl({ bucket, mediaPath, nowMs }) : '',
    });
  }
  return media;
}

async function signEvidenceUrl({ bucket, mediaPath, nowMs }) {
  if (!bucket || typeof bucket.file !== 'function') return '';
  try {
    const [url] = await bucket.file(mediaPath).getSignedUrl({
      action: 'read',
      expires: nowMs + DIRECT_CHAT_EVIDENCE_URL_TTL_MS,
      version: 'v4',
    });
    return typeof url === 'string' ? url : '';
  } catch {
    return '';
  }
}

async function applyDirectChatRemoval({ conversationId, db, decodedToken, messageIds, now, transaction }) {
  if (!conversationId) throw httpError(400, 'This evidence case has no conversation to moderate.');
  const conversationRef = db.doc(`directConversations/${conversationId}`);
  const messageRefs = messageIds.map((messageId) => conversationRef.collection('messages').doc(messageId));
  const [conversationSnapshot, ...messageSnapshots] = await Promise.all([
    transaction.get(conversationRef),
    ...messageRefs.map((reference) => transaction.get(reference)),
  ]);
  if (!conversationSnapshot.exists) throw httpError(404, 'The reported conversation no longer exists.');
  const conversation = conversationSnapshot.data();
  const memberUids = Array.isArray(conversation.memberUids) ? conversation.memberUids : [];
  const projectionRefs = memberUids.map((uid) => db.doc(`directConversationMembers/${uid}/items/${conversationId}`));
  const summaryRefs = memberUids.map((uid) => db.doc(`directChatInboxSummaries/${uid}`));
  const [projectionSnapshots, summarySnapshots] = await Promise.all([
    Promise.all(projectionRefs.map((reference) => transaction.get(reference))),
    Promise.all(summaryRefs.map((reference) => transaction.get(reference))),
  ]);

  const patch = buildDirectChatRemovalPatch({ actorUid: decodedToken.uid, now });
  const removable = messageSnapshots
    .map((snapshot) => (snapshot.exists ? { ...snapshot.data(), id: snapshot.id, ref: snapshot.ref } : undefined))
    .filter((message) => message && message.visibilityState !== 'removed');
  if (removable.length === 0) throw httpError(404, 'None of the requested messages are available to remove.');
  for (const message of removable) transaction.update(message.ref, patch);

  const removedIds = new Set(removable.map((message) => message.id));
  let projectedConversation = conversation;
  if (removedIds.has(readString(conversation.lastMessageId, 160))) {
    projectedConversation = {
      ...conversation,
      lastMessageKind: 'removed',
      lastMessagePreview: safeDirectChatPreview('unsent'),
      updatedAt: now,
    };
    transaction.set(conversationRef, projectedConversation, { merge: true });
  }
  memberUids.forEach((memberUid, index) => {
    const existing = projectionSnapshots[index].exists ? projectionSnapshots[index].data() : undefined;
    const unreadIncrement = -removable.filter((message) => (
      Array.isArray(message.unreadForUids)
      && message.unreadForUids.includes(memberUid)
      && safeSequence(message.sequence) > safeSequence(existing?.lastReadSequence)
    )).length;
    const projection = buildDirectChatProjection({
      conversation: projectedConversation,
      existing,
      now,
      ownerUid: memberUid,
      peerUid: memberUids.find((uid) => uid !== memberUid) || '',
      unreadIncrement,
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
  return { messageIds: removable.map((message) => message.id) };
}

function mapEvidenceCase(reportId, evidenceCase = {}) {
  return {
    attachmentCount: Array.isArray(evidenceCase.attachmentIds) ? evidenceCase.attachmentIds.length : 0,
    capturedAt: readIso(evidenceCase.capturedAt),
    category: readString(evidenceCase.category, 64),
    contextRange: {
      endSequence: safeSequence(evidenceCase.contextRange?.endSequence),
      startSequence: safeSequence(evidenceCase.contextRange?.startSequence),
    },
    conversationId: readString(evidenceCase.conversationId, 128),
    legalHold: evidenceCase.legalHold === true,
    policyVersion: safeSequence(evidenceCase.policyVersion),
    removedMessageIds: Array.isArray(evidenceCase.removedMessageIds)
      ? evidenceCase.removedMessageIds.filter((id) => typeof id === 'string').slice(0, 50)
      : [],
    reportId,
    reporterUid: readString(evidenceCase.reporterUid, 128),
    retentionUntilMs: Number(evidenceCase.retentionUntilMs || 0),
    selectedMessageIds: Array.isArray(evidenceCase.selectedMessageIds)
      ? evidenceCase.selectedMessageIds.filter((id) => typeof id === 'string').slice(0, 50)
      : [],
    snapshotCount: safeSequence(evidenceCase.snapshotCount),
    source: readString(evidenceCase.source, 64),
    status: readString(evidenceCase.status, 32),
    targetUid: readString(evidenceCase.targetUid, 128),
  };
}

function mapEvidenceSnapshot(snapshot, media) {
  return {
    attachmentId: readString(snapshot.attachmentId, 160),
    createdAt: readIso(snapshot.createdAt),
    kind: readString(snapshot.kind, 32),
    mediaContentType: readString(snapshot.mediaContentType, 64),
    mediaDurationMs: safeSequence(snapshot.mediaDurationMs),
    mediaHeld: media?.held === true,
    mediaIsolated: media?.isolated === true,
    mediaState: mapDirectChatEvidenceMediaState(snapshot.evidenceMediaState),
    mediaUrl: media?.mediaUrl || '',
    messageId: readString(snapshot.messageId, 160),
    replyToMessageId: readString(snapshot.replyToMessageId, 160),
    selected: snapshot.selected === true,
    senderUid: readString(snapshot.senderUid, 128),
    sequence: safeSequence(snapshot.sequence),
    systemType: readString(snapshot.systemType, 64),
    text: readString(snapshot.text, 2_000),
    visibilityState: readString(snapshot.visibilityState, 32),
  };
}

function httpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function readIso(value) {
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Number.isFinite(value)) return new Date(Number(value)).toISOString();
  return '';
}

function readString(value, maxLength) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function safeSequence(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

module.exports = { executeDirectChatModerationAction, resolveDirectChatEvidence };
