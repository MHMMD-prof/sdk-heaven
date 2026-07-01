import { StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '../../components/GlassCard';
import { colors, radius, spacing, typography } from '../../theme';
import { DrawingGuessViewModel } from '../controller/drawingGuessControllerTypes';

type DrawingGuessScorePanelProps = {
  viewModel: DrawingGuessViewModel;
};

export function DrawingGuessScorePanel({ viewModel }: DrawingGuessScorePanelProps) {
  return (
    <GlassCard style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Leaderboard</Text>
        <Text style={styles.phase}>{viewModel.phaseLabel}</Text>
      </View>
      {viewModel.leaderboard.map((ranking) => {
        const player = viewModel.players.find((item) => item.id === ranking.playerId);

        if (!player) {
          return null;
        }

        return (
          <View
            key={ranking.playerId}
            style={[
              styles.row,
              player.isDrawer && styles.drawerRow,
              ranking.isLocalPlayer && styles.localRow,
            ]}
          >
            <Text style={styles.rank}>#{ranking.rank}</Text>
            <Text style={styles.points}>{ranking.points}</Text>
            <View style={styles.copy}>
              <Text style={styles.name}>
                {ranking.displayName}
                {ranking.isLocalPlayer ? ' (you)' : ''}
              </Text>
              <View style={styles.badgeRow}>
                {player.isDrawer ? <Text style={styles.badge}>Drawing</Text> : null}
                {player.hasGuessedCorrectly ? <Text style={[styles.badge, styles.correctBadge]}>Correct</Text> : null}
                {player.isHost ? <Text style={styles.badge}>Host</Text> : null}
                {!player.isDrawer && !player.hasGuessedCorrectly && !player.isHost ? (
                  <Text style={styles.meta}>Ready</Text>
                ) : null}
              </View>
            </View>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{ranking.avatarLabel}</Text>
            </View>
          </View>
        );
      })}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: {
    color: colors.text,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  phase: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
  },
  row: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  drawerRow: {
    borderColor: colors.borderGold,
  },
  localRow: {
    backgroundColor: 'rgba(232,190,97,0.08)',
  },
  rank: {
    color: colors.textSubtle,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    minWidth: 30,
  },
  points: {
    color: colors.gold,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
    minWidth: 38,
  },
  copy: {
    flex: 1,
  },
  name: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
  },
  meta: {
    color: colors.textSubtle,
    fontSize: typography.sizes.caption,
    textAlign: 'right',
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    justifyContent: 'flex-end',
    marginTop: spacing.xs,
  },
  badge: {
    backgroundColor: 'rgba(232,190,97,0.12)',
    borderColor: colors.borderGold,
    borderRadius: 999,
    borderWidth: 1,
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  correctBadge: {
    backgroundColor: 'rgba(43,203,136,0.14)',
    borderColor: 'rgba(43,203,136,0.38)',
    color: colors.emerald,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  avatarText: {
    color: colors.goldSoft,
    fontWeight: typography.weights.black,
  },
});
