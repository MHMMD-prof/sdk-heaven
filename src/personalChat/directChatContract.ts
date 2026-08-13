import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';

export const DIRECT_CHAT_SCHEMA_VERSION = 1 as const;
export const DIRECT_CHAT_COMMAND_VERSION = 1 as const;
export const DIRECT_CHAT_DEFAULT_INBOX_LIMIT = 30;
export const DIRECT_CHAT_DEFAULT_THREAD_LIMIT = 40;
export const DIRECT_CHAT_MAX_PAGE_LIMIT = 50;
export const DIRECT_CHAT_MAX_TEXT_LENGTH = 2_000;
export const DIRECT_CHAT_MAX_REPORT_DETAILS_LENGTH = 500;
export const DIRECT_CHAT_MAX_REPORT_MESSAGES = 10;
export const DIRECT_CHAT_MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const DIRECT_CHAT_MAX_VOICE_BYTES = 5 * 1024 * 1024;

export const DIRECT_CHAT_ACTIONS = [
  'get-direct-chat-inbox',
  'get-direct-chat-thread',
  'get-direct-chat-status',
  'send-direct-message',
  'send-message-request',
  'accept-message-request',
  'reject-message-request',
  'unsend-direct-message',
  'delete-conversation-for-me',
  'mark-direct-chat-read',
  'set-direct-chat-mute',
  'set-direct-chat-archive',
  'create-direct-chat-upload',
  'finalize-direct-chat-upload',
  'report-direct-chat',
] as const;

export const DIRECT_CHAT_MESSAGE_KINDS = [
  'text',
  'emoji',
  'image',
  'voice-note',
  'sticker',
] as const;

export const DIRECT_CHAT_REPORT_CATEGORIES = [
  'harassment',
  'hate',
  'sexual-content',
  'threat',
  'underage',
  'spam',
  'scam',
  'personal-information',
  'impersonation',
  'other',
] as const;

export type DirectChatAction = typeof DIRECT_CHAT_ACTIONS[number];
export type DirectChatMessageKind = typeof DIRECT_CHAT_MESSAGE_KINDS[number];
export type DirectChatReportCategory = typeof DIRECT_CHAT_REPORT_CATEGORIES[number];

export const DIRECT_CHAT_ERRORS = {
  ACCOUNT_RESTRICTED: safeError(403, 'This account cannot use personal chat.', 'لا يمكن لهذا الحساب استخدام المحادثات الشخصية.'),
  AUTH_REQUIRED: safeError(401, 'Authentication is required.', 'يجب تسجيل الدخول للمتابعة.'),
  BLOCKED: safeError(403, 'Personal chat is unavailable for this user.', 'المحادثة الشخصية غير متاحة مع هذا المستخدم.'),
  CONTENT_FILTERED: safeError(422, 'The message contains blocked content.', 'تحتوي الرسالة على محتوى غير مسموح.'),
  CURSOR_INVALID: safeError(400, 'The page cursor is invalid or expired.', 'مؤشر الصفحة غير صالح أو منتهي.'),
  EMAIL_VERIFICATION_REQUIRED: safeError(403, 'Email verification is required.', 'يجب تأكيد البريد الإلكتروني للمتابعة.'),
  EVIDENCE_UNAVAILABLE: safeError(422, 'The selected messages are unavailable.', 'الرسائل المحددة غير متاحة للإبلاغ.'),
  FEATURE_DISABLED: safeError(503, 'Personal chat is not available.', 'المحادثات الشخصية غير متاحة حالياً.'),
  INTERNAL: safeError(500, 'The personal chat request failed.', 'تعذر تنفيذ طلب المحادثة. حاول مرة أخرى.'),
  INVALID_REQUEST: safeError(400, 'The personal chat request is invalid.', 'طلب المحادثة الشخصية غير صالح.'),
  MEDIA_DISABLED: safeError(503, 'Personal chat media is not available.', 'وسائط المحادثة الشخصية غير متاحة حالياً.'),
  MEDIA_REJECTED: safeError(422, 'The attachment could not be approved.', 'تعذر اعتماد المرفق.'),
  MESSAGE_EMPTY: safeError(400, 'A message is required.', 'يجب كتابة رسالة.'),
  MESSAGE_TOO_LONG: safeError(400, 'The message is too long.', 'الرسالة أطول من الحد المسموح.'),
  MESSAGE_UNAVAILABLE: safeError(404, 'The message is unavailable.', 'الرسالة غير متاحة.'),
  NOT_FOUND: safeError(404, 'The conversation is unavailable.', 'المحادثة غير متاحة.'),
  NOT_FRIEND: safeError(403, 'A message request is required.', 'يجب إرسال طلب مراسلة أولاً.'),
  PERMISSION_DENIED: safeError(403, 'This action is not permitted.', 'لا تملك صلاحية تنفيذ هذا الإجراء.'),
  PROFILE_INCOMPLETE: safeError(409, 'A complete profile is required.', 'يجب إكمال الملف الشخصي أولاً.'),
  RATE_LIMITED: safeError(429, 'Too many personal chat requests were made.', 'تم إرسال طلبات كثيرة. حاول لاحقاً.'),
  READ_SEQUENCE_INVALID: safeError(409, 'The read position is invalid.', 'موضع القراءة غير صالح.'),
  REQUEST_CONFLICT: safeError(409, 'This request ID was used for another operation.', 'تم استخدام معرف الطلب لعملية أخرى.'),
  REQUEST_COOLDOWN: safeError(429, 'A new message request cannot be sent yet.', 'لا يمكن إرسال طلب مراسلة جديد الآن.'),
  REQUEST_EXPIRED: safeError(409, 'The message request expired.', 'انتهت صلاحية طلب المراسلة.'),
  REQUEST_PENDING: safeError(409, 'A message request is already pending.', 'يوجد طلب مراسلة قيد الانتظار بالفعل.'),
  REQUESTS_DISABLED: safeError(503, 'New message requests are not available.', 'طلبات المراسلة الجديدة غير متاحة حالياً.'),
  REPLY_TARGET_UNAVAILABLE: safeError(409, 'The reply target is unavailable.', 'الرسالة التي تحاول الرد عليها غير متاحة.'),
  STICKER_UNAVAILABLE: safeError(409, 'This sticker is unavailable.', 'هذا الملصق غير متاح.'),
  UNSEND_WINDOW_EXPIRED: safeError(409, 'The unsend window expired.', 'انتهت مدة التراجع عن الإرسال.'),
  UPLOAD_INVALID: safeError(400, 'The attachment upload is invalid.', 'تحميل المرفق غير صالح.'),
} as const;

export type DirectChatErrorCode = keyof typeof DIRECT_CHAT_ERRORS;
export type DirectChatCommand = {
  action: DirectChatAction;
  payload: Record<string, unknown>;
  requestId: string;
  version: 1;
};
export type DirectChatValidationResult =
  | { ok: true; value: DirectChatCommand }
  | ({ code: DirectChatErrorCode; ok: false } & typeof DIRECT_CHAT_ERRORS[DirectChatErrorCode]);

export type DirectChatFeatureFlags = {
  directMessageMedia: boolean;
  directMessageRequests: boolean;
  directMessages: boolean;
};

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{12,80}$/;
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{11,159}$/;
const STORE_ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{16,512}$/;

export function normalizeDirectChatCommand(input: unknown, requestingUid = ''): DirectChatValidationResult {
  if (!isRecord(input) || hasUnknownKeys(input, ['action', 'payload', 'requestId', 'version'])) {
    return directChatError('INVALID_REQUEST');
  }
  const action = readString(input.action, 64);
  const requestId = readString(input.requestId, 80);
  if (
    input.version !== DIRECT_CHAT_COMMAND_VERSION
    || !isDirectChatAction(action)
    || !REQUEST_ID_PATTERN.test(requestId)
  ) return directChatError('INVALID_REQUEST');
  const payload = normalizeActionPayload(action, input.payload, requestingUid);
  if (!payload.ok) return payload;
  return {
    ok: true,
    value: {
      action,
      payload: payload.value,
      requestId,
      version: DIRECT_CHAT_COMMAND_VERSION,
    },
  };
}

type PayloadResult =
  | { ok: true; value: Record<string, unknown> }
  | ReturnType<typeof directChatError>;

function normalizeActionPayload(action: DirectChatAction, rawPayload: unknown, requestingUid: string): PayloadResult {
  const payload = rawPayload === undefined ? {} : rawPayload;
  if (!isRecord(payload)) return directChatError('INVALID_REQUEST');
  if (action === 'get-direct-chat-inbox') return normalizePagePayload(payload, []);
  if (action === 'get-direct-chat-thread') return normalizePagePayload(payload, ['targetUid'], requestingUid);
  if (action === 'get-direct-chat-status') return normalizeTargetPayload(payload, requestingUid);
  if (action === 'send-direct-message') return normalizeSendPayload(payload, requestingUid);
  if (action === 'send-message-request') return normalizeMessageRequestPayload(payload, requestingUid);
  if (['accept-message-request', 'reject-message-request', 'delete-conversation-for-me'].includes(action)) {
    return normalizeTargetPayload(payload, requestingUid);
  }
  if (action === 'unsend-direct-message') {
    if (hasUnknownKeys(payload, ['messageId', 'targetUid'])) return directChatError('INVALID_REQUEST');
    const targetUid = normalizeTarget(payload.targetUid, requestingUid);
    const messageId = readString(payload.messageId, 160);
    return targetUid && DOCUMENT_ID_PATTERN.test(messageId)
      ? { ok: true, value: { messageId, targetUid } }
      : directChatError('INVALID_REQUEST');
  }
  if (action === 'mark-direct-chat-read') {
    if (hasUnknownKeys(payload, ['targetUid', 'throughSequence'])) return directChatError('INVALID_REQUEST');
    const targetUid = normalizeTarget(payload.targetUid, requestingUid);
    return targetUid && Number.isSafeInteger(payload.throughSequence) && Number(payload.throughSequence) >= 0
      ? { ok: true, value: { targetUid, throughSequence: payload.throughSequence } }
      : directChatError('INVALID_REQUEST');
  }
  if (action === 'set-direct-chat-mute') {
    if (hasUnknownKeys(payload, ['muted', 'targetUid'])) return directChatError('INVALID_REQUEST');
    const targetUid = normalizeTarget(payload.targetUid, requestingUid);
    return targetUid && typeof payload.muted === 'boolean'
      ? { ok: true, value: { muted: payload.muted, targetUid } }
      : directChatError('INVALID_REQUEST');
  }
  if (action === 'set-direct-chat-archive') {
    if (hasUnknownKeys(payload, ['archived', 'targetUid'])) return directChatError('INVALID_REQUEST');
    const targetUid = normalizeTarget(payload.targetUid, requestingUid);
    return targetUid && typeof payload.archived === 'boolean'
      ? { ok: true, value: { archived: payload.archived, targetUid } }
      : directChatError('INVALID_REQUEST');
  }
  if (action === 'create-direct-chat-upload') return normalizeUploadPayload(payload, requestingUid);
  if (action === 'finalize-direct-chat-upload') return normalizeFinalizePayload(payload, requestingUid);
  if (action === 'report-direct-chat') return normalizeReportPayload(payload, requestingUid);
  return directChatError('INVALID_REQUEST');
}

function normalizePagePayload(payload: Record<string, unknown>, requiredKeys: string[], requestingUid = ''): PayloadResult {
  const allowed = [...requiredKeys, 'cursor', 'limit'];
  if (hasUnknownKeys(payload, allowed)) return directChatError('INVALID_REQUEST');
  const value: Record<string, unknown> = {};
  if (requiredKeys.includes('targetUid')) {
    const targetUid = normalizeTarget(payload.targetUid, requestingUid);
    if (!targetUid) return directChatError('INVALID_REQUEST');
    value.targetUid = targetUid;
  }
  if (payload.cursor !== undefined) {
    const cursor = readString(payload.cursor, 512);
    if (!CURSOR_PATTERN.test(cursor)) return directChatError('INVALID_REQUEST');
    value.cursor = cursor;
  }
  const defaultLimit = requiredKeys.includes('targetUid')
    ? DIRECT_CHAT_DEFAULT_THREAD_LIMIT
    : DIRECT_CHAT_DEFAULT_INBOX_LIMIT;
  const limit = payload.limit === undefined ? defaultLimit : payload.limit;
  if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > DIRECT_CHAT_MAX_PAGE_LIMIT) {
    return directChatError('INVALID_REQUEST');
  }
  value.limit = limit;
  return { ok: true, value };
}

function normalizeTargetPayload(payload: Record<string, unknown>, requestingUid: string): PayloadResult {
  if (hasUnknownKeys(payload, ['targetUid'])) return directChatError('INVALID_REQUEST');
  const targetUid = normalizeTarget(payload.targetUid, requestingUid);
  return targetUid ? { ok: true, value: { targetUid } } : directChatError('INVALID_REQUEST');
}

function normalizeMessageRequestPayload(payload: Record<string, unknown>, requestingUid: string): PayloadResult {
  if (hasUnknownKeys(payload, ['targetUid', 'text'])) return directChatError('INVALID_REQUEST');
  const targetUid = normalizeTarget(payload.targetUid, requestingUid);
  const text = normalizeDirectChatText(payload.text);
  if (!targetUid) return directChatError('INVALID_REQUEST');
  if (!text) return directChatError('MESSAGE_EMPTY');
  if (unicodeLength(text) > DIRECT_CHAT_MAX_TEXT_LENGTH) return directChatError('MESSAGE_TOO_LONG');
  return { ok: true, value: { targetUid, text } };
}

function normalizeSendPayload(payload: Record<string, unknown>, requestingUid: string): PayloadResult {
  if (hasUnknownKeys(payload, [
    'attachmentId',
    'kind',
    'replyToMessageId',
    'stickerItemId',
    'targetUid',
    'text',
  ])) return directChatError('INVALID_REQUEST');
  const targetUid = normalizeTarget(payload.targetUid, requestingUid);
  const kind = readString(payload.kind, 24);
  const text = normalizeDirectChatText(payload.text);
  const attachmentId = readString(payload.attachmentId, 160);
  const stickerItemId = readString(payload.stickerItemId, 80);
  const replyToMessageId = readString(payload.replyToMessageId, 160);
  if (!targetUid || !isDirectChatMessageKind(kind)) return directChatError('INVALID_REQUEST');
  if (replyToMessageId && !DOCUMENT_ID_PATTERN.test(replyToMessageId)) return directChatError('INVALID_REQUEST');
  const value: Record<string, unknown> = {
    kind,
    ...(replyToMessageId ? { replyToMessageId } : {}),
    targetUid,
  };
  if (['text', 'emoji'].includes(kind)) {
    if (!text) return directChatError('MESSAGE_EMPTY');
    if (unicodeLength(text) > DIRECT_CHAT_MAX_TEXT_LENGTH) return directChatError('MESSAGE_TOO_LONG');
    if (attachmentId || stickerItemId) return directChatError('INVALID_REQUEST');
    return { ok: true, value: { ...value, text } };
  }
  if (kind === 'sticker') {
    if (!STORE_ITEM_ID_PATTERN.test(stickerItemId) || text || attachmentId) return directChatError('INVALID_REQUEST');
    return { ok: true, value: { ...value, stickerItemId } };
  }
  if (!DOCUMENT_ID_PATTERN.test(attachmentId) || text || stickerItemId) return directChatError('INVALID_REQUEST');
  return { ok: true, value: { ...value, attachmentId } };
}

function normalizeUploadPayload(payload: Record<string, unknown>, requestingUid: string): PayloadResult {
  if (hasUnknownKeys(payload, ['contentType', 'kind', 'sizeBytes', 'targetUid'])) {
    return directChatError('INVALID_REQUEST');
  }
  const targetUid = normalizeTarget(payload.targetUid, requestingUid);
  const kind = readString(payload.kind, 24);
  const contentType = readString(payload.contentType, 80).toLowerCase();
  const sizeBytes = payload.sizeBytes;
  if (!targetUid || !['image', 'voice-note'].includes(kind) || !Number.isSafeInteger(sizeBytes) || Number(sizeBytes) < 1) {
    return directChatError('INVALID_REQUEST');
  }
  const validImage = kind === 'image'
    && ['image/jpeg', 'image/png', 'image/webp'].includes(contentType)
    && Number(sizeBytes) <= DIRECT_CHAT_MAX_IMAGE_BYTES;
  const validVoice = kind === 'voice-note'
    && ['audio/aac', 'audio/mp4', 'audio/x-m4a'].includes(contentType)
    && Number(sizeBytes) <= DIRECT_CHAT_MAX_VOICE_BYTES;
  return validImage || validVoice
    ? { ok: true, value: { contentType, kind, sizeBytes, targetUid } }
    : directChatError('UPLOAD_INVALID');
}

function normalizeFinalizePayload(payload: Record<string, unknown>, requestingUid: string): PayloadResult {
  if (hasUnknownKeys(payload, ['replyToMessageId', 'targetUid', 'uploadId'])) {
    return directChatError('INVALID_REQUEST');
  }
  const targetUid = normalizeTarget(payload.targetUid, requestingUid);
  const uploadId = readString(payload.uploadId, 160);
  const replyToMessageId = readString(payload.replyToMessageId, 160);
  if (!targetUid || !DOCUMENT_ID_PATTERN.test(uploadId) || (replyToMessageId && !DOCUMENT_ID_PATTERN.test(replyToMessageId))) {
    return directChatError('INVALID_REQUEST');
  }
  return {
    ok: true,
    value: {
      ...(replyToMessageId ? { replyToMessageId } : {}),
      targetUid,
      uploadId,
    },
  };
}

function normalizeReportPayload(payload: Record<string, unknown>, requestingUid: string): PayloadResult {
  if (hasUnknownKeys(payload, ['category', 'details', 'messageIds', 'targetUid'])) {
    return directChatError('INVALID_REQUEST');
  }
  const targetUid = normalizeTarget(payload.targetUid, requestingUid);
  const category = readString(payload.category, 64);
  const details = normalizeDirectChatText(payload.details);
  const messageIds = Array.isArray(payload.messageIds)
    ? [...new Set(payload.messageIds.map((value) => readString(value, 160)))]
    : [];
  if (
    !targetUid
    || !isDirectChatReportCategory(category)
    || messageIds.length < 1
    || messageIds.length > DIRECT_CHAT_MAX_REPORT_MESSAGES
    || messageIds.some((value) => !DOCUMENT_ID_PATTERN.test(value))
    || unicodeLength(details) > DIRECT_CHAT_MAX_REPORT_DETAILS_LENGTH
  ) return directChatError('INVALID_REQUEST');
  return {
    ok: true,
    value: {
      category,
      ...(details ? { details } : {}),
      messageIds,
      targetUid,
    },
  };
}

export function normalizeDirectChatText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\uFFFD/g, '')
    // Drop unpaired surrogates; keep valid surrogate pairs (emoji) intact.
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (match) => (match.length === 2 ? match : ''))
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function createDirectConversationId(firstUid: string, secondUid: string): Promise<string> {
  const members = normalizePair(firstUid, secondUid);
  return members
    ? digestStringAsync(CryptoDigestAlgorithm.SHA256, `direct-chat-v1\u0000${members[0]}\u0000${members[1]}`)
    : '';
}

export async function createDirectMessageId({
  conversationId,
  requestId,
  senderUid,
}: {
  conversationId: string;
  requestId: string;
  senderUid: string;
}): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(conversationId) || !REQUEST_ID_PATTERN.test(requestId) || !validUid(senderUid)) return '';
  const hash = await digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    `direct-message-v1\u0000${conversationId}\u0000${senderUid}\u0000${requestId}`,
  );
  return `dmm_${hash.slice(0, 40)}`;
}

export async function createDirectChatReportId({
  conversationId,
  reporterUid,
  requestId,
}: {
  conversationId: string;
  reporterUid: string;
  requestId: string;
}): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(conversationId) || !REQUEST_ID_PATTERN.test(requestId) || !validUid(reporterUid)) return '';
  const hash = await digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    `direct-report-v1\u0000${conversationId}\u0000${reporterUid}\u0000${requestId}`,
  );
  return `dmr_${hash.slice(0, 40)}`;
}

export const disabledDirectChatFeatureFlags: DirectChatFeatureFlags = Object.freeze({
  directMessageMedia: false,
  directMessageRequests: false,
  directMessages: false,
});

export function mapDirectChatFeatureFlags(value: unknown): DirectChatFeatureFlags {
  const input = isRecord(value) ? value : {};
  return {
    directMessageMedia: input.directMessageMedia === true,
    directMessageRequests: input.directMessageRequests === true,
    directMessages: input.directMessages === true,
  };
}

function directChatError(code: DirectChatErrorCode) {
  return { code, ok: false as const, ...DIRECT_CHAT_ERRORS[code] };
}

function safeError(status: number, error: string, messageAr: string) {
  return Object.freeze({ error, messageAr, status });
}

function normalizePair(firstUid: string, secondUid: string): [string, string] | undefined {
  if (!validUid(firstUid) || !validUid(secondUid) || firstUid === secondUid) return undefined;
  return [firstUid, secondUid].sort() as [string, string];
}

function normalizeTarget(value: unknown, requestingUid: string) {
  const targetUid = readString(value, 128);
  return validUid(targetUid) && (!requestingUid || targetUid !== requestingUid) ? targetUid : '';
}

function validUid(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && !value.includes('/');
}

function isDirectChatAction(value: string): value is DirectChatAction {
  return (DIRECT_CHAT_ACTIONS as readonly string[]).includes(value);
}

function isDirectChatMessageKind(value: string): value is DirectChatMessageKind {
  return (DIRECT_CHAT_MESSAGE_KINDS as readonly string[]).includes(value);
}

function isDirectChatReportCategory(value: string): value is DirectChatReportCategory {
  return (DIRECT_CHAT_REPORT_CATEGORIES as readonly string[]).includes(value);
}

function readString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized.length <= maxLength ? normalized : '';
}

function unicodeLength(value: string) {
  return [...value].length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasUnknownKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).some((key) => !allowed.includes(key));
}
