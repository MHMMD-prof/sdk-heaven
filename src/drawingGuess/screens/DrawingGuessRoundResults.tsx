import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '../../components/GlassCard';
import { LuxuryButton } from '../../components/LuxuryButton';
import { colors, spacing, typography } from '../../theme';
import { DrawingGuessActions, DrawingGuessViewModel } from '../controller/drawingGuessControllerTypes';
import { triggerDrawingGuessHaptic } from './drawingGuessHaptics';

type DrawingGuessRoundResultsProps = {
  viewModel: DrawingGuessViewModel;
  actions: DrawingGuessActions;
};

export function DrawingGuessRoundResults({ actions, viewModel }: DrawingGuessRoundResultsProps) {
  return (
    <GlassCard style={styles.card}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Round result</Text>
        <Text style={styles.prompt}>{viewModel.revealedPromptText ?? 'Hidden'}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaPill}>{getRoundEndReasonLabel(viewModel.roundEndReason)}</Text>
          <Text style={styles.metaPill}>
            {viewModel.players.filter((player) => player.hasGuessedCorrectly).length} correct
          </Text>
        </View>
      </View>
      <View style={styles.deltaList}>
        {viewModel.players.map((player) => (
          <RoundResultRow key={player.id} player={player} viewModel={viewModel} />
        ))}
      </View>
      {viewModel.canAdvanceRound ? (
        <LuxuryButton
          accessibilityHint={
            viewModel.isFinalRound
              ? 'Show the final scoreboard.'
              : 'Move to the next drawer.'
          }
          onPress={() => {
            void triggerDrawingGuessHaptic(viewModel.isFinalRound ? 'success' : 'selection');
            actions.advanceRound();
          }}
          title={viewModel.nextRoundLabel}
        />
      ) : null}
      {viewModel.isHost ? (
        <Pressable
          accessibilityHint="End the match and show final scores."
          accessibilityLabel="End match"
          accessibilityRole="button"
          onPress={() => {
            void triggerDrawingGuessHaptic('warning');
            actions.finishMatch();
          }}
          style={styles.secondaryAction}
        >
          <Text style={styles.secondaryActionText}>
            End match
          </Text>
        </Pressable>
      ) : null}
    </GlassCard>
  );
}

type RoundResultRowProps = {
  player: DrawingGuessViewModel['players'][number];
  viewModel: DrawingGuessViewModel;
};

function RoundResultRow({ player, viewModel }: RoundResultRowProps) {
  const points = viewModel.roundScoreDeltas[player.id] ?? 0;
  const status = player.isDrawer ? 'Drawer bonus' : player.hasGuessedCorrectly ? 'Correct' : 'Missed';

  return (
    <View
      style={[
        styles.resultRow,
        player.isDrawer && styles.drawerRow,
        player.hasGuessedCorrectly && styles.correctRow,
      ]}
    >
      <View style={styles.resultAvatar}>
        <Text style={styles.resultAvatarText}>{player.avatarLabel}</Text>
      </View>
      <View style={styles.resultCopy}>
        <Text style={styles.resultName}>
          {player.displayName}
          {player.id === viewModel.localPlayerId ? ' (you)' : ''}
        </Text>
        <Text style={styles.resultStatus}>{status}</Text>
      </View>
      <View style={styles.pointsBox}>
        <Text style={styles.delta}>+{points}</Text>
        <Text style={styles.total}>{player.points} total</Text>
      </View>
    </View>
  );
}

const getRoundEndReasonLabel = (reason: DrawingGuessViewModel['roundEndReason']) => {
  if (reason === 'timer') {
    return 'Timer ended';
  }

  if (reason === 'all-guessed') {
    return 'All guessed';
  }

  return 'Manual reveal';
};

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  hero: {
    backgroundColor: 'rgba(232,190,97,0.10)',
    borderColor: colors.borderGold,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  eyebrow: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  prompt: {
    color: colors.text,
    flexShrink: 1,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  metaPill: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  deltaList: {
    gap: spacing.sm,
  },
  resultRow: {
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
  correctRow: {
    backgroundColor: 'rgba(43,203,136,0.10)',
    borderColor: 'rgba(43,203,136,0.35)',
  },
  resultAvatar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  resultAvatarText: {
    color: colors.goldSoft,
    fontWeight: typography.weights.black,
  },
  resultCopy: {
    flex: 1,
    minWidth: 0,
  },
  resultName: {
    color: colors.text,
    flexShrink: 1,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
  },
  resultStatus: {
    color: colors.textSubtle,
    flexShrink: 1,
    fontSize: typography.sizes.caption,
    marginTop: 2,
    textAlign: 'right',
  },
  pointsBox: {
    alignItems: 'flex-start',
    flexShrink: 0,
    minWidth: 72,
  },
  delta: {
    color: colors.gold,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
  },
  total: {
    color: colors.textSubtle,
    fontSize: typography.sizes.caption,
    marginTop: 2,
  },
  secondaryAction: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 42,
    justifyContent: 'center',
  },
  secondaryActionText: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
  },
});
