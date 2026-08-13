const { buildDirectChatProjection, resolveDirectChatProjectionDrift } = require('./directChatProjectionCore');
const { safeDirectChatPreview, systemEventPreview } = require('./directChatPolicyCore');

function buildDirectChatReconciliation({ conversation, latestMessage, now, projections = {}, unreadCounts = {} }) {
  if (!conversation || !Array.isArray(conversation.memberUids) || conversation.memberUids.length !== 2) {
    return { repairable: false, report: { drifted: true, reasons: ['conversation-invalid'] } };
  }
  // lastSequence is the allocator for new messages and the ceiling every projection clamps
  // against, so retention ageing out the newest rows must never pull it backwards.
  const retentionFloor = safeSequence(conversation.retentionPurgedThroughSequence);
  const normalizedConversation = {
    ...conversation,
    lastMessageId: latestMessage?.id || '',
    lastMessageKind: latestMessage
      ? latestMessage.visibilityState === 'unsent' ? 'unsent' : latestMessage.kind
      : '',
    lastMessagePreview: previewMessage(latestMessage),
    lastMessageSenderUid: latestMessage?.senderUid || '',
    lastSequence: Math.max(
      Number.isSafeInteger(latestMessage?.sequence) ? latestMessage.sequence : 0,
      retentionFloor,
    ),
    retentionPurgedThroughSequence: retentionFloor,
  };
  const conversationReasons = [];
  for (const field of ['lastMessageId', 'lastMessageKind', 'lastMessagePreview', 'lastMessageSenderUid', 'lastSequence']) {
    if ((conversation[field] ?? '') !== (normalizedConversation[field] ?? '')) conversationReasons.push(`conversation.${field}`);
  }
  const expectedProjections = {};
  const projectionReports = {};
  for (const ownerUid of conversation.memberUids) {
    const peerUid = conversation.memberUids.find((uid) => uid !== ownerUid);
    const existing = projections[ownerUid];
    const expected = buildDirectChatProjection({
      conversation: normalizedConversation,
      existing,
      now,
      ownerUid,
      peerUid,
    });
    expected.archived = existing?.archived === true;
    expected.unreadCount = Number.isSafeInteger(unreadCounts[ownerUid]) && unreadCounts[ownerUid] >= 0
      ? unreadCounts[ownerUid]
      : 0;
    expectedProjections[ownerUid] = expected;
    const projectionReport = resolveDirectChatProjectionDrift({ conversation: normalizedConversation, projection: existing });
    const reasons = [...projectionReport.reasons];
    if (existing && existing.unreadCount !== expected.unreadCount) reasons.push('unreadCount');
    projectionReports[ownerUid] = { drifted: reasons.length > 0, reasons };
  }
  const reasons = [
    ...conversationReasons,
    ...Object.entries(projectionReports).flatMap(([uid, report]) => report.reasons.map((reason) => `projection.${uid}.${reason}`)),
  ];
  return {
    expectedConversation: normalizedConversation,
    expectedProjections,
    repairable: true,
    report: {
      conversationReasons,
      drifted: reasons.length > 0,
      projectionReports,
      reasons,
    },
  };
}

function safeSequence(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function previewMessage(message) {
  if (!message) return '';
  if (message.visibilityState === 'unsent') return safeDirectChatPreview('unsent');
  if (message.kind === 'system') return systemEventPreview(message.systemType);
  return safeDirectChatPreview(message.kind, message.text);
}

module.exports = {
  buildDirectChatReconciliation,
  previewMessage,
};
