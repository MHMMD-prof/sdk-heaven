import { StyleSheet, Text, View } from 'react-native';

import { LuxuryButton } from '../components/LuxuryButton';
import { colors, radius, spacing, typography } from '../theme';
import { labels } from './constants';

type BattleshipHandoffPanelProps = {
  player: 1 | 2;
  onContinue: () => void;
};

export function BattleshipHandoffPanel({ player, onContinue }: BattleshipHandoffPanelProps) {
  return (
    <View style={styles.panel} testID="battleship-handoff-panel">
      <Text style={styles.kicker}>
        {labels.player} {player}
      </Text>
      <Text style={styles.title}>{labels.passTitle}</Text>
      <Text style={styles.text}>{labels.passReady}</Text>
      <LuxuryButton onPress={onContinue} title={labels.passReady} />
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
});
