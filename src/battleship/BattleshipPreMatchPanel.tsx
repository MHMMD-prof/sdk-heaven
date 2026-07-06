import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LuxuryButton } from '../components/LuxuryButton';
import { colors, radius, spacing, typography } from '../theme';
import { MiniGameMode } from '../types/miniGame';
import { MAX_ATTEMPTS } from '../utils/miniGameEngine';
import { labels } from './constants';

type BattleshipPreMatchPanelProps = {
  attemptsEnabled: boolean;
  canResumeSavedMatch?: boolean;
  canStartNewMatch?: boolean;
  hasSavedMatch: boolean;
  isPersistenceLoading?: boolean;
  mode: MiniGameMode;
  onResumeMatch: () => void;
  onStartMatch: () => void;
  onToggleAttempts: () => void;
  savedMatchLabel?: string;
};

export function BattleshipPreMatchPanel({
  attemptsEnabled,
  canResumeSavedMatch = true,
  canStartNewMatch = true,
  hasSavedMatch,
  isPersistenceLoading = false,
  mode,
  onResumeMatch,
  onStartMatch,
  onToggleAttempts,
  savedMatchLabel,
}: BattleshipPreMatchPanelProps) {
  return (
    <View style={styles.panel} testID="battleship-pre-match-panel">
      <Text style={styles.kicker}>{labels.localGame}</Text>
      <Text style={styles.title}>{mode.title}</Text>
      <Text style={styles.text}>{mode.subtitle}</Text>

      <View style={styles.helpBox}>
        <Text style={styles.helpTitle}>{labels.helpTitle}</Text>
        <Text style={styles.helpText}>{labels.helpSetup}</Text>
        <Text style={styles.helpText}>{labels.helpPrivacy}</Text>
        <Text style={styles.helpText}>{labels.helpFire}</Text>
      </View>

      {hasSavedMatch ? (
        <View style={styles.resumeBox} testID="battleship-resume-panel">
          <Text style={styles.resumeTitle}>{labels.resumeMatchPrompt}</Text>
          {savedMatchLabel ? <Text style={styles.resumeText}>{savedMatchLabel}</Text> : null}
          <LuxuryButton
            accessibilityHint={labels.resumeMatchHint}
            disabled={!canResumeSavedMatch}
            onPress={onResumeMatch}
            title={labels.resumeMatch}
          />
        </View>
      ) : null}

      <Pressable
        accessibilityHint={labels.attemptsHint}
        accessibilityLabel={attemptsEnabled ? labels.attemptsOn : labels.attemptsOff}
        accessibilityRole="switch"
        accessibilityState={{ checked: attemptsEnabled }}
        onPress={onToggleAttempts}
        style={[styles.ruleOption, attemptsEnabled && styles.ruleOptionActive]}
        testID="battleship-attempts-toggle"
      >
        <Text style={styles.ruleOptionTitle}>
          {attemptsEnabled ? labels.attemptsOn : labels.attemptsOff}
        </Text>
        <Text style={styles.ruleOptionMeta}>{attemptsEnabled ? `${MAX_ATTEMPTS}` : '\u221e'}</Text>
      </Pressable>

      <LuxuryButton
        accessibilityHint={labels.startMatchHint}
        disabled={!canStartNewMatch || isPersistenceLoading}
        onPress={onStartMatch}
        title={labels.startMatch}
      />
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
  helpBox: {
    backgroundColor: 'rgba(0,0,0,0.14)',
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  helpTitle: {
    color: colors.goldSoft,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  helpText: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    lineHeight: 18,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  resumeBox: {
    backgroundColor: 'rgba(43,203,136,0.1)',
    borderColor: 'rgba(43,203,136,0.34)',
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  resumeTitle: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  resumeText: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  ruleOption: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.16)',
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
    padding: spacing.md,
  },
  ruleOptionActive: {
    borderColor: colors.borderGold,
  },
  ruleOptionTitle: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    flex: 1,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  ruleOptionMeta: {
    color: colors.goldSoft,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
  },
});
