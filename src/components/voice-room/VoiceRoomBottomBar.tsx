import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, typography } from '../../theme';
import type { RoomThemeManifest } from '../../voice/roomThemeContract';
import { resolveRoomThemeAssetSource } from '../../voice/roomThemeRuntime';

type VoiceRoomBottomBarProps = {
  isConnected: boolean;
  isMicMuted: boolean;
  isSeated: boolean;
  manifest: RoomThemeManifest;
  onChat: () => void;
  onGames: () => void;
  onGift: () => void;
  onMic: () => void;
  onTools: () => void;
};

export function VoiceRoomBottomBar({
  isConnected,
  isMicMuted,
  isSeated,
  manifest,
  onChat,
  onGames,
  onGift,
  onMic,
  onTools,
}: VoiceRoomBottomBarProps) {
  const dockAsset = manifest.assets.dock;
  const primaryLabel = isSeated ? 'تحدث' : 'خذ مقعداً';

  return (
    <View style={styles.shell}>
      <LinearGradient
        colors={[`${manifest.colors.panelRaised}FA`, `${manifest.colors.background}FC`]}
        end={{ x: 0, y: 1 }}
        start={{ x: 1, y: 0 }}
        style={[styles.root, { borderColor: `${manifest.colors.gold}8C` }]}
      >
        {dockAsset ? (
          <Image
            accessibilityIgnoresInvertColors
            contentFit="cover"
            pointerEvents="none"
            source={resolveRoomThemeAssetSource(dockAsset.uri)}
            style={styles.dockArtwork}
          />
        ) : null}
        <View pointerEvents="none" style={[styles.goldLine, { backgroundColor: manifest.colors.goldSoft }]} />
        <View pointerEvents="none" style={[styles.ornament, styles.ornamentLeft, { borderColor: manifest.colors.gold }]} />
        <View pointerEvents="none" style={[styles.ornament, styles.ornamentRight, { borderColor: manifest.colors.gold }]} />
        <BarAction
          gold={manifest.colors.goldSoft}
          icon={{ ios: 'gift.fill', android: 'redeem', web: 'redeem' }}
          label="هدية"
          onPress={onGift}
        />
        <BarAction
          gold={manifest.colors.goldSoft}
          icon={{ ios: 'message.fill', android: 'chat_bubble', web: 'chat_bubble' }}
          label="دردشة"
          onPress={onChat}
        />
        <Pressable
          accessibilityLabel={
            isSeated
              ? isMicMuted ? 'تشغيل الميكروفون' : 'كتم الميكروفون'
              : 'الانضمام إلى مقعد ميكروفون'
          }
          accessibilityRole="button"
          accessibilityState={{ disabled: !isConnected }}
          disabled={!isConnected}
          hitSlop={8}
          onPress={onMic}
          style={({ pressed }) => [
            styles.primaryShell,
            !isConnected && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <LinearGradient
            colors={isMicMuted
              ? [manifest.colors.rubyBright, manifest.colors.ruby]
              : [manifest.colors.goldSoft, manifest.colors.gold]}
            style={[styles.primary, { borderColor: manifest.colors.goldSoft }]}
          >
            <View style={styles.primaryInnerRing} />
            <SymbolView
              name={
                isSeated
                  ? isMicMuted
                    ? { ios: 'mic.slash.fill', android: 'mic_off', web: 'mic_off' }
                    : { ios: 'mic.fill', android: 'mic', web: 'mic' }
                  : { ios: 'hand.raised.fill', android: 'pan_tool', web: 'pan_tool' }
              }
              size={27}
              tintColor={isMicMuted ? '#FFF1E6' : '#2A1404'}
            />
            <Text style={[styles.primaryLabel, isMicMuted && styles.primaryLabelMuted]}>{primaryLabel}</Text>
          </LinearGradient>
        </Pressable>
        <BarAction
          gold={manifest.colors.goldSoft}
          icon={{ ios: 'gamecontroller.fill', android: 'sports_esports', web: 'sports_esports' }}
          label="ألعاب"
          onPress={onGames}
        />
        <BarAction
          gold={manifest.colors.goldSoft}
          icon={{ ios: 'square.grid.2x2.fill', android: 'apps', web: 'apps' }}
          label="أدوات"
          onPress={onTools}
        />
      </LinearGradient>
    </View>
  );
}

function BarAction({
  active = false,
  disabled = false,
  gold,
  icon,
  label,
  onPress,
}: {
  active?: boolean;
  disabled?: boolean;
  gold: string;
  icon: React.ComponentProps<typeof SymbolView>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.action, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <View style={[styles.iconWell, active && styles.iconWellActive, { borderColor: `${gold}38` }]}>
        <SymbolView name={icon} size={21} tintColor={gold} />
      </View>
      <Text style={[styles.label, { color: gold }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    flex: 1,
    gap: 3,
    justifyContent: 'center',
    minHeight: 58,
    minWidth: 46,
  },
  disabled: { opacity: 0.42 },
  dockArtwork: {
    ...StyleSheet.absoluteFill,
    opacity: 0.28,
  },
  goldLine: {
    height: 1,
    left: 28,
    opacity: 0.75,
    position: 'absolute',
    right: 28,
    top: 0,
  },
  iconWell: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 232, 175, 0.025)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  iconWellActive: { backgroundColor: 'rgba(214, 168, 79, 0.18)' },
  label: {
    fontSize: 10,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  ornament: {
    borderRadius: 2,
    borderTopWidth: 1,
    height: 8,
    position: 'absolute',
    top: -1,
    transform: [{ rotate: '45deg' }],
    width: 8,
  },
  ornamentLeft: { left: 18 },
  ornamentRight: { right: 18 },
  pressed: { opacity: 0.74, transform: [{ scale: 0.96 }] },
  primary: {
    alignItems: 'center',
    borderRadius: radius.full,
    borderWidth: 2,
    elevation: 10,
    gap: 1,
    height: 68,
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#D6A84F',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.58,
    shadowRadius: 17,
    width: 68,
  },
  primaryInnerRing: {
    ...StyleSheet.absoluteFill,
    borderColor: 'rgba(255, 248, 221, 0.36)',
    borderRadius: radius.full,
    borderWidth: 4,
    margin: 4,
  },
  primaryLabel: {
    color: '#2A1404',
    fontSize: 9,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  primaryLabelMuted: { color: '#FFF1E6' },
  primaryShell: {
    marginHorizontal: 3,
    marginTop: -18,
    zIndex: 3,
  },
  root: {
    alignItems: 'center',
    borderRadius: 31,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: 1,
    minHeight: 82,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingTop: 9,
  },
  shell: {
    paddingTop: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.52,
    shadowRadius: 22,
  },
});
