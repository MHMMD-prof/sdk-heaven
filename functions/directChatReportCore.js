const { DIRECT_CHAT_MAX_REPORT_MESSAGES, directChatError } = require('./directChatCore');
const { timestampToMillis } = require('./directChatPolicyCore');

const DIRECT_CHAT_REPORT_RATE_LIMIT = 5;
const DIRECT_CHAT_REPORT_RATE_WINDOW_MS = 60 * 60 * 1_000;
const DIRECT_CHAT_REPORT_CONVERSATION_COOLDOWN_MS = 60 * 60 * 1_000;
const DIRECT_CHAT_REPORT_TRACKED_CONVERSATIONS = 10;
const DIRECT_CHAT_EVIDENCE_CONTEXT_RADIUS = 10;
const DIRECT_CHAT_MAX_EVIDENCE_SNAPSHOTS = 30;
const DIRECT_CHAT_EVIDENCE_TEXT_LENGTH = 2_000;
const DIRECT_CHAT_EVIDENCE_POLICY_VERSION = 1;
const DIRECT_CHAT_EVIDENCE_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const DIRECT_CHAT_REPORT_SOURCE = 'direct-chat-safety-v1';
const DIRECT_CHAT_REPORT_SUBJECT_TYPE = 'direct-message';

// Reporting deliberately does not reuse resolveDirectChatPairAccess. A participant must keep
// the ability to report after blocking the peer, after the peer is suspended, while their own
// chat restriction is active, and while the directMessages flag is emergency-disabled.
function resolveDirectChatReportAccess({ actorProfile, conversation, targetUid, uid }) {
  if (!actorProfile || actorProfile.uid !== uid || actorProfile.moderationStatus === 'removed') {
    return directChatError('ACCOUNT_RESTRICTED');
  }
  const members = Array.isArray(conversation?.memberUids) ? conversation.memberUids : [];
  if (members.length !== 2 || !members.includes(uid) || !members.includes(targetUid)) {
    return directChatError('NOT_FOUND');
  }
  return { ok: true };
}

function resolveDirectChatReportRateLimit({ conversationId, nowMs, rate }) {
  const windowStartedAtMs = timestampToMillis(rate?.reportWindowStartedAt);
  const sameWindow = Number.isFinite(windowStartedAtMs)
    && nowMs >= windowStartedAtMs
    && nowMs - windowStartedAtMs < DIRECT_CHAT_REPORT_RATE_WINDOW_MS;
  const reportCount = sameWindow && Number.isSafeInteger(rate?.reportCount) ? rate.reportCount : 0;
  if (reportCount >= DIRECT_CHAT_REPORT_RATE_LIMIT) return directChatError('RATE_LIMITED');

  const tracked = normalizeTrackedConversations(rate?.reportedConversations, nowMs);
  if (tracked.some((entry) => entry.conversationId === conversationId)) {
    return directChatError('RATE_LIMITED');
  }
  return {
    ok: true,
    value: {
      reportCount: reportCount + 1,
      reportWindowStartedAtMs: sameWindow ? windowStartedAtMs : nowMs,
      reportedConversations: [...tracked, { atMs: nowMs, conversationId }]
        .slice(-DIRECT_CHAT_REPORT_TRACKED_CONVERSATIONS),
    },
  };
}

function normalizeTrackedConversations(value, nowMs) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => (
      entry
      && typeof entry.conversationId === 'string'
      && entry.conversationId.length > 0
      && Number.isFinite(Number(entry.atMs))
      && nowMs - Number(entry.atMs) < DIRECT_CHAT_REPORT_CONVERSATION_COOLDOWN_MS
      && Number(entry.atMs) <= nowMs
    ))
    .map((entry) => ({ atMs: Number(entry.atMs), conversationId: entry.conversationId }))
    .slice(-DIRECT_CHAT_REPORT_TRACKED_CONVERSATIONS);
}

// Bounds the context query before it runs so a report can never scan an entire thread.
function resolveDirectChatEvidenceRange({ messageIds, messages }) {
  const selected = (Array.isArray(messages) ? messages : [])
    .filter((message) => isReportableMessage(message) && messageIds.includes(message.id))
    .slice(0, DIRECT_CHAT_MAX_REPORT_MESSAGES);
  if (!selected.length) return directChatError('EVIDENCE_UNAVAILABLE');
  const sequences = selected.map((message) => message.sequence);
  const minSequence = Math.min(...sequences);
  const maxSequence = Math.max(...sequences);
  return {
    ok: true,
    value: {
      contextEndSequence: maxSequence + DIRECT_CHAT_EVIDENCE_CONTEXT_RADIUS,
      contextStartSequence: Math.max(0, minSequence - DIRECT_CHAT_EVIDENCE_CONTEXT_RADIUS),
      maxSequence,
      minSequence,
      selected,
      selectedIds: selected.map((message) => message.id).sort(),
    },
  };
}

function resolveDirectChatEvidenceWindow({ contextMessages, range }) {
  const selectedIds = new Set(range.selectedIds);
  const context = (Array.isArray(contextMessages) ? contextMessages : [])
    .filter((message) => isReportableMessage(message) && !selectedIds.has(message.id))
    .sort((first, second) => (
      distanceToSelection(first.sequence, range) - distanceToSelection(second.sequence, range)
      || first.sequence - second.sequence
    ))
    .slice(0, Math.max(0, DIRECT_CHAT_MAX_EVIDENCE_SNAPSHOTS - range.selected.length));
  return [...range.selected, ...context].sort((first, second) => first.sequence - second.sequence);
}

function distanceToSelection(sequence, range) {
  if (sequence < range.minSequence) return range.minSequence - sequence;
  if (sequence > range.maxSequence) return sequence - range.maxSequence;
  return 0;
}

function buildDirectChatEvidenceSnapshot({ conversationId, message, reportId, selected }) {
  return {
    attachmentId: readText(message.attachmentId, 160),
    conversationId,
    createdAt: message.createdAt || null,
    kind: readText(message.kind, 32),
    mediaContentType: readText(message.mediaContentType, 64),
    mediaDurationMs: safeCount(message.mediaDurationMs),
    mediaPath: readText(message.mediaPath, 512),
    messageId: message.id,
    replyToMessageId: readText(message.replyToMessageId, 160),
    reportId,
    selected,
    senderUid: readText(message.senderUid, 128),
    sequence: message.sequence,
    systemType: readText(message.systemType, 64),
    text: truncateText(message.text),
    visibilityState: readText(message.visibilityState, 32),
  };
}

function directChatReportSeverity(category) {
  return ['sexual-content', 'threat', 'underage'].includes(category) ? 'high' : 'medium';
}

function isReportableMessage(message) {
  return Boolean(
    message
    && typeof message.id === 'string'
    && message.id.length > 0
    && Number.isSafeInteger(message.sequence)
    && message.sequence >= 0,
  );
}

function readText(value, maxLength) {
  return typeof value === 'string' && value.length <= maxLength ? value : '';
}

function truncateText(value) {
  return typeof value === 'string'
    ? [...value].slice(0, DIRECT_CHAT_EVIDENCE_TEXT_LENGTH).join('')
    : '';
}

function safeCount(value) {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

module.exports = {
  DIRECT_CHAT_EVIDENCE_CONTEXT_RADIUS,
  DIRECT_CHAT_EVIDENCE_POLICY_VERSION,
  DIRECT_CHAT_EVIDENCE_RETENTION_MS,
  DIRECT_CHAT_EVIDENCE_TEXT_LENGTH,
  DIRECT_CHAT_MAX_EVIDENCE_SNAPSHOTS,
  DIRECT_CHAT_REPORT_CONVERSATION_COOLDOWN_MS,
  DIRECT_CHAT_REPORT_RATE_LIMIT,
  DIRECT_CHAT_REPORT_RATE_WINDOW_MS,
  DIRECT_CHAT_REPORT_SOURCE,
  DIRECT_CHAT_REPORT_SUBJECT_TYPE,
  DIRECT_CHAT_REPORT_TRACKED_CONVERSATIONS,
  buildDirectChatEvidenceSnapshot,
  directChatReportSeverity,
  resolveDirectChatEvidenceRange,
  resolveDirectChatEvidenceWindow,
  resolveDirectChatReportAccess,
  resolveDirectChatReportRateLimit,
};
