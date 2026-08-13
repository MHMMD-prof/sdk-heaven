import { useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CosmeticAssetRenderer } from '../../cosmetics/CosmeticAssetRenderer';
import { usePublishedCosmeticAsset } from '../../cosmetics/assetRegistry';
import type { CosmeticsFeatureFlags } from '../../cosmetics/featureFlags';
import { recordPairRuntimeEvent } from '../../cosmetics/runtimeTelemetry';
import { colors, radius, spacing, typography } from '../../theme';
import { resolveBottomEffectStageAssetSelection } from '../../voice/bottomEffectStage';
import type { QueuedRoomEffect, RoomEffectViewerMode } from '../../voice/roomEffectsQueue';
import { BottomEffectStage } from './BottomEffectStage';
import { RocketMotionArtwork } from './RocketMotionArtwork';

export function RoomEffectOverlay({ bottomStageEnabled, effect, flags, onComplete, onError, viewerMode }: {
  bottomStageEnabled: boolean;
  effect: QueuedRoomEffect;
  flags: CosmeticsFeatureFlags;
  onComplete?: () => void;
  onError?: () => void;
  viewerMode: RoomEffectViewerMode;
}) {
  const [artworkFailed, setArtworkFailed] = useState(false);
  const majorGift = effect.kind === 'room-gift'
    && (effect.giftPresentationTier === 'major' || effect.giftPresentationTier === 'global');
  const bottomStageEffect = bottomStageEnabled && (effect.kind === 'room-entry' || majorGift);
  const giftMotionEnabled = effect.kind !== 'room-gift'
    || (flags.roomGiftAnimations && effect.animationEnabled === true);
  const entryMotionEnabled = effect.kind !== 'room-entry'
    || (flags.roomEntryAnimations && effect.animationEnabled === true);
  const entryFormatEnabled = effect.kind !== 'room-entry'
    || (effect.coupleEntrance
      ? flags.coupleEntrances
        && flags.coupleEffects
        && (effect.coupleAssetFormat === 'png' || flags.lottie)
      : effect.visualFormat === 'mp4'
        ? flags.roomEntryVideo && flags.video
        : flags.lottie);
  const customEntryAllowed = effect.kind !== 'room-entry'
    || effect.customSource !== true
    || flags.customRendering === true;
  const canonicalLookupEnabled = Boolean(
    flags.assetRegistry
    && flags.sharedRenderer
    && customEntryAllowed
    && effect.assetId
    && effect.assetVersionId,
  );
  const canonicalEnabled = canonicalLookupEnabled
    && giftMotionEnabled
    && entryMotionEnabled
    && entryFormatEnabled;
  const rendererFlags = useMemo(() => effect.kind === 'room-gift'
    ? {
      ...flags,
      effectAudio: flags.effectAudio && flags.roomGiftAudio && effect.audioEnabled === true,
      video: flags.video && flags.roomGiftVideo,
    }
    : effect.kind === 'room-entry'
      ? {
        ...flags,
        effectAudio: flags.effectAudio && flags.roomEntryAudio && effect.audioEnabled === true,
        video: flags.video && flags.roomEntryVideo,
      }
      : flags, [effect.audioEnabled, effect.kind, flags]);
  const bundle = usePublishedCosmeticAsset(
    effect.assetId,
    effect.assetVersionId,
    canonicalEnabled || (bottomStageEffect && canonicalLookupEnabled),
  );
  const customBundleAllowed = !bundle?.primary
    || bundle.primary.ownerType !== 'user'
    || flags.customRendering === true;
  const exactPairBundle = !effect.coupleEntrance || Boolean(
    bundle?.primary.category === 'couple-effect'
    && bundle.primary.assetId === effect.assetId
    && bundle.primary.assetVersionId === effect.assetVersionId
    && bundle.primary.format === effect.coupleAssetFormat
    && (effect.coupleAssetFormat === 'png'
      ? effect.fallbackAssetId === effect.assetId
        && effect.fallbackAssetVersionId === effect.assetVersionId
      : bundle.fallback?.assetId === effect.fallbackAssetId
        && bundle.fallback?.assetVersionId === effect.fallbackAssetVersionId),
  );
  const player = useAudioPlayer(
    effect.kind === 'room-rocket' && effect.presentation === 'visual'
      && !canonicalEnabled
      ? effect.soundUrl
      : undefined,
  );
  useEffect(() => {
    setArtworkFailed(false);
  }, [effect.eventId]);

  useEffect(() => {
    if (!effect.coupleEntrance) return;
    const render = effect.presentation === 'visual'
      && canonicalEnabled
      && Boolean(bundle?.primary)
      && exactPairBundle
      && !artworkFailed;
    recordPairRuntimeEvent(
      render ? 'pair-entrance-render' : 'pair-entrance-fallback',
      render ? undefined : artworkFailed ? 'renderer-error' : canonicalEnabled ? 'asset-unavailable' : 'flag-disabled',
    );
  }, [
    artworkFailed,
    bundle?.primary,
    canonicalEnabled,
    effect.coupleEntrance,
    effect.eventId,
    effect.presentation,
    exactPairBundle,
  ]);

  useEffect(() => {
    if (
      effect.kind !== 'room-gift'
      || viewerMode !== 'full'
      || !flags.roomGiftAnimations
      || effect.hapticPolicy === 'off'
    ) return;
    const feedback = effect.hapticPolicy === 'success'
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void feedback.catch(() => undefined);
  }, [effect.eventId, effect.hapticPolicy, effect.kind, flags.roomGiftAnimations, viewerMode]);

  useEffect(() => {
    if (
      canonicalEnabled
      || effect.kind !== 'room-rocket'
      || effect.presentation !== 'visual'
      || !effect.soundUrl
    ) return;
    try {
      player.seekTo(0);
      player.play();
    } catch {
      // The visual and built-in fallback remain available when sound cannot start.
    }
  }, [canonicalEnabled, effect.eventId, effect.kind, effect.presentation, effect.soundUrl, player]);

  const artwork = (
    <CosmeticAssetRenderer
      compatibilityUri={effect.thumbnailUrl}
      descriptor={canonicalEnabled ? bundle?.primary : undefined}
      fallbackDescriptor={canonicalEnabled ? bundle?.fallback : undefined}
      flags={rendererFlags}
      contentFit="contain"
      onComplete={effect.kind === 'room-gift' ? undefined : onComplete}
      onError={() => {
        setArtworkFailed(true);
        if (effect.kind === 'room-rocket') onError?.();
      }}
      style={effect.kind === 'room-rocket'
        ? styles.rocketArtwork
        : styles.thumbnail}
      viewerMode={viewerMode}
    />
  );
  const audio = canonicalEnabled && bundle?.audio ? (
    <CosmeticAssetRenderer
      descriptor={bundle.audio}
      flags={rendererFlags}
      muted={viewerMode !== 'full' || effect.audioEnabled !== true}
      viewerMode={viewerMode}
    />
  ) : null;

  if (bottomStageEffect) {
    const exactAssetAllowed = effect.kind !== 'room-entry' || exactPairBundle;
    const bundleAllowed = customBundleAllowed && exactAssetAllowed && !artworkFailed;
    const selection = resolveBottomEffectStageAssetSelection({
      hasCompatibility: effect.presentation === 'visual'
        && Boolean(effect.thumbnailUrl)
        && !artworkFailed,
      hasFallback: bundleAllowed && Boolean(bundle?.fallback),
      motionAllowed: effect.presentation === 'visual'
        && canonicalEnabled
        && bundleAllowed,
      primaryFormat: bundleAllowed ? bundle?.primary?.format : undefined,
    });
    const selectedDescriptor = selection.source === 'primary'
      ? bundle?.primary
      : selection.source === 'fallback' ? bundle?.fallback : undefined;
    const selectedFallback = selection.source === 'primary' ? bundle?.fallback : undefined;
    const compatibilityUri = selection.source === 'compatibility' ? effect.thumbnailUrl : undefined;

    return (
      <BottomEffectStage
        audio={audio}
        effect={effect}
        fallbackReason={selection.source === 'fallback' || selection.source === 'compatibility'
          ? 'asset-unavailable'
          : undefined}
        media={selection.media}
        onComplete={onComplete}
        onRendererError={() => setArtworkFailed(true)}
        renderArtwork={selection.source === 'none' ? undefined : ({
          onComplete: completeStage,
          onError: failStage,
          onFallback: fallbackStage,
          onShown: showStage,
        }) => (
          <CosmeticAssetRenderer
            compatibilityUri={compatibilityUri}
            contentFit="cover"
            descriptor={selectedDescriptor}
            fallbackDescriptor={selectedFallback}
            flags={rendererFlags}
            onComplete={completeStage}
            onError={failStage}
            onFirstFrame={() => showStage(selection.media === 'motion' ? 'motion' : 'static')}
            onStateChange={(state, source) => {
              if (
                selection.source === 'primary'
                && (source === 'fallback' || source === 'compatibility')
              ) {
                fallbackStage('renderer-error');
              }
              if (state === 'ready') {
                showStage(
                  source === 'fallback' || source === 'compatibility' || selection.media !== 'motion'
                    ? 'static'
                    : 'motion',
                );
              }
            }}
            style={styles.stageArtwork}
            viewerMode={viewerMode}
          />
        )}
        viewerMode={viewerMode}
      />
    );
  }

  if (effect.kind !== 'room-rocket') {
    return (
      <View
        accessibilityLabel={effect.label}
        accessibilityLiveRegion="polite"
        accessible
        pointerEvents="none"
        style={[
          styles.compact,
          effect.presentation === 'visual' && styles.visual,
          effect.giftPresentationTier === 'targeted' && styles.targeted,
        ]}
      >
        {effect.presentation === 'visual'
          && (bundle?.primary || effect.thumbnailUrl)
          && !artworkFailed ? artwork : null}
        {audio}
        <Text style={styles.compactText}>{effect.label}</Text>
        {effect.comboCount && effect.comboCount > 1 ? <Text style={styles.compactCombo}>×{effect.comboCount}</Text> : null}
      </View>
    );
  }

  if (effect.presentation !== 'visual') {
    return (
      <View accessibilityLiveRegion="polite" accessible style={styles.rocketReduced}>
        <Text style={styles.rocketReducedIcon}>🚀</Text>
        <Text style={styles.rocketReducedText}>{effect.label}</Text>
      </View>
    );
  }

  return (
    <View
      accessibilityLabel={`${effect.label}، تم فتح هدف الصاروخ`}
      accessibilityLiveRegion="polite"
      accessible
      pointerEvents="none"
      style={styles.rocketRoot}
    >
      <LinearGradient colors={['rgba(7,2,4,0.2)', 'rgba(91,8,18,0.94)', 'rgba(7,2,4,0.96)']} style={styles.rocketBackdrop}>
        <View style={styles.ringOuter} />
        <View style={styles.ringInner} />
        {audio}
        {!artworkFailed && (bundle?.primary || effect.thumbnailUrl || effect.posterUrl) ? (
          bundle?.primary ? (
            artwork
          ) : (
            <RocketMotionArtwork
              flags={flags}
              format={effect.visualFormat}
              motionUri={effect.thumbnailUrl}
              onComplete={onComplete}
              onError={() => {
                setArtworkFailed(true);
                onError?.();
              }}
              posterUri={effect.posterUrl}
              style={styles.rocketArtwork}
            />
          )
        ) : (
          <Text accessibilityLabel="صاروخ" style={styles.fallbackRocket}>🚀</Text>
        )}
        <Text style={styles.rocketEyebrow}>اكتمل هدف الغرفة</Text>
        <Text style={styles.rocketTitle}>{effect.label}</Text>
        <Text style={styles.rocketSub}>تم فتح مكافآت الداعمين لهذا الأسبوع</Text>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  compact: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(12, 5, 14, 0.96)',
    borderColor: colors.borderGold,
    borderRadius: radius.full,
    borderWidth: 1,
    bottom: 105,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    maxWidth: '88%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: 'absolute',
    zIndex: 30,
  },
  visual: { borderColor: colors.gold },
  thumbnail: { borderRadius: radius.full, height: 34, width: 34 },
  compactText: { color: colors.goldSoft, fontSize: 12, fontWeight: typography.weights.bold, textAlign: 'right' },
  compactCombo: { color: '#FFFFFF', fontSize: 12, fontWeight: typography.weights.black },
  targeted: { borderColor: '#D58CFF', borderWidth: 2, bottom: 170 },
  stageArtwork: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  rocketReduced: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#2E080D',
    borderColor: colors.gold,
    borderRadius: radius.full,
    borderWidth: 1,
    bottom: 105,
    flexDirection: 'row-reverse',
    gap: 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    position: 'absolute',
    zIndex: 40,
  },
  rocketReducedIcon: { fontSize: 19 },
  rocketReducedText: { color: '#FFE4AD', fontSize: 12, fontWeight: typography.weights.black },
  rocketRoot: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 50,
  },
  rocketBackdrop: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: spacing.xl,
  },
  ringOuter: {
    borderColor: 'rgba(242,180,84,0.45)',
    borderRadius: 180,
    borderWidth: 2,
    height: 310,
    position: 'absolute',
    width: 310,
  },
  ringInner: {
    backgroundColor: 'rgba(215,38,58,0.18)',
    borderColor: 'rgba(255,227,167,0.6)',
    borderRadius: 118,
    borderWidth: 1,
    height: 220,
    position: 'absolute',
    width: 220,
  },
  rocketArtwork: { height: 250, width: 250 },
  fallbackRocket: {
    fontSize: 112,
    marginBottom: spacing.md,
    textShadowColor: '#E62F48',
    textShadowOffset: { height: 0, width: 0 },
    textShadowRadius: 24,
    transform: [{ rotate: '-36deg' }],
  },
  rocketEyebrow: { color: '#EDB85F', fontSize: 12, fontWeight: typography.weights.bold, marginTop: spacing.md },
  rocketTitle: { color: '#FFF0CC', fontSize: 28, fontWeight: typography.weights.black, marginTop: 4, textAlign: 'center' },
  rocketSub: { color: '#F2C9CF', fontSize: 12, marginTop: 7, textAlign: 'center' },
});
