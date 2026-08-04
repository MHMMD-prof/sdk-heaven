import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';
import { CosmeticAssetRenderer } from '../../cosmetics/CosmeticAssetRenderer';
import { usePublishedCosmeticAsset } from '../../cosmetics/assetRegistry';
import type { CosmeticsFeatureFlags } from '../../cosmetics/featureFlags';
import type { QueuedRoomEffect } from '../../voice/roomEffectsQueue';
import { RoomSeatViewModel } from '../../voice/roomMainScreenModel';
import {
  MAJLIS_DEFAULT_MANIFEST,
  RoomThemeManifestV1,
  RoomThemeSeatPositionV1,
} from '../../voice/roomThemeContract';
import { RepresentativeBadge } from '../RepresentativeBadge';
import { AvatarFrameLayer } from '../AvatarPresentation';
import { EquipmentCosmeticAsset } from '../EquipmentCosmeticAsset';

type VoiceRoomStageProps = {
  cosmeticsFlags: CosmeticsFeatureFlags;
  manifest?: RoomThemeManifestV1;
  modeLabel: string;
  onSeatPress: (seat: RoomSeatViewModel) => void;
  pendingSeatId?: string;
  seats: RoomSeatViewModel[];
  targetedGiftEffect?: QueuedRoomEffect;
};

export function VoiceRoomStage({
  cosmeticsFlags,
  manifest = MAJLIS_DEFAULT_MANIFEST,
  modeLabel,
  onSeatPress,
  pendingSeatId,
  seats,
  targetedGiftEffect,
}: VoiceRoomStageProps) {
  const [stageWidth, setStageWidth] = useState(0);
  const reduceMotion = useReducedMotion();
  const height = stageHeight(seats.length);
  const layout = manifest.layouts[String(seats.length) as keyof RoomThemeManifestV1['layouts']]
    ?? MAJLIS_DEFAULT_MANIFEST.layouts[String(seats.length) as keyof RoomThemeManifestV1['layouts']];
  const positions = useMemo(
    () => new Map(layout?.map((position) => [position.seatNumber, position]) ?? []),
    [layout],
  );
  const handleLayout = (event: LayoutChangeEvent) => setStageWidth(event.nativeEvent.layout.width);

  return (
    <View style={styles.root}>
      <View style={styles.heading}>
        <View style={[styles.modePill, { borderColor: manifest.colors.gold }]}>
          <View style={styles.liveDot} />
          <Text style={[styles.modeLabel, { color: manifest.colors.textMuted }]}>{modeLabel}</Text>
        </View>
        <Text style={[styles.headingTitle, { color: manifest.colors.text }]}>منصة المقاعد</Text>
      </View>
      <View
        accessibilityRole="summary"
        onLayout={handleLayout}
        style={[
          styles.stage,
          {
            backgroundColor: `${manifest.colors.panel}B8`,
            borderColor: `${manifest.colors.gold}55`,
            height,
          },
        ]}
      >
        {stageWidth > 0 ? seats.map((seat) => (
          <PositionedSeat
            key={seat.id}
            height={height}
            cosmeticsFlags={cosmeticsFlags}
            manifest={manifest}
            onPress={() => onSeatPress(seat)}
            pending={pendingSeatId === seat.id}
            position={positions.get(seat.seatNumber) ?? fallbackPosition(seat.seatNumber, seats.length)}
            reduceMotion={reduceMotion}
            seat={seat}
            targetedGiftEffect={targetedGiftEffect?.recipientUid === seat.participant?.id ? targetedGiftEffect : undefined}
            width={stageWidth}
          />
        )) : null}
      </View>
    </View>
  );
}

function PositionedSeat({
  cosmeticsFlags,
  height,
  manifest,
  onPress,
  pending,
  position,
  reduceMotion,
  seat,
  targetedGiftEffect,
  width,
}: {
  cosmeticsFlags: CosmeticsFeatureFlags;
  height: number;
  manifest: RoomThemeManifestV1;
  onPress: () => void;
  pending: boolean;
  position: RoomThemeSeatPositionV1;
  reduceMotion: boolean;
  seat: RoomSeatViewModel;
  targetedGiftEffect?: QueuedRoomEffect;
  width: number;
}) {
  const x = Math.max(0, Math.min(width - 66, position.x * width - 33));
  const y = Math.max(0, Math.min(height - 72, position.y * height - 30));
  const translation = useRef(new Animated.ValueXY({ x, y })).current;

  useEffect(() => {
    if (reduceMotion) {
      translation.setValue({ x, y });
      return;
    }
    Animated.timing(translation, {
      duration: 250,
      easing: Easing.out(Easing.cubic),
      toValue: { x, y },
      useNativeDriver: true,
    }).start();
  }, [reduceMotion, translation, x, y]);

  return (
    <Animated.View
      style={[
        styles.positionedSeat,
        {
          transform: [
            { translateX: translation.x },
            { translateY: translation.y },
            { scale: position.scale },
          ],
          zIndex: position.z,
        },
      ]}
    >
      <Seat
        cosmeticsFlags={cosmeticsFlags}
        emptyColors={[manifest.colors.goldSoft, manifest.colors.panelRaised]}
        onPress={onPress}
        pending={pending}
        seat={seat}
        targetedGiftEffect={targetedGiftEffect}
      />
    </Animated.View>
  );
}

function Seat({
  cosmeticsFlags,
  emptyColors,
  onPress,
  pending,
  seat,
  targetedGiftEffect,
}: {
  cosmeticsFlags: CosmeticsFeatureFlags;
  emptyColors: [string, string];
  onPress: () => void;
  pending: boolean;
  seat: RoomSeatViewModel;
  targetedGiftEffect?: QueuedRoomEffect;
}) {
  const canPress = seat.action !== null && !pending;
  const isOccupied = !!seat.participant;
  const muted = seat.participant?.isMuted;
  const ownedFrame = seat.participant?.avatarFrameAssetUrl && seat.participant.avatarFrameItemId
    ? {
      assetUrl: seat.participant.avatarFrameAssetUrl,
      itemId: seat.participant.avatarFrameItemId,
      ...(seat.participant.avatarFrameAssetId && seat.participant.avatarFrameAssetVersionId ? {
        canonicalAsset: {
          assetId: seat.participant.avatarFrameAssetId,
          assetVersionId: seat.participant.avatarFrameAssetVersionId,
        },
      } : {}),
    }
    : undefined;

  return (
    <Pressable
      accessibilityLabel={seat.accessibilityLabel}
      accessibilityRole={canPress ? 'button' : 'text'}
      accessibilityState={{ disabled: !canPress, busy: pending }}
      disabled={!canPress}
      onPress={onPress}
      style={styles.seatCell}
    >
      {isOccupied ? <EquipmentCosmeticAsset category="seat-effect" enabled={cosmeticsFlags.seatEffects} flags={cosmeticsFlags} projection={seat.participant?.equipmentCosmetics?.seatEffect} style={styles.seatEffect} /> : null}
      <View
        style={[
          styles.statusHalo,
          seat.isSpeaking && styles.speakingHalo,
          seat.state === 'locked' && styles.lockedFrame,
          seat.state === 'reconnecting' && styles.reconnectingFrame,
          seat.state === 'retiring' && styles.retiringFrame,
        ]}
      >
        <View
          style={[
            styles.avatarFrame,
            !isOccupied && {
              backgroundColor: emptyColors[1],
              borderColor: `${emptyColors[0]}99`,
            },
          ]}
        >
          <View style={[styles.avatarInner, seat.isSpeaking && styles.speakingInner]}>
            {seat.participant ? (
              <Text style={styles.avatarText}>{seat.participant.avatarLabel}</Text>
            ) : (
              <SymbolView
                name={
                  seat.state === 'locked'
                    ? { ios: 'lock.fill', android: 'lock', web: 'lock' }
                    : seat.state === 'reconnecting'
                      ? { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }
                      : { ios: 'plus', android: 'add', web: 'add' }
                }
                size={seat.state === 'locked' ? 17 : 21}
                tintColor={seat.state === 'locked' ? colors.textSubtle : emptyColors[0]}
              />
            )}
          </View>
          {isOccupied && ownedFrame ? (
            <AvatarFrameLayer
              flags={cosmeticsFlags}
              frame={ownedFrame}
              renderLegacyWhenUnifiedDisabled
            />
          ) : null}
          {muted ? (
            <View style={styles.muteBadge}>
              <SymbolView
                name={{ ios: 'mic.slash.fill', android: 'mic_off', web: 'mic_off' }}
                size={10}
                tintColor="#FFFFFF"
              />
            </View>
          ) : null}
          {seat.isOwner || seat.isModerator ? (
            <View style={[styles.roleBadge, seat.isModerator && styles.moderatorBadge]}>
              <SymbolView
                name={
                  seat.isOwner
                    ? { ios: 'crown.fill', android: 'workspace_premium', web: 'workspace_premium' }
                    : { ios: 'shield.fill', android: 'shield', web: 'shield' }
                }
                size={9}
                tintColor={seat.isOwner ? '#2A1604' : '#FFFFFF'}
              />
            </View>
          ) : null}
          <RepresentativeBadge
            active={seat.participant?.representativeBadgeActive}
            style={styles.representativeBadge}
          />
        </View>
      </View>
      <View style={styles.nameShell}>
        {isOccupied ? <EquipmentCosmeticAsset category="nameplate" enabled={cosmeticsFlags.nameplates} flags={cosmeticsFlags} projection={seat.participant?.equipmentCosmetics?.nameplate} style={styles.seatNameplate} /> : null}
        <Text numberOfLines={1} style={[styles.name, seat.isSpeaking && styles.speakingName]}>
          {seat.participant?.displayName || (pending ? 'جارٍ التنفيذ…' : `مقعد ${seat.seatNumber}`)}
        </Text>
        {isOccupied ? <EquipmentCosmeticAsset category="cosmetic-badge" enabled={cosmeticsFlags.cosmeticBadges} flags={cosmeticsFlags} projection={seat.participant?.equipmentCosmetics?.cosmeticBadge} style={styles.seatCosmeticBadge} /> : null}
      </View>
      <Text style={styles.seatNumber}>#{seat.seatNumber}</Text>
      {targetedGiftEffect ? (
        <TargetedGiftEffect effect={targetedGiftEffect} flags={cosmeticsFlags} />
      ) : null}
    </Pressable>
  );
}

function TargetedGiftEffect({ effect, flags }: { effect: QueuedRoomEffect; flags: CosmeticsFeatureFlags }) {
  const enabled = Boolean(
    flags.assetRegistry
    && flags.sharedRenderer
    && flags.roomGiftAnimations
    && effect.animationEnabled
    && effect.assetId
    && effect.assetVersionId,
  );
  const bundle = usePublishedCosmeticAsset(effect.assetId, effect.assetVersionId, enabled);
  const rendererFlags = {
    ...flags,
    effectAudio: flags.effectAudio && flags.roomGiftAudio && effect.audioEnabled === true,
    video: flags.video && flags.roomGiftVideo,
  };
  useEffect(() => {
    if (!flags.roomGiftAnimations || effect.hapticPolicy === 'off') return;
    const feedback = effect.hapticPolicy === 'success'
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void feedback.catch(() => undefined);
  }, [effect.eventId, effect.hapticPolicy, flags.roomGiftAnimations]);
  return (
    <View accessibilityLabel={effect.label} pointerEvents="none" style={styles.targetedGift}>
      {bundle?.primary ? (
        <CosmeticAssetRenderer
          descriptor={bundle.primary}
          fallbackDescriptor={bundle.fallback}
          flags={rendererFlags}
          style={styles.targetedGiftArtwork}
          viewerMode="full"
        />
      ) : <Text style={styles.targetedGiftFallback}>🎁</Text>}
      {bundle?.audio && effect.audioEnabled ? (
        <CosmeticAssetRenderer descriptor={bundle.audio} flags={rendererFlags} viewerMode="full" />
      ) : null}
      {effect.comboCount && effect.comboCount > 1 ? <Text style={styles.targetedGiftCombo}>×{effect.comboCount}</Text> : null}
      <Text numberOfLines={2} style={styles.targetedGiftLabel}>{effect.label}</Text>
    </View>
  );
}

function useReducedMotion() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setEnabled(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setEnabled);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return enabled;
}

function stageHeight(count: number) {
  if (count <= 5) return 148;
  if (count <= 10) return 210;
  if (count <= 15) return 252;
  return 286;
}

function fallbackPosition(seatNumber: number, count: number): RoomThemeSeatPositionV1 {
  const columns = 5;
  const rows = Math.ceil(count / columns);
  const index = seatNumber - 1;
  return {
    seatNumber,
    x: ((index % columns) + 0.5) / columns,
    y: (Math.floor(index / columns) + 0.5) / rows,
    scale: 1,
    z: seatNumber,
  };
}

const styles = StyleSheet.create({
  root: {
    flexShrink: 1,
    paddingTop: spacing.sm,
  },
  heading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  headingTitle: {
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  modePill: {
    alignItems: 'center',
    backgroundColor: 'rgba(3,2,7,0.72)',
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  liveDot: {
    backgroundColor: colors.emerald,
    borderRadius: radius.full,
    height: 6,
    width: 6,
  },
  modeLabel: {
    fontSize: 9,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  stage: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  positionedSeat: {
    left: 0,
    position: 'absolute',
    top: 0,
  },
  seatCell: {
    alignItems: 'center',
    minHeight: 72,
    width: 66,
  },
  seatEffect: { height: 64, position: 'absolute', top: -5, width: 64, zIndex: 1 },
  statusHalo: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: radius.full,
    borderWidth: 2,
    height: 54,
    justifyContent: 'center',
    width: 54,
    zIndex: 2,
  },
  speakingHalo: {
    borderColor: colors.emerald,
    shadowColor: colors.emerald,
    shadowOpacity: 0.9,
    shadowRadius: 7,
  },
  avatarFrame: {
    alignItems: 'center',
    backgroundColor: '#17131A',
    borderColor: 'rgba(255,255,255,0.26)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    position: 'relative',
    width: 48,
  },
  avatarInner: {
    alignItems: 'center',
    backgroundColor: '#120B19',
    borderRadius: radius.full,
    height: 42,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 42,
  },
  speakingInner: {
    backgroundColor: '#09261E',
  },
  ownedAvatarFrame: {
    height: 60,
    position: 'absolute',
    width: 60,
    zIndex: 4,
  },
  lockedFrame: {
    opacity: 0.56,
  },
  reconnectingFrame: {
    borderColor: colors.goldSoft,
    borderStyle: 'dashed',
  },
  retiringFrame: {
    opacity: 0.72,
  },
  avatarText: {
    color: colors.goldSoft,
    fontSize: 17,
    fontWeight: typography.weights.black,
  },
  roleBadge: {
    alignItems: 'center',
    backgroundColor: colors.gold,
    borderColor: '#2A1604',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 17,
    justifyContent: 'center',
    left: -2,
    position: 'absolute',
    top: -3,
    width: 17,
    zIndex: 7,
  },
  moderatorBadge: {
    backgroundColor: colors.purpleBright,
    borderColor: '#C9B0FF',
  },
  muteBadge: {
    alignItems: 'center',
    backgroundColor: colors.ruby,
    borderColor: '#FFFFFF',
    borderRadius: radius.full,
    borderWidth: 1,
    bottom: -2,
    height: 17,
    justifyContent: 'center',
    position: 'absolute',
    right: -2,
    width: 17,
    zIndex: 7,
  },
  representativeBadge: {
    bottom: -2,
    left: -2,
    position: 'absolute',
    zIndex: 8,
  },
  name: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: typography.weights.bold,
    marginTop: 1,
    maxWidth: 66,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  nameShell: { alignItems: 'center', flexDirection: 'row', height: 16, justifyContent: 'center', marginTop: 1, maxWidth: 72, position: 'relative' },
  seatNameplate: { bottom: 0, left: 0, opacity: 0.68, position: 'absolute', right: 0, top: 0 },
  seatCosmeticBadge: { height: 14, width: 14 },
  speakingName: {
    color: colors.emerald,
  },
  seatNumber: {
    color: colors.textSubtle,
    fontSize: 8,
    marginTop: -1,
    writingDirection: 'ltr',
  },
  targetedGift: {
    alignItems: 'center',
    height: 94,
    justifyContent: 'center',
    left: -14,
    position: 'absolute',
    top: -35,
    width: 94,
    zIndex: 20,
  },
  targetedGiftArtwork: { height: 94, width: 94 },
  targetedGiftFallback: { fontSize: 42 },
  targetedGiftCombo: {
    backgroundColor: 'rgba(25,5,34,0.92)',
    borderRadius: radius.full,
    bottom: 0,
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: typography.weights.black,
    paddingHorizontal: 6,
    paddingVertical: 2,
    position: 'absolute',
    right: 0,
  },
  targetedGiftLabel: {
    backgroundColor: 'rgba(25,5,34,0.9)',
    borderRadius: radius.sm,
    color: '#FFF0CC',
    fontSize: 8,
    fontWeight: typography.weights.bold,
    paddingHorizontal: 5,
    paddingVertical: 2,
    position: 'absolute',
    textAlign: 'center',
    top: 78,
    width: 130,
  },
});
