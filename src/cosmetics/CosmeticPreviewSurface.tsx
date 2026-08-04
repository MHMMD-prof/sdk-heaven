import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '../theme';
import { CosmeticAssetRenderer } from './CosmeticAssetRenderer';
import type { CosmeticAssetBundle } from './assetRegistry';
import type { CosmeticsFeatureFlags } from './featureFlags';

export function CosmeticPreviewSurface({
  bundle,
  compatibilityUri,
  flags,
  onCompatibilityChange,
  style,
}: {
  bundle?: CosmeticAssetBundle;
  compatibilityUri?: string;
  flags: CosmeticsFeatureFlags;
  onCompatibilityChange?: (compatible: boolean) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const [state, setState] = useState<'loading' | 'ready' | 'fallback' | 'failed'>('loading');
  useEffect(() => onCompatibilityChange?.(state === 'ready'), [onCompatibilityChange, state]);
  return (
    <View style={[styles.root, style]}>
      <CosmeticAssetRenderer
        compatibilityUri={compatibilityUri}
        descriptor={bundle?.primary}
        fallbackDescriptor={bundle?.fallback}
        flags={flags}
        onError={() => setState('failed')}
        onStateChange={(next, source) => {
          if (next === 'loading') setState('loading');
          else if (next === 'ready' && source === 'primary') setState('ready');
          else if (source === 'fallback' || source === 'compatibility') setState('fallback');
          else if (next === 'failed' || next === 'disabled' || next === 'incompatible') setState('failed');
        }}
        style={StyleSheet.absoluteFill}
        viewerMode="full"
      />
      {state === 'loading' ? <ActivityIndicator color={colors.gold} /> : null}
      {state === 'fallback' || state === 'failed' ? (
        <Text style={styles.notice}>This item cannot be equipped on this device yet.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    backgroundColor: 'rgba(15,10,18,.88)',
    borderRadius: radius.md,
    bottom: spacing.sm,
    color: colors.goldSoft,
    fontSize: 11,
    left: spacing.sm,
    padding: spacing.sm,
    position: 'absolute',
    right: spacing.sm,
    textAlign: 'center',
  },
  root: {
    alignItems: 'center',
    backgroundColor: colors.backgroundDeep,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    height: 220,
    justifyContent: 'center',
    overflow: 'hidden',
    width: '100%',
  },
});
