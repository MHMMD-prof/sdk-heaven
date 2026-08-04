import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { usePublishedCosmeticAsset } from '../cosmetics/assetRegistry';
import type { CosmeticCategory, CosmeticViewerMode } from '../cosmetics/contracts';
import type { EquipmentCosmeticProjection } from '../cosmetics/equipmentCosmetics';
import type { CosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import { CosmeticAssetRenderer } from '../cosmetics/CosmeticAssetRenderer';

export function EquipmentCosmeticAsset({
  category,
  enabled,
  flags,
  projection,
  style,
  viewerMode = 'reduced',
}: {
  category: CosmeticCategory;
  enabled: boolean;
  flags: CosmeticsFeatureFlags;
  projection?: EquipmentCosmeticProjection;
  style?: StyleProp<ViewStyle>;
  viewerMode?: CosmeticViewerMode;
}) {
  const allowed = Boolean(enabled && flags.assetRegistry && flags.sharedRenderer && projection);
  const bundle = usePublishedCosmeticAsset(projection?.assetId, projection?.assetVersionId, allowed);
  if (!allowed || !bundle || bundle.primary.category !== category || ['mp4', 'm4a-aac'].includes(bundle.primary.format)) return null;
  const rendererFlags = { ...flags, effectAudio: false, video: false };
  return (
    <View pointerEvents="none" style={style}>
      <CosmeticAssetRenderer
        descriptor={bundle.primary}
        fallbackDescriptor={bundle.fallback}
        flags={rendererFlags}
        muted
        style={StyleSheet.absoluteFill}
        viewerMode={viewerMode}
      />
    </View>
  );
}
