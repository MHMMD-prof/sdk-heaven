import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { resolvePersonalChatPresentation } from '../ui/usePersonalChatPresentation';
import { chatMetrics } from '../ui/chatTheme';

const source = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('personal chat Wave 5 hardening', () => {
  it('keeps the deterministic visual fixture development-only and opt-in', () => {
    const app = source('../../../App.tsx');
    expect(app).toContain("__DEV__ && process.env.EXPO_PUBLIC_PERSONAL_CHAT_VISUAL_FIXTURE === '1'");
    expect(app).toContain("require('./src/personalChat/PersonalChatVisualFixtureScreen')");
    expect(app).toContain('<AuthProvider>');
  });

  it('covers inbox, thread, and request states with production components', () => {
    const fixture = source('../PersonalChatVisualFixtureScreen.tsx');
    expect(fixture).toContain("useState<FixtureState>('inbox')");
    expect(fixture).toContain("state === 'thread'");
    expect(fixture).toContain("state === 'request'");
    expect(fixture).toContain('<ChatConversationRow');
    expect(fixture).toContain('<ChatTimelineRow');
    expect(fixture).toContain('<DirectChatComposerModernRoyal');
  });

  it('preserves minimum touch sizes and bounded responsive content', () => {
    expect(chatMetrics.controlMinHeight).toBeGreaterThanOrEqual(44);
    expect(chatMetrics.contentMaxWidth).toBe(760);
    expect(chatMetrics.bubbleMaxWidth).toBe('82%');

    const composer = source('../ui/DirectChatComposerModernRoyal.tsx');
    const tray = source('../ui/ChatAttachmentTray.tsx');
    expect(composer).toContain('minWidth: 0');
    expect(tray).toContain('minHeight: 84');
    expect(tray).toContain("width: '100%'");
  });

  it('supports dynamic type, screen readers, and mixed text direction', () => {
    const report = source('../DirectChatReportSheet.tsx');
    const row = source('../ui/ChatConversationRow.tsx');
    const attachment = source('../DirectChatAttachment.tsx');
    expect(report).not.toMatch(/maxFontSizeMultiplier=\{1\.[34]\}/);
    expect(report).toContain('maxFontSizeMultiplier={2}');
    expect(row).toContain('accessibilityElementsHidden importantForAccessibility="no"');
    expect(row).toContain("writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr'");
    expect(attachment).toContain('useWindowDimensions');
    expect(attachment).toContain('I18nManager.isRTL');
  });

  it('leaves the replacement feature flag fail-closed', () => {
    expect(resolvePersonalChatPresentation(undefined)).toBe('legacy');
    expect(resolvePersonalChatPresentation(false)).toBe('legacy');
    expect(resolvePersonalChatPresentation('true')).toBe('legacy');
    expect(resolvePersonalChatPresentation(true)).toBe('legacy');
    expect(resolvePersonalChatPresentation(true, { percentage: 100, salt: '', schemaVersion: 1, stage: 'global' })).toBe('modern-royal');
  });

  it('does not construct native filesystem directories during web module load', () => {
    const chatMedia = source('../directChatMedia.ts');
    const cosmeticsCache = source('../../cosmetics/assetCache.ts');
    expect(chatMedia).toContain('let mediaCacheRoot: Directory | undefined');
    expect(chatMedia).toContain("Platform.OS === 'web'");
    expect(chatMedia).toContain('URL.createObjectURL');
    expect(source('../DirectChatAttachment.tsx')).toContain('URL.revokeObjectURL');
    expect(cosmeticsCache).toContain('let cacheDirectory: Directory | undefined');
    expect(cosmeticsCache).toContain("Platform.OS === 'web'");
  });
});
