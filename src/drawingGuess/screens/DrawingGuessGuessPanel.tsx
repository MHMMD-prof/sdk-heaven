import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '../../components/GlassCard';
import { LuxuryButton } from '../../components/LuxuryButton';
import { LuxuryInput } from '../../components/LuxuryInput';
import { colors, spacing, typography } from '../../theme';
import { DrawingGuessActions, DrawingGuessViewModel } from '../controller/drawingGuessControllerTypes';
import { triggerDrawingGuessHaptic } from './drawingGuessHaptics';

type DrawingGuessGuessPanelProps = {
  viewModel: DrawingGuessViewModel;
  actions: DrawingGuessActions;
};

export function DrawingGuessGuessPanel({ actions, viewModel }: DrawingGuessGuessPanelProps) {
  const [guess, setGuess] = useState('');

  useEffect(() => {
    if (viewModel.hasLocalPlayerGuessedCorrectly) {
      void triggerDrawingGuessHaptic('success');
    }
  }, [viewModel.hasLocalPlayerGuessedCorrectly]);

  const submitGuess = () => {
    void triggerDrawingGuessHaptic('selection');
    actions.submitGuess(guess);
    setGuess('');
  };

  return (
    <GlassCard style={styles.card}>
      <Text style={styles.title}>Guesses</Text>
      {viewModel.hasLocalPlayerGuessedCorrectly ? (
        <View
          accessibilityLabel="Correct. Wait for the round reveal."
          accessibilityRole="text"
          style={styles.solvedCard}
        >
          <Text style={styles.solved}>Correct! Wait for the round reveal.</Text>
        </View>
      ) : null}
      {viewModel.canSubmitGuess ? (
        <>
          <LuxuryInput
            blurOnSubmit={false}
            accessibilityHint="Type your guess and submit it before time runs out."
            accessibilityLabel="Your guess"
            label="Your guess"
            onChangeText={setGuess}
            onSubmitEditing={() => {
              if (guess.trim()) {
                submitGuess();
              }
            }}
            returnKeyType="send"
            value={guess}
          />
          <LuxuryButton
            accessibilityHint={
              guess.trim() ? 'Submit your guess.' : 'Type a guess before submitting.'
            }
            disabled={!guess.trim()}
            onPress={submitGuess}
            title="Send guess"
          />
        </>
      ) : null}
      <View style={styles.feed}>
        {viewModel.guesses.length === 0 ? (
          <Text style={styles.empty}>Guesses will appear here.</Text>
        ) : (
          viewModel.guessFeed.map((item) => <GuessFeedRow item={item} key={item.id} />)
        )}
      </View>
    </GlassCard>
  );
}

type GuessFeedRowProps = {
  item: DrawingGuessViewModel['guessFeed'][number];
};

function GuessFeedRow({ item }: GuessFeedRowProps) {
  return (
    <View style={[styles.guessRow, item.isCorrect && styles.correctGuessRow]}>
      <View style={[styles.guessBadge, item.isCorrect && styles.correctGuessBadge]}>
        <Text style={styles.guessBadgeText}>{item.playerName.trim().charAt(0) || '?'}</Text>
      </View>
      <View style={styles.guessCopy}>
        <Text style={styles.guessName}>
          {item.playerName}
          {item.isLocalPlayer ? ' (you)' : ''}
        </Text>
        <Text style={[styles.guess, item.isCorrect && styles.correctGuess]}>
          {item.originalText}
        </Text>
      </View>
      {item.isCorrect ? <Text style={styles.correctPill}>Correct</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  title: {
    color: colors.text,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  feed: {
    gap: spacing.sm,
  },
  empty: {
    color: colors.textSubtle,
    fontSize: typography.sizes.caption,
    textAlign: 'right',
  },
  guessRow: {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  correctGuessRow: {
    backgroundColor: 'rgba(43,203,136,0.11)',
    borderColor: 'rgba(43,203,136,0.38)',
  },
  guessBadge: {
    alignItems: 'center',
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  correctGuessBadge: {
    backgroundColor: colors.emerald,
    borderColor: colors.emerald,
  },
  guessBadgeText: {
    color: colors.text,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
  },
  guessCopy: {
    flex: 1,
    minWidth: 0,
  },
  guessName: {
    color: colors.text,
    flexShrink: 1,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
  },
  guess: {
    color: colors.textMuted,
    flexShrink: 1,
    fontSize: typography.sizes.body,
    textAlign: 'right',
  },
  correctGuess: {
    color: colors.emerald,
    fontWeight: typography.weights.bold,
  },
  correctPill: {
    backgroundColor: 'rgba(43,203,136,0.18)',
    borderColor: 'rgba(43,203,136,0.42)',
    borderRadius: 999,
    borderWidth: 1,
    color: colors.emerald,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    maxWidth: 92,
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  solved: {
    color: colors.emerald,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
  },
  solvedCard: {
    backgroundColor: 'rgba(43,203,136,0.12)',
    borderColor: 'rgba(43,203,136,0.38)',
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.md,
  },
});
