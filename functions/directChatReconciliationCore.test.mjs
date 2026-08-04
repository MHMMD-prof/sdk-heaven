import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { buildDirectChatReconciliation } = require('./directChatReconciliationCore');

const conversation = {
  conversationId: 'a'.repeat(64),
  lastMessageId: 'dmm_message_000010',
  lastMessageKind: 'text',
  lastMessagePreview: 'latest',
  lastMessageSenderUid: 'user-2',
  lastSequence: 10,
  memberUids: ['user-1', 'user-2'],
  requestState: 'accepted',
};
const latestMessage = {
  id: 'dmm_message_000010',
  kind: 'text',
  senderUid: 'user-2',
  sequence: 10,
  text: 'latest',
  visibilityState: 'visible',
};

describe('directChatReconciliationCore', () => {
  it('reports zero drift for balanced conversation projections', () => {
    const projections = {
      'user-1': projection('user-1', 'user-2', 2),
      'user-2': projection('user-2', 'user-1', 0),
    };
    const result = buildDirectChatReconciliation({ conversation, latestMessage, now: 100, projections, unreadCounts: { 'user-1': 2, 'user-2': 0 } });
    expect(result.report).toMatchObject({ drifted: false, reasons: [] });
  });

  it('builds deterministic repairs for sequence, preview, missing projection, and unread drift', () => {
    const result = buildDirectChatReconciliation({
      conversation: { ...conversation, lastMessagePreview: 'wrong', lastSequence: 9 },
      latestMessage,
      now: 100,
      projections: { 'user-1': { ...projection('user-1', 'user-2', 9), lastSequence: 9 } },
      unreadCounts: { 'user-1': 2, 'user-2': 0 },
    });
    expect(result.report.drifted).toBe(true);
    expect(result.report.reasons).toContain('conversation.lastMessagePreview');
    expect(result.report.reasons).toContain('conversation.lastSequence');
    expect(result.report.reasons).toContain('projection.user-2.projection-missing');
    expect(result.expectedConversation).toMatchObject({ lastMessagePreview: 'latest', lastSequence: 10 });
    expect(result.expectedProjections['user-1']).toMatchObject({ lastSequence: 10, unreadCount: 2 });
  });
});

function projection(ownerUid, peerUid, unreadCount) {
  return {
    archived: false,
    clearedThroughSequence: 0,
    conversationId: conversation.conversationId,
    lastMessageId: conversation.lastMessageId,
    lastMessageKind: conversation.lastMessageKind,
    lastMessagePreview: conversation.lastMessagePreview,
    lastMessageSenderUid: conversation.lastMessageSenderUid,
    lastReadSequence: ownerUid === 'user-2' ? 10 : 8,
    lastSequence: conversation.lastSequence,
    muted: false,
    ownerUid,
    peerUid,
    requestState: 'accepted',
    unreadCount,
    updatedAt: 100,
  };
}
