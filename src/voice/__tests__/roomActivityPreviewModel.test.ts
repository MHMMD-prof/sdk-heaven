import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { RoomChatMessage } from '../roomChat';
import { resolveRoomActivityPreview } from '../roomActivityPreviewModel';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function message(overrides: Partial<RoomChatMessage> = {}): RoomChatMessage {
  return {
    createdAtMs: 1,
    deliveryStatus: 'sent',
    id: 'message-1',
    kind: 'chat',
    revision: 1,
    roomId: 'room-1',
    schemaVersion: 2,
    senderAvatarLabel: 'س',
    senderDisplayName: 'سامي',
    senderUid: 'user-1',
    status: 'active',
    text: 'مساء الخير',
    ...overrides,
  };
}

describe('roomActivityPreviewModel', () => {
  it('shows the latest meaningful room activity in one bounded card', () => {
    const result = resolveRoomActivityPreview([
      message(),
      message({ id: 'deleted', status: 'deleted', text: 'removed' }),
      message({ id: 'gift', kind: 'gift', senderDisplayName: 'نور', text: 'أرسلت هدية' }),
    ]);

    expect(result).toMatchObject({
      empty: false,
      icon: 'gift',
      sender: 'نور',
      text: 'أرسلت هدية',
    });
  });

  it('labels system and moderation events as room notices', () => {
    expect(resolveRoomActivityPreview([message({ kind: 'system' })]).sender).toBe('إشعار الغرفة');
    expect(resolveRoomActivityPreview([message({ kind: 'moderation' })]).icon).toBe('notice');
  });

  it('provides a useful empty action', () => {
    expect(resolveRoomActivityPreview([])).toEqual({
      empty: true,
      icon: 'chat',
      sender: 'دردشة الغرفة',
      text: 'ابدأ الحديث مع الموجودين في الغرفة',
    });
  });

  it('keeps the activity card and Command Center declarative and theme-aware', () => {
    const screen = readSource('src/screens/VoiceRoomScreen.tsx');
    const activity = readSource('src/components/voice-room/VoiceRoomActivityPreview.tsx');
    const activityDock = readSource('src/components/voice-room/VoiceRoomActivityDock.tsx');
    const dock = readSource('src/components/voice-room/VoiceRoomBottomBar.tsx');

    expect(screen).toContain('<VoiceRoomActivityDock');
    expect(screen).not.toContain('roomChat.messages.slice(-3)');
    expect(activity).toContain('<LinearGradient');
    expect(activity).toContain('<AvatarPresentation');
    expect(activity).toContain('numberOfLines={1}');
    expect(activityDock).toContain('<VoiceRoomActivityPreview');
    expect(activityDock).toContain('ROTATION_INTERVAL_MS = 6_000');
    expect(activityDock).toContain('pagingEnabled');
    expect(activityDock).toContain('isReduceMotionEnabled');
    expect(activityDock).toContain('isScreenReaderEnabled');
    expect(dock).toContain('manifest.assets.dock');
    expect(dock).toContain('resolveRoomThemeAssetSource');
    expect(dock).toContain("label=\"هدية\"");
    expect(dock).toContain("label=\"أدوات\"");
    expect(dock).toContain('onPress={onMic}');
  });
});
