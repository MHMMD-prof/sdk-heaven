import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import {
  MAJLIS_DEFAULT_MANIFEST,
  ROOM_THEME_IDS,
  createBuiltInRoomThemeManifest,
  normalizePersistedRoomThemeId,
  resolveRoomThemeScene,
  validateRoomThemeManifestV3,
  validateRoomThemeManifestV2,
  validateRoomThemeManifestV1,
} from '../roomThemeContract';

const require = createRequire(import.meta.url);
const backend = require('../../../functions/roomThemeCore.js') as {
  validateRoomThemeManifestV1: (value: unknown, id: string) => unknown;
  validateRoomThemeManifestV2: (value: unknown, id: string) => unknown;
  validateRoomThemeManifestV3: (value: unknown, id: string) => unknown;
};

describe('RoomThemeManifestV1', () => {
  it.each(ROOM_THEME_IDS)('validates every supported layout for %s', (themeId) => {
    const manifest = createBuiltInRoomThemeManifest(themeId);
    expect(validateRoomThemeManifestV1(manifest, { allowBundledAssets: true })).toMatchObject({ ok: true });
    expect(Object.fromEntries(Object.entries(manifest.layouts).map(([count, seats]) => [
      count,
      seats.map((seat) => seat.seatNumber),
    ]))).toEqual({
      5: [1, 2, 3, 4, 5],
      10: Array.from({ length: 10 }, (_, index) => index + 1),
      15: Array.from({ length: 15 }, (_, index) => index + 1),
      20: Array.from({ length: 20 }, (_, index) => index + 1),
    });
  });

  it('parses the same published fixture on mobile and backend', () => {
    const manifest = {
      ...MAJLIS_DEFAULT_MANIFEST,
      assets: {
        ...MAJLIS_DEFAULT_MANIFEST.assets,
        background: { uri: 'https://assets.example.test/majlis/v1/background.webp', version: 1 },
        stage: { uri: 'https://assets.example.test/majlis/v2/stage.png', version: 2 },
      },
    };
    expect(validateRoomThemeManifestV1(manifest)).toMatchObject({ ok: true });
    expect(backend.validateRoomThemeManifestV1(manifest, manifest.themeId)).toMatchObject({
      manifestVersion: 1,
      themeId: 'majlis-default',
    });
  });

  it('rejects duplicate, overlapping and incomplete layouts', () => {
    const duplicate = structuredClone(MAJLIS_DEFAULT_MANIFEST);
    duplicate.layouts['5'][1].seatNumber = 1;
    expect(validateRoomThemeManifestV1(duplicate, { allowBundledAssets: true })).toMatchObject({ ok: false });

    const overlap = structuredClone(MAJLIS_DEFAULT_MANIFEST);
    overlap.layouts['5'][1] = { ...overlap.layouts['5'][0], seatNumber: 2 };
    expect(validateRoomThemeManifestV1(overlap, { allowBundledAssets: true })).toMatchObject({ ok: false });

    const incomplete = structuredClone(MAJLIS_DEFAULT_MANIFEST) as Record<string, any>;
    delete incomplete.layouts['20'];
    expect(validateRoomThemeManifestV1(incomplete, { allowBundledAssets: true })).toMatchObject({ ok: false });
  });

  it('keeps occupied user borders outside the room-theme contract', () => {
    const manifest = createBuiltInRoomThemeManifest('royal-theater') as Record<string, unknown>;
    expect(JSON.stringify(manifest)).not.toMatch(/avatarFrame|occupied.*border/i);
    expect(manifest.assets).toHaveProperty('emptySeatFrame');
  });

  it('parses bounded V2 motion identically and rejects unsafe ambient bounds', () => {
    const manifest = {
      ...MAJLIS_DEFAULT_MANIFEST,
      manifestVersion: 2 as const,
      motion: {
        background: { assetId: 'majlis-motion', assetVersionId: 'v1-123456789abc' },
        ambient: [{
          id: 'stars',
          asset: { assetId: 'majlis-stars', assetVersionId: 'v1-abcdef123456' },
          x: 0.1,
          y: 0.1,
          width: 0.3,
          height: 0.2,
        }],
      },
    };
    expect(validateRoomThemeManifestV2(manifest, { allowBundledAssets: true })).toMatchObject({ ok: true });
    expect(backend.validateRoomThemeManifestV2({
      ...manifest,
      assets: {
        ...manifest.assets,
        background: { uri: 'https://assets.example.test/majlis/v2/background.png', version: 2 },
        stage: { uri: 'https://assets.example.test/majlis/v2/stage.png', version: 2 },
      },
    }, manifest.themeId)).toMatchObject({ manifestVersion: 2 });
    expect(validateRoomThemeManifestV2({
      ...manifest,
      motion: { ...manifest.motion, ambient: [{ ...manifest.motion.ambient[0], y: 0.8, height: 0.2 }] },
    }, { allowBundledAssets: true })).toMatchObject({ ok: false });
  });

  it('parses responsive V3 scenes identically and resolves the requested viewport', () => {
    const manifest = responsiveManifest();
    manifest.scene.profiles.tall.layouts['5'][0] = {
      ...manifest.scene.profiles.tall.layouts['5'][0],
      x: 0.52,
    };

    expect(validateRoomThemeManifestV3(manifest, { allowBundledAssets: true })).toMatchObject({ ok: true });
    expect(backend.validateRoomThemeManifestV3({
      ...manifest,
      assets: {
        ...manifest.assets,
        background: { uri: 'https://assets.example.test/majlis/v3/background.webp', version: 3 },
        stage: { uri: 'https://assets.example.test/majlis/v2/stage.png', version: 2 },
      },
    }, manifest.themeId)).toMatchObject({ manifestVersion: 3 });
    expect(resolveRoomThemeScene(manifest, 'tall').layouts['5'][0].x).toBe(0.52);
    expect(resolveRoomThemeScene(MAJLIS_DEFAULT_MANIFEST, 'tall')).toMatchObject({
      background: { fit: 'cover', focalX: 0.5, focalY: 0.5 },
      layouts: MAJLIS_DEFAULT_MANIFEST.layouts,
      stage: { fit: 'contain', focalX: 0.5, focalY: 0.5 },
      viewportProfile: 'tall',
    });
  });

  it('rejects incomplete profiles, unsafe focal points and responsive overlaps', () => {
    const missing = responsiveManifest() as Record<string, any>;
    delete missing.scene.profiles.standard;
    expect(validateRoomThemeManifestV3(missing, { allowBundledAssets: true })).toMatchObject({ ok: false });

    const focal = responsiveManifest();
    focal.scene.background.focalX = 1.1;
    expect(validateRoomThemeManifestV3(focal, { allowBundledAssets: true })).toMatchObject({ ok: false });

    const overlap = responsiveManifest();
    overlap.scene.profiles.compact.layouts['5'][1] = {
      ...overlap.scene.profiles.compact.layouts['5'][0],
      seatNumber: 2,
    };
    expect(validateRoomThemeManifestV3(overlap, { allowBundledAssets: true })).toMatchObject({ ok: false });
  });

  it('migrates the legacy royal theme and folds the others into Majlis', () => {
    expect(normalizePersistedRoomThemeId('royal')).toBe('royal-theater');
    expect(normalizePersistedRoomThemeId('midnight')).toBe('majlis-default');
    expect(normalizePersistedRoomThemeId('ocean')).toBe('majlis-default');
    expect(normalizePersistedRoomThemeId('emerald')).toBe('majlis-default');
  });
});

function responsiveManifest() {
  const layouts = structuredClone(MAJLIS_DEFAULT_MANIFEST.layouts);
  return {
    ...MAJLIS_DEFAULT_MANIFEST,
    manifestVersion: 3 as const,
    motion: { ambient: [], background: null },
    scene: {
      background: { fit: 'cover' as const, focalX: 0.5, focalY: 0.42 },
      stage: { fit: 'cover' as const, focalX: 0.5, focalY: 0.5 },
      profiles: {
        compact: { layouts: structuredClone(layouts) },
        standard: { layouts: structuredClone(layouts) },
        tall: { layouts: structuredClone(layouts) },
      },
    },
  };
}
