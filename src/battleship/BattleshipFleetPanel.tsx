import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LuxuryButton } from '../components/LuxuryButton';
import { colors, radius, spacing, typography } from '../theme';
import { MiniGameTarget } from '../types/miniGame';
import { labels } from './constants';

type BattleshipFleetPanelProps = {
  activeGuesses: Set<string>;
  activeTargets: MiniGameTarget[];
  hits: number;
  isSetupPhase: boolean;
  modeAccentColor: string;
  onConfirmFleet: () => void;
  onPickUpTarget: (targetId: string, anchorCellId?: string) => void;
  selectedTargetId?: string;
  setupFleetReady: boolean;
  setupTargets: MiniGameTarget[];
  totalTargetCells: number;
};

export function BattleshipFleetPanel({
  activeGuesses,
  activeTargets,
  hits,
  isSetupPhase,
  modeAccentColor,
  onConfirmFleet,
  onPickUpTarget,
  selectedTargetId,
  setupFleetReady,
  setupTargets,
  totalTargetCells,
}: BattleshipFleetPanelProps) {
  if (isSetupPhase) {
    const selectedTarget = setupTargets.find((target) => target.id === selectedTargetId);

    return (
      <View style={styles.panel} testID="battleship-setup-fleet-panel">
        <View style={styles.header}>
          <Text style={styles.meta}>
            {setupTargets.filter((target) => target.isPlaced).length}/{setupTargets.length}
          </Text>
          <Text style={styles.title}>{labels.setupFleet}</Text>
        </View>
        {selectedTarget ? (
          <Text style={styles.selectedText}>
            {labels.selectedShip}: {selectedTarget.name}
          </Text>
        ) : null}
        {setupTargets.map((target) => (
          <Pressable
            accessibilityLabel={`${target.name} ${target.isPlaced ? labels.placed : labels.unplaced}`}
            accessibilityHint={labels.setupShipHint}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedTargetId === target.id }}
            key={target.id}
            onPress={() => onPickUpTarget(target.id, target.cells[0])}
            style={[
              styles.row,
              selectedTargetId === target.id && { borderColor: modeAccentColor },
            ]}
          >
            <View style={styles.progress}>
              {Array.from({ length: target.footprint.columns * target.footprint.rows }).map(
                (_, index) => (
                  <View
                    key={`${target.id}-${index}`}
                    style={[
                      styles.dot,
                      target.isPlaced && { backgroundColor: modeAccentColor },
                    ]}
                  />
                ),
              )}
            </View>
            <View style={styles.copy}>
              <Text style={styles.name}>{target.name}</Text>
              <Text style={[styles.state, target.isPlaced && styles.complete]}>
                {target.isPlaced ? labels.placed : labels.unplaced}
              </Text>
            </View>
          </Pressable>
        ))}
        <LuxuryButton
          accessibilityHint={labels.passSetupReady}
          disabled={!setupFleetReady}
          onPress={onConfirmFleet}
          title={labels.confirmFleet}
        />
      </View>
    );
  }

  return (
    <View style={styles.panel} testID="battleship-target-fleet-panel">
      <View style={styles.header}>
        <Text style={styles.meta}>
          {hits}/{totalTargetCells}
        </Text>
        <Text style={styles.title}>{labels.targetFleet}</Text>
      </View>
      {activeTargets.map((target) => {
        const revealed = target.cells.filter((cell) => activeGuesses.has(cell)).length;
        const complete = revealed === target.cells.length;

        return (
          <View key={target.id} style={styles.row}>
            <View style={styles.progress}>
              {target.cells.map((cell, index) => (
                <View
                  key={cell}
                  style={[
                    styles.dot,
                    index < revealed && { backgroundColor: modeAccentColor },
                    complete && styles.dotComplete,
                  ]}
                />
              ))}
            </View>
            <View style={styles.copy}>
              <Text style={styles.name}>{target.name}</Text>
              <Text style={[styles.state, complete && styles.complete]}>
                {complete ? labels.sunk : `${revealed}/${target.cells.length} ${labels.waiting}`}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    marginBottom: spacing.lg,
    padding: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  title: {
    color: colors.text,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  meta: {
    color: colors.goldSoft,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
  },
  row: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.12)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
    padding: spacing.sm,
  },
  progress: {
    flexShrink: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    maxWidth: 116,
  },
  dot: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.13)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 10,
    width: 10,
  },
  dotComplete: {
    backgroundColor: colors.emerald,
    borderColor: 'rgba(255,255,255,0.36)',
  },
  copy: {
    flex: 1,
    marginLeft: spacing.md,
  },
  name: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  state: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    marginTop: 2,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  complete: {
    color: colors.emerald,
  },
  selectedText: {
    color: colors.goldSoft,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
