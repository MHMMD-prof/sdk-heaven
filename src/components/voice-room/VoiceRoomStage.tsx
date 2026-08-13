import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import { Image as ExpoImage } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, radius, typography } from '../../theme';
import { CosmeticAssetRenderer } from '../../cosmetics/CosmeticAssetRenderer';
import { usePublishedCosmeticAsset } from '../../cosmetics/assetRegistry';
import type { CosmeticsFeatureFlags } from '../../cosmetics/featureFlags';
import type { QueuedRoomEffect } from '../../voice/roomEffectsQueue';
import { RoomSeatViewModel } from '../../voice/roomMainScreenModel';
import {
  orderRoomSeatsForAccessibility,
  resolveRoomSeatPresentation,
} from '../../voice/roomSeatPresentationModel';
import {
  MAJLIS_DEFAULT_MANIFEST,
  RoomThemeManifest,
  RoomThemeSeatPositionV1,
  RoomThemeViewportProfile,
  resolveRoomThemeScene,
} from '../../voice/roomThemeContract';
import { resolveRoomThemeAssetSource } from '../../voice/roomThemeRuntime';
import { RepresentativeBadge } from '../RepresentativeBadge';
import { AvatarFrameLayer } from '../AvatarPresentation';
import { EquipmentCosmeticAsset } from '../EquipmentCosmeticAsset';

const SEAT_WIDTH = 70;
const SEAT_HEIGHT = 96;
const OCCUPIED_BORDER_COLOR = 'rgba(255, 244, 222, 0.52)';
const SPEAKING_STATUS_COLOR = '#F4D58A';

type VoiceRoomStageProps = {
  cosmeticsFlags: CosmeticsFeatureFlags;
  manifest?: RoomThemeManifest;
  modeLabel: string;
  onSeatPress: (seat: RoomSeatViewModel) => void;
  pendingSeatId?: string;
  seats: RoomSeatViewModel[];
  targetedGiftEffect?: QueuedRoomEffect;
  viewportProfile: RoomThemeViewportProfile;
};

export function VoiceRoomStage({
  cosmeticsFlags,
  manifest = MAJLIS_DEFAULT_MANIFEST,
  modeLabel,
  onSeatPress,
  pendingSeatId,
  seats,
  targetedGiftEffect,
  viewportProfile,
}: VoiceRoomStageProps) {
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const reduceMotion = useReducedMotion();
  const scene = useMemo(
    () => resolveRoomThemeScene(manifest, viewportProfile),
    [manifest, viewportProfile],
  );
  const layout = scene.layouts[String(seats.length) as keyof RoomThemeManifest['layouts']]
    ?? MAJLIS_DEFAULT_MANIFEST.layouts[String(seats.length) as keyof RoomThemeManifest['layouts']];
  const positions = useMemo(
    () => new Map(layout?.map((position) => [position.seatNumber, position]) ?? []),
    [layout],
  );
  const orderedSeats = useMemo(() => orderRoomSeatsForAccessibility(seats), [seats]);
  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setStageSize({ width, height });
  };

  return (
    <View style={[styles.root, viewportProfile === 'compact' && styles.rootCompact]}>
      <View
        accessibilityRole="summary"
        onLayout={handleLayout}
        style={styles.stage}
      >
        {manifest.assets.stage ? (
          <ExpoImage
            accessibilityIgnoresInvertColors
            cachePolicy="memory-disk"
            contentFit={scene.stage.fit}
            contentPosition={mediaContentPosition(scene.stage.focalX, scene.stage.focalY)}
            recyclingKey={`${manifest.themeId}:${manifest.revision}:stage`}
            source={resolveRoomThemeAssetSource(manifest.assets.stage.uri)}
            style={styles.stageArtwork}
            transition={reduceMotion ? 0 : 140}
          />
        ) : null}
        <View pointerEvents="none" style={styles.modeAnchor}>
          <View style={[styles.modePill, { borderColor: `${manifest.colors.gold}77` }]}>
            <View style={[styles.liveDot, { backgroundColor: manifest.colors.goldSoft }]} />
            <Text style={[styles.modeLabel, { color: manifest.colors.goldSoft }]}>{modeLabel}</Text>
          </View>
        </View>
        {stageSize.width > 0 && stageSize.height > 0 ? orderedSeats.map((seat) => (
          <PositionedSeat
            key={seat.id}
            cosmeticsFlags={cosmeticsFlags}
            height={stageSize.height}
            manifest={manifest}
            onPress={() => onSeatPress(seat)}
            pending={pendingSeatId === seat.id}
            position={positions.get(seat.seatNumber) ?? fallbackPosition(seat.seatNumber, seats.length)}
            reduceMotion={reduceMotion}
            seat={seat}
            targetedGiftEffect={targetedGiftEffect?.recipientUid === seat.participant?.id ? targetedGiftEffect : undefined}
            width={stageSize.width}
          />
        )) : null}
      </View>
    </View>
  );
}

function mediaContentPosition(focalX: number, focalY: number) {
  return {
    left: `${Math.round(focalX * 100)}%` as `${number}%`,
    top: `${Math.round(focalY * 100)}%` as `${number}%`,
  };
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
  manifest: RoomThemeManifest;
  onPress: () => void;
  pending: boolean;
  position: RoomThemeSeatPositionV1;
  reduceMotion: boolean;
  seat: RoomSeatViewModel;
  targetedGiftEffect?: QueuedRoomEffect;
  width: number;
}) {
  const x = Math.max(0, Math.min(width - SEAT_WIDTH, position.x * width - SEAT_WIDTH / 2));
  const y = Math.max(0, Math.min(height - SEAT_HEIGHT, position.y * height - SEAT_HEIGHT / 2));
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
        emptySeatFrameUri={manifest.assets.emptySeatFrame?.uri}
        onPress={onPress}
        pending={pending}
        reduceMotion={reduceMotion}
        seat={seat}
        targetedGiftEffect={targetedGiftEffect}
      />
    </Animated.View>
  );
}

function Seat({
  cosmeticsFlags,
  emptyColors,
  emptySeatFrameUri,
  onPress,
  pending,
  reduceMotion,
  seat,
  targetedGiftEffect,
}: {
  cosmeticsFlags: CosmeticsFeatureFlags;
  emptyColors: [string, string];
  emptySeatFrameUri?: string;
  onPress: () => void;
  pending: boolean;
  reduceMotion: boolean;
  seat: RoomSeatViewModel;
  targetedGiftEffect?: QueuedRoomEffect;
}) {
  const canPress = seat.action !== null && !pending;
  const presentation = resolveRoomSeatPresentation(seat, pending);
  const isOccupied = presentation.isOccupied;
  const muted = seat.participant?.isMuted;
  const pulse = useSpeakingPulse(seat.isSpeaking, reduceMotion);
  const hasCanonicalFrame = Boolean(
    seat.participant?.avatarFrameAssetId && seat.participant.avatarFrameAssetVersionId,
  );
  const ownedFrame = seat.participant?.avatarFrameItemId
    && (seat.participant.avatarFrameAssetUrl || hasCanonicalFrame)
    ? {
      itemId: seat.participant.avatarFrameItemId,
      ...(seat.participant.avatarFrameAssetUrl ? { assetUrl: seat.participant.avatarFrameAssetUrl } : {}),
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
      {isOccupied ? (
        <EquipmentCosmeticAsset
          category="seat-effect"
          enabled={cosmeticsFlags.seatEffects}
          flags={cosmeticsFlags}
          projection={seat.participant?.equipmentCosmetics?.seatEffect}
          style={styles.seatEffect}
        />
      ) : null}
      <View style={styles.seatVisual}>
        {isOccupied && seat.isSpeaking ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.speakingHalo,
              {
                borderColor: SPEAKING_STATUS_COLOR,
                shadowColor: SPEAKING_STATUS_COLOR,
                transform: [{ scale: pulse }],
              },
            ]}
          />
        ) : null}
        {isOccupied ? (
          <View
            style={[
              styles.avatarFrame,
              { borderColor: ownedFrame ? 'transparent' : OCCUPIED_BORDER_COLOR },
              presentation.kind === 'reconnecting' && styles.reconnectingFrame,
              presentation.kind === 'retiring' && styles.retiringFrame,
            ]}
          >
            <View style={styles.avatarInner}>
              <Text style={styles.avatarText}>{seat.participant?.avatarLabel}</Text>
            </View>
            {ownedFrame ? (
              <AvatarFrameLayer
                flags={cosmeticsFlags}
                frame={ownedFrame}
                renderLegacyWhenUnifiedDisabled
              />
            ) : null}
            {muted ? (
              <View accessibilityLabel="الميكروفون مكتوم" style={styles.muteBadge}>
                <SymbolView
                  name={{ ios: 'mic.slash.fill', android: 'mic_off', web: 'mic_off' }}
                  size={10}
                  tintColor="#FFFFFF"
                />
              </View>
            ) : null}
            {seat.isOwner || seat.isModerator ? (
              <View
                accessibilityLabel={presentation.roleLabel}
                style={[styles.roleBadge, seat.isModerator && styles.moderatorBadge]}
              >
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
        ) : (
          <View
            style={[
              styles.emptySeatShell,
              { backgroundColor: emptyColors[1], borderColor: `${emptyColors[0]}99` },
              presentation.kind === 'locked' && styles.lockedFrame,
              presentation.kind === 'reconnecting' && styles.reconnectingFrame,
              presentation.kind === 'retiring' && styles.retiringFrame,
            ]}
          >
            {emptySeatFrameUri ? (
              <ExpoImage
                accessibilityIgnoresInvertColors
                contentFit="contain"
                pointerEvents="none"
                source={resolveRoomThemeAssetSource(emptySeatFrameUri)}
                style={styles.emptySeatArtwork}
              />
            ) : null}
            {pending ? (
              <ActivityIndicator color={emptyColors[0]} size="small" />
            ) : (
              <SymbolView
                name={seatStateSymbol(presentation.kind)}
                size={presentation.kind === 'open' ? 21 : 17}
                tintColor={presentation.kind === 'locked' ? '#8A7A68' : emptyColors[0]}
              />
            )}
            <View style={styles.emptySeatNumberBadge}>
              <Text style={styles.emptySeatNumber}>{seat.seatNumber}</Text>
            </View>
          </View>
        )}
      </View>
      <View style={styles.nameShell}>
        {isOccupied ? (
          <EquipmentCosmeticAsset
            category="nameplate"
            enabled={cosmeticsFlags.nameplates}
            flags={cosmeticsFlags}
            projection={seat.participant?.equipmentCosmetics?.nameplate}
            style={styles.seatNameplate}
          />
        ) : null}
        <Text
          numberOfLines={1}
          style={[styles.name, seat.isSpeaking && styles.speakingName]}
        >
          {seat.participant?.displayName || presentation.secondaryLabel || ''}
        </Text>
        {isOccupied ? (
          <EquipmentCosmeticAsset
            category="cosmetic-badge"
            enabled={cosmeticsFlags.cosmeticBadges}
            flags={cosmeticsFlags}
            projection={seat.participant?.equipmentCosmetics?.cosmeticBadge}
            style={styles.seatCosmeticBadge}
          />
        ) : null}
      </View>
      {targetedGiftEffect ? (
        <TargetedGiftEffect effect={targetedGiftEffect} flags={cosmeticsFlags} />
      ) : null}
    </Pressable>
  );
}

function seatStateSymbol(kind: ReturnType<typeof resolveRoomSeatPresentation>['kind']) {
  if (kind === 'locked') return { ios: 'lock.fill', android: 'lock', web: 'lock' } as const;
  if (kind === 'reconnecting') return { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' } as const;
  if (kind === 'retiring') {
    return { ios: 'hourglass.bottomhalf.filled', android: 'hourglass_bottom', web: 'hourglass_bottom' } as const;
  }
  return { ios: 'plus', android: 'add', web: 'add' } as const;
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
  const rendererFlags = useMemo(() => ({
    ...flags,
    effectAudio: flags.effectAudio && flags.roomGiftAudio && effect.audioEnabled === true,
    video: flags.video && flags.roomGiftVideo,
  }), [effect.audioEnabled, flags]);
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

function useSpeakingPulse(isSpeaking: boolean, reduceMotion: boolean) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isSpeaking || reduceMotion) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          toValue: 1.08,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(1);
    };
  }, [isSpeaking, pulse, reduceMotion]);
  return pulse;
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
    flex: 1,
    minHeight: 240,
  },
  rootCompact: {
    minHeight: 190,
  },
  stage: {
    backgroundColor: 'transparent',
    flex: 1,
    overflow: 'visible',
    position: 'relative',
    width: '100%',
  },
  stageArtwork: {
    ...StyleSheet.absoluteFill,
  },
  modeAnchor: {
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 30,
  },
  modePill: {
    alignItems: 'center',
    backgroundColor: 'rgba(8, 4, 5, 0.7)',
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  liveDot: {
    borderRadius: radius.full,
    height: 6,
    width: 6,
  },
  modeLabel: {
    fontSize: 9,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  positionedSeat: {
    left: 0,
    position: 'absolute',
    top: 0,
  },
  seatCell: {
    alignItems: 'center',
    minHeight: SEAT_HEIGHT,
    width: SEAT_WIDTH,
  },
  seatEffect: { height: 68, position: 'absolute', top: -6, width: 68, zIndex: 1 },
  seatVisual: {
    alignItems: 'center',
    borderRadius: radius.full,
    height: 62,
    justifyContent: 'center',
    position: 'relative',
    width: 62,
    zIndex: 2,
  },
  speakingHalo: {
    borderRadius: radius.full,
    borderWidth: 2.5,
    height: 62,
    position: 'absolute',
    shadowOpacity: 0.9,
    shadowRadius: 12,
    width: 62,
  },
  avatarFrame: {
    alignItems: 'center',
    borderRadius: radius.full,
    borderWidth: 1.5,
    height: 50,
    justifyContent: 'center',
    position: 'relative',
    width: 50,
  },
  avatarInner: {
    alignItems: 'center',
    backgroundColor: '#130A0B',
    borderRadius: radius.full,
    height: 44,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 44,
  },
  emptySeatShell: {
    alignItems: 'center',
    borderRadius: radius.full,
    borderWidth: 1.5,
    height: 54,
    justifyContent: 'center',
    overflow: 'visible',
    position: 'relative',
    width: 54,
  },
  emptySeatArtwork: {
    bottom: -3,
    left: -3,
    opacity: 0.95,
    position: 'absolute',
    right: -3,
    top: -3,
  },
  emptySeatNumberBadge: {
    alignItems: 'center',
    backgroundColor: '#0A0607',
    borderColor: 'rgba(244, 213, 138, 0.58)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 19,
    justifyContent: 'center',
    position: 'absolute',
    right: -5,
    top: -5,
    width: 19,
  },
  emptySeatNumber: {
    color: '#F4D58A',
    fontSize: 9,
    fontWeight: typography.weights.black,
    writingDirection: 'ltr',
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
    color: '#F4D58A',
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
    position: 'absolute',
    right: -2,
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
    color: '#FFF4DE',
    fontSize: 10,
    fontWeight: typography.weights.bold,
    maxWidth: 70,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    writingDirection: 'rtl',
  },
  speakingName: {
    color: SPEAKING_STATUS_COLOR,
  },
  nameShell: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 18,
    justifyContent: 'center',
    marginTop: 3,
    maxWidth: 76,
    position: 'relative',
  },
  seatNameplate: { bottom: 0, left: 0, opacity: 0.68, position: 'absolute', right: 0, top: 0 },
  seatCosmeticBadge: { height: 14, width: 14 },
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
