import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LuxuryButton } from '../components/LuxuryButton';
import { colors, radius, spacing, typography } from '../theme';
import { labels } from './constants';

type BattleshipHandoffPanelProps = {
  confirmHint: string;
  continueLabel: string;
  message: string;
  player: 1 | 2;
  onContinue: () => void;
};

export function BattleshipHandoffPanel({
  confirmHint,
  continueLabel,
  message,
  player,
  onContinue,
}: BattleshipHandoffPanelProps) {
  const [confirmed, setConfirmed] = useState(false);

  return (
    <View style={styles.panel} testID="battleship-handoff-panel">
      <Text style={styles.kicker}>
        {labels.player} {player}
      </Text>
      <Text style={styles.title}>{labels.passTitle}</Text>
      <Text style={styles.text}>{message}</Text>
      <Text style={styles.text}>{labels.passPrivacy}</Text>
      <Pressable
        accessibilityHint={confirmHint}
        accessibilityLabel={labels.passConfirm}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: confirmed }}
        onPress={() => setConfirmed((value) => !value)}
        style={[styles.confirmRow, confirmed && styles.confirmRowActive]}
        testID="battleship-handoff-confirm"
      >
        <View style={[styles.checkbox, confirmed && styles.checkboxActive]}>
          {confirmed ? <Text style={styles.checkmark}>OK</Text> : null}
        </View>
        <Text style={styles.confirmText}>{labels.passConfirm}</Text>
      </Pressable>
      <LuxuryButton
        accessibilityHint={confirmHint}
        disabled={!confirmed}
        onPress={onContinue}
        title={continueLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: colors.borderGold,
    borderRadius: radius.xl,
    borderWidth: 1,
    gap: spacing.md,
    marginTop: spacing.xxxl,
    padding: spacing.xl,
  },
  kicker: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  title: {
    color: colors.text,
    fontSize: typography.sizes.headline,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  text: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  confirmRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.16)',
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    minHeight: 48,
    padding: spacing.md,
  },
  confirmRowActive: {
    borderColor: colors.borderGold,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  checkboxActive: {
    backgroundColor: colors.gold,
    borderColor: colors.goldSoft,
  },
  checkmark: {
    color: colors.backgroundDeep,
    fontSize: 9,
    fontWeight: typography.weights.black,
  },
  confirmText: {
    color: colors.text,
    flex: 1,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
