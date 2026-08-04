const { filterChatText } = require('./roomChatCore');
const {
  directChatError,
  mapDirectChatFlags,
  mapDirectChatRestriction,
} = require('./directChatCore');

const DIRECT_CHAT_COMMAND_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const DIRECT_CHAT_REQUEST_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1_000;
const DIRECT_CHAT_REQUEST_EXPIRY_MS = 30 * 24 * 60 * 60 * 1_000;
const DIRECT_CHAT_SEND_RATE_LIMIT = 20;
const DIRECT_CHAT_SEND_RATE_WINDOW_MS = 10_000;
const DIRECT_CHAT_NEW_RECIPIENT_DAILY_LIMIT = 5;
const DIRECT_CHAT_UNSEND_WINDOW_MS = 5 * 60 * 1_000;

function resolveDirectChatPairAccess({
  actorProfile,
  actorRestriction,
  blockedByActor,
  blockedByTarget,
  featureFlags,
  nowMs,
  requireRequests = false,
  targetProfile,
  targetRestriction,
}) {
  const flags = mapDirectChatFlags(featureFlags);
  if (!flags.directMessages) return directChatError('FEATURE_DISABLED');
  if (requireRequests && !flags.directMessageRequests) return directChatError('REQUESTS_DISABLED');
  if (!isActiveProfile(actorProfile) || !isActiveProfile(targetProfile)) {
    return directChatError('ACCOUNT_RESTRICTED');
  }
  if (
    mapDirectChatRestriction(actorRestriction, actorProfile.uid, nowMs)?.active
    || mapDirectChatRestriction(targetRestriction, targetProfile.uid, nowMs)?.active
  ) return directChatError('ACCOUNT_RESTRICTED');
  if (blockedByActor || blockedByTarget) return directChatError('BLOCKED');
  return { ok: true, value: { flags } };
}

function resolveDirectChatActorAccess({ actorProfile, actorRestriction, featureFlags, nowMs }) {
  const flags = mapDirectChatFlags(featureFlags);
  if (!flags.directMessages) return directChatError('FEATURE_DISABLED');
  if (!isActiveProfile(actorProfile)) return directChatError('ACCOUNT_RESTRICTED');
  if (mapDirectChatRestriction(actorRestriction, actorProfile.uid, nowMs)?.active) {
    return directChatError('ACCOUNT_RESTRICTED');
  }
  return { ok: true, value: { flags } };
}

function resolveDirectChatRateLimit({ isNewNonFriendRecipient, nowMs, rate, targetUid }) {
  const windowStartedAtMs = timestampToMillis(rate?.sendWindowStartedAt);
  const sameWindow = Number.isFinite(windowStartedAtMs)
    && nowMs >= windowStartedAtMs
    && nowMs - windowStartedAtMs < DIRECT_CHAT_SEND_RATE_WINDOW_MS;
  const sendCount = sameWindow && Number.isSafeInteger(rate?.sendCount)
    ? rate.sendCount
    : 0;
  if (sendCount >= DIRECT_CHAT_SEND_RATE_LIMIT) return directChatError('RATE_LIMITED');

  const dayKey = createBaghdadDayKey(nowMs);
  const currentRecipients = rate?.requestDayKey === dayKey && Array.isArray(rate?.newRecipientUids)
    ? [...new Set(rate.newRecipientUids.filter(validUid))].slice(0, DIRECT_CHAT_NEW_RECIPIENT_DAILY_LIMIT)
    : [];
  const addsRecipient = isNewNonFriendRecipient && !currentRecipients.includes(targetUid);
  if (addsRecipient && currentRecipients.length >= DIRECT_CHAT_NEW_RECIPIENT_DAILY_LIMIT) {
    return directChatError('RATE_LIMITED');
  }
  return {
    ok: true,
    value: {
      newRecipientUids: addsRecipient ? [...currentRecipients, targetUid] : currentRecipients,
      requestDayKey: dayKey,
      sendCount: sendCount + 1,
      sendWindowStartedAtMs: sameWindow ? windowStartedAtMs : nowMs,
    },
  };
}

function filterDirectChatText(text, moderationConfig) {
  const mode = ['off', 'standard', 'strict'].includes(moderationConfig?.directChatKeywordFilterMode)
    ? moderationConfig.directChatKeywordFilterMode
    : 'standard';
  const filtered = filterChatText(text, mode, moderationConfig?.keywordTerms);
  return filtered.ok ? { ok: true, value: text } : directChatError('CONTENT_FILTERED');
}

function resolveDirectChatRequestStatus(request, nowMs) {
  if (!request || typeof request !== 'object') return 'none';
  if (request.status === 'pending' && timestampToMillis(request.expiresAt) <= nowMs) return 'expired';
  return ['pending', 'accepted', 'rejected', 'expired', 'blocked'].includes(request.status)
    ? request.status
    : 'none';
}

function canUnsendDirectMessage({ actorUid, message, nowMs }) {
  if (
    !message
    || message.senderUid !== actorUid
    || message.kind === 'system'
    || message.visibilityState !== 'visible'
  ) return directChatError('MESSAGE_UNAVAILABLE');
  const createdAtMs = timestampToMillis(message.createdAt);
  if (!Number.isFinite(createdAtMs) || nowMs < createdAtMs || nowMs - createdAtMs > DIRECT_CHAT_UNSEND_WINDOW_MS) {
    return directChatError('UNSEND_WINDOW_EXPIRED');
  }
  return { ok: true };
}

function isAcceptedConversation(conversation, friendship) {
  return conversation?.lifecycleState === 'active'
    && (
      conversation.requestState === 'accepted'
      || isPairFriendship(friendship, conversation.memberUids)
    );
}

function isPairFriendship(friendship, memberUids) {
  return Boolean(
    friendship
    && Array.isArray(friendship.memberUids)
    && Array.isArray(memberUids)
    && memberUids.length === 2
    && memberUids.every((uid) => friendship.memberUids.includes(uid)),
  );
}

function safeDirectChatPreview(kind, text = '') {
  if (kind === 'text' || kind === 'emoji') return [...text].slice(0, 120).join('');
  if (kind === 'system') return '';
  if (kind === 'unsent') return 'Message removed';
  return 'Message';
}

function systemEventPreview(eventType) {
  return {
    'request-accepted': 'Message request accepted',
    'request-blocked': 'Message request closed',
    'request-expired': 'Message request expired',
    'request-rejected': 'Message request declined',
  }[eventType] || 'Conversation updated';
}

function createBaghdadDayKey(nowMs) {
  return new Date(nowMs + (3 * 60 * 60 * 1_000)).toISOString().slice(0, 10);
}

function isActiveProfile(profile) {
  return Boolean(profile && validUid(profile.uid) && profile.moderationStatus === 'active');
}

function validUid(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && !value.includes('/');
}

function timestampToMillis(value) {
  if (Number.isFinite(value)) return Number(value);
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && Number.isFinite(value.seconds)) {
    return (value.seconds * 1_000) + Math.floor(Number(value.nanoseconds || 0) / 1_000_000);
  }
  return Number.NaN;
}

module.exports = {
  DIRECT_CHAT_COMMAND_RETENTION_MS,
  DIRECT_CHAT_NEW_RECIPIENT_DAILY_LIMIT,
  DIRECT_CHAT_REQUEST_COOLDOWN_MS,
  DIRECT_CHAT_REQUEST_EXPIRY_MS,
  DIRECT_CHAT_SEND_RATE_LIMIT,
  DIRECT_CHAT_SEND_RATE_WINDOW_MS,
  DIRECT_CHAT_UNSEND_WINDOW_MS,
  canUnsendDirectMessage,
  createBaghdadDayKey,
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
};
