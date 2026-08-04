import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  decodeInboxCursor,
  decodeThreadCursor,
  encodeInboxCursor,
  encodeThreadCursor,
} = require('./directChatPaginationCore');
const { createDirectConversationId } = require('./directChatCore');

describe('directChatPaginationCore', () => {
  it('round-trips bounded opaque inbox and thread cursors', () => {
    const conversationId = createDirectConversationId('user-1', 'user-2');
    const inbox = encodeInboxCursor({ conversationId, ownerUid: 'user-1', updatedAtMs: 1_234 });
    expect(inbox).toMatch(/^[A-Za-z0-9_-]{16,512}$/);
    expect(decodeInboxCursor(inbox, 'user-1')).toEqual({ conversationId, updatedAtMs: 1_234 });
    const thread = encodeThreadCursor({ conversationId, messageId: 'dmm_message_000001', sequence: 42 });
    expect(decodeThreadCursor(thread, conversationId)).toEqual({ messageId: 'dmm_message_000001', sequence: 42 });
  });

  it('rejects cross-scope, malformed, and tampered cursors', () => {
    const conversationId = createDirectConversationId('user-1', 'user-2');
    const otherConversationId = createDirectConversationId('user-1', 'user-3');
    const cursor = encodeInboxCursor({ conversationId, ownerUid: 'user-1', updatedAtMs: 1_234 });
    expect(decodeInboxCursor(cursor, 'user-2')).toBeUndefined();
    expect(decodeInboxCursor(`${cursor.slice(0, -1)}A`, 'user-1')).toBeUndefined();
    expect(decodeInboxCursor('not-a-valid-cursor', 'user-1')).toBeUndefined();
    const thread = encodeThreadCursor({ conversationId, messageId: 'dmm_message_000001', sequence: 42 });
    expect(decodeThreadCursor(thread, otherConversationId)).toBeUndefined();
  });
});
