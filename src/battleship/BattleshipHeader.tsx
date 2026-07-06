import { Pressable, StyleSheet, Text, View } from 'react-native';

import { miniGameModes } from '../data/miniGameModes';
import { colors, radius, spacing, typography } from '../theme';
import { MiniGameMode, MiniGameModeId } from '../types/miniGame';
import { labels } from './constants';

type BattleshipHeaderProps = {
  mode: MiniGameMode;
  modeId: MiniGameModeId;
  onBack: () => void;
  onModeChange: (modeId: MiniGameModeId) => void;
  onToggleSound: () => void;
  soundMuted: boolean;
};

export function BattleshipHeader({
  mode,
  modeId,
  onBack,
  onModeChange,
  onToggleSound,
  soundMuted,
}: BattleshipHeaderProps) {
  return (
    <>
      <View style={styles.header} testID="battleship-header">
        <Pressable
          accessibilityHint={labels.backHint}
          accessibilityLabel={labels.back}
          accessibilityRole="button"
          onPress={onBack}
          style={styles.backButton}
          testID="battleship-back-button"
        >
          <Text style={styles.backText}>{labels.back}</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>{labels.localGame}</Text>
          <Text style={styles.title}>{mode.title}</Text>
          <Text style={styles.subtitle}>
            {mode.subtitle} {labels.subtitleSuffix}
          </Text>
        </View>
      </View>

      <View style={styles.modeSwitch}>
        {miniGameModes.map((item) => {
          const active = item.id === modeId;

          return (
            <Pressable
              accessibilityLabel={item.title}
              accessibilityHint={labels.modeHint}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={item.id}
              onPress={() => onModeChange(item.id)}
              style={[styles.modeButton, active && { borderColor: item.accentColor }]}
              testID={`battleship-mode-${item.id}`}
            >
              <Text style={[styles.modeText, active && styles.modeTextActive]}>{item.title}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        accessibilityLabel={soundMuted ? labels.soundOff : labels.soundOn}
        accessibilityHint={labels.soundHint}
        accessibilityRole="switch"
        accessibilityState={{ checked: !soundMuted }}
        onPress={onToggleSound}
        style={styles.soundToggle}
        testID="battleship-sound-toggle"
      >
        <Text style={styles.soundToggleText}>
          {soundMuted ? labels.soundOff : labels.soundOn}
        </Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  backButton: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  backText: {
    color: colors.goldSoft,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  headerCopy: {
    flex: 1,
  },
  kicker: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: typography.weights.black,
    lineHeight: 36,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    lineHeight: 22,
    marginTop: spacing.xs,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  modeSwitch: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  modeButton: {
    backgroundColor: 'rgba(255,255,255,0.065)',
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  modeText: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  modeTextActive: {
    color: colors.text,
  },
  soundToggle: {
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  soundToggleText: {
    color: colors.goldSoft,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
