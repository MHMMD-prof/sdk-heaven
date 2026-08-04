import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';

type VoiceRoomHeaderProps = {
  audienceCount: number;
  onAudiencePress: () => void;
  onLeave: () => void;
  onShare: () => void;
  ownerName: string;
  recordingActive?: boolean;
  roomId: string;
  title: string;
};

export function VoiceRoomHeader({
  audienceCount,
  onAudiencePress,
  onLeave,
  onShare,
  ownerName,
  recordingActive = false,
  roomId,
  title,
}: VoiceRoomHeaderProps) {
  return (
    <View style={styles.root}>
      <RoundButton
        accessibilityLabel="مغادرة الغرفة"
        icon={{ ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' }}
        onPress={onLeave}
      />
      <View style={styles.identity}>
        <Text numberOfLines={1} style={styles.title}>{title}</Text>
        <View style={styles.metaRow}>
          <Text numberOfLines={1} style={styles.owner}>المالك: {ownerName}</Text>
          <View style={styles.dot} />
          <Text style={styles.roomId}>ID {roomId}</Text>
          {recordingActive ? (
            <>
              <View style={styles.dot} />
              <Text accessibilityLabel="تسجيل أمان نشط" style={styles.recording}>REC</Text>
            </>
          ) : null}
        </View>
      </View>
      <View style={styles.actions}>
        <RoundButton
          accessibilityLabel={`المشاركون، ${audienceCount}`}
          badge={audienceCount}
          icon={{ ios: 'person.2.fill', android: 'groups', web: 'groups' }}
          onPress={onAudiencePress}
        />
        <RoundButton
          accessibilityLabel="مشاركة الغرفة"
          icon={{ ios: 'square.and.arrow.up', android: 'share', web: 'share' }}
          onPress={onShare}
        />
      </View>
    </View>
  );
}

function RoundButton({
  accessibilityLabel,
  badge,
  icon,
  onPress,
}: {
  accessibilityLabel: string;
  badge?: number;
  icon: React.ComponentProps<typeof SymbolView>['name'];
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}
    >
      <SymbolView name={icon} size={20} tintColor={colors.goldSoft} />
      {badge !== undefined ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge > 999 ? '999+' : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 52,
  },
  identity: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.text,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: 6,
    marginTop: 3,
  },
  owner: {
    color: colors.goldSoft,
    flexShrink: 1,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  roomId: {
    color: colors.textSubtle,
    fontSize: 10,
    writingDirection: 'ltr',
  },
  recording: {
    color: colors.ruby,
    fontSize: 10,
    fontWeight: typography.weights.bold,
  },
  dot: {
    backgroundColor: colors.goldDeep,
    borderRadius: radius.full,
    height: 3,
    width: 3,
  },
  actions: {
    flexDirection: 'row',
    gap: 6,
  },
  roundButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(7, 5, 13, 0.76)',
    borderColor: colors.borderGold,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.97 }],
  },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.ruby,
    borderColor: colors.backgroundDeep,
    borderRadius: radius.full,
    borderWidth: 1,
    minWidth: 17,
    paddingHorizontal: 3,
    position: 'absolute',
    right: -4,
    top: -4,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: typography.weights.black,
  },
});
