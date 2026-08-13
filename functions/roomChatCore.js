const { readPublicAvatarFrameProjection } = require('./avatarFrameProjectionCore');

const ROOM_CHAT_ACTIONS = Object.freeze([
  'send-message',
  'delete-message',
  'pin-message',
  'unpin-message',
  'block-user',
  'unblock-user',
  'report-content',
]);

const ROOM_REPORT_SUBJECT_TYPES = Object.freeze([
  'user',
  'message',
  'room',
  'room-image',
  'gift',
  'voice',
]);

const ROOM_REPORT_CATEGORIES = Object.freeze([
  'harassment',
  'hate',
  'sexual-content',
  'threat',
  'underage',
  'spam',
  'scam',
  'personal-information',
  'impersonation',
  'unsafe-room',
  'other',
]);

const CHAT_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{12,128}$/;
const MAX_CHAT_TEXT_LENGTH = 280;
const MAX_REPORT_DETAILS_LENGTH = 500;
const MAX_KEYWORD_TERMS = 200;

function normalizeRoomChatBody(body) {
  const input = isRecord(body) ? body : {};
  return {
    action: stringValue(input.action, 40),
    category: stringValue(input.category, 64),
    details: cleanMultilineText(input.details, MAX_REPORT_DETAILS_LENGTH),
    giftEventId: stringValue(input.giftEventId, 160),
    mediaId: stringValue(input.mediaId, 160),
    messageId: stringValue(input.messageId, 160),
    replyToMessageId: stringValue(input.replyToMessageId, 160),
    requestId: stringValue(input.requestId, 128),
    roomId: stringValue(input.roomId, 128),
    subjectType: stringValue(input.subjectType, 40),
    targetUid: stringValue(input.targetUid, 128),
    text: normalizeChatText(input.text),
  };
}

function validateRoomChatRequest(command) {
  if (!command.roomId || command.roomId.includes('/')) {
    return roomChatError('INVALID_REQUEST', 400, 'A valid room ID is required.');
  }
  if (!ROOM_CHAT_ACTIONS.includes(command.action)) {
    return roomChatError('INVALID_ACTION', 400, 'A valid room chat action is required.');
  }
  if (!CHAT_REQUEST_ID_PATTERN.test(command.requestId)) {
    return roomChatError('INVALID_REQUEST', 400, 'A valid request ID is required.');
  }
  if (command.action === 'send-message') {
    if (!command.text) return roomChatError('MESSAGE_EMPTY', 400, 'Message text is required.');
    if (command.text.length > MAX_CHAT_TEXT_LENGTH) {
      return roomChatError('MESSAGE_TOO_LONG', 400, `Messages are limited to ${MAX_CHAT_TEXT_LENGTH} characters.`);
    }
    if (command.replyToMessageId && !validDocumentId(command.replyToMessageId)) {
      return roomChatError('INVALID_REQUEST', 400, 'The reply target is invalid.');
    }
  }
  if (['delete-message', 'pin-message', 'unpin-message'].includes(command.action) && !validDocumentId(command.messageId)) {
    return roomChatError('MESSAGE_REQUIRED', 400, 'A valid message ID is required.');
  }
  if (['block-user', 'unblock-user'].includes(command.action) && !validUid(command.targetUid)) {
    return roomChatError('TARGET_REQUIRED', 400, 'A valid target user is required.');
  }
  if (command.action === 'report-content') {
    if (!ROOM_REPORT_SUBJECT_TYPES.includes(command.subjectType)) {
      return roomChatError('REPORT_SUBJECT_INVALID', 400, 'A valid report subject is required.');
    }
    if (!ROOM_REPORT_CATEGORIES.includes(command.category)) {
      return roomChatError('REPORT_CATEGORY_INVALID', 400, 'A valid report category is required.');
    }
    if (command.subjectType === 'user' || command.subjectType === 'voice') {
      if (!validUid(command.targetUid)) return roomChatError('TARGET_REQUIRED', 400, 'A target user is required.');
    }
    if (command.subjectType === 'message' && !validDocumentId(command.messageId)) {
      return roomChatError('MESSAGE_REQUIRED', 400, 'A target message is required.');
    }
    if (command.subjectType === 'room-image' && !validDocumentId(command.mediaId)) {
      return roomChatError('MEDIA_REQUIRED', 400, 'A target room image is required.');
    }
    if (command.subjectType === 'gift' && !validDocumentId(command.giftEventId)) {
      return roomChatError('GIFT_REQUIRED', 400, 'A target gift event is required.');
    }
  }
  return { ok: true, value: command };
}

function resolveRoomChatAuthority({ decodedToken = {}, featureFlags, membership, operatorProfile, room }) {
  if (
    decodedToken.admin === true
    && decodedToken.adminRole === 'owner'
  ) {
    return { authority: 'platform-owner', canManage: true };
  }
  if (
    decodedToken.admin === true
    && decodedToken.adminRole === 'super-moderator'
    && featureFlags?.voice_room_super_moderation === true
    && operatorProfile?.role === 'super-moderator'
    && operatorProfile?.status === 'active'
  ) {
    const regionCodes = Array.isArray(operatorProfile.regionCodes)
      ? operatorProfile.regionCodes.filter((value) => typeof value === 'string')
      : [];
    if (operatorProfile.allRegions === true || regionCodes.includes(room?.countryCode)) {
      return { authority: 'super-moderator', canManage: true };
    }
  }
  if (!isActiveMembership(membership)) return { authority: null, canManage: false };
  if (membership.authorityRole === 'owner' || membership.role === 'host') {
    return { authority: 'owner', canManage: true };
  }
  if (membership.authorityRole === 'moderator') {
    return { authority: 'moderator', canManage: true };
  }
  return { authority: 'member', canManage: false };
}

function resolveSendMessage({
  authority,
  featureFlags,
  isFollowerOfOwner,
  membership,
  nowMs,
  profile,
  publicProfile,
  rate,
  room,
  text,
}) {
  if (featureFlags?.voice_room_chat !== true) {
    return roomChatError('FEATURE_DISABLED', 403, 'Room chat is not enabled.');
  }
  if (publicProfile?.moderationStatus !== 'active' || !profile || !isActiveMembership(membership)) {
    return roomChatError('ACCOUNT_RESTRICTED', 403, 'This account cannot send room messages.');
  }
  if (!room || room.status !== 'active' || room.availability === 'removed') {
    return roomChatError('ROOM_NOT_ACTIVE', 409, 'This room is not active.');
  }
  if (!text) return roomChatError('MESSAGE_EMPTY', 400, 'Message text is required.');
  if (room.chatMode === 'off' && authority !== 'owner' && authority !== 'moderator') {
    return roomChatError('CHAT_DISABLED', 403, 'Chat is disabled in this room.');
  }
  if (
    room.chatMode === 'followers'
    && authority !== 'owner'
    && authority !== 'moderator'
    && !isFollowerOfOwner
  ) {
    return roomChatError('CHAT_FOLLOWERS_ONLY', 403, 'Only the owner’s followers can chat in this room.');
  }
  const rateResult = resolveChatRateLimit({
    nowMs,
    rate,
    slowModeSeconds: Number(room.slowModeSeconds || 0),
  });
  if (!rateResult.ok) return rateResult;
  return {
    ok: true,
    value: {
      nextRate: rateResult.value,
      senderAvatarLabel: typeof publicProfile.avatarLabel === 'string' ? publicProfile.avatarLabel : '',
      senderAvatarFrame: readPublicAvatarFrameProjection(publicProfile),
      senderDisplayName: typeof publicProfile.displayName === 'string'
        ? publicProfile.displayName.slice(0, 32)
        : '',
    },
  };
}

function resolveChatRateLimit({ nowMs, rate, slowModeSeconds }) {
  const safeNow = Number.isFinite(nowMs) ? nowMs : Date.now();
  const lastSentAtMs = timestampToMillis(rate?.lastSentAt);
  const boundedSlowMode = [0, 5, 10, 30, 60].includes(slowModeSeconds) ? slowModeSeconds : 0;
  const nextAllowedAtMs = lastSentAtMs === undefined
    ? safeNow
    : lastSentAtMs + (boundedSlowMode * 1_000);
  if (nextAllowedAtMs > safeNow) {
    return roomChatError(
      'SLOW_MODE_ACTIVE',
      429,
      'Wait before sending another message.',
      { retryAfterMs: nextAllowedAtMs - safeNow },
    );
  }

  const windowStartedAtMs = timestampToMillis(rate?.windowStartedAt);
  const sameWindow = windowStartedAtMs !== undefined && safeNow - windowStartedAtMs < 10_000;
  const messageCount = sameWindow ? Number(rate?.messageCount || 0) : 0;
  if (messageCount >= 5) {
    return roomChatError(
      'RATE_LIMITED',
      429,
      'Too many messages were sent.',
      { retryAfterMs: Math.max(1, (windowStartedAtMs + 10_000) - safeNow) },
    );
  }
  return {
    ok: true,
    value: {
      lastSentAtMs: safeNow,
      messageCount: messageCount + 1,
      windowStartedAtMs: sameWindow ? windowStartedAtMs : safeNow,
    },
  };
}

function filterChatText(text, mode, configuredTerms) {
  if (mode === 'off') return { ok: true, value: text };
  const terms = normalizeKeywordTerms(configuredTerms);
  const matchedTerm = terms.find((term) => text.toLocaleLowerCase('ar').includes(term));
  if (!matchedTerm) return { ok: true, value: text };
  return roomChatError('CONTENT_FILTERED', 422, 'The message contains blocked content.');
}

function normalizeKeywordTerms(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .slice(0, MAX_KEYWORD_TERMS)
    .map((term) => normalizeChatText(term).toLocaleLowerCase('ar'))
    .filter((term) => term.length >= 2 && term.length <= 40))];
}

function buildRoomChatFingerprint(actorUid, command) {
  return [
    actorUid,
    command.roomId,
    command.action,
    command.messageId,
    command.targetUid,
    command.subjectType,
    command.category,
    command.mediaId,
    command.giftEventId,
    command.replyToMessageId,
    command.text,
    command.details,
  ].join('|');
}

function normalizeChatText(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHAT_TEXT_LENGTH + 1);
}

function cleanMultilineText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function stringValue(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function validDocumentId(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 160 && !value.includes('/');
}

function validUid(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && !value.includes('/');
}

function isActiveMembership(value) {
  return !!value
    && value.status !== 'removed'
    && typeof value.uid === 'string'
    && value.uid.length > 0;
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function timestampToMillis(value) {
  if (Number.isFinite(value)) return Number(value);
  if (!isRecord(value)) return undefined;
  if (typeof value.toMillis === 'function') {
    const millis = value.toMillis.call(value);
    return Number.isFinite(millis) ? millis : undefined;
  }
  return Number.isFinite(value.seconds)
    ? (value.seconds * 1_000) + Math.floor((Number(value.nanoseconds || 0)) / 1_000_000)
    : undefined;
}

function roomChatError(code, status, error, details = undefined) {
  return { ok: false, code, status, error, ...(details ? { details } : {}) };
}

module.exports = {
  CHAT_REQUEST_ID_PATTERN,
  MAX_CHAT_TEXT_LENGTH,
  ROOM_CHAT_ACTIONS,
  ROOM_REPORT_CATEGORIES,
  ROOM_REPORT_SUBJECT_TYPES,
  buildRoomChatFingerprint,
  filterChatText,
  isActiveMembership,
  normalizeChatText,
  normalizeKeywordTerms,
  normalizeRoomChatBody,
  resolveChatRateLimit,
  resolveRoomChatAuthority,
  resolveSendMessage,
  roomChatError,
  validateRoomChatRequest,
};
