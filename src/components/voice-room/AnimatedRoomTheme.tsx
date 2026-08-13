import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { usePublishedCosmeticAsset } from '../../cosmetics/assetRegistry';
import { CosmeticAssetRenderer } from '../../cosmetics/CosmeticAssetRenderer';
import type { CosmeticViewerMode } from '../../cosmetics/contracts';
import type { CosmeticsFeatureFlags } from '../../cosmetics/featureFlags';
import { recordCosmeticsRuntimeEvent } from '../../cosmetics/runtimeTelemetry';
import type {
  RoomThemeAmbientSlotV2,
  RoomThemeManifest,
  RoomThemeMotionAssetV2,
} from '../../voice/roomThemeContract';

export function AnimatedRoomTheme({
  flags,
  manifest,
  viewerMode,
}: {
  flags: CosmeticsFeatureFlags;
  manifest: RoomThemeManifest;
  viewerMode: CosmeticViewerMode;
}) {
  if (
    manifest.manifestVersion === 1
    || !flags.roomAnimatedThemes
    || !flags.assetRegistry
    || !flags.sharedRenderer
    || viewerMode === 'off'
  ) return null;
  return (
    <View pointerEvents="none" style={styles.layer}>
      {manifest.motion.background ? (
        <MotionAsset
          flags={flags}
          kind="background"
          reference={manifest.motion.background}
          viewerMode={viewerMode}
        />
      ) : null}
      {manifest.motion.ambient.map((slot) => (
        <AmbientAsset
          flags={flags}
          key={slot.id}
          slot={slot}
          viewerMode={viewerMode}
        />
      ))}
    </View>
  );
}

function AmbientAsset({
  flags,
  slot,
  viewerMode,
}: {
  flags: CosmeticsFeatureFlags;
  slot: RoomThemeAmbientSlotV2;
  viewerMode: CosmeticViewerMode;
}) {
  return (
    <View
      style={[
        styles.ambient,
        {
          height: `${slot.height * 100}%`,
          left: `${slot.x * 100}%`,
          top: `${slot.y * 100}%`,
          width: `${slot.width * 100}%`,
        },
      ]}
    >
      <MotionAsset flags={flags} kind="ambient" reference={slot.asset} viewerMode={viewerMode} />
    </View>
  );
}

function MotionAsset({
  flags,
  kind,
  reference,
  viewerMode,
}: {
  flags: CosmeticsFeatureFlags;
  kind: 'ambient' | 'background';
  reference: RoomThemeMotionAssetV2;
  viewerMode: CosmeticViewerMode;
}) {
  const bundle = usePublishedCosmeticAsset(reference.assetId, reference.assetVersionId, true);
  const valid = bundle
    && bundle.primary.category === 'room-theme'
    && (kind === 'background'
      ? bundle.primary.format === 'mp4'
      : bundle.primary.format === 'lottie-json')
    && bundle.fallback
    && (bundle.fallback.format === 'png' || bundle.fallback.format === 'jpeg');
  useEffect(() => {
    if (bundle && !valid) {
      recordCosmeticsRuntimeEvent('theme-motion-fallback', { reason: `invalid-${kind}-bundle` });
    }
  }, [bundle, kind, valid]);
  if (!valid || !bundle) return null;
  return (
    <CosmeticAssetRenderer
      contentFit="cover"
      descriptor={bundle.primary}
      fallbackDescriptor={bundle.fallback}
      flags={flags}
      muted
      style={styles.renderer}
      viewerMode={viewerMode}
    />
  );
}

const styles = StyleSheet.create({
  ambient: {
    position: 'absolute',
  },
  layer: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
    zIndex: 1,
  },
  renderer: {
    height: '100%',
    width: '100%',
  },
});
