import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { mergeDirectChatInboxItems } from '../directChatInboxState';
import { resolveDirectChatPresence, type DirectChatRealtimeProjection } from '../directChatRealtime';

const source = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

function projection(conversationId: string, updatedAtMs: number): DirectChatRealtimeProjection {
  return {
    archived: false,
    clearedThroughSequence: 0,
    conversationId,
    lastMessageId: `message-${conversationId}`,
    lastMessageKind: 'text',
    lastMessagePreview: conversationId,
    lastMessageSenderUid: 'peer',
    lastReadSequence: 0,
    lastSequence: 1,
    muted: false,
    ownerUid: 'self',
    peerUid: `peer-${conversationId}`,
    recipientUid: 'self',
    requestState: 'accepted',
    requesterUid: 'peer',
    retentionPurgedThroughSequence: 0,
    unreadCount: 1,
    updatedAtMs,
  };
}

describe('personal chat logic audit regressions', () => {
  it('removes conversations that leave the realtime head while preserving explicitly paged rows', () => {
    const current = [projection('dropped', 30), projection('kept', 20), projection('paged', 10)];
    const incoming = [projection('kept', 40), projection('new', 35)];
    const merged = mergeDirectChatInboxItems({
      current,
      incoming,
      preserveConversationIds: new Set(['paged']),
      removeConversationIds: new Set(['dropped', 'kept', 'paged']),
    });
    expect(merged.map((item) => item.conversationId)).toEqual(['kept', 'new', 'paged']);
    expect(merged[0].updatedAtMs).toBe(40);
  });

  it('treats presence as active only for the correct peer, value, and unexpired lease', () => {
    const value = { expiresAt: 2_000, uid: 'peer', value: 'online' };
    expect(resolveDirectChatPresence(value, 'online', 'peer', 1_000)).toEqual({ active: true, expiresAtMs: 2_000 });
    expect(resolveDirectChatPresence(value, 'online', 'peer', 2_000).active).toBe(false);
    expect(resolveDirectChatPresence(value, 'online', 'other', 1_000).active).toBe(false);
    expect(resolveDirectChatPresence({ ...value, value: true }, 'typing', 'peer', 1_000).active).toBe(true);
  });

  it('remounts thread state when the recipient changes', () => {
    const screen = source('../../screens/DirectChatScreen.tsx');
    expect(screen).toContain('key={props.route.params.targetUid}');
  });

  it('renews online presence and expires remote presence locally', () => {
    const thread = source('../useDirectChatThread.ts');
    const realtime = source('../directChatRealtime.ts');
    expect(thread).toContain('setInterval(renewOnlinePresence, DIRECT_CHAT_ONLINE_PRESENCE_REFRESH_MS)');
    expect(thread).toContain('clearInterval(onlineHeartbeat)');
    expect(realtime).toContain('presence.expiresAtMs - Date.now() + 25');
    expect(realtime).toContain('a listener error is not evidence that every chat was read');
  });

  it('recovers the composer when private draft storage fails', () => {
    for (const relative of ['../../screens/DirectChatScreen.tsx', '../../screens/DirectChatScreenModernRoyal.tsx']) {
      const screen = source(relative);
      expect(screen).toContain("setDraft('');");
      expect(screen).toContain('setDraftReady(true);');
      expect(screen).toContain('writeDirectChatDraft(user.uid, thread.conversationId, draft).catch(() => undefined)');
      expect(screen).toContain('clearDirectChatDraft(user.uid, thread.conversationId).catch(() => undefined)');
    }
  });
});
