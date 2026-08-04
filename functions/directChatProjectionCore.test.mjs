import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildDirectChatProjection,
  mapDirectChatMessage,
  resolveDirectChatMarkRead,
  resolveDirectChatProjectionDrift,
} = require('./directChatProjectionCore');

const conversation = {
  conversationId: 'a'.repeat(64),
  lastMessageId: 'dmm_message_000001',
  lastMessageKind: 'text',
  lastMessagePreview: 'Hello',
  lastMessageSenderUid: 'user-2',
  lastSequence: 8,
  requestState: 'accepted',
};

describe('directChatProjectionCore', () => {
  it('preserves preferences and advances unread counts without restoring cleared history', () => {
    expect(buildDirectChatProjection({
      conversation,
      existing: { archived: true, clearedThroughSequence: 5, lastReadSequence: 4, muted: true, unreadCount: 2 },
      now: 100,
      ownerUid: 'user-1',
      peerUid: 'user-2',
      unreadIncrement: 1,
    })).toMatchObject({
      archived: false,
      clearedThroughSequence: 5,
      lastReadSequence: 4,
      muted: true,
      unreadCount: 3,
    });
  });

  it('allows stale multi-device acknowledgements but only advances to the committed tail', () => {
    expect(resolveDirectChatMarkRead({ conversation, projection: { lastReadSequence: 8, unreadCount: 0 }, throughSequence: 6 }))
      .toMatchObject({ ok: true, value: { changed: false, lastReadSequence: 8 } });
    expect(resolveDirectChatMarkRead({ conversation, projection: { lastReadSequence: 4, unreadCount: 4 }, throughSequence: 6 }))
      .toMatchObject({ code: 'READ_SEQUENCE_INVALID' });
    expect(resolveDirectChatMarkRead({ conversation, projection: { lastReadSequence: 4, unreadCount: 4 }, throughSequence: 8 }))
      .toEqual({ ok: true, value: { changed: true, lastReadSequence: 8, unreadCount: 0 } });
  });

  it('maps unsent messages without returning removed text', () => {
    expect(mapDirectChatMessage({
      conversationId: conversation.conversationId,
      createdAt: 100,
      id: 'dmm_message_000001',
      kind: 'text',
      senderUid: 'user-2',
      sequence: 8,
      text: 'secret',
      visibilityState: 'unsent',
    })).toMatchObject({ text: '', visibilityState: 'unsent' });
  });

  it('reports exact projection drift fields', () => {
    const projection = buildDirectChatProjection({ conversation, now: 100, ownerUid: 'user-1', peerUid: 'user-2' });
    expect(resolveDirectChatProjectionDrift({ conversation, projection })).toEqual({ drifted: false, reasons: [] });
    expect(resolveDirectChatProjectionDrift({ conversation, projection: { ...projection, lastSequence: 7 } }))
      .toEqual({ drifted: true, reasons: ['lastSequence'] });
  });
});
