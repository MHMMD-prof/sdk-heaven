import { describe, expect, it } from 'vitest';

import type { DirectChatUiMessage } from '../directChatModels';
import type { DirectChatRealtimeProjection } from '../directChatRealtime';
import { buildInboxSections, mapPreviewKind } from '../ui/buildInboxSections';
import { buildMessageGroups } from '../ui/buildMessageGroups';
import { shouldAnimateChatTransition } from '../ui/chatMotion';
import { chatColors, chatMetrics } from '../ui/chatTheme';
import { mapChatDesignFixtureCatalog } from '../ui/wave0FixtureAdapter';
import { resolvePersonalChatPresentation } from '../ui/usePersonalChatPresentation';

describe('personal chat frontend Wave 1 foundation', () => {
  it('keeps the Modern Royal semantic tokens local and stable', () => {
    expect(chatColors).toMatchObject({
      canvas: '#090203',
      gold: '#E0B967',
      goldForeground: '#2B080D',
      royalRed: '#A61935',
      textPrimary: '#FFF8EC',
    });
    expect(chatMetrics).toMatchObject({
      avatarInbox: 52,
      contentMaxWidth: 760,
      controlMinHeight: 44,
      rowMinHeight: 76,
    });
  });

  it('honors reduced motion without coupling it to data state', () => {
    expect(shouldAnimateChatTransition(false)).toBe(true);
    expect(shouldAnimateChatTransition(true)).toBe(false);
  });

  it('fails the replacement presentation closed without changing chat availability', () => {
    expect(resolvePersonalChatPresentation(undefined)).toBe('legacy');
    expect(resolvePersonalChatPresentation(false)).toBe('legacy');
    expect(resolvePersonalChatPresentation(1)).toBe('legacy');
    expect(resolvePersonalChatPresentation(true, { percentage: 100, salt: '', schemaVersion: 1, stage: 'global' })).toBe('modern-royal');
  });

  it('separates incoming requests from the all and unread inboxes', () => {
    const accepted = projection({ conversationId: 'accepted', peerUid: 'sara', unreadCount: 3 });
    const incoming = projection({
      conversationId: 'incoming',
      ownerUid: 'me',
      peerUid: 'omar',
      recipientUid: 'me',
      requestState: 'pending',
      requesterUid: 'omar',
      unreadCount: 1,
    });
    const outgoing = projection({
      conversationId: 'outgoing',
      ownerUid: 'me',
      peerUid: 'noor',
      recipientUid: 'noor',
      requestState: 'pending',
      requesterUid: 'me',
    });
    const archived = projection({ archived: true, conversationId: 'archived', peerUid: 'hidden' });
    const base = {
      fallbackDeletedName: 'Deleted user',
      fallbackUserName: 'User',
      items: [accepted, incoming, outgoing, archived],
      profiles: {
        noor: { displayName: 'Noor' },
        omar: { displayName: 'Omar' },
        sara: { displayName: 'Sara' },
      },
    };

    const all = buildInboxSections({ ...base, filter: 'all' });
    expect(all.incomingRequestCount).toBe(1);
    expect(all.rows.map((row) => row.item.conversationId)).toEqual(['accepted', 'outgoing']);

    const unread = buildInboxSections({ ...base, filter: 'unread' });
    expect(unread.rows.map((row) => row.item.conversationId)).toEqual(['accepted']);

    const requests = buildInboxSections({ ...base, filter: 'requests' });
    expect(requests.rows.map((row) => row.item.conversationId)).toEqual(['incoming']);
  });

  it('combines normalized search, drafts, media previews, and deleted identities', () => {
    const rows = buildInboxSections({
      drafts: { media: '   Draft reply   ' },
      fallbackDeletedName: 'Deleted user',
      fallbackUserName: 'User',
      filter: 'all',
      items: [
        projection({ conversationId: 'media', lastMessageKind: 'image', peerUid: 'sara' }),
        projection({ conversationId: 'deleted', lastMessageKind: 'voice-note', peerUid: 'deleted' }),
      ],
      profiles: {
        deleted: { deleted: true, displayName: 'Old name' },
        sara: { displayName: 'Sára' },
      },
      query: 'draft',
    }).rows;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ displayName: 'Sára', previewKind: 'draft', previewText: 'Draft reply' });
    expect(mapPreviewKind('image')).toBe('image');
    expect(mapPreviewKind('voice-note')).toBe('voice-note');
    expect(mapPreviewKind('unknown')).toBe('text');

    const deleted = buildInboxSections({
      fallbackDeletedName: 'Deleted user',
      fallbackUserName: 'User',
      filter: 'all',
      items: [projection({ conversationId: 'deleted', peerUid: 'deleted' })],
      profiles: { deleted: { deleted: true, displayName: 'Old name' } },
    }).rows[0];
    expect(deleted?.displayName).toBe('Deleted user');
  });

  it('groups adjacent messages and breaks groups at system and date boundaries', () => {
    const noon = new Date(2026, 7, 9, 12, 0, 0).getTime();
    const timeline = buildMessageGroups({
      messages: [
        message({ createdAtMs: noon, id: 'm1', senderUid: 'sara', sequence: 1 }),
        message({ createdAtMs: noon + 4 * 60_000, id: 'm2', senderUid: 'sara', sequence: 2 }),
        message({ createdAtMs: noon + 5 * 60_000, id: 'system', kind: 'system', senderUid: '', sequence: 3 }),
        message({ createdAtMs: noon + 6 * 60_000, id: 'm3', senderUid: 'sara', sequence: 4 }),
        message({ createdAtMs: noon + 24 * 60 * 60_000, id: 'm4', senderUid: 'sara', sequence: 5 }),
      ],
      viewerUid: 'me',
    });

    expect(timeline.map((item) => item.kind)).toEqual(['date', 'group', 'system', 'group', 'date', 'group']);
    expect(timeline[1]?.kind === 'group' ? timeline[1].messages.map((item) => item.id) : []).toEqual(['m1', 'm2']);
  });

  it('inserts the unread boundary once before the first unread peer message', () => {
    const timeline = buildMessageGroups({
      messages: [
        message({ id: 'mine', senderUid: 'me', sequence: 10 }),
        message({ id: 'peer-1', senderUid: 'sara', sequence: 11 }),
        message({ id: 'peer-2', senderUid: 'sara', sequence: 12 }),
      ],
      unreadAfterSequence: 10,
      viewerUid: 'me',
    });
    expect(timeline.filter((item) => item.kind === 'unread-boundary')).toHaveLength(1);
    expect(timeline.map((item) => item.kind)).toEqual(['date', 'group', 'unread-boundary', 'group']);
  });

  it('fails disposable fixture metadata closed', () => {
    const valid = mapChatDesignFixtureCatalog({
      notice: 'Design only',
      states: [
        { direction: 'rtl', id: 'inbox-ar', locale: 'ar-IQ', screen: 'inbox' },
        { direction: 'ltr', id: 'thread-en', locale: 'en', screen: 'thread' },
      ],
      version: 'wave0-v1',
    });
    expect(valid?.states).toHaveLength(2);
    expect(mapChatDesignFixtureCatalog({ notice: 'x', states: [{ direction: 'sideways' }], version: 'x' })).toBeUndefined();
    expect(mapChatDesignFixtureCatalog(undefined)).toBeUndefined();
  });
});

function projection(overrides: Partial<DirectChatRealtimeProjection> = {}): DirectChatRealtimeProjection {
  return {
    archived: false,
    clearedThroughSequence: 0,
    conversationId: 'conversation',
    lastMessageId: 'message',
    lastMessageKind: 'text',
    lastMessagePreview: 'Hello',
    lastMessageSenderUid: 'peer',
    lastReadSequence: 0,
    lastSequence: 1,
    muted: false,
    ownerUid: 'me',
    peerUid: 'peer',
    recipientUid: 'peer',
    requestState: 'accepted',
    requesterUid: '',
    retentionPurgedThroughSequence: 0,
    unreadCount: 0,
    updatedAtMs: 1,
    ...overrides,
  };
}

function message(overrides: Partial<DirectChatUiMessage> = {}): DirectChatUiMessage {
  return {
    attachmentId: '',
    createdAtMs: new Date(2026, 7, 9, 12, 0, 0).getTime(),
    id: 'message',
    kind: 'text',
    mediaContentType: '',
    mediaDurationMs: 0,
    mediaHeight: 0,
    mediaPath: '',
    mediaWidth: 0,
    replyToMessageId: '',
    senderUid: 'peer',
    sequence: 1,
    systemType: '',
    text: 'Hello',
    visibilityState: 'visible',
    ...overrides,
  };
}
