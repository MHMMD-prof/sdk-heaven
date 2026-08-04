import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';
import { RoomGameSession } from '../../voice/requestRoomGameCommand';

type RoomGameInviteCardProps = {
  isPlayer: boolean;
  onEnd?: () => void;
  onJoin?: () => void;
  onOpenGame?: () => void;
  session: RoomGameSession;
};

const GAME_LABELS: Record<string, string> = {
  'carrom-royal': 'كاروم رويال',
  'drawing-guess': 'خمن الرسم',
  'royal-majlis': 'مجلس الملوك',
};

export function RoomGameInviteCard({
  isPlayer,
  onEnd,
  onJoin,
  onOpenGame,
  session,
}: RoomGameInviteCardProps) {
  const title = GAME_LABELS[session.gameId] || session.gameId;
  const statusLabel = session.status === 'active' ? 'جارية' : 'دعوة اختيارية';

  return (
    <View accessibilityLiveRegion="polite" style={styles.card}>
      <Text style={styles.eyebrow}>لعبة مرتبطة بالغرفة · {statusLabel}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.meta}>
        {session.sessionMode === 'host-local'
          ? 'نشاط محلي على جهاز المضيف · الصوت يبقى متصلًا'
          : `${session.playerCount}/${session.maxPlayers} لاعبين · الصوت يبقى متصلًا`}
      </Text>
      <View style={styles.actions}>
        {isPlayer && onOpenGame ? (
          <Pressable accessibilityRole="button" onPress={onOpenGame} style={styles.primary}>
            <Text style={styles.primaryText}>فتح اللعبة</Text>
          </Pressable>
        ) : onJoin ? (
          <Pressable accessibilityRole="button" onPress={onJoin} style={styles.primary}>
            <Text style={styles.primaryText}>انضم للّوبي</Text>
          </Pressable>
        ) : null}
        {onEnd ? (
          <Pressable accessibilityRole="button" onPress={onEnd} style={styles.secondary}>
            <Text style={styles.secondaryText}>إنهاء</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  card: {
    backgroundColor: 'rgba(18, 24, 38, 0.92)',
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
    padding: spacing.md,
  },
  eyebrow: {
    color: colors.goldSoft,
    fontSize: typography.sizes.caption,
    textAlign: 'right',
  },
  meta: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    textAlign: 'right',
  },
  primary: {
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  primaryText: {
    color: colors.backgroundDeep,
    fontSize: typography.sizes.caption,
    fontWeight: '700',
  },
  secondary: {
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  secondaryText: {
    color: colors.text,
    fontSize: typography.sizes.caption,
  },
  title: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: '700',
    textAlign: 'right',
  },
});
