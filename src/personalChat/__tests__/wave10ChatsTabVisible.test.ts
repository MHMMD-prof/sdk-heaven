import { describe, expect, it } from 'vitest';

import { MAIN_SHELL_TAB_KEYS } from '../../types/navigation';
import { directChatCopy } from '../directChatCopy';

describe('Wave 10 Chats tab stays visible when dark', () => {
  it('keeps chats in the main shell tab list', () => {
    expect(MAIN_SHELL_TAB_KEYS).toEqual(['home', 'rooms', 'chats', 'games', 'me']);
    expect(MAIN_SHELL_TAB_KEYS).toContain('chats');
  });

  it('exposes unavailable copy for the visible empty Chats state', () => {
    const ar = directChatCopy('ar');
    const en = directChatCopy('en');
    expect(ar.unavailableTitle.length).toBeGreaterThan(3);
    expect(ar.unavailableBody.length).toBeGreaterThan(3);
    expect(en.unavailableTitle).toMatch(/not enabled/i);
    expect(en.unavailableBody).toMatch(/appear here/i);
    expect(ar.searchPlaceholder).toBe('ابحث بالاسم');
    expect(ar.newChat).toBe('محادثة جديدة');
    expect(ar.composeTitle).toBe('محادثة جديدة');
    expect(ar.friends).toBe('الأصدقاء');
    expect(ar.startChat).toMatch(/محادثة/);
  });
});
