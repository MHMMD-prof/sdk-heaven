import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ROOM_THEME_IDS,
  createBuiltInRoomThemeManifest,
  createBuiltInRoomThemeManifestV3,
  validateRoomThemeManifestV3,
  type RoomThemeViewportProfile,
} from '../roomThemeContract';
import {
  createProductionRoomThemeLayouts,
  validateProductionRoomThemeLayoutGeometry,
} from '../roomThemeProductionLayouts';

const require = createRequire(import.meta.url);
const backend = require('../../../functions/roomThemeProductionLayouts.js') as {
  createProductionRoomThemeLayouts: typeof createProductionRoomThemeLayouts;
};
const profiles: RoomThemeViewportProfile[] = ['compact', 'standard', 'tall'];

describe('production room theme layouts', () => {
  it.each(ROOM_THEME_IDS)('matches mobile and backend layouts for %s', (themeId) => {
    for (const profile of profiles) {
      const mobileLayouts = createProductionRoomThemeLayouts(themeId, profile);
      expect(backend.createProductionRoomThemeLayouts(themeId, profile)).toEqual(mobileLayouts);
      expect(validateProductionRoomThemeLayoutGeometry(mobileLayouts)).toEqual([]);
    }
  });

  it.each(ROOM_THEME_IDS)('publishes a valid complete V3 scene for %s', (themeId) => {
    const base = createBuiltInRoomThemeManifest(themeId);
    const manifest = {
      ...base,
      manifestVersion: 3 as const,
      motion: { ambient: [], background: null },
      scene: {
        background: { fit: 'cover' as const, focalX: 0.5, focalY: 0.5 },
        stage: { fit: 'contain' as const, focalX: 0.5, focalY: 0.5 },
        profiles: Object.fromEntries(profiles.map((profile) => [profile, {
          layouts: createProductionRoomThemeLayouts(themeId, profile),
        }])) as Record<RoomThemeViewportProfile, { layouts: typeof base.layouts }>,
      },
    };
    expect(validateRoomThemeManifestV3(manifest, { allowBundledAssets: true })).toMatchObject({ ok: true });
  });

  it('keeps seat one focal and preserves the 1 + 4 + 5 + 5 + 5 topology', () => {
    const layouts = createProductionRoomThemeLayouts('royal-theater', 'tall');
    expect(layouts['20'][0]).toMatchObject({ seatNumber: 1, x: 0.5, z: 100 });
    const tiers = [...new Set(layouts['20'].map((seat) => seat.y))];
    expect(tiers.map((y) => layouts['20'].filter((seat) => seat.y === y).length)).toEqual([1, 4, 5, 5, 5]);
    expect(layouts['5'].map((seat) => seat.seatNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it('uses smaller compact seats and theme-specific compositions', () => {
    const compact = createProductionRoomThemeLayouts('majlis-default', 'compact');
    const tall = createProductionRoomThemeLayouts('majlis-default', 'tall');
    expect(compact['20'][19].scale).toBeLessThan(tall['20'][19].scale);
    expect(createProductionRoomThemeLayouts('majlis-default', 'standard')['10'])
      .not.toEqual(createProductionRoomThemeLayouts('ruby-constellation', 'standard')['10']);
  });

  it.each(ROOM_THEME_IDS)('spreads a 10-seat room across the usable stage for %s', (themeId) => {
    const seats = createProductionRoomThemeLayouts(themeId, 'standard')['10'];
    const yValues = seats.map((seat) => seat.y);

    expect(Math.max(...yValues) - Math.min(...yValues)).toBeGreaterThan(0.5);
    if (themeId === 'majlis-default') expect(new Set(yValues).size).toBeGreaterThan(5);
    else expect(new Set(yValues)).toHaveLength(3);
  });

  it.each(ROOM_THEME_IDS)('uses one approved full-room background without an opaque overlay for %s', (themeId) => {
    const manifest = createBuiltInRoomThemeManifest(themeId);
    expect(manifest.assets.background?.uri).toContain(`/room-themes/${themeId}/stage-v2`);
    expect(manifest.assets.stage).toBeNull();
    expect(createBuiltInRoomThemeManifestV3(themeId).scene.background.fit).toBe('cover');
  });

  it('uses a horseshoe rather than theater rows for the 10-seat Majlis', () => {
    const majlis = createProductionRoomThemeLayouts('majlis-default', 'standard')['10'];
    const royal = createProductionRoomThemeLayouts('royal-theater', 'standard')['10'];

    expect(new Set(majlis.map((seat) => seat.y)).size).toBeGreaterThan(5);
    expect(new Set(royal.map((seat) => seat.y))).toHaveLength(3);
  });

  it.each(ROOM_THEME_IDS)('fits all 20 seats inside compact, standard and tall Android stage canvases for %s', (themeId) => {
    const canvases: Record<RoomThemeViewportProfile, { height: number; width: number }> = {
      compact: { height: 480, width: 308 },
      standard: { height: 524, width: 341 },
      tall: { height: 600, width: 341 },
    };
    for (const profile of profiles) {
      const canvas = canvases[profile];
      const seats = createProductionRoomThemeLayouts(themeId, profile)['20'];
      const boxes = seats.map((seat) => ({
        bottom: seat.y * canvas.height + (96 * seat.scale) / 2,
        left: seat.x * canvas.width - (70 * seat.scale) / 2,
        right: seat.x * canvas.width + (70 * seat.scale) / 2,
        top: seat.y * canvas.height - (96 * seat.scale) / 2,
      }));
      for (const box of boxes) {
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(canvas.width);
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.bottom).toBeLessThanOrEqual(canvas.height);
      }
      for (let left = 0; left < boxes.length; left += 1) {
        for (let right = left + 1; right < boxes.length; right += 1) {
          const a = boxes[left];
          const b = boxes[right];
          expect(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top).toBe(true);
        }
      }
    }
  });

  it.each(ROOM_THEME_IDS)('ships a valid portrait V2 stage asset for %s', (themeId) => {
    const path = resolve(process.cwd(), `assets/room-themes/${themeId}/stage-v2.png`);
    expect(existsSync(path)).toBe(true);
    const image = readFileSync(path);
    expect(image.subarray(1, 4).toString('ascii')).toBe('PNG');
    const width = image.readUInt32BE(16);
    const height = image.readUInt32BE(20);
    expect(width).toBeGreaterThanOrEqual(852);
    expect(height).toBeGreaterThanOrEqual(1536);
    expect(width / height).toBeGreaterThan(0.45);
    expect(width / height).toBeLessThan(0.7);
  });
});
