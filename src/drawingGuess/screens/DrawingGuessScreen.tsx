import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { PropsWithChildren, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { LuxuryButton } from '../../components/LuxuryButton';
import { ScreenContainer } from '../../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../../theme';
import { RootStackParamList } from '../../types/navigation';
import { useDrawingGuessController } from '../controller/useDrawingGuessController';
import { DrawingGuessCanvasStage } from './DrawingGuessCanvasStage';
import { DrawingGuessConnectionBanner } from './DrawingGuessConnectionBanner';
import { DrawingGuessGuessPanel } from './DrawingGuessGuessPanel';
import { DrawingGuessLobbyPanel } from './DrawingGuessLobbyPanel';
import { DrawingGuessRoundResults } from './DrawingGuessRoundResults';
import { DrawingGuessScorePanel } from './DrawingGuessScorePanel';
import { triggerDrawingGuessHaptic } from './drawingGuessHaptics';
import {
  drawingGuessShowcaseHelpBody,
  drawingGuessShowcaseHelpSteps,
  drawingGuessShowcaseHelpTitle,
} from './drawingGuessShowcaseHelp';

type DrawingGuessScreenProps = NativeStackScreenProps<RootStackParamList, 'DrawingGuess'>;

export function DrawingGuessScreen({ navigation, route }: DrawingGuessScreenProps) {
  const controller = useDrawingGuessController(route.params, () => navigation.goBack());
  const { actions, viewModel } = controller;
  const [localStatus, setLocalStatus] = useState('');
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const localStatusTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showLocalStatus = (label: string) => {
    if (localStatusTimeout.current) {
      clearTimeout(localStatusTimeout.current);
    }

    setLocalStatus(label);
    localStatusTimeout.current = setTimeout(() => setLocalStatus(''), 1500);
  };

  useEffect(
    () => () => {
      if (localStatusTimeout.current) {
        clearTimeout(localStatusTimeout.current);
      }
    },
    [],
  );

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable
          accessibilityHint="Leave Drawing Guess and return to the previous screen."
          accessibilityLabel="Close Drawing Guess"
          accessibilityRole="button"
          onPress={() => {
            void triggerDrawingGuessHaptic('selection');
            actions.leaveGame();
          }}
          style={styles.closeButton}
        >
          <Text style={styles.closeIcon}>x</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>{viewModel.phaseLabel}</Text>
          <Text style={styles.title}>{viewModel.launchTitle}</Text>
          <Text style={styles.subtitle}>{viewModel.launchSubtitle}</Text>
          <View style={styles.headerMeta}>
            <Text style={styles.headerPill}>{viewModel.connectedPlayerCount} players</Text>
            {viewModel.drawerName ? <Text style={styles.headerPill}>Drawer: {viewModel.drawerName}</Text> : null}
          </View>
          {viewModel.isShowcaseMode ? (
            <Pressable
              accessibilityHint="Open a short guide to the local drawing game."
              accessibilityLabel={drawingGuessShowcaseHelpTitle}
              accessibilityRole="button"
              onPress={() => {
                void triggerDrawingGuessHaptic('selection');
                setIsHelpOpen(true);
              }}
              style={styles.helpButton}
            >
              <Text style={styles.helpButtonText}>{drawingGuessShowcaseHelpTitle}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <DrawingGuessConnectionBanner label={viewModel.connectionLabel} />

      {isHelpOpen ? (
        <FadeInPanel animationKey="drawing-guess-help">
          <View
            accessibilityLabel={`${drawingGuessShowcaseHelpTitle}. ${drawingGuessShowcaseHelpBody}`}
            accessibilityRole="summary"
            style={styles.helpCard}
          >
            <Text style={styles.promptEyebrow}>{drawingGuessShowcaseHelpTitle}</Text>
            <View style={styles.helpStepList}>
              {drawingGuessShowcaseHelpSteps.map((step, index) => (
                <View key={step} style={styles.helpStep}>
                  <Text style={styles.helpStepNumber}>{index + 1}</Text>
                  <Text style={styles.helpStepText}>{step}</Text>
                </View>
              ))}
            </View>
            <Pressable
              accessibilityHint="Close the gameplay guide."
              accessibilityLabel="Got it"
              accessibilityRole="button"
              onPress={() => {
                void triggerDrawingGuessHaptic('selection');
                setIsHelpOpen(false);
              }}
              style={styles.helpCloseButton}
            >
              <Text style={styles.helpCloseButtonText}>Got it</Text>
            </Pressable>
          </View>
        </FadeInPanel>
      ) : null}

      {localStatus ? (
        <View style={styles.localStatus}>
          <Text style={styles.localStatusText}>{localStatus}</Text>
        </View>
      ) : null}

      {viewModel.phase === 'lobby' ? (
        <FadeInPanel animationKey={viewModel.phase}>
          <DrawingGuessLobbyPanel actions={actions} viewModel={viewModel} />
        </FadeInPanel>
      ) : null}

      {viewModel.phase === 'prompt-select' ? (
        <FadeInPanel animationKey={viewModel.phase}>
          <PromptSelectPanel actions={actions} viewModel={viewModel} />
        </FadeInPanel>
      ) : null}

      {viewModel.phase === 'drawing' ? (
        <>
          <DrawingGuessCanvasStage
            actions={{
              ...actions,
              clearCanvas: () => {
                void triggerDrawingGuessHaptic('warning');
                actions.clearCanvas();
                showLocalStatus('Canvas cleared.');
              },
              undoLatestStroke: () => {
                void triggerDrawingGuessHaptic('selection');
                actions.undoLatestStroke();
                showLocalStatus('Stroke undone.');
              },
            }}
            viewModel={viewModel}
          />
          <FadeInPanel animationKey={`${viewModel.phase}:${viewModel.hasLocalPlayerGuessedCorrectly}`}>
            <DrawingGuessGuessPanel actions={actions} viewModel={viewModel} />
          </FadeInPanel>
        </>
      ) : null}

      {viewModel.phase === 'round-results' ? (
        <FadeInPanel animationKey={viewModel.phase}>
          <DrawingGuessRoundResults actions={actions} viewModel={viewModel} />
        </FadeInPanel>
      ) : null}

      {viewModel.phase === 'match-results' ? (
        <FadeInPanel animationKey={viewModel.phase}>
          <MatchResultsPanel actions={actions} viewModel={viewModel} />
        </FadeInPanel>
      ) : null}

      <DrawingGuessScorePanel viewModel={viewModel} />
    </ScreenContainer>
  );
}

type FadeInPanelProps = PropsWithChildren<{
  animationKey: string;
}>;

function FadeInPanel({ animationKey, children }: FadeInPanelProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    opacity.setValue(0);
    translateY.setValue(10);
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [animationKey, opacity, translateY]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

type DrawingGuessPanelProps = {
  viewModel: ReturnType<typeof useDrawingGuessController>['viewModel'];
  actions: ReturnType<typeof useDrawingGuessController>['actions'];
};

function PromptSelectPanel({ actions, viewModel }: DrawingGuessPanelProps) {
  if (!viewModel.canChoosePrompt) {
    return (
      <View style={styles.promptCard}>
        <Text style={styles.promptEyebrow}>Secret prompt</Text>
        <Text style={styles.promptTitle}>Waiting for {viewModel.drawerName ?? 'the drawer'}</Text>
        <Text style={styles.promptBody}>
          They are picking a secret card. Watch the canvas, then jump in with your guess.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.promptCard}>
      <Text style={styles.promptEyebrow}>Secret prompt</Text>
      <Text style={styles.promptTitle}>Choose your prompt</Text>
      <Text style={styles.promptBody}>Pick one card. Only you can see it while drawing.</Text>
      <View style={styles.promptGrid}>
        {viewModel.promptOptions.map((prompt) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Choose ${prompt.text}, ${prompt.categoryLabel}`}
            accessibilityHint="Select this secret prompt and start drawing."
            key={prompt.id}
            onPress={() => {
              void triggerDrawingGuessHaptic('selection');
              actions.choosePrompt(prompt.id);
            }}
            style={({ pressed }) => [styles.promptOption, pressed && styles.promptOptionPressed]}
          >
            <Text style={styles.promptCategory}>{prompt.categoryLabel}</Text>
            <Text style={styles.promptOptionText}>{prompt.text}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function MatchResultsPanel({ actions, viewModel }: DrawingGuessPanelProps) {
  const winner = viewModel.finalRankings[0];

  return (
    <View style={styles.promptCard}>
      <View style={styles.winnerHero}>
        <Text style={styles.promptEyebrow}>Winner</Text>
        <Text style={styles.winnerName}>
          {winner?.displayName ?? 'No winner'}
          {winner?.isLocalPlayer ? ' (you)' : ''}
        </Text>
        <Text style={styles.winnerPoints}>{winner?.points ?? 0} points</Text>
      </View>
      <View style={styles.podiumList}>
        {viewModel.finalRankings.map((player) => (
          <View key={player.playerId} style={[styles.rankingRow, player.isWinner && styles.winnerRow]}>
            <Text style={styles.rankingRank}>#{player.rank}</Text>
            <View style={styles.rankingAvatar}>
              <Text style={styles.rankingAvatarText}>{player.avatarLabel}</Text>
            </View>
            <Text style={styles.rankingName}>
              {player.displayName}
              {player.isLocalPlayer ? ' (you)' : ''}
            </Text>
            <Text style={styles.rankingPoints}>{player.points}</Text>
          </View>
        ))}
      </View>
      <LuxuryButton
        onPress={() => {
          void triggerDrawingGuessHaptic('success');
          if (viewModel.isOnlineRoom) {
            actions.createOnlineRoom();
            return;
          }
          actions.createLocalRoom();
        }}
        title={viewModel.isOnlineRoom ? 'New online room' : 'New local match'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  closeIcon: {
    color: colors.goldSoft,
    fontSize: 22,
    fontWeight: typography.weights.black,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
  },
  title: {
    color: colors.text,
    flexShrink: 1,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  subtitle: {
    color: colors.textMuted,
    flexShrink: 1,
    fontSize: typography.sizes.body,
    lineHeight: 22,
    marginTop: spacing.sm,
    textAlign: 'right',
  },
  headerMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    marginTop: spacing.sm,
  },
  headerPill: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    maxWidth: '100%',
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  helpButton: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(232,190,97,0.12)',
    borderColor: colors.borderGold,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  helpButtonText: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    textAlign: 'center',
  },
  helpCard: {
    backgroundColor: 'rgba(255,255,255,0.075)',
    borderColor: colors.borderGold,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  helpStepList: {
    gap: spacing.sm,
  },
  helpStep: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  helpStepNumber: {
    backgroundColor: 'rgba(232,190,97,0.14)',
    borderColor: colors.borderGold,
    borderRadius: 999,
    borderWidth: 1,
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    minWidth: 28,
    overflow: 'hidden',
    paddingVertical: 4,
    textAlign: 'center',
  },
  helpStepText: {
    color: colors.text,
    flex: 1,
    fontSize: typography.sizes.body,
    lineHeight: 22,
    textAlign: 'right',
  },
  helpCloseButton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: 'rgba(232,190,97,0.14)',
    borderColor: colors.borderGold,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  helpCloseButtonText: {
    color: colors.gold,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.black,
  },
  localStatus: {
    backgroundColor: 'rgba(43,203,136,0.12)',
    borderColor: 'rgba(43,203,136,0.35)',
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.sm,
  },
  localStatusText: {
    color: colors.emerald,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    textAlign: 'center',
  },
  promptCard: {
    backgroundColor: 'rgba(255,255,255,0.065)',
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    marginBottom: spacing.md,
    overflow: 'hidden',
    padding: spacing.lg,
  },
  promptEyebrow: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  promptTitle: {
    color: colors.text,
    flexShrink: 1,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  promptBody: {
    color: colors.textMuted,
    flexShrink: 1,
    fontSize: typography.sizes.body,
    lineHeight: 22,
    textAlign: 'right',
  },
  promptGrid: {
    gap: spacing.sm,
  },
  promptOption: {
    backgroundColor: 'rgba(232,190,97,0.10)',
    borderColor: colors.borderGold,
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 82,
    minWidth: 0,
    justifyContent: 'center',
    padding: spacing.md,
  },
  promptOptionPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.99 }],
  },
  promptCategory: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  promptOptionText: {
    color: colors.text,
    flexShrink: 1,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
    marginTop: spacing.xs,
    textAlign: 'right',
  },
  winnerHero: {
    backgroundColor: 'rgba(232,190,97,0.12)',
    borderColor: colors.borderGold,
    borderRadius: 18,
    borderWidth: 1,
    padding: spacing.lg,
  },
  winnerName: {
    color: colors.text,
    flexShrink: 1,
    fontSize: typography.sizes.headline,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  winnerPoints: {
    color: colors.gold,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
    marginTop: spacing.xs,
    textAlign: 'right',
  },
  podiumList: {
    gap: spacing.sm,
  },
  rankingRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    padding: spacing.sm,
  },
  winnerRow: {
    backgroundColor: 'rgba(232,190,97,0.10)',
    borderColor: colors.borderGold,
  },
  rankingRank: {
    color: colors.gold,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.black,
    minWidth: 36,
  },
  rankingAvatar: {
    alignItems: 'center',
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  rankingAvatarText: {
    color: colors.goldSoft,
    fontWeight: typography.weights.black,
  },
  rankingName: {
    color: colors.text,
    flex: 1,
    flexShrink: 1,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
  },
  rankingPoints: {
    color: colors.gold,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
    minWidth: 44,
    textAlign: 'left',
  },
});
