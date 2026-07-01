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

type DrawingGuessScreenProps = NativeStackScreenProps<RootStackParamList, 'DrawingGuess'>;

export function DrawingGuessScreen({ navigation, route }: DrawingGuessScreenProps) {
  const controller = useDrawingGuessController(route.params, () => navigation.goBack());
  const { actions, viewModel } = controller;
  const [localStatus, setLocalStatus] = useState('');

  const showLocalStatus = (label: string) => {
    setLocalStatus(label);
    setTimeout(() => setLocalStatus(''), 1500);
  };

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={actions.leaveGame} style={styles.closeButton}>
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
        </View>
      </View>

      <DrawingGuessConnectionBanner label={viewModel.connectionLabel} />

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
                actions.clearCanvas();
                showLocalStatus('Canvas cleared.');
              },
              undoLatestStroke: () => {
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
        <Text style={styles.promptBody}>The drawer is choosing a prompt. The secret stays hidden until results.</Text>
      </View>
    );
  }

  return (
    <View style={styles.promptCard}>
      <Text style={styles.promptEyebrow}>Secret prompt</Text>
      <Text style={styles.promptTitle}>Choose your prompt</Text>
      <Text style={styles.promptBody}>Pick one card. Only you can see it while drawing.</Text>
      <View style={styles.promptGrid}>
        {viewModel.promptOptions.map((prompt, index) => (
          <Pressable
            accessibilityRole="button"
            key={prompt.id}
            onPress={() => actions.choosePrompt(prompt.id)}
            style={({ pressed }) => [styles.promptOption, pressed && styles.promptOptionPressed]}
          >
            <Text style={styles.promptCategory}>Choice {index + 1}</Text>
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
        onPress={viewModel.isOnlineRoom ? actions.createOnlineRoom : actions.createLocalRoom}
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
  },
  eyebrow: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
  },
  title: {
    color: colors.text,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  subtitle: {
    color: colors.textMuted,
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
    overflow: 'hidden',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
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
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  promptBody: {
    color: colors.textMuted,
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
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
  },
  rankingPoints: {
    color: colors.gold,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
    minWidth: 44,
  },
});
