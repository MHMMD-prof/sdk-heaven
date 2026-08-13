import { describe, expect, it } from 'vitest';

import {
  capDirectChatInboxItems,
  capDirectChatThreadMessages,
  directChatPerformanceBudgets,
  isOverBudget,
} from '../directChatPerformanceBudgets';

describe('directChatPerformanceBudgets', () => {
  it('defines provisional P95 and client caps', () => {
    expect(directChatPerformanceBudgets.sendAckP95Ms).toBe(2_500);
    expect(directChatPerformanceBudgets.inboxOpenP95Ms).toBe(1_500);
    expect(directChatPerformanceBudgets.inboxClientCap).toBe(150);
    expect(directChatPerformanceBudgets.threadClientCap).toBe(200);
    expect(isOverBudget(2_501, directChatPerformanceBudgets.sendAckP95Ms)).toBe(true);
    expect(isOverBudget(1_400, directChatPerformanceBudgets.inboxOpenP95Ms)).toBe(false);
  });

  it('keeps newest inbox rows and newest thread tail under caps', () => {
    const inbox = Array.from({ length: 180 }, (_, index) => ({ conversationId: `c-${index}` }));
    expect(capDirectChatInboxItems(inbox)).toHaveLength(150);
    expect(capDirectChatInboxItems(inbox)[0]?.conversationId).toBe('c-0');

    const thread = Array.from({ length: 250 }, (_, index) => ({ id: `m-${index}` }));
    const capped = capDirectChatThreadMessages(thread);
    expect(capped).toHaveLength(200);
    expect(capped[0]?.id).toBe('m-50');
    expect(capped.at(-1)?.id).toBe('m-249');
  });
});
