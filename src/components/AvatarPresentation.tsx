import { Image } from 'expo-image';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { AvatarFrameProjection } from '../cosmetics/avatarFrameProjection';
import { CosmeticAssetRenderer } from '../cosmetics/CosmeticAssetRenderer';
import { usePublishedCosmeticAsset } from '../cosmetics/assetRegistry';
import type { CosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import { colors, typography } from '../theme';

export function AvatarPresentation({
  avatarUrl,
  flags,
  frame,
  label,
  renderLegacyFrameWhenUnifiedDisabled = false,
  size,
  style,
  viewerMode = 'full',
}: {
  avatarUrl?: string;
  flags: CosmeticsFeatureFlags;
  frame?: AvatarFrameProjection;
  label: string;
  renderLegacyFrameWhenUnifiedDisabled?: boolean;
  size: number;
  style?: StyleProp<ViewStyle>;
  viewerMode?: 'full' | 'reduced' | 'off';
}) {
  return (
    <View style={[styles.root, { height: size, width: size }, style]}>
      {avatarUrl ? (
        <Image cachePolicy="memory-disk" contentFit="cover" source={{ uri: avatarUrl }} style={[StyleSheet.absoluteFill, styles.avatarImage]} />
      ) : (
        <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={[styles.label, { fontSize: Math.max(12, size * 0.38) }]}>
          {[...label.trim()][0] || '؟'}
        </Text>
      )}
      <AvatarFrameLayer
        flags={flags}
        frame={frame}
        renderLegacyWhenUnifiedDisabled={renderLegacyFrameWhenUnifiedDisabled}
        viewerMode={viewerMode}
      />
    </View>
  );
}

export function AvatarFrameLayer({
  flags,
  frame,
  renderLegacyWhenUnifiedDisabled = false,
  viewerMode = 'full',
}: {
  flags: CosmeticsFeatureFlags;
  frame?: AvatarFrameProjection;
  renderLegacyWhenUnifiedDisabled?: boolean;
  viewerMode?: 'full' | 'reduced' | 'off';
}) {
  const canonicalEnabled = Boolean(
    flags.unifiedAvatarFrames
    && frame?.canonicalAsset
    && flags.assetRegistry
    && flags.sharedRenderer,
  );
  const bundle = usePublishedCosmeticAsset(
    frame?.canonicalAsset?.assetId,
    frame?.canonicalAsset?.assetVersionId,
    canonicalEnabled,
  );
  if (!frame) return null;
  if (!flags.unifiedAvatarFrames && !renderLegacyWhenUnifiedDisabled) return null;
  const rendererFlags = flags.animatedAvatarFrames
    ? flags
    : { ...flags, lottie: false };
  return (
    <View pointerEvents="none" style={styles.frameLayer}>
      <CosmeticAssetRenderer
        compatibilityUri={frame.assetUrl}
        descriptor={bundle?.primary}
        fallbackDescriptor={bundle?.fallback}
        flags={rendererFlags}
        style={StyleSheet.absoluteFill}
        viewerMode={viewerMode}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  avatarImage: { borderRadius: 999 },
  frameLayer: {
    bottom: -3,
    left: -3,
    position: 'absolute',
    right: -3,
    top: -3,
    zIndex: 2,
  },
  label: {
    color: colors.goldSoft,
    fontWeight: typography.weights.black,
    maxWidth: '90%',
  },
  root: {
    alignItems: 'center',
    backgroundColor: '#2B0A0E',
    borderColor: colors.gold,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'visible',
  },
});
