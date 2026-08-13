const { directChatError } = require('./directChatCore');

function buildDirectChatProjection({
  conversation,
  existing,
  now,
  ownerUid,
  peerUid,
  unreadIncrement = 0,
}) {
  const lastSequence = safeSequence(conversation?.lastSequence);
  const lastReadSequence = Math.min(safeSequence(existing?.lastReadSequence), lastSequence);
  const clearedThroughSequence = Math.min(safeSequence(existing?.clearedThroughSequence), lastSequence);
  const retentionPurgedThroughSequence = Math.min(safeSequence(conversation?.retentionPurgedThroughSequence), lastSequence);
  const existingUnread = safeSequence(existing?.unreadCount);
  const boundedIncrement = Number.isSafeInteger(unreadIncrement) ? unreadIncrement : 0;
  const unreadCount = Math.max(0, existingUnread + boundedIncrement);
  return {
    archived: false,
    clearedThroughSequence,
    conversationId: conversation.conversationId,
    lastMessageId: readString(conversation.lastMessageId, 160),
    lastMessageKind: readString(conversation.lastMessageKind, 24),
    lastMessagePreview: readString(conversation.lastMessagePreview, 120),
    lastMessageSenderUid: readString(conversation.lastMessageSenderUid, 128),
    lastReadSequence,
    lastSequence,
    muted: existing?.muted === true,
    ownerUid,
    peerUid,
    recipientUid: readString(conversation.recipientUid, 128),
    requestState: readString(conversation.requestState, 24) || 'none',
    requesterUid: readString(conversation.requesterUid, 128),
    retentionPurgedThroughSequence,
    unreadCount,
    updatedAt: now,
  };
}

function resolveDirectChatMarkRead({ conversation, projection, throughSequence }) {
  const lastSequence = safeSequence(conversation?.lastSequence);
  const currentRead = Math.min(safeSequence(projection?.lastReadSequence), lastSequence);
  if (!Number.isSafeInteger(throughSequence) || throughSequence < 0 || throughSequence > lastSequence) {
    return directChatError('READ_SEQUENCE_INVALID');
  }
  if (throughSequence <= currentRead) {
    return { ok: true, value: { changed: false, lastReadSequence: currentRead, unreadCount: safeSequence(projection?.unreadCount) } };
  }
  if (throughSequence !== lastSequence) return directChatError('READ_SEQUENCE_INVALID');
  return { ok: true, value: { changed: true, lastReadSequence: lastSequence, unreadCount: 0 } };
}

function resolveDirectChatProjectionDrift({ conversation, projection }) {
  if (!conversation || !projection) return { drifted: true, reasons: [!conversation ? 'conversation-missing' : 'projection-missing'] };
  const reasons = [];
  const exactFields = [
    'conversationId',
    'lastMessageId',
    'lastMessageKind',
    'lastMessagePreview',
    'lastMessageSenderUid',
    'lastSequence',
    'recipientUid',
    'requestState',
    'requesterUid',
  ];
  for (const field of exactFields) {
    if ((projection[field] ?? '') !== (conversation[field] ?? '')) reasons.push(field);
  }
  if (projection.ownerUid === projection.peerUid) reasons.push('peerUid');
  if (safeSequence(projection.lastReadSequence) > safeSequence(conversation.lastSequence)) reasons.push('lastReadSequence');
  if (safeSequence(projection.clearedThroughSequence) > safeSequence(conversation.lastSequence)) reasons.push('clearedThroughSequence');
  if (safeSequence(projection.retentionPurgedThroughSequence) !== safeSequence(conversation.retentionPurgedThroughSequence)) {
    reasons.push('retentionPurgedThroughSequence');
  }
  if (!Number.isSafeInteger(projection.unreadCount) || projection.unreadCount < 0) reasons.push('unreadCount');
  return { drifted: reasons.length > 0, reasons };
}

function mapDirectChatProjection(value, ownerUid) {
  if (!value || value.ownerUid !== ownerUid || typeof value.conversationId !== 'string' || typeof value.peerUid !== 'string') return undefined;
  return {
    archived: value.archived === true,
    clearedThroughSequence: safeSequence(value.clearedThroughSequence),
    conversationId: value.conversationId,
    lastMessageId: readString(value.lastMessageId, 160),
    lastMessageKind: readString(value.lastMessageKind, 24),
    lastMessagePreview: readString(value.lastMessagePreview, 120),
    lastMessageSenderUid: readString(value.lastMessageSenderUid, 128),
    lastReadSequence: safeSequence(value.lastReadSequence),
    lastSequence: safeSequence(value.lastSequence),
    muted: value.muted === true,
    ownerUid,
    peerUid: value.peerUid,
    recipientUid: readString(value.recipientUid, 128),
    requestState: readString(value.requestState, 24) || 'none',
    requesterUid: readString(value.requesterUid, 128),
    retentionPurgedThroughSequence: safeSequence(value.retentionPurgedThroughSequence),
    unreadCount: safeSequence(value.unreadCount),
    updatedAt: value.updatedAt,
  };
}

// Retention deletes rows for both participants, so the floor a thread reads from is the higher of
// the member's own delete-for-me marker and the conversation-wide retention watermark.
function resolveDirectChatThreadFloor(projection, conversation) {
  return Math.max(
    safeSequence(projection?.clearedThroughSequence),
    safeSequence(conversation?.retentionPurgedThroughSequence),
    safeSequence(projection?.retentionPurgedThroughSequence),
  );
}

function mapDirectChatMessage(value, clearedThroughSequence = 0) {
  if (
    !value
    || typeof value.id !== 'string'
    || !Number.isSafeInteger(value.sequence)
    || value.sequence <= safeSequence(clearedThroughSequence)
    || !['text', 'emoji', 'system', 'image', 'voice-note', 'sticker'].includes(value.kind)
    || !['visible', 'unsent'].includes(value.visibilityState)
  ) return undefined;
  return {
    attachmentId: readString(value.attachmentId, 160),
    conversationId: readString(value.conversationId, 64),
    createdAt: value.createdAt,
    id: value.id,
    kind: value.kind,
    mediaContentType: readString(value.mediaContentType, 80),
    mediaDurationMs: safeSequence(value.mediaDurationMs),
    mediaHeight: safeSequence(value.mediaHeight),
    mediaPath: readString(value.mediaPath, 512),
    mediaWidth: safeSequence(value.mediaWidth),
    replyToMessageId: readString(value.replyToMessageId, 160),
    senderUid: readString(value.senderUid, 128),
    sequence: value.sequence,
    sticker: mapSticker(value.sticker),
    systemType: readString(value.systemType, 48),
    text: value.visibilityState === 'visible' ? readString(value.text, 2_000) : '',
    visibilityState: value.visibilityState,
  };
}

function mapSticker(value) {
  if (!value || typeof value !== 'object') return undefined;
  const assetId = readString(value.assetId, 128);
  const assetVersionId = readString(value.assetVersionId, 128);
  const itemId = readString(value.itemId, 80);
  return assetId && assetVersionId && itemId ? { assetId, assetVersionId, itemId } : undefined;
}

function safeSequence(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function readString(value, maxLength) {
  return typeof value === 'string' && value.length <= maxLength ? value : '';
}

module.exports = {
  buildDirectChatProjection,
  mapDirectChatMessage,
  mapDirectChatProjection,
  resolveDirectChatMarkRead,
  resolveDirectChatProjectionDrift,
  resolveDirectChatThreadFloor,
  safeSequence,
};
