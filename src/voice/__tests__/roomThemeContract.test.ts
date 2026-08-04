import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import {
  MAJLIS_DEFAULT_MANIFEST,
  ROOM_THEME_IDS,
  createBuiltInRoomThemeManifest,
  normalizePersistedRoomThemeId,
  validateRoomThemeManifestV1,
} from '../roomThemeContract';

const require = createRequire(import.meta.url);
const backend = require('../../../functions/roomThemeCore.js') as {
  validateRoomThemeManifestV1: (value: unknown, id: string) => unknown;
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

  it('migrates the legacy royal theme and folds the others into Majlis', () => {
    expect(normalizePersistedRoomThemeId('royal')).toBe('royal-theater');
    expect(normalizePersistedRoomThemeId('midnight')).toBe('majlis-default');
    expect(normalizePersistedRoomThemeId('ocean')).toBe('majlis-default');
    expect(normalizePersistedRoomThemeId('emerald')).toBe('majlis-default');
  });
});
