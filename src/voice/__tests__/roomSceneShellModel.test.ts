import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  clampRoomActivityPageIndex,
  formatRoomDisplayId,
  nextRoomActivityPageIndex,
  resolveRoomActivityPages,
  resolveRoomLiveActivity,
  shouldRotateRoomActivity,
} from '../roomSceneShellModel';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('roomSceneShellModel', () => {
  it('keeps short room IDs and bounds long technical IDs', () => {
    expect(formatRoomDisplayId('152001')).toBe('152001');
    expect(formatRoomDisplayId(' representative-test-qLaisDcEGpcp5XIJ8XqHpigZqDJ3 '))
      .toBe('repres…qDJ3');
  });

  it('orders only the available Support Hub pages', () => {
    expect(resolveRoomActivityPages({ rocketEnabled: true, supportersEnabled: true, targetEnabled: true }))
      .toEqual(['supporters', 'rocket', 'target']);
    expect(resolveRoomActivityPages({ rocketEnabled: false, supportersEnabled: true, targetEnabled: true }))
      .toEqual(['supporters', 'target']);
    expect(resolveRoomActivityPages({ rocketEnabled: false, supportersEnabled: false, targetEnabled: false }))
      .toEqual([]);
  });

  it('clamps paging, loops rotation, and gives PK priority over games', () => {
    expect(clampRoomActivityPageIndex(5, 3)).toBe(2);
    expect(clampRoomActivityPageIndex(-2, 3)).toBe(0);
    expect(nextRoomActivityPageIndex(2, 3)).toBe(0);
    expect(resolveRoomLiveActivity({ gameActive: true, pkActive: true })).toBe('pk');
    expect(resolveRoomLiveActivity({ gameActive: true, pkActive: false })).toBe('game');
  });

  it('rotates only when room and accessibility state allow it', () => {
    const ready = {
      appActive: true,
      interacting: false,
      liveActivity: false,
      pageCount: 3,
      reducedMotion: false,
      screenReaderEnabled: false,
      sheetOpen: false,
    };
    expect(shouldRotateRoomActivity(ready)).toBe(true);
    expect(shouldRotateRoomActivity({ ...ready, interacting: true })).toBe(false);
    expect(shouldRotateRoomActivity({ ...ready, reducedMotion: true })).toBe(false);
    expect(shouldRotateRoomActivity({ ...ready, screenReaderEnabled: true })).toBe(false);
    expect(shouldRotateRoomActivity({ ...ready, sheetOpen: true })).toBe(false);
    expect(shouldRotateRoomActivity({ ...ready, liveActivity: true })).toBe(false);
    expect(shouldRotateRoomActivity({ ...ready, pageCount: 1 })).toBe(false);
  });

  it('keeps incentives in a bounded bottom dock outside the seat stage', () => {
    const screen = readSource('src/screens/VoiceRoomScreen.tsx');
    const header = readSource('src/components/voice-room/VoiceRoomHeader.tsx');
    const announcement = readSource('src/components/voice-room/VoiceRoomAnnouncementBar.tsx');

    expect(screen).toContain('styles.stageShell');
    expect(screen).toContain('<VoiceRoomActivityDock');
    expect(screen.indexOf('<VoiceRoomActivityDock'))
      .toBeGreaterThan(screen.indexOf('styles.stageShell'));
    expect(screen).not.toContain('styles.incentiveLaunchers');
    expect(screen).not.toContain('styles.incentiveRail');
    expect(screen).not.toContain('styles.incentiveDock');
    expect(screen).not.toContain('style={styles.overlayRail}');
    expect(header).toContain('<AvatarPresentation');
    expect(header).toContain('accessibilityLabel={`معرف الغرفة ${roomId}`}');
    expect(announcement).toContain('accessibilityRole="summary"');
    expect(announcement).toContain('numberOfLines={1}');
  });
});
