import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { AdminRoomThemeManifest, AdminRoomThemeSeat } from './adminDashboardApi';
import {
  ROOM_THEME_EDITOR_PROFILES,
  ROOM_THEME_EDITOR_REGIONS,
  ROOM_THEME_INCENTIVE_PREVIEWS,
  requiredRoomThemePreviewKeys,
  roomThemeIncentiveCoverageMatrix,
  roomThemePreviewKey,
  upgradeRoomThemeManifestToV3,
  validateRoomThemeEditorManifest,
} from './roomThemeEditorModel';

const source = (path: string) => readFileSync(resolve(process.cwd(), 'admin-dashboard', 'src', path), 'utf8');

describe('roomThemeEditorModel', () => {
  it('upgrades legacy layouts into independent compact, standard and tall profiles', () => {
    const upgraded = upgradeRoomThemeManifestToV3(manifest());

    expect(upgraded.manifestVersion).toBe(3);
    expect(upgraded.scene).toBeDefined();
    expect(Object.keys(upgraded.scene!.profiles)).toEqual(ROOM_THEME_EDITOR_PROFILES);
    upgraded.scene!.profiles.compact.layouts['5'][0]!.x = 0.44;
    expect(upgraded.scene!.profiles.standard.layouts['5'][0]!.x).toBe(0.1);
  });

  it('requires explicit review of every seat count on all phone profiles', () => {
    const keys = requiredRoomThemePreviewKeys();
    expect(keys).toHaveLength(12);
    expect(keys).toContain(roomThemePreviewKey('standard', 20));
  });

  it('mirrors backend bounds and overlap publication checks', () => {
    const upgraded = upgradeRoomThemeManifestToV3(manifest());
    expect(validateRoomThemeEditorManifest(upgraded)).toEqual([]);

    upgraded.scene!.profiles.tall.layouts['10'][1] = {
      ...upgraded.scene!.profiles.tall.layouts['10'][0]!,
      seatNumber: 2,
    };
    expect(validateRoomThemeEditorManifest(upgraded).join(' ')).toContain('متداخلان');
  });

  it('uses the same normalized production shell regions as mobile', () => {
    expect(ROOM_THEME_EDITOR_REGIONS.standard).toMatchObject({
      stage: { x: 0.03, y: 0.165, width: 0.94, height: 0.52 },
      activityDock: { x: 0.03, y: 0.695, width: 0.94, height: 0.18 },
      dock: { y: 0.885 },
    });
  });

  it('renders seats inside the stage and previews the complete shared shell', () => {
    const editor = source('RoomThemeManifestEditor.tsx');
    expect(editor).toContain('className="room-theme-preview-stage"');
    expect(editor).toContain('className="room-theme-preview-activity-dock"');
    expect(editor).toContain('className="room-theme-preview-dock"');
    expect(editor).toContain('previewStage');
    expect(editor).toContain('previewDock');
    expect(editor).toContain('ROOM_THEME_EDITOR_PROFILES.map');
  });

  it('covers every incentive state on all built-in themes and supported seat counts', () => {
    const matrix = roomThemeIncentiveCoverageMatrix();
    expect(matrix).toHaveLength(3 * 4 * 4);
    expect(new Set(matrix.map((entry) => entry.themeId)).size).toBe(3);
    expect(new Set(matrix.map((entry) => entry.seatCount)).size).toBe(4);
    expect(new Set(matrix.map((entry) => entry.preview))).toEqual(new Set(ROOM_THEME_INCENTIVE_PREVIEWS));
  });

  it('offers room, daily supporters, weekly supporters and target sheet previews', () => {
    const editor = source('RoomThemeManifestEditor.tsx');
    expect(editor).toContain("'rocket-week': 'الصاروخ · أسبوعي'");
    expect(editor).toContain("'rocket-today': 'الصاروخ · اليوم'");
    expect(editor).toContain("target: 'هدف الغرفة'");
    expect(editor).toContain('room-theme-incentive-podium');
    expect(editor).toContain('room-theme-target-return');
  });
});

function manifest(): AdminRoomThemeManifest {
  const layouts = {
    '5': grid(5),
    '10': grid(10),
    '15': grid(15),
    '20': grid(20),
  };
  return {
    assets: { background: null, stage: null, emptySeatFrame: null, badge: null, dock: null, drawer: null },
    colors: {
      background: '#080405', panel: '#130A0B', panelRaised: '#211012', ruby: '#74151D',
      rubyBright: '#B92A35', gold: '#D6A84F', goldSoft: '#F4D58A', text: '#FFF4DE', textMuted: '#CDBB9D',
    },
    layouts,
    manifestVersion: 2,
    minimumClientVersion: '1.0.0',
    motion: { ambient: [], background: null },
    publicationStatus: 'draft',
    purchasingEnabled: true,
    renderingEnabled: true,
    revision: 1,
    themeId: 'test-theme',
  };
}

function grid(count: number): AdminRoomThemeSeat[] {
  return Array.from({ length: count }, (_, index) => ({
    scale: 0.7,
    seatNumber: index + 1,
    x: ((index % 5) + 0.5) / 5,
    y: (Math.floor(index / 5) + 0.5) / Math.ceil(count / 5),
    z: index + 1,
  }));
}
