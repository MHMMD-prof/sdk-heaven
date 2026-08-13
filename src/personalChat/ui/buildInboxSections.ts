import type { DirectChatRealtimeProjection } from '../directChatRealtime';
import { normalizeSearch } from '../directChatSearch';

export type ChatInboxFilter = 'all' | 'requests' | 'unread';
export type ChatInboxPreviewKind = 'draft' | 'image' | 'sticker' | 'system' | 'text' | 'voice-note';

export type ChatInboxProfile = {
  deleted?: boolean;
  displayName: string;
};

export type ChatInboxRowModel = {
  displayName: string;
  item: DirectChatRealtimeProjection;
  previewKind: ChatInboxPreviewKind;
  previewText: string;
  requestDirection: 'incoming' | 'none' | 'outgoing';
};

export type ChatInboxViewModel = {
  incomingRequestCount: number;
  rows: ChatInboxRowModel[];
};

export function buildInboxSections({
  drafts = {},
  fallbackDeletedName,
  fallbackUserName,
  filter,
  items,
  profiles,
  query = '',
}: {
  drafts?: Record<string, string | undefined>;
  fallbackDeletedName: string;
  fallbackUserName: string;
  filter: ChatInboxFilter;
  items: DirectChatRealtimeProjection[];
  profiles: Record<string, ChatInboxProfile | undefined>;
  query?: string;
}): ChatInboxViewModel {
  const normalizedQuery = normalizeSearch(query);
  const candidates = items
    .filter((item) => !item.archived)
    .map((item): ChatInboxRowModel => {
      const profile = profiles[item.peerUid];
      const displayName = profile?.deleted
        ? fallbackDeletedName
        : profile?.displayName.trim() || fallbackUserName;
      const draft = drafts[item.conversationId]?.trim() || '';
      const requestDirection = getRequestDirection(item);
      return {
        displayName,
        item,
        previewKind: draft ? 'draft' : mapPreviewKind(item.lastMessageKind),
        previewText: draft || item.lastMessagePreview,
        requestDirection,
      };
    })
    .filter((row) => !normalizedQuery || normalizeSearch(`${row.displayName} ${row.previewText}`).includes(normalizedQuery));

  const incomingRequests = candidates.filter((row) => row.requestDirection === 'incoming');
  const rows = candidates.filter((row) => {
    if (filter === 'requests') return row.requestDirection === 'incoming';
    if (row.requestDirection === 'incoming') return false;
    if (filter === 'unread') return row.item.unreadCount > 0;
    return true;
  });

  return { incomingRequestCount: incomingRequests.length, rows };
}

export function getRequestDirection(item: DirectChatRealtimeProjection): ChatInboxRowModel['requestDirection'] {
  if (item.requestState !== 'pending') return 'none';
  return item.recipientUid === item.ownerUid ? 'incoming' : 'outgoing';
}

export function mapPreviewKind(kind: string): ChatInboxPreviewKind {
  if (kind === 'image') return 'image';
  if (kind === 'voice-note') return 'voice-note';
  if (kind === 'sticker') return 'sticker';
  if (kind === 'system') return 'system';
  return 'text';
}
