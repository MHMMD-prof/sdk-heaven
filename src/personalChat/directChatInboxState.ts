import { capDirectChatInboxItems } from './directChatPerformanceBudgets';
import type { DirectChatRealtimeProjection } from './directChatRealtime';

export function mergeDirectChatInboxItems({
  current,
  incoming,
  preserveConversationIds = new Set<string>(),
  removeConversationIds = new Set<string>(),
  replace = false,
}: {
  current: DirectChatRealtimeProjection[];
  incoming: DirectChatRealtimeProjection[];
  preserveConversationIds?: ReadonlySet<string>;
  removeConversationIds?: ReadonlySet<string>;
  replace?: boolean;
}) {
  const retained = replace
    ? []
    : current.filter((item) => !removeConversationIds.has(item.conversationId) || preserveConversationIds.has(item.conversationId));
  const byConversation = new Map(retained.map((item) => [item.conversationId, item]));
  incoming.forEach((item) => byConversation.set(item.conversationId, item));
  return capDirectChatInboxItems(
    [...byConversation.values()]
      .filter((item) => !item.archived)
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs || right.conversationId.localeCompare(left.conversationId)),
  );
}
