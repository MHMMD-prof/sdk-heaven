import { describe, expect, it } from 'vitest';

import { sanitizeSentryBreadcrumb, sanitizeSentryEvent, sanitizeSentrySpan } from '../sentryPrivacy';

describe('Sentry privacy scrubbing', () => {
  it('removes chat content, identity, tokens, paths, and unknown tags', () => {
    const event = sanitizeSentryEvent({
      contexts: { chat: { mediaPath: 'direct-chat-media/private', text: 'secret message', uid: 'user-1' } },
      request: { headers: { Authorization: 'Bearer secret' }, url: 'https://private.example/chat' },
      tags: { command_action: 'send-direct-message', targetUid: 'user-2', unknown: 'drop-me' },
      user: { email: 'private@example.com', id: 'user-1' },
    });
    expect(event.user).toBeUndefined();
    expect(event.tags).toEqual({ command_action: 'send-direct-message' });
    expect(JSON.stringify(event)).not.toContain('secret message');
    expect(JSON.stringify(event)).not.toContain('user-1');
    expect(JSON.stringify(event)).not.toContain('Bearer secret');
    expect(JSON.stringify(event)).not.toContain('direct-chat-media/private');
  });

  it('keeps only bounded operational attributes for chat breadcrumbs and spans', () => {
    expect(sanitizeSentryBreadcrumb({ category: 'personal-chat', data: {
      command_action: 'report-direct-chat', message: 'private', targetUid: 'user-2',
    }, message: 'report-open' })).toMatchObject({
      data: { command_action: 'report-direct-chat' }, message: 'report-open',
    });
    expect(sanitizeSentrySpan({ data: { error_code: 'TIMEOUT', text: 'private' }, description: 'send-ack' }))
      .toMatchObject({ data: { error_code: 'TIMEOUT' }, description: 'send-ack' });
  });
});
