import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '../components/GlassCard';
import { colors, spacing, typography } from '../theme';

export type BattleshipOnlineLobbyPanelProps = {
  body: string;
  eyebrow: string;
  leaveLabel: string;
  matchIdLabel?: string;
  onLeave: () => void;
  playerCountLabel: string;
  readyStatusLabel?: string;
  roleLabel: string;
  sessionStatusLabel: string;
  title: string;
  transportStatusLabel?: string;
};

export function BattleshipOnlineLobbyPanel({
  body,
  eyebrow,
  leaveLabel,
  matchIdLabel,
  onLeave,
  playerCountLabel,
  readyStatusLabel,
  roleLabel,
  sessionStatusLabel,
  title,
  transportStatusLabel,
}: BattleshipOnlineLobbyPanelProps) {
  return (
    <GlassCard style={styles.card} testID="battleship-online-lobby-panel">
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaPill}>{roleLabel}</Text>
          <Text style={styles.metaPill}>{playerCountLabel}</Text>
          <Text style={styles.metaPill}>{sessionStatusLabel}</Text>
          {transportStatusLabel ? (
            <Text style={styles.metaPill} testID="battleship-online-lobby-transport">
              {transportStatusLabel}
            </Text>
          ) : null}
          {matchIdLabel ? (
            <Text style={styles.metaPill} testID="battleship-online-lobby-match">
              {matchIdLabel}
            </Text>
          ) : null}
          {readyStatusLabel ? (
            <Text style={styles.metaPill} testID="battleship-online-lobby-ready">
              {readyStatusLabel}
            </Text>
          ) : null}
        </View>
      </View>

      <Pressable
        accessibilityHint="Leave this Naval Duel lobby and return to the voice room."
        accessibilityLabel={leaveLabel}
        accessibilityRole="button"
        onPress={onLeave}
        style={styles.leaveButton}
        testID="battleship-online-lobby-leave"
      >
        <Text style={styles.leaveText}>{leaveLabel}</Text>
      </Pressable>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.lg,
    marginBottom: spacing.md,
  },
  hero: {
    backgroundColor: 'rgba(75,163,255,0.10)',
    borderColor: 'rgba(75,163,255,0.35)',
    borderRadius: 18,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  eyebrow: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
  },
  title: {
    color: colors.text,
    fontSize: typography.sizes.headline,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  body: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    lineHeight: 22,
    textAlign: 'right',
  },
  metaRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  metaPill: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    color: colors.text,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  leaveButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  leaveText: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
  },
});
