import { LinearGradient } from 'expo-linear-gradient';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import { CarromGameState, CarromPlayer } from '../types/carrom';
import {
  CarromEventTone,
  CarromSparkleTone,
  getEndGameQueenLabel,
  getEventGradient,
  getSparkleColor,
} from '../utils/carromPresentation';

const SPARKLE_DOT_INDICES = Array.from({ length: 8 }, (_, index) => index);
const WIN_RAY_ROTATIONS = Array.from({ length: 12 }, (_, index) => `${index * 30}deg`);

export type PocketSparkle = {
  id: string;
  progress: Animated.Value;
  tone: CarromSparkleTone;
  x: number;
  y: number;
};

export type TurnBanner = {
  id: string;
  player: CarromPlayer;
  progress: Animated.Value;
};

type CarromBoardOverlaysProps = {
  compact: boolean;
  effectsEnabled: boolean;
  eventTone: CarromEventTone;
  game: CarromGameState;
  isMoving: boolean;
  onBackToGames: () => void;
  onNewRound: () => void;
  pocketSparkles: PocketSparkle[];
  scale: number;
  showEventBanner: boolean;
  showPerfOverlay: boolean;
  turnBanner?: TurnBanner;
  winProgress: Animated.Value;
  winActionsEnabled: boolean;
  perfDurationMs?: number;
  perfFps?: number;
  perfFrames?: number;
  perfMaxSteps?: number;
  perfPhase?: 'live' | 'last';
  perfSteps?: number;
  perfWorstFrameMs?: number;
};

export function CarromBoardOverlays({
  compact,
  effectsEnabled,
  eventTone,
  game,
  isMoving,
  onBackToGames,
  onNewRound,
  pocketSparkles,
  scale,
  showEventBanner,
  showPerfOverlay,
  turnBanner,
  winProgress,
  winActionsEnabled,
  perfDurationMs,
  perfFps,
  perfFrames,
  perfMaxSteps,
  perfPhase,
  perfSteps,
  perfWorstFrameMs,
}: CarromBoardOverlaysProps) {
  return (
    <>
      {showPerfOverlay && perfFps !== undefined ? (
        <View pointerEvents="none" style={styles.perfOverlay}>
          <Text style={styles.perfOverlayText}>{perfPhase ?? 'live'} {perfFps} FPS</Text>
          <Text style={styles.perfOverlayMeta}>
            worst {perfWorstFrameMs ?? 0}ms / steps {perfSteps ?? 0} / max {perfMaxSteps ?? 0}
          </Text>
          <Text style={styles.perfOverlayMeta}>
            frames {perfFrames ?? 0} / duration {perfDurationMs ?? 0}ms
          </Text>
        </View>
      ) : null}

      {showEventBanner ? (
        <View pointerEvents="none" style={styles.eventBannerWrap}>
          <LinearGradient
            colors={getEventGradient(eventTone)}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[
              styles.eventBanner,
              eventTone === 'foul' && styles.eventBannerFoul,
              eventTone === 'queen' && styles.eventBannerQueen,
              eventTone === 'success' && styles.eventBannerSuccess,
            ]}
          >
            <Text
              numberOfLines={compact ? 1 : 2}
              style={[styles.eventBannerText, compact && styles.eventBannerTextCompact]}
            >
              {game.message}
            </Text>
            <Text style={styles.eventBannerMeta}>
              {game.status === 'gameOver' ? 'انتهت الجولة' : `دور اللاعب ${game.currentPlayer}`}
            </Text>
          </LinearGradient>
        </View>
      ) : null}

      {!isMoving && turnBanner ? (
        <Animated.View
          style={[
            styles.turnBanner,
            {
              opacity: turnBanner.progress,
              transform: [
                {
                  translateY: turnBanner.progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-16, 0],
                  }),
                },
                {
                  scale: turnBanner.progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.94, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={styles.turnBannerText}>دور اللاعب {turnBanner.player}</Text>
        </Animated.View>
      ) : null}

      {effectsEnabled && !isMoving
        ? pocketSparkles.map((sparkle) => {
            const sparkleColor = getSparkleColor(sparkle.tone);
            const ringSize = (sparkle.tone === 'queen' ? 82 : 62) * scale;

            return (
              <View
                key={sparkle.id}
                pointerEvents="none"
                style={[
                  styles.sparkleLayer,
                  {
                    left: sparkle.x * scale,
                    top: sparkle.y * scale,
                  },
                ]}
              >
                <Animated.View
                  style={[
                    styles.sparkleRing,
                    {
                      borderColor: sparkleColor,
                      height: ringSize,
                      opacity: sparkle.progress.interpolate({
                        inputRange: [0, 0.24, 1],
                        outputRange: [0, 0.9, 0],
                      }),
                      transform: [
                        { translateX: -ringSize / 2 },
                        { translateY: -ringSize / 2 },
                        {
                          scale: sparkle.progress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.35, 1.25],
                          }),
                        },
                      ],
                      width: ringSize,
                    },
                  ]}
                />
                {SPARKLE_DOT_INDICES.map((index) => {
                  const angle = (Math.PI * 2 * index) / 8;
                  const distance = (sparkle.tone === 'queen' ? 54 : 42) * scale;

                  return (
                    <Animated.View
                      key={`${sparkle.id}-dot-${index}`}
                      style={[
                        styles.sparkleDot,
                        {
                          backgroundColor: sparkleColor,
                          opacity: sparkle.progress.interpolate({
                            inputRange: [0, 0.18, 1],
                            outputRange: [0, 1, 0],
                          }),
                          transform: [
                            {
                              translateX: sparkle.progress.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0, Math.cos(angle) * distance],
                              }),
                            },
                            {
                              translateY: sparkle.progress.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0, Math.sin(angle) * distance],
                              }),
                            },
                            {
                              scale: sparkle.progress.interpolate({
                                inputRange: [0, 0.2, 1],
                                outputRange: [0.4, 1, 0.2],
                              }),
                            },
                          ],
                        },
                      ]}
                    />
                  );
                })}
              </View>
            );
          })
        : null}

      {game.status === 'gameOver' && game.winner ? (
        <Animated.View
          style={[
            styles.winOverlay,
            {
              opacity: winProgress,
              transform: [
                {
                  scale: winProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.92, 1],
                  }),
                },
              ],
            },
          ]}
        >
          {effectsEnabled ? (
            <View style={styles.winBurst}>
              {WIN_RAY_ROTATIONS.map((rotation, index) => (
                <Animated.View
                  key={`win-ray-${index}`}
                  style={[
                    styles.winRay,
                    {
                      transform: [
                        { rotate: rotation },
                        {
                          scaleY: winProgress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.2, 1],
                          }),
                        },
                      ],
                    },
                  ]}
                />
              ))}
            </View>
          ) : null}
          <View style={styles.winPanel}>
            <Text style={styles.winTitle}>فاز اللاعب {game.winner}</Text>
            <Text style={styles.winSubtitle}>{getEndGameQueenLabel(game)}</Text>
            <View style={styles.winScoreRow}>
              <View style={styles.winScoreBlock}>
                <Text style={styles.winScoreValue}>{game.scores[1]}</Text>
                <Text style={styles.winScoreLabel}>اللاعب 1</Text>
              </View>
              <View style={styles.winScoreBlock}>
                <Text style={styles.winScoreValue}>{game.scores[2]}</Text>
                <Text style={styles.winScoreLabel}>اللاعب 2</Text>
              </View>
            </View>
            <View style={styles.winActions}>
              <Pressable
                disabled={!winActionsEnabled}
                onPress={onNewRound}
                style={[
                  styles.winButton,
                  styles.winButtonPrimary,
                  !winActionsEnabled && styles.winButtonDisabled,
                ]}
              >
                <Text style={styles.winButtonPrimaryText}>جولة جديدة</Text>
              </Pressable>
              <Pressable onPress={onBackToGames} style={styles.winButton}>
                <Text style={styles.winButtonText}>الألعاب</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  eventBanner: {
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: radius.full,
    borderWidth: 1,
    maxWidth: '70%',
    minHeight: 34,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.32,
    shadowRadius: 16,
  },
  eventBannerFoul: {
    borderColor: 'rgba(255,142,159,0.45)',
  },
  eventBannerMeta: {
    color: 'rgba(255,247,232,0.72)',
    fontSize: 8,
    fontWeight: typography.weights.bold,
    marginTop: 1,
    writingDirection: 'rtl',
  },
  eventBannerQueen: {
    borderColor: 'rgba(246,217,145,0.56)',
  },
  eventBannerSuccess: {
    borderColor: 'rgba(244,210,122,0.52)',
  },
  eventBannerText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  eventBannerTextCompact: {
    fontSize: 9,
  },
  eventBannerWrap: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: spacing.xs,
    zIndex: 26,
  },
  perfOverlay: {
    backgroundColor: 'rgba(8,5,15,0.72)',
    borderColor: 'rgba(99,244,196,0.42)',
    borderRadius: radius.md,
    borderWidth: 1,
    left: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    position: 'absolute',
    top: spacing.sm,
    zIndex: 40,
  },
  perfOverlayText: {
    color: '#63F4C4',
    fontSize: 10,
    fontWeight: typography.weights.black,
  },
  perfOverlayMeta: {
    color: 'rgba(255,247,232,0.72)',
    fontSize: 9,
    fontWeight: typography.weights.bold,
    marginTop: 1,
  },
  sparkleDot: {
    borderRadius: radius.full,
    height: 7,
    left: -3.5,
    position: 'absolute',
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 7,
    top: -3.5,
    width: 7,
  },
  sparkleLayer: {
    height: 1,
    position: 'absolute',
    width: 1,
    zIndex: 28,
  },
  sparkleRing: {
    borderRadius: radius.full,
    borderWidth: 2,
    position: 'absolute',
  },
  turnBanner: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(31,8,8,0.9)',
    borderColor: 'rgba(246,217,145,0.58)',
    borderRadius: radius.full,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: spacing.lg,
    position: 'absolute',
    top: '43%',
    zIndex: 29,
  },
  turnBannerText: {
    color: colors.goldSoft,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  winActions: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginTop: spacing.md,
    width: '100%',
  },
  winBurst: {
    alignItems: 'center',
    height: 150,
    justifyContent: 'center',
    position: 'absolute',
    width: 150,
  },
  winButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: radius.full,
    borderWidth: 1,
    flex: 1,
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  winButtonPrimary: {
    backgroundColor: colors.gold,
    borderColor: colors.goldSoft,
  },
  winButtonDisabled: {
    opacity: 0.52,
  },
  winButtonPrimaryText: {
    color: colors.backgroundDeep,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  winButtonText: {
    color: colors.text,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  winOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(4,2,2,0.7)',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 35,
  },
  winPanel: {
    alignItems: 'center',
    backgroundColor: 'rgba(38,8,10,0.94)',
    borderColor: 'rgba(246,217,145,0.52)',
    borderRadius: radius.xl,
    borderWidth: 1,
    maxWidth: '86%',
    minWidth: 230,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  winRay: {
    backgroundColor: 'rgba(246,217,145,0.34)',
    borderRadius: radius.full,
    height: 108,
    position: 'absolute',
    width: 5,
  },
  winScoreBlock: {
    alignItems: 'center',
    backgroundColor: 'rgba(8,4,4,0.6)',
    borderColor: 'rgba(246,217,145,0.24)',
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    paddingVertical: spacing.sm,
  },
  winScoreLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    marginTop: 2,
    writingDirection: 'rtl',
  },
  winScoreRow: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginTop: spacing.md,
    width: '100%',
  },
  winScoreValue: {
    color: colors.text,
    fontSize: 24,
    fontWeight: typography.weights.black,
    lineHeight: 28,
  },
  winSubtitle: {
    color: colors.goldSoft,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    marginTop: spacing.xs,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  winTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
