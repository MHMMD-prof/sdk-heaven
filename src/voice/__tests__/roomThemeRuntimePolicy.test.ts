import { describe, expect, it } from 'vitest';

import {
  BUILT_IN_ROOM_THEME_REVISION,
  createBuiltInRoomThemeManifestV3,
} from '../roomThemeContract';
import { resolveRuntimeRoomThemeManifest } from '../roomThemeRuntimePolicy';

describe('room theme runtime policy', () => {
  it('keeps the requested built-in theme when its remote manifest is missing', () => {
    const result = resolveRuntimeRoomThemeManifest('royal-theater');

    expect(result.usesRemote).toBe(false);
    expect(result.manifest.themeId).toBe('royal-theater');
    expect(result.manifest.manifestVersion).toBe(3);
    expect(result.manifest.layouts['10'].map(({ x, y }) => [x, y]))
      .not.toEqual(createBuiltInRoomThemeManifestV3('majlis-default').layouts['10']
        .map(({ x, y }) => [x, y]));
  });

  it('rejects a stale generic remote layout for a built-in theme', () => {
    const stale = {
      ...createBuiltInRoomThemeManifestV3('royal-theater'),
      revision: BUILT_IN_ROOM_THEME_REVISION - 1,
      layouts: createBuiltInRoomThemeManifestV3('majlis-default').layouts,
    };
    const result = resolveRuntimeRoomThemeManifest('royal-theater', stale);

    expect(result.usesRemote).toBe(false);
    expect(result.manifest.revision).toBe(BUILT_IN_ROOM_THEME_REVISION);
    expect(result.manifest.layouts).not.toEqual(stale.layouts);
  });

  it('accepts a current published manifest', () => {
    const current = createBuiltInRoomThemeManifestV3('ruby-constellation');
    const result = resolveRuntimeRoomThemeManifest('ruby-constellation', current);

    expect(result).toEqual({ manifest: current, usesRemote: true });
  });
});
