import type { DirectChatUiMessage } from '../directChatModels';

export const CHAT_MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1_000;

export type ChatMessageGroup = {
  id: string;
  kind: 'group';
  messages: DirectChatUiMessage[];
  senderUid: string;
};

export type ChatTimelineItem =
  | ChatMessageGroup
  | { dateKey: string; id: string; kind: 'date' }
  | { id: string; kind: 'system'; message: DirectChatUiMessage }
  | { id: string; kind: 'unread-boundary' };

export function buildMessageGroups({
  messages,
  unreadAfterSequence,
  viewerUid,
}: {
  messages: DirectChatUiMessage[];
  unreadAfterSequence?: number;
  viewerUid: string;
}): ChatTimelineItem[] {
  const timeline: ChatTimelineItem[] = [];
  let currentDateKey = '';
  let unreadInserted = false;

  messages.forEach((message) => {
    const dateKey = chatMessageDateKey(message.createdAtMs);
    if (dateKey !== currentDateKey) {
      currentDateKey = dateKey;
      timeline.push({ dateKey, id: `date-${dateKey}-${message.id}`, kind: 'date' });
    }

    const shouldInsertUnread = !unreadInserted
      && unreadAfterSequence !== undefined
      && message.sequence > unreadAfterSequence
      && message.senderUid !== viewerUid
      && message.kind !== 'system';
    if (shouldInsertUnread) {
      unreadInserted = true;
      timeline.push({ id: `unread-${message.id}`, kind: 'unread-boundary' });
    }

    if (message.kind === 'system') {
      timeline.push({ id: `system-${message.id}`, kind: 'system', message });
      return;
    }

    const previous = timeline.at(-1);
    if (previous?.kind === 'group' && canJoinMessageGroup(previous, message)) {
      previous.messages.push(message);
      return;
    }
    timeline.push({ id: `group-${message.id}`, kind: 'group', messages: [message], senderUid: message.senderUid });
  });

  return timeline;
}

export function canJoinMessageGroup(group: ChatMessageGroup, message: DirectChatUiMessage) {
  const previous = group.messages.at(-1);
  if (!previous || message.kind === 'system' || previous.kind === 'system') return false;
  if (group.senderUid !== message.senderUid) return false;
  if (chatMessageDateKey(previous.createdAtMs) !== chatMessageDateKey(message.createdAtMs)) return false;
  const gap = message.createdAtMs - previous.createdAtMs;
  return gap >= 0 && gap <= CHAT_MESSAGE_GROUP_WINDOW_MS;
}

export function chatMessageDateKey(createdAtMs: number) {
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return 'unknown';
  const date = new Date(createdAtMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
