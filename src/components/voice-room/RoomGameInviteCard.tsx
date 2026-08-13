import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';
import { RoomGameSession } from '../../voice/requestRoomGameCommand';

type RoomGameInviteCardProps = {
  compact?: boolean;
  isPlayer: boolean;
  onEnd?: () => void;
  onJoin?: () => void;
  onOpenGame?: () => void;
  onSpectate?: () => void;
  session: RoomGameSession;
};

const GAME_LABELS: Record<string, string> = {
  'carrom-royal': 'كاروم رويال',
  'drawing-guess': 'خمن الرسم',
  'naval-duel': 'مبارزة البحر',
  'royal-majlis': 'مجلس الملوك',
};

export function RoomGameInviteCard({
  compact = false,
  isPlayer,
  onEnd,
  onJoin,
  onOpenGame,
  onSpectate,
  session,
}: RoomGameInviteCardProps) {
  const title = GAME_LABELS[session.gameId] || session.gameId;
  const statusLabel = session.status === 'active' ? 'جارية' : 'دعوة اختيارية';
  const entryFee = session.economy?.entryFeeCoins || 0;
  const poolCoins = session.economy?.poolCoins || 0;

  if (compact) {
    const primaryAction = isPlayer && onOpenGame ? onOpenGame : onJoin;
    return (
      <View accessibilityLabel={`لعبة الغرفة ${title}، ${statusLabel}`} accessibilityLiveRegion="polite" style={[styles.card, styles.compactCard]}>
        <View style={styles.compactCopy}>
          <Text numberOfLines={1} style={styles.compactTitle}>{title}</Text>
          <Text numberOfLines={1} style={styles.compactMeta}>
            {session.sessionMode === 'host-local' ? statusLabel : `${session.playerCount}/${session.maxPlayers} · ${statusLabel}`}
          </Text>
        </View>
        {primaryAction ? (
          <Pressable accessibilityRole="button" onPress={primaryAction} style={[styles.primary, styles.compactButton]}>
            <Text style={styles.primaryText}>{isPlayer ? 'فتح' : entryFee > 0 ? `${entryFee} · انضم` : 'انضم'}</Text>
          </Pressable>
        ) : null}
        {!isPlayer && onSpectate ? (
          <Pressable accessibilityRole="button" onPress={onSpectate} style={[styles.secondary, styles.compactButton]}>
            <Text style={styles.secondaryText}>شاهد</Text>
          </Pressable>
        ) : null}
        {onEnd ? (
          <Pressable accessibilityRole="button" onPress={onEnd} style={[styles.secondary, styles.compactButton]}>
            <Text style={styles.secondaryText}>إنهاء</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View accessibilityLiveRegion="polite" style={styles.card}>
      <Text style={styles.eyebrow}>لعبة مرتبطة بالغرفة · {statusLabel}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.meta}>
        {session.sessionMode === 'host-local'
          ? 'نشاط محلي على جهاز المضيف · الصوت يبقى متصلًا'
          : `${session.playerCount}/${session.maxPlayers} لاعبين · الصوت يبقى متصلًا`}
      </Text>
      {entryFee > 0 ? (
        <Text style={styles.economy}>
          دخول {entryFee.toLocaleString('ar-IQ')} عملة · الجائزة الحالية {poolCoins.toLocaleString('ar-IQ')} · ترفيه وليس مراهنة مهارة
        </Text>
      ) : null}
      <View style={styles.actions}>
        {isPlayer && onOpenGame ? (
          <Pressable accessibilityRole="button" onPress={onOpenGame} style={styles.primary}>
            <Text style={styles.primaryText}>فتح اللعبة</Text>
          </Pressable>
        ) : onJoin ? (
          <Pressable accessibilityRole="button" onPress={onJoin} style={styles.primary}>
            <Text style={styles.primaryText}>
              {entryFee > 0 ? `انضم · ${entryFee} عملة` : 'انضم للّوبي'}
            </Text>
          </Pressable>
        ) : null}
        {!isPlayer && onSpectate ? (
          <Pressable accessibilityRole="button" onPress={onSpectate} style={styles.secondary}>
            <Text style={styles.secondaryText}>شاهد</Text>
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
  compactCard: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: 6,
    height: 60,
    paddingHorizontal: 10,
    paddingVertical: 6,
    width: '100%',
  },
  compactCopy: { alignItems: 'flex-end', flex: 1, minWidth: 0 },
  compactTitle: { color: colors.text, fontSize: 11, fontWeight: typography.weights.black, textAlign: 'right' },
  compactMeta: { color: colors.textMuted, fontSize: 9, textAlign: 'right' },
  compactButton: { paddingHorizontal: 9, paddingVertical: 7 },
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
  economy: {
    color: colors.goldSoft,
    fontSize: 11,
    lineHeight: 16,
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
