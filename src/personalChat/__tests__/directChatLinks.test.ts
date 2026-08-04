import { describe, expect, it } from 'vitest';

import { parseDirectChatLink } from '../directChatLinks';

describe('parseDirectChatLink', () => {
  it('resolves the same target for custom-scheme and HTTPS links', () => {
    expect(parseDirectChatLink('yallgame://chat/user_123')).toBe('user_123');
    expect(parseDirectChatLink('https://example.test/chat/user_123?source=room')).toBe('user_123');
  });

  it('rejects malformed, encoded-path, and oversized targets', () => {
    expect(parseDirectChatLink('yallgame://room/user_123')).toBe('');
    expect(parseDirectChatLink('yallgame://chat/user%2F123')).toBe('');
    expect(parseDirectChatLink(`yallgame://chat/${'a'.repeat(129)}`)).toBe('');
    expect(parseDirectChatLink('yallgame://chat/%E0%A4%A')).toBe('');
  });
});
