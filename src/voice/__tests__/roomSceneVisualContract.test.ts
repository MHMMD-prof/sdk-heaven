import { describe, expect, it } from 'vitest';

import {
  ROOM_SCENE_REGIONS,
  ROOM_SCENE_VISUAL_INVARIANTS,
  ROOM_THEME_VISUAL_TARGETS,
  classifyRoomSceneViewport,
  normalizedRectContains,
  normalizedRectsOverlap,
  validateRoomSceneRegions,
} from '../roomSceneVisualContract';

describe('roomSceneVisualContract', () => {
  it('classifies the supplied current and reference captures as tall viewports', () => {
    expect(classifyRoomSceneViewport(716, 1600)).toBe('tall');
    expect(classifyRoomSceneViewport(853, 1844)).toBe('tall');
    expect(classifyRoomSceneViewport(390, 844)).toBe('tall');
    expect(classifyRoomSceneViewport(360, 640)).toBe('compact');
  });

  it.each(Object.entries(ROOM_SCENE_REGIONS))('%s regions are bounded and collision-free', (_name, regions) => {
    expect(validateRoomSceneRegions(regions)).toEqual([]);
    expect(normalizedRectContains({ x: 0, y: 0, width: 1, height: 1 }, regions.activityDock)).toBe(true);
    expect(normalizedRectsOverlap(regions.stage, regions.activityDock)).toBe(false);
    expect(normalizedRectsOverlap(regions.activityDock, regions.dock)).toBe(false);
  });

  it('maps each current capture to the approved composition reference', () => {
    expect(ROOM_THEME_VISUAL_TARGETS['majlis-default']).toMatchObject({
      composition: 'horseshoe-majlis',
      referenceCapture: 'codex-clipboard-123785ea-6d0f-4e51-aa4a-ed98ff9b4934.png',
    });
    expect(ROOM_THEME_VISUAL_TARGETS['royal-theater']).toMatchObject({
      composition: 'curved-theater',
      referenceCapture: 'call_7JXnuSQbZMwWYSnpfgMzeA7K.png',
    });
    expect(ROOM_THEME_VISUAL_TARGETS['ruby-constellation']).toMatchObject({
      composition: 'modular-grid',
      referenceCapture: 'codex-clipboard-a64a904e-cdb1-41a1-a0bf-2a7e5e8d8875.png',
    });
  });

  it.each(Object.entries(ROOM_THEME_VISUAL_TARGETS))('%s defines complete supported seat topologies', (_themeId, target) => {
    for (const count of [5, 10, 15, 20] as const) {
      expect(target.seatTopology[count].reduce((sum, tier) => sum + tier, 0)).toBe(count);
      expect(target.seatTopology[count][0]).toBe(1);
      expect(Math.max(...target.seatTopology[count])).toBeLessThanOrEqual(5);
    }
  });

  it('keeps user-owned borders and server seat behavior outside theme authority', () => {
    expect(ROOM_SCENE_VISUAL_INVARIANTS).toMatchObject({
      occupiedAvatarBorderSource: 'user-cosmetic',
      roomThemeMayStyleOccupiedAvatarBorder: false,
      supportHubPageOrder: ['supporters', 'rocket', 'target'],
      seatAccessibilityOrder: 'seat-number',
      themeMayChangeSeatBehavior: false,
    });
  });
});
