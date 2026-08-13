/**
 * Wave 9 provisional Direct Chat performance budgets.
 * Acceptance goals to validate on device later — not production SLOs yet.
 * @see docs/PERSONAL_CHATS_WAVE9_HARDENING.md
 */

export const directChatPerformanceBudgets = Object.freeze({
  /** Soft send-command round-trip budget (ms) for acknowledgement UX. */
  sendAckP95Ms: 2_500,
  /** Soft inbox-open budget (ms) before surfacing slow-load telemetry. */
  inboxOpenP95Ms: 1_500,
  /** Max conversations retained in client memory after pagination merges. */
  inboxClientCap: 150,
  /** Max messages retained in an open thread after load-older merges. */
  threadClientCap: 200,
});

export type DirectChatPerformanceBudgets = typeof directChatPerformanceBudgets;

export function isOverBudget(elapsedMs: number, budgetMs: number): boolean {
  return Number.isFinite(elapsedMs) && Number.isFinite(budgetMs) && elapsedMs > budgetMs;
}

export function capDirectChatInboxItems<T extends { conversationId: string }>(
  items: T[],
  cap = directChatPerformanceBudgets.inboxClientCap,
): T[] {
  if (!Array.isArray(items) || items.length <= cap) return items;
  return items.slice(0, Math.max(1, cap));
}

export function capDirectChatThreadMessages<T>(
  messages: T[],
  cap = directChatPerformanceBudgets.threadClientCap,
): T[] {
  if (!Array.isArray(messages) || messages.length <= cap) return messages;
  return messages.slice(-Math.max(1, cap));
}
