import { useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CosmeticAssetRenderer } from '../../cosmetics/CosmeticAssetRenderer';
import { usePublishedCosmeticAsset } from '../../cosmetics/assetRegistry';
import type { CosmeticsFeatureFlags } from '../../cosmetics/featureFlags';
import { colors, radius, spacing, typography } from '../../theme';
import type { QueuedRoomEffect, RoomEffectViewerMode } from '../../voice/roomEffectsQueue';

export function RoomEffectOverlay({ effect, flags, onComplete, onError, viewerMode }: {
  effect: QueuedRoomEffect;
  flags: CosmeticsFeatureFlags;
  onComplete?: () => void;
  onError?: () => void;
  viewerMode: RoomEffectViewerMode;
}) {
  const [artworkFailed, setArtworkFailed] = useState(false);
  const giftMotionEnabled = effect.kind !== 'room-gift'
    || (flags.roomGiftAnimations && effect.animationEnabled === true);
  const entryMotionEnabled = effect.kind !== 'room-entry'
    || (flags.roomEntryAnimations && effect.animationEnabled === true);
  const entryFormatEnabled = effect.kind !== 'room-entry'
    || (effect.visualFormat === 'mp4'
      ? flags.roomEntryVideo && flags.video
      : flags.lottie);
  const canonicalEnabled = Boolean(
    flags.assetRegistry
    && flags.sharedRenderer
    && giftMotionEnabled
    && entryMotionEnabled
    && entryFormatEnabled
    && effect.assetId
    && effect.assetVersionId,
  );
  const rendererFlags = effect.kind === 'room-gift'
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
      : flags;
  const bundle = usePublishedCosmeticAsset(
    effect.assetId,
    effect.assetVersionId,
    canonicalEnabled,
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
      descriptor={bundle?.primary}
      fallbackDescriptor={bundle?.fallback}
      flags={rendererFlags}
      contentFit="contain"
      onComplete={effect.kind === 'room-gift' ? undefined : onComplete}
      onError={() => {
        setArtworkFailed(true);
        if (effect.kind === 'room-rocket') onError?.();
      }}
      style={effect.kind === 'room-rocket'
        ? styles.rocketArtwork
        : effect.kind === 'room-entry' ? styles.entryArtwork : styles.thumbnail}
      viewerMode={viewerMode}
    />
  );
  const audio = bundle?.audio ? (
    <CosmeticAssetRenderer
      descriptor={bundle.audio}
      flags={rendererFlags}
      muted={viewerMode !== 'full' || effect.audioEnabled !== true}
      viewerMode={viewerMode}
    />
  ) : null;

  if (effect.kind === 'room-entry') {
    const showMotion = effect.presentation === 'visual'
      && canonicalEnabled
      && Boolean(bundle?.primary)
      && !artworkFailed;
    if (!showMotion) {
      return (
        <View accessibilityLabel={effect.label} accessibilityLiveRegion="polite" accessible pointerEvents="none" style={styles.compact}>
          {effect.thumbnailUrl && !artworkFailed ? (
            <CosmeticAssetRenderer compatibilityUri={effect.thumbnailUrl} flags={flags} style={styles.thumbnail} viewerMode={viewerMode === 'off' ? 'reduced' : viewerMode} />
          ) : null}
          <Text style={styles.compactText}>{effect.label}</Text>
        </View>
      );
    }
    return (
      <View accessibilityLabel={effect.label} accessibilityLiveRegion="polite" accessible pointerEvents="none" style={styles.entryRoot}>
        <LinearGradient colors={['rgba(9,4,14,0)', 'rgba(25,8,35,0.82)', 'rgba(9,4,14,0)']} style={styles.entryBackdrop}>
          {audio}
          {artwork}
          <Text style={styles.entryLabel}>{effect.label}</Text>
        </LinearGradient>
      </View>
    );
  }

  if (effect.kind !== 'room-rocket') {
    const majorGift = effect.kind === 'room-gift'
      && effect.presentation === 'visual'
      && (effect.giftPresentationTier === 'major' || effect.giftPresentationTier === 'global');
    if (majorGift) {
      return (
        <View
          accessibilityLabel={effect.label}
          accessibilityLiveRegion="polite"
          accessible
          pointerEvents="none"
          style={[styles.giftMajorRoot, effect.giftPresentationTier === 'global' && styles.giftGlobalRoot]}
        >
          <LinearGradient colors={['rgba(15,5,22,0.12)', 'rgba(54,13,70,0.86)', 'rgba(8,3,13,0.94)']} style={styles.giftMajorBackdrop}>
            {audio}
            {(bundle?.primary || effect.thumbnailUrl) && !artworkFailed ? artwork : (
              <Text style={styles.giftFallbackIcon}>🎁</Text>
            )}
            <Text style={styles.giftMajorTitle}>{effect.label}</Text>
            {effect.comboCount && effect.comboCount > 1 ? <Text style={styles.giftCombo}>COMBO ×{effect.comboCount}</Text> : null}
          </LinearGradient>
        </View>
      );
    }
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
        {(bundle?.primary || effect.thumbnailUrl) && !artworkFailed ? (
          artwork
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
  entryRoot: {
    bottom: 104,
    height: 260,
    left: 12,
    overflow: 'hidden',
    position: 'absolute',
    right: 12,
    zIndex: 44,
  },
  entryBackdrop: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    paddingBottom: spacing.sm,
  },
  entryArtwork: { height: 220, width: '100%' },
  entryLabel: {
    backgroundColor: 'rgba(12,5,14,0.88)',
    borderColor: colors.borderGold,
    borderRadius: radius.full,
    borderWidth: 1,
    bottom: spacing.sm,
    color: colors.goldSoft,
    fontSize: 12,
    fontWeight: typography.weights.black,
    maxWidth: '90%',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    position: 'absolute',
    textAlign: 'center',
  },
  giftMajorRoot: {
    bottom: 88,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 45,
  },
  giftGlobalRoot: { zIndex: 46 },
  giftMajorBackdrop: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  giftFallbackIcon: { fontSize: 96 },
  giftMajorTitle: { color: '#FFF0CC', fontSize: 22, fontWeight: typography.weights.black, marginTop: spacing.md, textAlign: 'center' },
  giftCombo: { color: '#F3C4FF', fontSize: 18, fontWeight: typography.weights.black, marginTop: spacing.sm },
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
