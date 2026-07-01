import { StyleSheet, Text, View } from 'react-native';

import { LuxuryButton } from '../components/LuxuryButton';
import { colors, radius, spacing, typography } from '../theme';
import { MiniGameMode } from '../types/miniGame';
import { labels } from './constants';

type BattleshipVictoryPanelProps = {
  mode: MiniGameMode;
  onReset: () => void;
  playerOneHits: number;
  playerOneShots: number;
  playerTwoHits: number;
  playerTwoShots: number;
  totalTargetCells: number;
  winner?: 1 | 2;
};

export function BattleshipVictoryPanel({
  mode,
  onReset,
  playerOneHits,
  playerOneShots,
  playerTwoHits,
  playerTwoShots,
  totalTargetCells,
  winner,
}: BattleshipVictoryPanelProps) {
  return (
    <View style={styles.panel} testID="battleship-victory-panel">
      <Text style={styles.kicker}>{mode.title}</Text>
      <Text style={styles.title}>
        {winner ? `${labels.victory}: ${labels.player} ${winner}` : labels.draw}
      </Text>
      <Text style={styles.text}>
        {winner ? `${labels.winner} ${labels.player} ${winner}` : labels.noWinner}
      </Text>

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>
            {playerOneHits}/{totalTargetCells}
          </Text>
          <Text style={styles.statLabel}>
            {labels.player} 1 - {labels.hits}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>
            {playerTwoHits}/{totalTargetCells}
          </Text>
          <Text style={styles.statLabel}>
            {labels.player} 2 - {labels.hits}
          </Text>
        </View>
      </View>

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{playerOneShots}</Text>
          <Text style={styles.statLabel}>
            {labels.player} 1 - {labels.shots}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{playerTwoShots}</Text>
          <Text style={styles.statLabel}>
            {labels.player} 2 - {labels.shots}
          </Text>
        </View>
      </View>

      <LuxuryButton onPress={onReset} title={labels.newRound} />
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
  stats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  stat: {
    backgroundColor: 'rgba(0,0,0,0.16)',
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    minWidth: 118,
    padding: spacing.md,
  },
  statValue: {
    color: colors.text,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
    textAlign: 'center',
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    marginTop: 2,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
