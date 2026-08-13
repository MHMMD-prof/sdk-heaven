import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { DirectChatUiMessage } from '../directChatModels';
import { buildMessageActionAvailability } from '../ui/buildMessageActions';
import { buildMessageGroups } from '../ui/buildMessageGroups';

const source = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

function message(overrides: Partial<DirectChatUiMessage> = {}): DirectChatUiMessage {
  return {
    attachmentId: '', createdAtMs: 1_700_000_000_000, deliveryState: 'sent', id: 'm1', kind: 'text',
    mediaContentType: '', mediaDurationMs: 0, mediaHeight: 0, mediaPath: '', mediaWidth: 0,
    replyToMessageId: '', senderUid: 'peer', sequence: 1, systemType: '', text: 'hello',
    visibilityState: 'visible', ...overrides,
  };
}

describe('personal chat Wave 3 thread', () => {
  it('guards the new thread behind the same fail-closed presentation selector', () => {
    const screen = source('../../screens/DirectChatScreen.tsx');
    expect(screen).toContain("presentation === 'modern-royal'");
    expect(screen).toContain('<DirectChatScreenModernRoyal');
    expect(screen).toContain('<LegacyDirectChatScreen');
  });

  it('does not bring legacy salon imagery into the modern thread', () => {
    const screen = source('../../screens/DirectChatScreenModernRoyal.tsx');
    expect(screen).not.toMatch(/velvet|leather|royalCrest|ImageBackground|absoluteFillObject/);
    expect(screen).toContain('<ChatRoyalBackdrop');
    expect(screen).toContain('<ChatThreadCanvas');
    expect(screen).toContain('<ChatTimelineRow');
  });

  it('keeps history anchors and does not force-scroll readers on realtime messages', () => {
    const screen = source('../../screens/DirectChatScreenModernRoyal.tsx');
    expect(screen).toContain('maintainVisibleContentPosition');
    expect(screen).toContain('nearBottom.current');
    expect(screen).toContain('newMessageCount');
  });

  it('uses a bottom action sheet and the Expo clipboard for message actions', () => {
    const screen = source('../../screens/DirectChatScreenModernRoyal.tsx');
    expect(screen).toContain("from 'expo-clipboard'");
    expect(screen).toContain('<ChatMessageActionSheet');
    expect(source('../ui/ChatMessageActionSheet.tsx')).toContain('<Modal');
  });

  it('offers only actions valid for the message state and owner', () => {
    expect(buildMessageActionAvailability(message(), 'self')).toEqual({ canCopy: true, canReply: true, canReport: true, canRetry: false, canUnsend: false });
    expect(buildMessageActionAvailability(message({ deliveryState: 'failed', senderUid: 'self' }), 'self')).toMatchObject({ canReport: false, canRetry: true, canUnsend: false });
    expect(buildMessageActionAvailability(message({ senderUid: 'self' }), 'self')).toMatchObject({ canReport: false, canRetry: false, canUnsend: true });
    expect(buildMessageActionAvailability(message({ kind: 'system', text: '' }), 'self')).toMatchObject({ canCopy: false, canReply: false, canReport: false });
  });

  it('renders date, unread, grouped, and system timeline items deterministically', () => {
    const items = buildMessageGroups({
      messages: [
        message({ id: 'a', sequence: 2 }),
        message({ createdAtMs: 1_700_000_010_000, id: 'b', sequence: 3 }),
        message({ createdAtMs: 1_700_000_020_000, id: 'c', kind: 'system', sequence: 4, systemType: 'request-accepted', text: '' }),
      ],
      unreadAfterSequence: 1,
      viewerUid: 'self',
    });
    expect(items.map((item) => item.kind)).toEqual(['date', 'unread-boundary', 'group', 'system']);
    expect(items.find((item) => item.kind === 'group' && item.messages.length === 2)).toBeTruthy();
  });
});
