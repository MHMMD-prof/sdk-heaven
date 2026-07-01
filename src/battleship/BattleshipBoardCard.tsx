import { ComponentProps } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import { MiniGameMode } from '../types/miniGame';
import { labels } from './constants';
import { BattleshipOwnBoard, BattleshipTargetBoard } from './BattleshipBoard';
import { GamePhase, LastShot } from './BattleshipGameTypes';

type TargetBoardProps = ComponentProps<typeof BattleshipTargetBoard>;
type OwnBoardProps = ComponentProps<typeof BattleshipOwnBoard>;

type BattleshipBoardCardProps = {
  attemptsLeftText: string;
  hits: number;
  isSetupPhase: boolean;
  lastShot?: LastShot;
  mode: MiniGameMode;
  onClearSetup: () => void;
  onRandomizeSetup: () => void;
  onRotateSelected: () => void;
  ownBoardProps: OwnBoardProps;
  phase: GamePhase;
  selectedTargetId?: string;
  shotsTaken: number;
  statusText: string;
  targetBoardProps: TargetBoardProps;
  totalTargetCells: number;
};

export function BattleshipBoardCard({
  attemptsLeftText,
  hits,
  isSetupPhase,
  lastShot,
  mode,
  onClearSetup,
  onRandomizeSetup,
  onRotateSelected,
  ownBoardProps,
  phase,
  selectedTargetId,
  shotsTaken,
  statusText,
  targetBoardProps,
  totalTargetCells,
}: BattleshipBoardCardProps) {
  return (
    <LinearGradient
      colors={['rgba(50,139,194,0.2)', 'rgba(9,29,53,0.78)', 'rgba(8,5,15,0.96)']}
      style={styles.card}
      testID="battleship-board-card"
    >
      <View style={styles.header}>
        <View style={styles.turnBadge}>
          <Text style={styles.turnBadgeText}>{statusText}</Text>
        </View>
        <Text style={styles.boardLabel}>
          {phase === 'battle' ? labels.enemyWaters : mode.boardLabel}
        </Text>
      </View>

      {isSetupPhase ? (
        <View style={styles.setupActions}>
          <Pressable
            accessibilityLabel={labels.rotate}
            accessibilityRole="button"
            accessibilityState={{ disabled: !selectedTargetId }}
            disabled={!selectedTargetId}
            onPress={onRotateSelected}
            style={[styles.toolButton, !selectedTargetId && styles.toolButtonDisabled]}
            testID="battleship-rotate-button"
          >
            <Text style={styles.toolButtonText}>{labels.rotate}</Text>
          </Pressable>
          <Pressable
            accessibilityLabel={labels.randomize}
            accessibilityRole="button"
            onPress={onRandomizeSetup}
            style={styles.toolButton}
            testID="battleship-randomize-button"
          >
            <Text style={styles.toolButtonText}>{labels.randomize}</Text>
          </Pressable>
          <Pressable
            accessibilityLabel={labels.clear}
            accessibilityRole="button"
            onPress={onClearSetup}
            style={styles.toolButton}
            testID="battleship-clear-button"
          >
            <Text style={styles.toolButtonText}>{labels.clear}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.statsRow}>
          <View style={styles.statTile}>
            <Text style={styles.statValue}>
              {hits}/{totalTargetCells}
            </Text>
            <Text style={styles.statLabel}>{labels.hits}</Text>
          </View>
          <View style={styles.statTile}>
            <Text style={styles.statValue}>{attemptsLeftText}</Text>
            <Text style={styles.statLabel}>{labels.remaining}</Text>
          </View>
          <View style={styles.statTile}>
            <Text style={styles.statValue}>{shotsTaken}</Text>
            <Text style={styles.statLabel}>{labels.shots}</Text>
          </View>
        </View>
      )}

      <View
        style={[
          styles.resultBanner,
          lastShot?.result === 'hit' && styles.resultBannerHit,
          lastShot?.result === 'miss' && styles.resultBannerMiss,
        ]}
      >
        <Text style={[styles.resultText, lastShot?.result === 'hit' && styles.resultTextHit]}>
          {lastShot?.text ?? statusText}
        </Text>
      </View>

      <BattleshipTargetBoard {...targetBoardProps} />

      {phase === 'battle' ? <BattleshipOwnBoard {...ownBoardProps} /> : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    borderColor: 'rgba(117, 191, 255, 0.26)',
    borderRadius: radius.xl,
    borderWidth: 1,
    marginBottom: spacing.lg,
    overflow: 'hidden',
    padding: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    width: '100%',
  },
  turnBadge: {
    backgroundColor: 'rgba(255,255,255,0.075)',
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    maxWidth: '58%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  turnBadgeText: {
    color: colors.goldSoft,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  boardLabel: {
    color: colors.text,
    flexShrink: 1,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  setupActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
    width: '100%',
  },
  toolButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    minWidth: 82,
    paddingVertical: spacing.sm,
  },
  toolButtonDisabled: {
    opacity: 0.45,
  },
  toolButtonText: {
    color: colors.text,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
    width: '100%',
  },
  statTile: {
    backgroundColor: 'rgba(3, 12, 23, 0.46)',
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    minWidth: 82,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
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
  resultBanner: {
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: 'rgba(255,255,255,0.11)',
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    marginBottom: spacing.md,
    minHeight: 42,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: '100%',
  },
  resultBannerHit: {
    backgroundColor: 'rgba(75,163,255,0.15)',
    borderColor: 'rgba(75,163,255,0.34)',
  },
  resultBannerMiss: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.09)',
  },
  resultText: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  resultTextHit: {
    color: colors.text,
  },
});
