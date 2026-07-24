import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';

type VoiceRoomBottomBarProps = {
  isConnected: boolean;
  isMicMuted: boolean;
  isSeated: boolean;
  isSpeakerEnabled: boolean;
  onChat: () => void;
  onGift: () => void;
  onMic: () => void;
  onReaction: () => void;
  onSpeaker: () => void;
  onTools: () => void;
};

export function VoiceRoomBottomBar({
  isConnected,
  isMicMuted,
  isSeated,
  isSpeakerEnabled,
  onChat,
  onGift,
  onMic,
  onReaction,
  onSpeaker,
  onTools,
}: VoiceRoomBottomBarProps) {
  return (
    <View style={styles.root}>
      <BarAction
        icon={{ ios: 'gift.fill', android: 'redeem', web: 'redeem' }}
        label="هدية"
        onPress={onGift}
      />
      <BarAction
        icon={{ ios: 'square.grid.2x2.fill', android: 'apps', web: 'apps' }}
        label="الأدوات"
        onPress={onTools}
      />
      <BarAction
        icon={{ ios: 'face.smiling.fill', android: 'mood', web: 'mood' }}
        label="تفاعل"
        onPress={onReaction}
      />
      <Pressable
        accessibilityLabel={
          isSeated
            ? isMicMuted ? 'تشغيل الميكروفون' : 'كتم الميكروفون'
            : 'الانضمام إلى مقعد ميكروفون'
        }
        accessibilityRole="button"
        disabled={!isConnected}
        onPress={onMic}
        style={({ pressed }) => [
          styles.primary,
          isMicMuted && styles.primaryMuted,
          !isConnected && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <SymbolView
          name={
            isSeated
              ? isMicMuted
                ? { ios: 'mic.slash.fill', android: 'mic_off', web: 'mic_off' }
                : { ios: 'mic.fill', android: 'mic', web: 'mic' }
              : { ios: 'hand.raised.fill', android: 'pan_tool', web: 'pan_tool' }
          }
          size={24}
          tintColor={isMicMuted ? '#FFD5DD' : '#241403'}
        />
      </Pressable>
      <BarAction
        active={isSpeakerEnabled}
        disabled={!isConnected}
        icon={
          isSpeakerEnabled
            ? { ios: 'speaker.wave.2.fill', android: 'volume_up', web: 'volume_up' }
            : { ios: 'speaker.slash.fill', android: 'volume_off', web: 'volume_off' }
        }
        label="الصوت"
        onPress={onSpeaker}
      />
      <BarAction
        icon={{ ios: 'message.fill', android: 'chat_bubble', web: 'chat_bubble' }}
        label="دردشة"
        onPress={onChat}
      />
    </View>
  );
}

function BarAction({
  active = false,
  disabled = false,
  icon,
  label,
  onPress,
}: {
  active?: boolean;
  disabled?: boolean;
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
      onPress={onPress}
      style={({ pressed }) => [styles.action, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <SymbolView name={icon} size={20} tintColor={active ? colors.goldSoft : colors.textMuted} />
      <Text style={[styles.label, active && styles.activeLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    backgroundColor: 'rgba(4, 2, 8, 0.96)',
    borderColor: colors.borderGold,
    borderRadius: radius.xl,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: 2,
    minHeight: 68,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
  },
  action: {
    alignItems: 'center',
    flex: 1,
    gap: 3,
    justifyContent: 'center',
    minWidth: 42,
  },
  label: {
    color: colors.textMuted,
    fontSize: 8,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  activeLabel: {
    color: colors.goldSoft,
  },
  primary: {
    alignItems: 'center',
    backgroundColor: colors.gold,
    borderColor: colors.goldSoft,
    borderRadius: radius.full,
    borderWidth: 2,
    height: 50,
    justifyContent: 'center',
    marginHorizontal: 2,
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    width: 50,
  },
  primaryMuted: {
    backgroundColor: colors.ruby,
    borderColor: '#FFBAC8',
  },
  disabled: {
    opacity: 0.42,
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
});
