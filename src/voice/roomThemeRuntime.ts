import Constants from 'expo-constants';
import { useEffect, useMemo, useState } from 'react';
import type { ImageSourcePropType } from 'react-native';

import {
  DEFAULT_ROOM_THEME_ID,
  RoomThemeManifest,
  isClientVersionCompatible,
  isRoomThemeId,
  validateRoomThemeManifest,
} from './roomThemeContract';
import { resolveRuntimeRoomThemeManifest } from './roomThemeRuntimePolicy';

const manifestCache = new Map<string, RoomThemeManifest>();

const bundledAssets: Record<string, ImageSourcePropType> = {
  'bundle://room-themes/majlis-default/background':
    require('../../assets/room-themes/majlis-default/background-v1.png') as ImageSourcePropType,
  'bundle://room-themes/royal-theater/background':
    require('../../assets/room-themes/royal-theater/background-v1.png') as ImageSourcePropType,
  'bundle://room-themes/ruby-constellation/background':
    require('../../assets/room-themes/ruby-constellation/background-v1.png') as ImageSourcePropType,
  'bundle://room-themes/majlis-default/stage-v2':
    require('../../assets/room-themes/majlis-default/stage-v2.png') as ImageSourcePropType,
  'bundle://room-themes/royal-theater/stage-v2':
    require('../../assets/room-themes/royal-theater/stage-v2.png') as ImageSourcePropType,
  'bundle://room-themes/ruby-constellation/stage-v2':
    require('../../assets/room-themes/ruby-constellation/stage-v2.png') as ImageSourcePropType,
};

export type ResolvedRoomTheme = {
  backgroundSource: ImageSourcePropType;
  manifest: RoomThemeManifest;
  requestedThemeId: string;
  source: 'fallback' | 'cache' | 'remote';
};

export function useResolvedRoomTheme({
  enabled,
  roomCustomizationSuspended,
  themeId,
}: {
  enabled: boolean;
  roomCustomizationSuspended?: boolean;
  themeId?: string;
}): ResolvedRoomTheme {
  const requestedThemeId = enabled
    && !roomCustomizationSuspended
    && isRoomThemeId(themeId)
    ? themeId
    : DEFAULT_ROOM_THEME_ID;
  const [remoteManifest, setRemoteManifest] = useState<RoomThemeManifest | undefined>(
    () => manifestCache.get(requestedThemeId),
  );

  useEffect(() => {
    setRemoteManifest(manifestCache.get(requestedThemeId));
    if (!enabled || roomCustomizationSuspended) return undefined;
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    void Promise.all([
      import('../auth/firebase'),
      import('firebase/firestore'),
    ]).then(([{ firebaseDb }, { doc, onSnapshot }]) => {
      if (stopped) return;
      unsubscribe = onSnapshot(
        doc(firebaseDb, 'roomThemes', requestedThemeId),
        (snapshot) => {
          if (stopped) return;
          const validation = validateRoomThemeManifest(snapshot.exists() ? snapshot.data() : undefined);
          const manifest = validation.ok
            && validation.manifest.themeId === requestedThemeId
            && validation.manifest.publicationStatus === 'published'
            && validation.manifest.renderingEnabled
            && isClientVersionCompatible(
              validation.manifest.minimumClientVersion,
              Constants.expoConfig?.version || '1.0.0',
            )
            ? validation.manifest
            : undefined;
          if (manifest) manifestCache.set(requestedThemeId, manifest);
          else manifestCache.delete(requestedThemeId);
          setRemoteManifest(manifest);
        },
        () => setRemoteManifest(undefined),
      );
    }).catch(() => setRemoteManifest(undefined));
    return () => {
      stopped = true;
      unsubscribe?.();
    };
  }, [enabled, requestedThemeId, roomCustomizationSuspended]);

  return useMemo(() => {
    const { manifest, usesRemote } = resolveRuntimeRoomThemeManifest(
      requestedThemeId,
      remoteManifest,
    );
    const background = manifest.assets.background;
    return {
      backgroundSource: background
        ? bundledAssets[background.uri] ?? { uri: background.uri }
        : bundledAssets['bundle://room-themes/majlis-default/background'],
      manifest,
      requestedThemeId,
      source: usesRemote && remoteManifest
        ? manifestCache.get(requestedThemeId) === remoteManifest ? 'cache' : 'remote'
        : 'fallback',
    };
  }, [remoteManifest, requestedThemeId]);
}

export function clearRoomThemeManifestCache() {
  manifestCache.clear();
}

export function resolveRoomThemeAssetSource(uri: string): ImageSourcePropType {
  return bundledAssets[uri] ?? { uri };
}
