import {
  BUILT_IN_ROOM_THEME_REVISION,
  DEFAULT_ROOM_THEME_ID,
  ROOM_THEME_IDS,
  RoomThemeManifest,
  createBuiltInRoomThemeManifestV3,
} from './roomThemeContract';

export function resolveRuntimeRoomThemeManifest(
  requestedThemeId: string,
  remoteManifest?: RoomThemeManifest,
): { manifest: RoomThemeManifest; usesRemote: boolean } {
  const builtInThemeId = ROOM_THEME_IDS.find((candidate) => candidate === requestedThemeId);
  const bundledManifest = createBuiltInRoomThemeManifestV3(
    builtInThemeId ?? DEFAULT_ROOM_THEME_ID,
  );
  const remoteIsStaleBuiltIn = Boolean(
    builtInThemeId
    && remoteManifest
    && remoteManifest.revision < BUILT_IN_ROOM_THEME_REVISION,
  );
  const usesRemote = Boolean(remoteManifest && !remoteIsStaleBuiltIn);

  return {
    manifest: usesRemote ? remoteManifest! : bundledManifest,
    usesRemote,
  };
}
