import { describe, expect, it } from 'vitest';

import { mapRealtimeMessage, mapRealtimeProjection } from '../directChatRealtime';

describe('directChatRealtime mappers', () => {
  it('maps only the owner projection and normalizes counters', () => {
    expect(mapRealtimeProjection({
      archived: false,
      conversationId: 'conversation',
      lastReadSequence: -1,
      ownerUid: 'user-1',
      peerUid: 'user-2',
      unreadCount: 2,
      updatedAt: { toMillis: () => 123 },
    }, 'user-1')).toMatchObject({ lastReadSequence: 0, unreadCount: 2, updatedAtMs: 123 });
    expect(mapRealtimeProjection({ conversationId: 'conversation', ownerUid: 'user-2', peerUid: 'user-1' }, 'user-1')).toBeUndefined();
  });

  it('never exposes removed text from an unsent realtime message', () => {
    expect(mapRealtimeMessage({
      createdAt: 100,
      kind: 'text',
      senderUid: 'user-2',
      sequence: 1,
      text: 'removed',
      visibilityState: 'unsent',
    }, 'message-1')).toMatchObject({ text: '', visibilityState: 'unsent' });
  });
});
