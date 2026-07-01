import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, ViewProps } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import { CarromCoinKind, CarromPlayer } from '../types/carrom';
import { ShotHistoryItem, getCoinLabel, getHistoryToneStyle } from '../utils/carromPresentation';

type CarromHeaderProps = {
  compact: boolean;
  kicker: string;
  onBack: () => void;
  onReset: () => void;
  title: string;
};

export function CarromHeader({ compact, kicker, onBack, onReset, title }: CarromHeaderProps) {
  return (
    <View style={[styles.header, compact && styles.headerCompact]}>
      <Pressable
        onPress={onBack}
        style={[styles.iconButton, compact && styles.iconButtonCompact]}
      >
        <Text style={[styles.iconButtonText, compact && styles.iconButtonTextCompact]}>‹</Text>
      </Pressable>

      <View style={styles.headerCenter}>
        <Text numberOfLines={1} style={[styles.kicker, compact && styles.kickerCompact]}>
          {kicker}
        </Text>
        <Text numberOfLines={1} style={[styles.title, compact && styles.titleCompact]}>
          {title}
        </Text>
      </View>

      <Pressable
        onPress={onReset}
        style={[styles.iconButton, compact && styles.iconButtonCompact]}
      >
        <Text style={[styles.resetIcon, compact && styles.resetIconCompact]}>↻</Text>
      </Pressable>
    </View>
  );
}

type CarromPlayerRailProps = {
  compact: boolean;
  currentPlayer: CarromPlayer;
  moving: boolean;
  playerCoins: Record<CarromPlayer, CarromCoinKind>;
  queenLabel: string;
  remaining: Record<CarromPlayer, number>;
  scores: Record<CarromPlayer, number>;
};

export function CarromPlayerRail({
  compact,
  currentPlayer,
  moving,
  playerCoins,
  queenLabel,
  remaining,
  scores,
}: CarromPlayerRailProps) {
  return (
    <View style={[styles.playerRail, compact && styles.playerRailCompact]}>
      <PlayerBadge
        active={currentPlayer === 2}
        compact={compact}
        coinKind={playerCoins[2]}
        player={2}
        remaining={remaining[2]}
        score={scores[2]}
      />
      <View style={[styles.turnCenter, compact && styles.turnCenterCompact]}>
        <Text numberOfLines={1} style={[styles.turnLabel, compact && styles.turnLabelCompact]}>
          {moving ? 'الضربة قيد الحركة' : `دور اللاعب ${currentPlayer}`}
        </Text>
        <Text
          numberOfLines={compact ? 1 : 2}
          style={[styles.targetLabel, compact && styles.targetLabelCompact]}
        >
          {queenLabel}
        </Text>
      </View>
      <PlayerBadge
        active={currentPlayer === 1}
        compact={compact}
        coinKind={playerCoins[1]}
        player={1}
        remaining={remaining[1]}
        score={scores[1]}
      />
    </View>
  );
}

type CarromSettingsRailProps = {
  aimAssistEnabled: boolean;
  compact: boolean;
  effectsEnabled: boolean;
  onToggleAimAssist: () => void;
  onToggleEffects: () => void;
  onToggleSound: () => void;
  soundEnabled: boolean;
};

export function CarromSettingsRail({
  aimAssistEnabled,
  compact,
  effectsEnabled,
  onToggleAimAssist,
  onToggleEffects,
  onToggleSound,
  soundEnabled,
}: CarromSettingsRailProps) {
  return (
    <View style={[styles.settingsRail, compact && styles.settingsRailCompact]}>
      <SettingToggle
        active={soundEnabled}
        compact={compact}
        label="الصوت"
        onPress={onToggleSound}
      />
      <SettingToggle
        active={aimAssistEnabled}
        compact={compact}
        label="المساعدة"
        onPress={onToggleAimAssist}
      />
      <SettingToggle
        active={effectsEnabled}
        compact={compact}
        label="الحركة"
        onPress={onToggleEffects}
      />
    </View>
  );
}

type CarromStrikerSliderProps = {
  panHandlers: ViewProps;
  progress: number;
  width: number;
};

export type CarromStrikerSliderHandle = {
  setProgress: (progress: number) => void;
};

export const CarromStrikerSlider = forwardRef<CarromStrikerSliderHandle, CarromStrikerSliderProps>(
  function CarromStrikerSlider({ panHandlers, progress, width }, ref) {
  const progressValue = useRef(new Animated.Value(progress)).current;
  const fillWidth = progressValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, width],
  });
  const thumbX = progressValue.interpolate({
    inputRange: [0, 1],
    outputRange: [-17, width - 17],
  });

  useEffect(() => {
    progressValue.setValue(progress);
  }, [progress, progressValue]);

  useImperativeHandle(
    ref,
    () => ({
      setProgress(nextProgress) {
        progressValue.setValue(Math.min(1, Math.max(0, nextProgress)));
      },
    }),
    [progressValue],
  );

  return (
    <View style={[styles.strikerSlider, { width }]} {...panHandlers}>
      <View pointerEvents="none" style={styles.strikerSliderTrack} />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.strikerSliderFillClip,
          {
            width: fillWidth,
          },
        ]}
      >
        <LinearGradient
          colors={[colors.goldSoft, colors.gold]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={styles.strikerSliderFill}
        />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[styles.strikerSliderThumb, { transform: [{ translateX: thumbX }] }]}
      >
        <View style={styles.strikerSliderThumbCore} />
      </Animated.View>
    </View>
  );
});

type CarromControlDockProps = {
  compact: boolean;
  statusSubtitle: string;
  statusText: string;
};

export function CarromControlDock({ compact, statusSubtitle, statusText }: CarromControlDockProps) {
  return (
    <View style={[styles.controlDock, compact && styles.controlDockCompact]}>
      <View style={styles.statusCopy}>
        <Text numberOfLines={1} style={[styles.statusTitle, compact && styles.statusTitleCompact]}>
          {statusText}
        </Text>
        <Text
          numberOfLines={compact ? 2 : 3}
          style={[styles.statusSubtitle, compact && styles.statusSubtitleCompact]}
        >
          {statusSubtitle}
        </Text>
      </View>
      <View style={[styles.strikerChip, compact && styles.strikerChipCompact]}>
        <View style={[styles.strikerDot, compact && styles.strikerDotCompact]} />
        <Text style={styles.strikerText}>Striker</Text>
      </View>
    </View>
  );
}

type CarromShotHistoryPanelProps = {
  compact: boolean;
  expanded: boolean;
  items: ShotHistoryItem[];
  onToggle: () => void;
};

export function CarromShotHistoryPanel({
  compact,
  expanded,
  items,
  onToggle,
}: CarromShotHistoryPanelProps) {
  return (
    <Pressable
      onPress={onToggle}
      style={[styles.historyPanel, compact && styles.historyPanelCompact]}
    >
      <View style={styles.historyHeader}>
        <Text style={styles.historyTitle}>سجل الضربات</Text>
        <Text style={styles.historyToggle}>{expanded ? 'إخفاء' : 'عرض'}</Text>
      </View>
      {items.length > 0 ? (
        <View style={styles.historyList}>
          {(expanded ? items.slice(0, 5) : items.slice(0, 1)).map((item) => (
            <View key={item.id} style={styles.historyItem}>
              <View style={[styles.historyDot, styles[getHistoryToneStyle(item.tone)]]} />
              <Text numberOfLines={expanded ? 2 : 1} style={styles.historyText}>
                {item.message}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text numberOfLines={1} style={styles.historyEmpty}>
          ستظهر نتيجة كل ضربة هنا
        </Text>
      )}
    </Pressable>
  );
}

type PlayerBadgeProps = {
  active: boolean;
  compact: boolean;
  coinKind: CarromCoinKind;
  player: CarromPlayer;
  remaining: number;
  score: number;
};

function PlayerBadge({ active, compact, coinKind, player, remaining, score }: PlayerBadgeProps) {
  return (
    <View
      style={[
        styles.playerBadge,
        compact && styles.playerBadgeCompact,
        active && styles.playerBadgeActive,
      ]}
    >
      <View
        style={[
          styles.avatar,
          compact && styles.avatarCompact,
          coinKind === 'black' && styles.avatarBlack,
        ]}
      >
        <Text style={[styles.avatarText, compact && styles.avatarTextCompact]}>{player}</Text>
      </View>
      <View style={styles.playerCopy}>
        <Text numberOfLines={1} style={[styles.playerName, compact && styles.playerNameCompact]}>
          اللاعب {player}
        </Text>
        <Text numberOfLines={1} style={[styles.playerMeta, compact && styles.playerMetaCompact]}>
          {getCoinLabel(coinKind)} {score}/9 • متبقي {remaining}
        </Text>
      </View>
    </View>
  );
}

type SettingToggleProps = {
  active: boolean;
  compact: boolean;
  label: string;
  onPress: () => void;
};

function SettingToggle({ active, compact, label, onPress }: SettingToggleProps) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.settingToggle,
        compact && styles.settingToggleCompact,
        active && styles.settingToggleActive,
      ]}
    >
      <Text numberOfLines={1} style={[styles.settingToggleText, compact && styles.settingToggleTextCompact]}>
        {label}
      </Text>
      <View style={[styles.settingSwitch, active && styles.settingSwitchActive]}>
        <View style={[styles.settingSwitchThumb, active && styles.settingSwitchThumbActive]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.input,
    borderColor: colors.borderGold,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  avatarBlack: {
    backgroundColor: '#16131C',
    borderColor: 'rgba(255,255,255,0.35)',
  },
  avatarCompact: {
    height: 26,
    width: 26,
  },
  avatarText: {
    color: colors.goldSoft,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.black,
  },
  avatarTextCompact: {
    fontSize: 12,
  },
  controlDock: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: colors.border,
    borderRadius: radius.xl,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.md,
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  controlDockCompact: {
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  headerCenter: {
    alignItems: 'center',
    flex: 1,
  },
  headerCompact: {
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  historyDot: {
    borderRadius: radius.full,
    height: 8,
    width: 8,
  },
  historyDotFoul: {
    backgroundColor: '#FF8E9F',
  },
  historyDotNeutral: {
    backgroundColor: colors.textSubtle,
  },
  historyDotQueen: {
    backgroundColor: colors.goldSoft,
  },
  historyDotSuccess: {
    backgroundColor: '#63F4C4',
  },
  historyEmpty: {
    color: colors.textSubtle,
    fontSize: 10,
    fontWeight: typography.weights.semibold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  historyHeader: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  historyItem: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.xs,
    minHeight: 20,
  },
  historyList: {
    gap: spacing.xs,
  },
  historyPanel: {
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  historyPanelCompact: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  historyText: {
    color: colors.textMuted,
    flex: 1,
    fontSize: 10,
    fontWeight: typography.weights.semibold,
    lineHeight: 14,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  historyTitle: {
    color: colors.text,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  historyToggle: {
    color: colors.goldSoft,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  iconButtonCompact: {
    height: 36,
    width: 36,
  },
  iconButtonText: {
    color: colors.text,
    fontSize: 34,
    fontWeight: typography.weights.medium,
    lineHeight: 36,
  },
  iconButtonTextCompact: {
    fontSize: 30,
    lineHeight: 32,
  },
  kicker: {
    color: colors.goldSoft,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  kickerCompact: {
    fontSize: 10,
  },
  playerBadge: {
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: radius.lg,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: spacing.sm,
  },
  playerBadgeActive: {
    backgroundColor: 'rgba(232,190,97,0.13)',
    borderColor: 'rgba(232,190,97,0.45)',
  },
  playerBadgeCompact: {
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.xs,
  },
  playerCopy: {
    flex: 1,
    minWidth: 0,
  },
  playerMeta: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: typography.weights.semibold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  playerMetaCompact: {
    fontSize: 9,
  },
  playerName: {
    color: colors.text,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  playerNameCompact: {
    fontSize: 10,
  },
  playerRail: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: colors.borderGold,
    borderRadius: radius.xl,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    padding: spacing.sm,
  },
  playerRailCompact: {
    gap: spacing.xs,
    marginBottom: spacing.xs,
    padding: spacing.xs,
  },
  resetIcon: {
    color: colors.goldSoft,
    fontSize: 22,
    fontWeight: typography.weights.black,
    lineHeight: 26,
  },
  resetIconCompact: {
    fontSize: 19,
    lineHeight: 23,
  },
  settingSwitch: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: radius.full,
    height: 16,
    justifyContent: 'center',
    paddingHorizontal: 2,
    width: 30,
  },
  settingSwitchActive: {
    backgroundColor: 'rgba(246,217,145,0.92)',
  },
  settingSwitchThumb: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderRadius: radius.full,
    height: 12,
    transform: [{ translateX: 0 }],
    width: 12,
  },
  settingSwitchThumbActive: {
    backgroundColor: colors.backgroundDeep,
    transform: [{ translateX: 14 }],
  },
  settingToggle: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
  },
  settingToggleActive: {
    backgroundColor: 'rgba(232,190,97,0.12)',
    borderColor: 'rgba(232,190,97,0.42)',
  },
  settingToggleCompact: {
    minHeight: 28,
    paddingHorizontal: spacing.xs,
  },
  settingToggleText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  settingToggleTextCompact: {
    fontSize: 9,
  },
  settingsRail: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  settingsRailCompact: {
    gap: spacing.xs,
  },
  statusCopy: {
    flex: 1,
  },
  statusSubtitle: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    lineHeight: 17,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  statusSubtitleCompact: {
    fontSize: 10,
    lineHeight: 14,
  },
  statusTitle: {
    color: colors.text,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  statusTitleCompact: {
    fontSize: typography.sizes.body,
  },
  strikerChip: {
    alignItems: 'center',
    gap: 3,
  },
  strikerChipCompact: {
    gap: 1,
  },
  strikerDot: {
    backgroundColor: '#CF6334',
    borderColor: colors.goldSoft,
    borderRadius: radius.full,
    borderWidth: 2,
    height: 30,
    width: 30,
  },
  strikerDotCompact: {
    height: 24,
    width: 24,
  },
  strikerSlider: {
    alignSelf: 'center',
    height: 38,
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  strikerSliderFill: {
    borderRadius: radius.full,
    height: '100%',
    width: '100%',
  },
  strikerSliderFillClip: {
    borderRadius: radius.full,
    height: 10,
    left: 0,
    overflow: 'hidden',
    position: 'absolute',
  },
  strikerSliderThumb: {
    alignItems: 'center',
    backgroundColor: 'rgba(8,5,15,0.78)',
    borderColor: colors.goldSoft,
    borderRadius: radius.full,
    borderWidth: 2,
    height: 34,
    justifyContent: 'center',
    position: 'absolute',
    width: 34,
  },
  strikerSliderThumbCore: {
    backgroundColor: '#CF6334',
    borderColor: 'rgba(255,255,255,0.24)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 20,
    width: 20,
  },
  strikerSliderTrack: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(232,190,97,0.24)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 10,
    overflow: 'hidden',
    width: '100%',
  },
  strikerText: {
    color: colors.textSubtle,
    fontSize: 10,
    fontWeight: typography.weights.bold,
  },
  targetLabel: {
    color: colors.textSubtle,
    fontSize: 10,
    fontWeight: typography.weights.semibold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  targetLabelCompact: {
    fontSize: 8,
    maxWidth: 78,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: typography.weights.black,
    lineHeight: 32,
    writingDirection: 'rtl',
  },
  titleCompact: {
    fontSize: 21,
    lineHeight: 25,
  },
  turnCenter: {
    alignItems: 'center',
    minWidth: 92,
  },
  turnCenterCompact: {
    minWidth: 66,
  },
  turnLabel: {
    color: colors.goldSoft,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  turnLabelCompact: {
    fontSize: 10,
  },
});
