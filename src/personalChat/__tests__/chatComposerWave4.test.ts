import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buildComposerState } from '../ui/buildComposerState';

const source = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('personal chat Wave 4 composer', () => {
  it('models loading, request, pending, and accepted states without ambiguous sending', () => {
    expect(buildComposerState({ accepted: false, draft: 'hello', requestIncoming: false, requestOutgoing: false, statusReady: false })).toEqual({ canEditText: false, canOpenAttachments: false, canSend: false, mode: 'loading' });
    expect(buildComposerState({ accepted: false, draft: 'hello', requestIncoming: false, requestOutgoing: false, statusReady: true })).toEqual({ canEditText: true, canOpenAttachments: false, canSend: true, mode: 'request' });
    expect(buildComposerState({ accepted: false, draft: 'hello', requestIncoming: true, requestOutgoing: false, statusReady: true })).toMatchObject({ canEditText: false, canSend: false, mode: 'incoming-request' });
    expect(buildComposerState({ accepted: false, draft: 'hello', requestIncoming: false, requestOutgoing: true, statusReady: true })).toMatchObject({ canEditText: false, canSend: false, mode: 'outgoing-request' });
    expect(buildComposerState({ accepted: true, draft: 'hello', requestIncoming: false, requestOutgoing: false, statusReady: true })).toEqual({ canEditText: true, canOpenAttachments: true, canSend: true, mode: 'accepted' });
  });

  it('enforces empty and character-limit send states', () => {
    expect(buildComposerState({ accepted: true, draft: '   ', requestIncoming: false, requestOutgoing: false, statusReady: true }).canSend).toBe(false);
    expect(buildComposerState({ accepted: true, draft: 'x'.repeat(2_001), requestIncoming: false, requestOutgoing: false, statusReady: true }).canSend).toBe(false);
  });

  it('replaces the legacy tools in the Modern Royal thread', () => {
    const screen = source('../../screens/DirectChatScreenModernRoyal.tsx');
    expect(screen).toContain('<DirectChatComposerModernRoyal');
    expect(screen).not.toContain('<DirectChatComposerTools');
    expect(screen).toContain("behavior={Platform.OS === 'ios' ? 'padding' : 'height'}");
    expect(screen).toContain('if (nearBottom.current) requestAnimationFrame');
  });

  it('provides one attachment entry backed by the existing upload contract', () => {
    const composer = source('../ui/DirectChatComposerModernRoyal.tsx');
    const tray = source('../ui/ChatAttachmentTray.tsx');
    expect(composer.match(/<ChatAttachmentTray/g)).toHaveLength(1);
    expect(tray).toContain('beginDirectChatUpload');
    expect(tray).toContain('ImagePicker.getPendingResultAsync');
    expect(tray).toContain('useAudioRecorder(RecordingPresets.HIGH_QUALITY)');
    expect(tray).toContain('DIRECT_CHAT_IMAGE_MAX_BYTES');
    expect(tray).toContain('DIRECT_CHAT_VOICE_MAX_BYTES');
  });

  it('uses visible state together with non-blocking haptics', () => {
    const tray = source('../ui/ChatAttachmentTray.tsx');
    expect(tray).toContain('accessibilityLiveRegion="polite"');
    expect(tray).toContain('triggerChatSelectionFeedback');
    expect(tray).toContain('triggerChatSuccessFeedback');
    expect(tray).toContain('triggerChatWarningFeedback');
  });

  it('keeps Accept as the only primary request action and confirms rejection', () => {
    const card = source('../ui/ChatRequestDecisionCard.tsx');
    const screen = source('../../screens/DirectChatScreenModernRoyal.tsx');
    expect(card.match(/styles\.accept/g)?.length).toBeGreaterThan(0);
    expect(card).not.toMatch(/requestPrimary|reportPrimary|rejectPrimary|blockPrimary/);
    expect(screen).toContain("tr('رفض طلب المحادثة؟', 'Reject chat request?')");
    expect(screen).toContain("style: 'destructive'");
  });
});
