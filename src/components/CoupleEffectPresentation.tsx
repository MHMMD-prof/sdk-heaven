import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { CosmeticAssetRenderer } from '../cosmetics/CosmeticAssetRenderer';
import { usePublishedCosmeticAsset } from '../cosmetics/assetRegistry';
import {
  resolveCoupleEffectSurface,
  type CoupleEffectProjection,
  type CoupleEffectSurface,
} from '../cosmetics/coupleEffects';
import type { CosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import { recordPairRuntimeEvent } from '../cosmetics/runtimeTelemetry';

export function CoupleEffectPresentation({
  flags,
  projection,
  style,
  surface,
}: {
  flags: CosmeticsFeatureFlags;
  projection?: CoupleEffectProjection;
  style?: StyleProp<ViewStyle>;
  surface: CoupleEffectSurface;
}) {
  const reducedMotion = useReducedMotion();
  const enabled = flags.coupleEffects && flags.assetRegistry && flags.sharedRenderer;
  const plan = resolveCoupleEffectSurface({ enabled, projection, reducedMotion, surface });
  const bundle = usePublishedCosmeticAsset(
    projection?.assetId,
    projection?.assetVersionId,
    plan.renderCoupleEffect,
  );
  const validBundle = Boolean(
    bundle
    && projection
    && bundle.primary.category === 'couple-effect'
    && ['png', 'lottie-json'].includes(bundle.primary.format)
    && bundle.primary.assetId === projection.assetId
    && bundle.primary.assetVersionId === projection.assetVersionId
    && bundle.primary.format === projection.format
    && (
      projection.format !== 'lottie-json'
      || (
        bundle.fallback?.assetId === projection.fallbackAssetId
        && bundle.fallback.assetVersionId === projection.fallbackAssetVersionId
      )
    )
  );
  useEffect(() => {
    if (!projection) return;
    if (!plan.renderCoupleEffect) {
      recordPairRuntimeEvent('pair-projection-fallback', enabled ? 'motion-reduced' : 'flag-disabled');
    } else if (validBundle) {
      recordPairRuntimeEvent('pair-projection-render');
    } else {
      recordPairRuntimeEvent('pair-projection-fallback', 'asset-unavailable');
    }
  }, [enabled, plan.renderCoupleEffect, projection, validBundle]);
  if (!plan.renderCoupleEffect || !bundle || !validBundle) return null;
  return (
    <View pointerEvents="none" style={style}>
      <CosmeticAssetRenderer
        descriptor={bundle.primary}
        fallbackDescriptor={bundle.fallback}
        flags={{ ...flags, effectAudio: false, video: false }}
        muted
        style={StyleSheet.absoluteFill}
        viewerMode={plan.viewerMode}
      />
    </View>
  );
}

function useReducedMotion() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setEnabled(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setEnabled);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return enabled;
}
