import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { CosmeticAssetRenderer } from '../../cosmetics/CosmeticAssetRenderer';
import { usePublishedCosmeticAsset } from '../../cosmetics/assetRegistry';
import type { CosmeticCategory, CosmeticViewerMode } from '../../cosmetics/contracts';
import type { CosmeticsFeatureFlags } from '../../cosmetics/featureFlags';
import { statusAsset, type StatusAssetSlot, type StatusPresentation } from '../../status/statusPresentation';

const CATEGORY: Record<StatusAssetSlot, CosmeticCategory> = {
  badge: 'cosmetic-badge',
  chatBubble: 'chat-bubble',
  entryEffect: 'entry-effect',
  frame: 'avatar-frame',
  nameplate: 'nameplate',
};

export function StatusBenefitAsset({ flags, presentation, slot, style, viewerMode = 'reduced' }: {
  flags: CosmeticsFeatureFlags;
  presentation?: StatusPresentation;
  slot: StatusAssetSlot;
  style?: StyleProp<ViewStyle>;
  viewerMode?: CosmeticViewerMode;
}) {
  const reference = statusAsset(presentation, slot);
  const enabled = Boolean(flags.assetRegistry && flags.sharedRenderer && reference);
  const bundle = usePublishedCosmeticAsset(reference?.assetId, reference?.assetVersionId, enabled);
  if (!enabled || !bundle || bundle.primary.ownerType !== 'platform' || bundle.primary.category !== CATEGORY[slot]) return null;
  const rendererFlags = { ...flags, effectAudio: false, video: false };
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={style}>
      <CosmeticAssetRenderer descriptor={bundle.primary} fallbackDescriptor={bundle.fallback} flags={rendererFlags} muted style={StyleSheet.absoluteFill} viewerMode={viewerMode} />
    </View>
  );
}
