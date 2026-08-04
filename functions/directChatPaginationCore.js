const crypto = require('node:crypto');

const DIRECT_CHAT_CURSOR_VERSION = 1;
const DIRECT_CHAT_CURSOR_MAX_LENGTH = 512;

function encodeInboxCursor({ conversationId, ownerUid, updatedAtMs }) {
  if (!isConversationId(conversationId) || !validUid(ownerUid) || !Number.isFinite(updatedAtMs)) return '';
  return encodeCursor({
    conversationId,
    scope: hashScope(`inbox\u0000${ownerUid}`),
    type: 'inbox',
    updatedAtMs: Math.floor(updatedAtMs),
    version: DIRECT_CHAT_CURSOR_VERSION,
  });
}

function decodeInboxCursor(value, ownerUid) {
  const payload = decodeCursor(value);
  if (
    !payload
    || payload.type !== 'inbox'
    || payload.scope !== hashScope(`inbox\u0000${ownerUid}`)
    || !isConversationId(payload.conversationId)
    || !Number.isSafeInteger(payload.updatedAtMs)
    || payload.updatedAtMs < 0
  ) return undefined;
  return { conversationId: payload.conversationId, updatedAtMs: payload.updatedAtMs };
}

function encodeThreadCursor({ conversationId, messageId, sequence }) {
  if (!isConversationId(conversationId) || !validMessageId(messageId) || !Number.isSafeInteger(sequence) || sequence < 1) return '';
  return encodeCursor({
    messageId,
    scope: hashScope(`thread\u0000${conversationId}`),
    sequence,
    type: 'thread',
    version: DIRECT_CHAT_CURSOR_VERSION,
  });
}

function decodeThreadCursor(value, conversationId) {
  const payload = decodeCursor(value);
  if (
    !payload
    || payload.type !== 'thread'
    || payload.scope !== hashScope(`thread\u0000${conversationId}`)
    || !validMessageId(payload.messageId)
    || !Number.isSafeInteger(payload.sequence)
    || payload.sequence < 1
  ) return undefined;
  return { messageId: payload.messageId, sequence: payload.sequence };
}

function encodeCursor(payload) {
  const serialized = stableStringify(payload);
  const signature = sign(serialized);
  return Buffer.from(stableStringify({ payload, signature }), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > DIRECT_CHAT_CURSOR_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return undefined;
  }
  try {
    const envelope = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!isPlainObject(envelope) || !isPlainObject(envelope.payload) || typeof envelope.signature !== 'string') return undefined;
    if (envelope.payload.version !== DIRECT_CHAT_CURSOR_VERSION) return undefined;
    const serialized = stableStringify(envelope.payload);
    const expected = sign(serialized);
    const left = Buffer.from(envelope.signature, 'utf8');
    const right = Buffer.from(expected, 'utf8');
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return undefined;
    return envelope.payload;
  } catch {
    return undefined;
  }
}

function sign(value) {
  return crypto.createHash('sha256').update(`direct-chat-cursor-v1\u0000${value}`).digest('base64url').slice(0, 22);
}

function hashScope(value) {
  return crypto.createHash('sha256').update(value).digest('base64url').slice(0, 22);
}

function timestampToMillis(value) {
  if (Number.isFinite(value)) return Number(value);
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && Number.isFinite(value.seconds)) return (value.seconds * 1_000) + Math.floor(Number(value.nanoseconds || 0) / 1_000_000);
  return Number.NaN;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function isConversationId(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validMessageId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{11,159}$/.test(value);
}

function validUid(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && !value.includes('/');
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

module.exports = {
  DIRECT_CHAT_CURSOR_MAX_LENGTH,
  DIRECT_CHAT_CURSOR_VERSION,
  decodeInboxCursor,
  decodeThreadCursor,
  encodeInboxCursor,
  encodeThreadCursor,
  timestampToMillis,
};
