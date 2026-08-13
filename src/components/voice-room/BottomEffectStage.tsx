import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '../../theme';
import { recordBottomEffectStageRuntimeEvent } from '../../cosmetics/runtimeTelemetry';
import {
  claimBottomEffectCompletion,
  claimBottomEffectStageOutcome,
  BOTTOM_EFFECT_POINTER_EVENTS,
  resolveBottomEffectStageCopy,
  resolveBottomEffectStageGeometry,
  resolveBottomEffectStageIdentities,
  resolveBottomEffectStagePresentation,
  type BottomEffectStageMedia,
} from '../../voice/bottomEffectStage';
import type { QueuedRoomEffect, RoomEffectViewerMode } from '../../voice/roomEffectsQueue';

type StageRendererCallbacks = {
  onComplete: () => void;
  onError: (reason: string) => void;
  onFallback: (reason: 'asset-unavailable' | 'renderer-error') => void;
  onShown: (presentation: 'motion' | 'static') => void;
};

type BottomEffectStageProps = {
  audio?: ReactNode;
  avatarUris?: Partial<Record<string, string>>;
  effect: QueuedRoomEffect;
  fallbackReason?: 'asset-unavailable';
  media: BottomEffectStageMedia;
  onComplete?: () => void;
  onRendererError?: (reason: string) => void;
  renderArtwork?: (callbacks: StageRendererCallbacks) => ReactNode;
  viewerMode: RoomEffectViewerMode;
};

export function BottomEffectStage({
  audio,
  avatarUris,
  effect,
  fallbackReason,
  media,
  onComplete,
  onRendererError,
  renderArtwork,
  viewerMode,
}: BottomEffectStageProps) {
  const insets = useSafeAreaInsets();
  const viewport = useWindowDimensions();
  const [rendererFailed, setRendererFailed] = useState(false);
  const completionStateRef = useRef({ eventId: effect.eventId, settled: false });
  const outcomeStateRef = useRef({
    eventId: effect.eventId,
    recorded: new Set<'shown' | 'fallback' | 'failed'>(),
  });
  const completionRef = useRef(onComplete);
  completionRef.current = onComplete;

  useEffect(() => {
    completionStateRef.current = { eventId: effect.eventId, settled: false };
    outcomeStateRef.current = { eventId: effect.eventId, recorded: new Set() };
    setRendererFailed(false);
  }, [effect.eventId]);

  const finishOnce = useCallback(() => {
    if (!claimBottomEffectCompletion(completionStateRef.current, effect.eventId)) return;
    completionRef.current?.();
  }, [effect.eventId]);
  const recordFallbackOnce = useCallback((reason: 'asset-unavailable' | 'renderer-error') => {
    if (!claimBottomEffectStageOutcome(outcomeStateRef.current, effect.eventId, 'fallback')) return;
    recordBottomEffectStageRuntimeEvent('bottom-stage-fallback', {
      kind: effect.kind === 'room-gift' ? 'gift' : 'entry',
      reason,
    });
  }, [effect.eventId, effect.kind]);
  const recordShownOnce = useCallback((shownPresentation: 'motion' | 'static') => {
    if (!claimBottomEffectStageOutcome(outcomeStateRef.current, effect.eventId, 'shown')) return;
    recordBottomEffectStageRuntimeEvent('bottom-stage-shown', {
      kind: effect.kind === 'room-gift' ? 'gift' : 'entry',
      presentation: shownPresentation,
    });
  }, [effect.eventId, effect.kind]);
  const failArtwork = useCallback((reason: string) => {
    if (!claimBottomEffectStageOutcome(outcomeStateRef.current, effect.eventId, 'failed')) return;
    setRendererFailed(true);
    const kind = effect.kind === 'room-gift' ? 'gift' : 'entry';
    recordBottomEffectStageRuntimeEvent('bottom-stage-decode-error', {
      kind,
      reason: 'renderer-error',
    });
    onRendererError?.(reason);
  }, [effect.eventId, effect.kind, onRendererError]);

  const geometry = resolveBottomEffectStageGeometry({
    safeAreaBottom: insets.bottom,
    viewportHeight: viewport.height,
    viewportWidth: viewport.width,
  });
  const presentation = resolveBottomEffectStagePresentation(
    viewerMode,
    rendererFailed ? 'none' : media,
  );
  const copy = resolveBottomEffectStageCopy(effect);
  const identities = resolveBottomEffectStageIdentities(effect);

  useEffect(() => {
    const kind = effect.kind === 'room-gift' ? 'gift' : 'entry';
    if (viewerMode !== 'full') {
      recordBottomEffectStageRuntimeEvent('bottom-stage-reduced', {
        kind,
        presentation: 'compact',
      });
      return;
    }
    if (rendererFailed) {
      recordShownOnce('static');
      recordFallbackOnce('renderer-error');
      return;
    }
    if (media === 'none') {
      recordShownOnce('static');
      recordFallbackOnce('asset-unavailable');
    } else if (fallbackReason) {
      recordFallbackOnce(fallbackReason);
    }
  }, [effect.eventId, effect.kind, fallbackReason, media, recordFallbackOnce, recordShownOnce, rendererFailed, viewerMode]);

  if (presentation === 'compact') {
    return (
      <View
        accessibilityLabel={copy}
        accessibilityLiveRegion="polite"
        accessible
        pointerEvents={BOTTOM_EFFECT_POINTER_EVENTS}
        style={[styles.compact, { bottom: geometry.bottom }]}
        testID="bottom-effect-stage-compact"
      >
        <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.compactIcon}>
          {effect.kind === 'room-gift' ? '🎁' : '✨'}
        </Text>
        <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.compactText}>
          {copy}
        </Text>
      </View>
    );
  }

  const showArtwork = !rendererFailed && media !== 'none' && Boolean(renderArtwork);
  return (
    <View
      accessibilityLabel={copy}
      accessibilityLiveRegion="polite"
      accessible
      pointerEvents={BOTTOM_EFFECT_POINTER_EVENTS}
      style={[
        styles.root,
        {
          bottom: geometry.bottom,
          height: geometry.height,
          left: geometry.left,
          right: geometry.right,
          zIndex: geometry.zIndex,
        },
      ]}
      testID="bottom-effect-stage"
    >
      <View pointerEvents="none" style={styles.clippedCanvas}>
        {presentation === 'visual' ? audio : null}
        {showArtwork ? renderArtwork?.({
          onComplete: finishOnce,
          onError: failArtwork,
          onFallback: recordFallbackOnce,
          onShown: recordShownOnce,
        }) : (
          <View style={styles.fallbackArtwork}>
            <Text style={styles.fallbackIcon}>{effect.kind === 'room-gift' ? '🎁' : '✨'}</Text>
          </View>
        )}
        <LinearGradient
          colors={['rgba(8,4,5,0.74)', 'rgba(8,4,5,0.02)', 'rgba(8,4,5,0.08)']}
          locations={[0, 0.22, 0.7]}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          colors={['rgba(8,4,5,0)', 'rgba(8,4,5,0.16)', 'rgba(8,4,5,0.96)']}
          locations={[0, 0.62, 1]}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" style={styles.banner}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.identities}>
            {identities.map((item, index) => (
              <View
                key={item.key}
                style={[
                  styles.avatar,
                  index > 0 && styles.avatarOverlap,
                  item.role === 'recipient' && styles.recipientAvatar,
                ]}
              >
                {avatarUris?.[item.key] || avatarUris?.[item.role] ? (
                  <Image
                    accessibilityIgnoresInvertColors
                    contentFit="cover"
                    source={{ uri: avatarUris[item.key] || avatarUris[item.role] }}
                    style={styles.avatarImage}
                  />
                ) : (
                  <Text style={styles.avatarText}>{item.initial}</Text>
                )}
              </View>
            ))}
          </View>
          <Text
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            numberOfLines={2}
            style={styles.bannerText}
          >
            {copy}
          </Text>
        </View>
        <StageMetadata effect={effect} />
      </View>
    </View>
  );
}

function StageMetadata({ effect }: { effect: QueuedRoomEffect }) {
  if (effect.kind !== 'room-gift') return null;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.metadata}>
      {effect.theaterKind === 'storm' ? <Text style={styles.metadataText}>عاصفة هدايا</Text> : null}
      {effect.comboCount && effect.comboCount > 1 ? (
        <Text style={styles.comboText}>COMBO ×{effect.comboCount}</Text>
      ) : null}
      {effect.luckyOutcome?.kind === 'display-crumb' ? (
        <Text style={styles.metadataText}>حظ: {effect.luckyOutcome.labelAr} · {effect.luckyOutcome.oddsLabelAr}</Text>
      ) : null}
      {effect.magicFrame ? (
        <View style={[styles.magicFrame, { borderColor: effect.magicFrame.accentColor }]}>
          <Text style={styles.metadataText}>{effect.magicFrame.labelAr}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
    position: 'absolute',
  },
  clippedCanvas: {
    backgroundColor: '#080405',
    borderColor: 'rgba(214,168,79,0.25)',
    borderRadius: radius.lg,
    borderWidth: 1,
    flex: 1,
    overflow: 'hidden',
  },
  fallbackArtwork: {
    alignItems: 'center',
    backgroundColor: '#170A11',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  fallbackIcon: {
    fontSize: 74,
    textShadowColor: 'rgba(214,168,79,0.56)',
    textShadowOffset: { height: 0, width: 0 },
    textShadowRadius: 24,
  },
  banner: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(13,8,11,0.9)',
    borderColor: 'rgba(244,213,138,0.72)',
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    left: spacing.md,
    maxWidth: '92%',
    minHeight: 48,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    position: 'absolute',
    right: spacing.md,
    top: spacing.sm,
  },
  bannerText: {
    color: '#FFF4DE',
    flex: 1,
    fontSize: 12,
    fontWeight: typography.weights.black,
    lineHeight: 17,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  identities: {
    flexDirection: 'row-reverse',
    paddingLeft: 4,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.ruby,
    borderColor: '#FFF4DE',
    borderRadius: radius.full,
    borderWidth: 2,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  recipientAvatar: {
    backgroundColor: '#276E73',
  },
  avatarOverlap: {
    marginRight: -9,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: typography.weights.black,
  },
  avatarImage: {
    borderRadius: radius.full,
    height: '100%',
    width: '100%',
  },
  metadata: {
    alignItems: 'center',
    bottom: spacing.sm,
    gap: 3,
    left: spacing.md,
    position: 'absolute',
    right: spacing.md,
  },
  metadataText: {
    color: '#FFE9A8',
    fontSize: 11,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
  },
  comboText: {
    color: '#F3C4FF',
    fontSize: 16,
    fontWeight: typography.weights.black,
  },
  magicFrame: {
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 2,
  },
  compact: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(12,5,14,0.96)',
    borderColor: colors.borderGold,
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    left: spacing.xl,
    maxWidth: '88%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: 'absolute',
    right: spacing.xl,
    zIndex: 10,
  },
  compactIcon: { fontSize: 20 },
  compactText: {
    color: colors.goldSoft,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
