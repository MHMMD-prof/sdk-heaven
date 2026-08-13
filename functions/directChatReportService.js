const {
  createDirectChatReportId,
  createDirectConversationId,
  directChatError,
} = require('./directChatCore');
const { DIRECT_CHAT_COMMAND_RETENTION_MS } = require('./directChatPolicyCore');
const {
  DIRECT_CHAT_EVIDENCE_POLICY_VERSION,
  DIRECT_CHAT_EVIDENCE_RETENTION_MS,
  DIRECT_CHAT_MAX_EVIDENCE_SNAPSHOTS,
  DIRECT_CHAT_REPORT_SOURCE,
  DIRECT_CHAT_REPORT_SUBJECT_TYPE,
  buildDirectChatEvidenceSnapshot,
  directChatReportSeverity,
  resolveDirectChatEvidenceRange,
  resolveDirectChatEvidenceWindow,
  resolveDirectChatReportAccess,
  resolveDirectChatReportRateLimit,
} = require('./directChatReportCore');
const { resolveDirectChatEvidenceMediaState } = require('./directChatRetentionCore');

async function submitDirectChatReport({ clock, command, db, fingerprint, uid }) {
  const targetUid = command.payload.targetUid;
  const conversationId = createDirectConversationId(uid, targetUid);
  const reportId = createDirectChatReportId({ conversationId, reporterUid: uid, requestId: command.requestId });
  if (!conversationId || !reportId) return directChatError('INVALID_REQUEST');
  const refs = reportRefs({ conversationId, db, reportId, targetUid, uid });
  const commandRef = db.doc(`directChatCommands/${uid}/requests/${command.requestId}`);
  const messages = refs.conversation.collection('messages');
  const nowMs = clock.nowMillis();
  const now = clock.timestampFromMillis(nowMs);

  return db.runTransaction(async (transaction) => {
    const selectedRefs = command.payload.messageIds.map((messageId) => messages.doc(messageId));
    const [commandSnapshot, actorProfileSnapshot, targetProfileSnapshot, conversationSnapshot, rateSnapshot,
      ...selectedSnapshots] = await Promise.all([
      transaction.get(commandRef),
      transaction.get(refs.actorProfile),
      transaction.get(refs.targetProfile),
      transaction.get(refs.conversation),
      transaction.get(refs.rate),
      ...selectedRefs.map((reference) => transaction.get(reference)),
    ]);
    const replay = resolveReplay(commandSnapshot, fingerprint, uid);
    if (replay) return replay;

    let response = resolveDirectChatReportAccess({
      actorProfile: dataOf(actorProfileSnapshot),
      conversation: dataOf(conversationSnapshot),
      targetUid,
      uid,
    });
    const rate = response.ok
      ? resolveDirectChatReportRateLimit({ conversationId, nowMs, rate: dataOf(rateSnapshot) })
      : response;
    if (response.ok && !rate.ok) response = rate;
    const range = response.ok
      ? resolveDirectChatEvidenceRange({
        messageIds: command.payload.messageIds,
        messages: selectedSnapshots.map(messageOf).filter(Boolean),
      })
      : response;
    if (response.ok && !range.ok) response = range;
    if (!response.ok) {
      return recordCommand({ clock, command, commandRef, conversationId, fingerprint, now, response, transaction, uid });
    }

    const contextSnapshot = await transaction.get(messages
      .where('sequence', '>=', range.value.contextStartSequence)
      .where('sequence', '<=', range.value.contextEndSequence)
      .orderBy('sequence', 'asc')
      .limit(DIRECT_CHAT_MAX_EVIDENCE_SNAPSHOTS));
    const captured = resolveDirectChatEvidenceWindow({
      contextMessages: contextSnapshot.docs.map(messageOf).filter(Boolean),
      range: range.value,
    });
    const selectedIds = new Set(range.value.selectedIds);
    const attachmentIds = [...new Set(captured.map((message) => message.attachmentId).filter(Boolean))]
      .slice(0, DIRECT_CHAT_MAX_EVIDENCE_SNAPSHOTS);
    const attachmentRefs = attachmentIds.map((attachmentId) => db.doc(`directChatUploads/${attachmentId}`));
    const attachmentSnapshots = await Promise.all(attachmentRefs.map((reference) => transaction.get(reference)));

    const actorProfile = dataOf(actorProfileSnapshot) || {};
    const targetProfile = dataOf(targetProfileSnapshot) || {};
    const severity = directChatReportSeverity(command.payload.category);
    // contentExcerpt stays empty on purpose. It renders in the unaudited queue list, so private
    // message content must only be reachable through the audited evidence case in Wave 6B.
    transaction.create(refs.report, {
      assignedTo: '',
      category: command.payload.category,
      contentExcerpt: '',
      countryCode: readCountryCode(targetProfile.countryCode),
      createdAt: now,
      details: command.payload.details || '',
      evidenceId: reportId,
      messageId: '',
      messageSnapshot: null,
      noteCount: 0,
      reason: command.payload.category,
      reporterPublicId: readText(actorProfile.publicId, 64),
      reporterUid: uid,
      resolutionNote: '',
      roomId: '',
      severity,
      source: DIRECT_CHAT_REPORT_SOURCE,
      status: 'open',
      subjectType: DIRECT_CHAT_REPORT_SUBJECT_TYPE,
      targetPublicId: readText(targetProfile.publicId, 64),
      targetUid,
      updatedAt: now,
    });
    transaction.create(refs.evidenceCase, {
      accessPolicy: 'staff-only',
      attachmentIds,
      capturedAt: now,
      category: command.payload.category,
      contextRange: { endSequence: range.value.maxSequence, startSequence: range.value.minSequence },
      conversationId,
      createdAt: now,
      legalHold: false,
      policyVersion: DIRECT_CHAT_EVIDENCE_POLICY_VERSION,
      reportId,
      reporterUid: uid,
      retentionUntilMs: nowMs + DIRECT_CHAT_EVIDENCE_RETENTION_MS,
      selectedMessageIds: range.value.selectedIds,
      snapshotCount: captured.length,
      source: DIRECT_CHAT_REPORT_SOURCE,
      status: 'open',
      targetUid,
      updatedAt: now,
    });
    for (const message of captured) {
      const snapshot = buildDirectChatEvidenceSnapshot({
        conversationId,
        message,
        reportId,
        selected: selectedIds.has(message.id),
      });
      transaction.create(refs.evidenceCase.collection('evidence').doc(message.id), {
        ...snapshot,
        capturedAt: now,
        // The bytes are still shared with the live conversation at this point. Marking the
        // snapshot pending queues the retention worker to copy them under this report's own
        // prefix; evidenceHold below keeps them alive until that copy lands.
        evidenceMediaState: resolveDirectChatEvidenceMediaState(snapshot),
        evidencePath: '',
      });
    }
    attachmentSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      transaction.set(attachmentRefs[index], { evidenceHold: true, updatedAt: now }, { merge: true });
    });
    transaction.create(refs.audit, {
      action: 'direct-chat-report-create',
      actorRole: 'participant',
      actorUid: uid,
      category: command.payload.category,
      createdAt: now,
      countryCode: readCountryCode(targetProfile.countryCode),
      kind: 'direct-chat-report',
      reportId,
      requestId: command.requestId,
      severity,
      snapshotCount: captured.length,
      status: 'open',
      targetUid,
    });
    transaction.set(refs.rate, {
      reportCount: rate.value.reportCount,
      reportWindowStartedAt: clock.timestampFromMillis(rate.value.reportWindowStartedAtMs),
      reportedConversations: rate.value.reportedConversations,
      uid,
      updatedAt: now,
    }, { merge: true });
    return recordCommand({
      clock,
      command,
      commandRef,
      conversationId,
      fingerprint,
      now,
      response: success(command, conversationId, { capturedMessageCount: captured.length, reportId, status: 'open' }),
      transaction,
      uid,
    });
  });
}

function reportRefs({ conversationId, db, reportId, targetUid, uid }) {
  return {
    actorProfile: db.doc(`publicProfiles/${uid}`),
    audit: db.doc(`adminAuditEvents/direct_chat_report_${reportId}`),
    conversation: db.doc(`directConversations/${conversationId}`),
    evidenceCase: db.doc(`directChatReports/${reportId}`),
    rate: db.doc(`directChatRateLimits/${uid}`),
    report: db.doc(`reports/${reportId}`),
    targetProfile: db.doc(`publicProfiles/${targetUid}`),
  };
}

function messageOf(snapshot) {
  return snapshot?.exists ? { ...snapshot.data(), id: snapshot.id } : undefined;
}

function resolveReplay(snapshot, fingerprint, uid) {
  if (!snapshot?.exists) return undefined;
  const previous = snapshot.data();
  return previous.actorUid === uid && previous.fingerprint === fingerprint
    ? { ...previous.response, replayed: true }
    : directChatError('REQUEST_CONFLICT');
}

function recordCommand({ clock, command, commandRef, conversationId, fingerprint, now, response, transaction, uid }) {
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

function success(command, conversationId, value) {
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

function dataOf(snapshot) {
  return snapshot?.exists ? snapshot.data() : undefined;
}

function readText(value, maxLength) {
  return typeof value === 'string' && value.length <= maxLength ? value.trim() : '';
}

function readCountryCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase().slice(0, 2) : '';
}

module.exports = { submitDirectChatReport };
