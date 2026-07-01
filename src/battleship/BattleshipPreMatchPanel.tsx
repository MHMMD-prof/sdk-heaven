import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LuxuryButton } from '../components/LuxuryButton';
import { colors, radius, spacing, typography } from '../theme';
import { MiniGameMode } from '../types/miniGame';
import { MAX_ATTEMPTS } from '../utils/miniGameEngine';
import { labels } from './constants';

type BattleshipPreMatchPanelProps = {
  attemptsEnabled: boolean;
  mode: MiniGameMode;
  onStartMatch: () => void;
  onToggleAttempts: () => void;
};

export function BattleshipPreMatchPanel({
  attemptsEnabled,
  mode,
  onStartMatch,
  onToggleAttempts,
}: BattleshipPreMatchPanelProps) {
  return (
    <View style={styles.panel} testID="battleship-pre-match-panel">
      <Text style={styles.kicker}>{labels.localGame}</Text>
      <Text style={styles.title}>{mode.title}</Text>
      <Text style={styles.text}>{mode.subtitle}</Text>

      <Pressable
        accessibilityLabel={attemptsEnabled ? labels.attemptsOn : labels.attemptsOff}
        accessibilityRole="switch"
        accessibilityState={{ checked: attemptsEnabled }}
        onPress={onToggleAttempts}
        style={[styles.ruleOption, attemptsEnabled && styles.ruleOptionActive]}
        testID="battleship-attempts-toggle"
      >
        <Text style={styles.ruleOptionTitle}>
          {attemptsEnabled ? labels.attemptsOn : labels.attemptsOff}
        </Text>
        <Text style={styles.ruleOptionMeta}>{attemptsEnabled ? `${MAX_ATTEMPTS}` : '\u221e'}</Text>
      </Pressable>

      <LuxuryButton onPress={onStartMatch} title={labels.startMatch} />
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
    marginTop: spacing.xl,
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
    color: colors.goldSoft,
    fontSize: typography.sizes.headline,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  text: {
    color: colors.text,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  ruleOption: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.16)',
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  ruleOptionActive: {
    borderColor: colors.borderGold,
  },
  ruleOptionTitle: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  ruleOptionMeta: {
    color: colors.goldSoft,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
  },
});
