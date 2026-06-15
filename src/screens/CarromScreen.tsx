import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { CarromBoard, CarromBoardHandle } from '../components/CarromBoard';
import { ReadyCountdownPanel, TableSelection } from '../components/CarromMatchFlow';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import { CarromCoinKind, CarromGameState, CarromPlayer, CarromShotGuide } from '../types/carrom';
import { MatchSession, MatchStatus, MatchTable, ShotInput } from '../types/carromMatch';
import { RootStackParamList } from '../types/navigation';
import { localCarromMatchController } from '../utils/localCarromMatchController';
import {
  CARROM_BOTTOM_BASELINE_Y,
  CARROM_EDGE_BOTTOM,
  CARROM_EDGE_LEFT,
  CARROM_EDGE_RIGHT,
  CARROM_EDGE_TOP,
  CARROM_STRIKER_MAX_X,
  CARROM_STRIKER_MIN_X,
  CARROM_TOP_BASELINE_Y,
  CARROM_WORLD_SIZE,
  applyShot,
  createInitialCarromState,
  lockStrikerPlacement,
  moveStrikerPlacement,
  stepCarrom,
} from '../utils/carromEngine';

const boardImage = require('../../assets/carrom/board-good.png');
const hitSound = require('../../assets/carrom/sounds/hit.wav');
const pocketSound = require('../../assets/carrom/sounds/pocket.wav');
const foulSound = require('../../assets/carrom/sounds/foul.wav');
const winSound = require('../../assets/carrom/sounds/win.wav');
const SHOW_CARROM_DEBUG_OVERLAY = false;
const MIN_SHOT_POWER = 20;
const MAX_DRAG_POWER = 260;
const AIM_DOT_COUNT = 7;
const MATCH_COUNTDOWN_SECONDS = 3;
const SHOW_CARROM_PERF_OVERLAY = false;

type CarromScreenProps = NativeStackScreenProps<RootStackParamList, 'Carrom'>;
type MatchPhase = 'tableSelect' | MatchStatus;
type PocketSparkle = {
  id: string;
  progress: Animated.Value;
  tone: 'queen' | 'coin' | 'striker';
  x: number;
  y: number;
};

type TurnBanner = {
  id: string;
  player: CarromPlayer;
  progress: Animated.Value;
};

type ShotHistoryItem = {
  id: string;
  message: string;
  player: CarromPlayer;
  tone: 'neutral' | 'success' | 'foul' | 'queen' | 'win';
};

export function CarromScreen({ navigation }: CarromScreenProps) {
  const { height, width } = useWindowDimensions();
  const isCompactPhone = height < 720 || width < 380;
  const boardSize = Math.min(
    width - spacing.sm * 2,
    height * (isCompactPhone ? 0.56 : 0.68),
    isCompactPhone ? 560 : 650,
  );
  const scale = boardSize / CARROM_WORLD_SIZE;
  const [game, setGame] = useState<CarromGameState>(() => createInitialCarromState());
  const [shotGuide, setShotGuide] = useState<CarromShotGuide | undefined>();
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [aimAssistEnabled, setAimAssistEnabled] = useState(true);
  const [effectsEnabled, setEffectsEnabled] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [shotHistory, setShotHistory] = useState<ShotHistoryItem[]>([]);
  const [matchSession, setMatchSession] = useState<MatchSession | undefined>();
  const [countdown, setCountdown] = useState(MATCH_COUNTDOWN_SECONDS);
  const [pocketSparkles, setPocketSparkles] = useState<PocketSparkle[]>([]);
  const [turnBanner, setTurnBanner] = useState<TurnBanner | undefined>();
  const hitPlayer = useAudioPlayer(hitSound);
  const pocketPlayer = useAudioPlayer(pocketSound);
  const foulPlayer = useAudioPlayer(foulSound);
  const winPlayer = useAudioPlayer(winSound);
  const queenPulse = useRef(new Animated.Value(0)).current;
  const winProgress = useRef(new Animated.Value(0)).current;
  const boardRef = useRef<CarromBoardHandle>(null);
  const gameRef = useRef(game);
  const matchSessionRef = useRef<MatchSession | undefined>(undefined);
  const pendingShotRef = useRef<
    { beforeState: CarromGameState; input: ShotInput } | undefined
  >(undefined);
  const shotGuideRef = useRef<CarromShotGuide | undefined>(undefined);
  const interactionModeRef = useRef<'none' | 'aiming' | 'slider'>('none');
  const sliderStartProgressRef = useRef(0.5);
  const previousStatusRef = useRef<CarromGameState['status']>(game.status);
  const lastShotPlayerRef = useRef<CarromPlayer>(game.currentPlayer);
  const pocketedSoundIdsRef = useRef<Set<string>>(new Set());
  const perfFrameRef = useRef({ frames: 0, lastReportAt: 0, lastTickAt: 0 });
  const [perfFps, setPerfFps] = useState<number | undefined>();
  const selectedTable = matchSession?.table;
  const matchPhase: MatchPhase = matchSession?.status ?? 'tableSelect';
  const playerReady =
    matchSession?.players.find((player) => player.id === 'local-player-1')?.ready ?? false;
  const opponentReady =
    matchSession?.players.find((player) => player.id === 'local-player-2')?.ready ?? false;

  const showPocketSparkles = (
    sparkles: Array<Omit<PocketSparkle, 'progress'>>,
  ) => {
    if (!effectsEnabled) {
      return;
    }

    const nextSparkles = sparkles.map((sparkle) => ({
      ...sparkle,
      id: `${sparkle.id}-${Date.now()}`,
      progress: new Animated.Value(0),
    }));

    setPocketSparkles((current) => [...current, ...nextSparkles]);

    nextSparkles.forEach((sparkle) => {
      Animated.timing(sparkle.progress, {
        duration: 720,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }).start(() => {
        setPocketSparkles((current) => current.filter((item) => item.id !== sparkle.id));
      });
    });
  };

  const showTurnBanner = (player: CarromPlayer) => {
    if (!effectsEnabled) {
      return;
    }

    const nextBanner = {
      id: `${player}-${Date.now()}`,
      player,
      progress: new Animated.Value(0),
    };

    setTurnBanner(nextBanner);
    Animated.sequence([
      Animated.timing(nextBanner.progress, {
        duration: 180,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.delay(780),
      Animated.timing(nextBanner.progress, {
        duration: 220,
        easing: Easing.in(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setTurnBanner((current) => (current?.id === nextBanner.id ? undefined : current));
    });
  };

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    matchSessionRef.current = matchSession;
  }, [matchSession]);

  useEffect(() => {
    const current = gameRef.current;

    boardRef.current?.syncDiscPositions(current.discs, scale);
    boardRef.current?.setDiscVisibility(current.discs);
    boardRef.current?.setMovingMode(current.status === 'moving');
  }, [game.discs, game.status, scale]);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (matchPhase !== 'countdown') {
      return undefined;
    }

    setCountdown(MATCH_COUNTDOWN_SECONDS);
    const intervalId = setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          clearInterval(intervalId);
          setMatchSession((session) =>
            session ? localCarromMatchController.startMatch(session) : session,
          );
          return 0;
        }

        return current - 1;
      });
    }, 900);

    return () => clearInterval(intervalId);
  }, [matchPhase]);

  useEffect(() => {
    if (!effectsEnabled || game.status === 'moving') {
      queenPulse.setValue(0);
      return undefined;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(queenPulse, {
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(queenPulse, {
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();

    return () => loop.stop();
  }, [effectsEnabled, game.status, queenPulse]);

  useEffect(() => {
    if (game.status === 'gameOver') {
      winProgress.setValue(0);
      if (!effectsEnabled) {
        winProgress.setValue(1);
        return;
      }

      Animated.spring(winProgress, {
        damping: 11,
        mass: 0.9,
        stiffness: 90,
        toValue: 1,
        useNativeDriver: true,
      }).start();
    } else {
      winProgress.setValue(0);
    }
  }, [effectsEnabled, game.status, winProgress]);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    const newPocketedDiscs = game.pocketedThisTurn.filter(
      (disc) => !pocketedSoundIdsRef.current.has(disc.id),
    );

    if (newPocketedDiscs.length > 0) {
      game.pocketedThisTurn.forEach((disc) => pocketedSoundIdsRef.current.add(disc.id));
      if (soundEnabled) {
        playSound(pocketPlayer);
      }
      showPocketSparkles(
        newPocketedDiscs.map((disc) => ({
          id: disc.id,
          tone: disc.kind === 'queen' ? 'queen' : disc.kind === 'striker' ? 'striker' : 'coin',
          x: disc.x,
          y: disc.y,
        })),
      );
    }

    if (previousStatus === 'moving' && game.status !== 'moving') {
      pocketedSoundIdsRef.current.clear();
      const pendingShot = pendingShotRef.current;

      if (pendingShot && matchSessionRef.current) {
        const result = localCarromMatchController.createShotResult({
          input: pendingShot.input,
          beforeState: pendingShot.beforeState,
          afterState: game,
        });
        let nextSession = localCarromMatchController.recordShotResolved(
          matchSessionRef.current,
          result,
        );

        if (game.status === 'gameOver' && game.winner) {
          nextSession = localCarromMatchController.settleMatch(nextSession, game.winner);
        }

        pendingShotRef.current = undefined;
        matchSessionRef.current = nextSession;
        setMatchSession(nextSession);
      }

      setShotHistory((current) =>
        [
          createShotHistoryItem(game, lastShotPlayerRef.current),
          ...current,
        ].slice(0, 8),
      );

      if (game.status === 'gameOver') {
        if (soundEnabled) {
          playSound(winPlayer);
        }
      } else if (game.message.includes('خطأ')) {
        if (soundEnabled) {
          playSound(foulPlayer);
        }
      } else {
        showTurnBanner(game.currentPlayer);
      }
    }

    previousStatusRef.current = game.status;
  }, [
    effectsEnabled,
    foulPlayer,
    game.currentPlayer,
    game.message,
    game.pocketedThisTurn,
    game.status,
    pocketPlayer,
    soundEnabled,
    winPlayer,
  ]);

  useEffect(() => {
    let frameId = 0;

    const tick = (timestamp: number) => {
      const current = gameRef.current;

      if (current.status === 'moving') {
        const next = stepCarrom(current);
        gameRef.current = next;
        boardRef.current?.syncDiscPositions(next.discs, scale);
        trackFrameRate(timestamp);

        if (next.status !== 'moving') {
          boardRef.current?.setMovingMode(false);
          boardRef.current?.setDiscVisibility(next.discs);
          setGame(next);
        }
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frameId);
  }, [scale]);

  const striker = game.discs.find((disc) => disc.kind === 'striker');
  const isMoving = game.status === 'moving';
  const statusText = getStatusText(game);
  const eventTone = getEventTone(game.message, game.status);
  const showEventBanner = !isMoving && shouldShowEventBanner(game);
  const remaining = {
    1: game.discs.filter((disc) => disc.kind === game.playerCoins[1] && !disc.pocketed).length,
    2: game.discs.filter((disc) => disc.kind === game.playerCoins[2] && !disc.pocketed).length,
  };

  const updateShotGuide = (nextGuide: CarromShotGuide | undefined) => {
    shotGuideRef.current = nextGuide;
    setShotGuide(nextGuide);
  };

  const trackFrameRate = (timestamp: number) => {
    if (!SHOW_CARROM_PERF_OVERLAY) {
      return;
    }

    const frame = perfFrameRef.current;

    if (frame.lastTickAt === 0) {
      frame.lastTickAt = timestamp;
      frame.lastReportAt = timestamp;
      return;
    }

    frame.frames += 1;

    if (timestamp - frame.lastReportAt >= 1000) {
      setPerfFps(Math.round((frame.frames * 1000) / (timestamp - frame.lastReportAt)));
      frame.frames = 0;
      frame.lastReportAt = timestamp;
    }

    frame.lastTickAt = timestamp;
  };

  const canAimOnBoard = () => {
    const status = gameRef.current.status;
    const sessionStatus = matchSessionRef.current?.status;

    return sessionStatus === 'live' && (status === 'placing' || status === 'aiming');
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: canAimOnBoard,
        onStartShouldSetPanResponderCapture: canAimOnBoard,
        onMoveShouldSetPanResponder: canAimOnBoard,
        onMoveShouldSetPanResponderCapture: canAimOnBoard,
        onPanResponderGrant: () => {
          const current = gameRef.current;
          const next = current.status === 'placing' ? lockStrikerPlacement(current) : current;

          interactionModeRef.current = next.status === 'aiming' ? 'aiming' : 'none';
          gameRef.current = next;
          setGame(next);
          updateShotGuide(undefined);
        },
        onPanResponderMove: (_, gesture) => {
          const activeStriker = gameRef.current.discs.find((disc) => disc.kind === 'striker');
          const mode = interactionModeRef.current;

          if (!activeStriker || mode === 'none') {
            return;
          }

          if (mode !== 'aiming' || gameRef.current.status !== 'aiming') {
            return;
          }

          const dx = -gesture.dx / scale;
          const dy = -gesture.dy / scale;
          const distance = Math.min(Math.hypot(dx, dy), MAX_DRAG_POWER);

          if (distance < 1) {
            updateShotGuide(undefined);
            return;
          }

          const angle = Math.atan2(dy, dx);

          updateShotGuide({
            x: activeStriker.x + Math.cos(angle) * distance,
            y: activeStriker.y + Math.sin(angle) * distance,
            power: distance,
          });
        },
        onPanResponderRelease: () => {
          const activeStriker = gameRef.current.discs.find((disc) => disc.kind === 'striker');
          const guide = shotGuideRef.current;
          const mode = interactionModeRef.current;

          interactionModeRef.current = 'none';

          if (mode !== 'aiming' || !activeStriker || !guide || gameRef.current.status !== 'aiming') {
            updateShotGuide(undefined);
            return;
          }

          const dx = guide.x - activeStriker.x;
          const dy = guide.y - activeStriker.y;
          const power = Math.min(Math.hypot(dx, dy), MAX_DRAG_POWER);

          if (power < MIN_SHOT_POWER) {
            updateShotGuide(undefined);
            return;
          }

          const speed = Math.pow(power / MAX_DRAG_POWER, 0.88) * 38;
          const beforeState = gameRef.current;
          const velocity = {
            vx: (dx / power) * speed,
            vy: (dy / power) * speed,
          };

          lastShotPlayerRef.current = beforeState.currentPlayer;

          if (matchSessionRef.current) {
            const input = localCarromMatchController.createShotInput({
              match: matchSessionRef.current,
              player: beforeState.currentPlayer,
              striker: {
                x: activeStriker.x,
                y: activeStriker.y,
              },
              velocity,
            });
            const nextSession = localCarromMatchController.recordShotSubmitted(
              matchSessionRef.current,
              input,
            );

            pendingShotRef.current = { beforeState, input };
            matchSessionRef.current = nextSession;
            setMatchSession(nextSession);
          }

          const next = applyShot(beforeState, velocity);

          if (soundEnabled) {
            playSound(hitPlayer);
          }
          updateShotGuide(undefined);
          boardRef.current?.setMovingMode(true);
          boardRef.current?.syncDiscPositions(next.discs, scale);
          gameRef.current = next;
          setGame(next);
        },
        onPanResponderTerminate: () => {
          interactionModeRef.current = 'none';
          updateShotGuide(undefined);
        },
      }),
    [scale, soundEnabled],
  );

  const sliderWidth = Math.min(
    boardSize * (isCompactPhone ? 0.86 : 0.72),
    width - (isCompactPhone ? spacing.lg : spacing.xxl) * 2,
  );
  const sliderProgress = striker
    ? (striker.x - CARROM_STRIKER_MIN_X) / (CARROM_STRIKER_MAX_X - CARROM_STRIKER_MIN_X)
    : 0.5;

  const updateStrikerFromSliderProgress = (progress: number) => {
    if (gameRef.current.status !== 'placing') {
      return;
    }

    const clampedProgress = Math.min(1, Math.max(0, progress));
    const nextX =
      CARROM_STRIKER_MIN_X +
      clampedProgress * (CARROM_STRIKER_MAX_X - CARROM_STRIKER_MIN_X);
    const next = moveStrikerPlacement(gameRef.current, nextX);

    gameRef.current = next;
    setGame(next);
  };

  const getCurrentSliderProgress = () => {
    const activeStriker = gameRef.current.discs.find((disc) => disc.kind === 'striker');

    if (!activeStriker) {
      return 0.5;
    }

    return (
      (activeStriker.x - CARROM_STRIKER_MIN_X) /
      (CARROM_STRIKER_MAX_X - CARROM_STRIKER_MIN_X)
    );
  };

  const sliderPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => gameRef.current.status === 'placing',
        onStartShouldSetPanResponderCapture: () => gameRef.current.status === 'placing',
        onMoveShouldSetPanResponder: () => gameRef.current.status === 'placing',
        onMoveShouldSetPanResponderCapture: () => gameRef.current.status === 'placing',
        onPanResponderGrant: () => {
          interactionModeRef.current = 'slider';
          sliderStartProgressRef.current = getCurrentSliderProgress();
          updateShotGuide(undefined);
        },
        onPanResponderMove: (_, gesture) => {
          if (interactionModeRef.current !== 'slider') {
            return;
          }

          updateStrikerFromSliderProgress(
            sliderStartProgressRef.current + gesture.dx / sliderWidth,
          );
        },
        onPanResponderRelease: () => {
          interactionModeRef.current = 'none';
        },
        onPanResponderTerminate: () => {
          interactionModeRef.current = 'none';
        },
      }),
    [sliderWidth],
  );

  const reset = () => {
    const next = createInitialCarromState();
    gameRef.current = next;
    interactionModeRef.current = 'none';
    pocketedSoundIdsRef.current.clear();
    perfFrameRef.current = { frames: 0, lastReportAt: 0, lastTickAt: 0 };
    boardRef.current?.setMovingMode(false);
    boardRef.current?.syncDiscPositions(next.discs, scale);
    boardRef.current?.setDiscVisibility(next.discs);
    pendingShotRef.current = undefined;
    lastShotPlayerRef.current = next.currentPlayer;
    setPocketSparkles([]);
    setTurnBanner(undefined);
    setShotHistory([]);
    setHistoryExpanded(false);
    winProgress.setValue(0);
    updateShotGuide(undefined);
    setGame(next);
  };

  const prepareRound = () => {
    reset();
    setCountdown(MATCH_COUNTDOWN_SECONDS);
    setMatchSession((session) =>
      session ? localCarromMatchController.resetRound(session) : session,
    );
  };

  const handleResetPress = () => {
    if (matchPhase === 'tableSelect') {
      reset();
      return;
    }

    if (matchPhase === 'settled' || matchPhase === 'cancelled') {
      prepareRound();
      return;
    }

    leaveTable();
  };

  const selectTable = (table: MatchTable) => {
    reset();
    setMatchSession(localCarromMatchController.createMatch(table.id, MATCH_COUNTDOWN_SECONDS));
    setCountdown(MATCH_COUNTDOWN_SECONDS);
  };

  const confirmReady = () => {
    setMatchSession((session) => {
      if (!session) {
        return session;
      }

      const withLocalReady = localCarromMatchController.setReady(
        session,
        'local-player-1',
        true,
      );
      const withOpponentReady = localCarromMatchController.setReady(
        withLocalReady,
        'local-player-2',
        true,
      );

      return localCarromMatchController.startCountdown(withOpponentReady);
    });
  };

  const leaveTable = () => {
    setMatchSession((session) =>
      session ? localCarromMatchController.cancelMatch(session) : session,
    );
    reset();
    setMatchSession(undefined);
    setCountdown(MATCH_COUNTDOWN_SECONDS);
  };

  const aimAngle =
    shotGuide && striker ? Math.atan2(shotGuide.y - striker.y, shotGuide.x - striker.x) : 0;
  const aimLength = shotGuide ? Math.max(shotGuide.power * scale, 1) : 0;
  const powerPercent = shotGuide ? Math.min(shotGuide.power / MAX_DRAG_POWER, 1) : 0;
  const aimReach =
    shotGuide && striker ? getAimReachToRail(striker.x, striker.y, aimAngle) * scale : 0;
  const powerTone = getPowerTone(powerPercent);
  const baselineY =
    game.currentPlayer === 1 ? CARROM_BOTTOM_BASELINE_Y : CARROM_TOP_BASELINE_Y;
  const aimDots =
    shotGuide && striker
      ? Array.from({ length: AIM_DOT_COUNT }, (_, index) => {
          const ratio = (index + 1) / (AIM_DOT_COUNT + 1);

          return {
            opacity: 0.9 - index * 0.12,
            x: striker.x + (shotGuide.x - striker.x) * ratio,
            y: striker.y + (shotGuide.y - striker.y) * ratio,
          };
        })
      : [];

  return (
    <ScreenContainer
      horizontalPadding={isCompactPhone ? spacing.xs : spacing.sm}
      scroll={false}
      topPadding={isCompactPhone ? 0 : spacing.xs}
    >
      <View style={[styles.header, isCompactPhone && styles.headerCompact]}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={[styles.iconButton, isCompactPhone && styles.iconButtonCompact]}
        >
          <Text style={[styles.iconButtonText, isCompactPhone && styles.iconButtonTextCompact]}>
            ‹
          </Text>
        </Pressable>

        <View style={styles.headerCenter}>
          <Text
            numberOfLines={1}
            style={[styles.kicker, isCompactPhone && styles.kickerCompact]}
          >
            نموذج لعب محلي
          </Text>
          <Text numberOfLines={1} style={[styles.title, isCompactPhone && styles.titleCompact]}>
            كاروم رويال
          </Text>
        </View>

        <Pressable
          onPress={handleResetPress}
          style={[styles.iconButton, isCompactPhone && styles.iconButtonCompact]}
        >
          <Text style={[styles.resetIcon, isCompactPhone && styles.resetIconCompact]}>↻</Text>
        </Pressable>
      </View>

      {matchPhase === 'tableSelect' ? (
        <TableSelection
          compact={isCompactPhone}
          onBack={() => navigation.goBack()}
          onSelect={selectTable}
        />
      ) : (
        <>
          {matchPhase !== 'live' && matchPhase !== 'settled' && selectedTable ? (
            <ReadyCountdownPanel
              countdown={countdown}
              opponentReady={opponentReady}
              onLeave={leaveTable}
              onReady={confirmReady}
              phase={matchPhase}
              playerReady={playerReady}
              table={selectedTable}
            />
          ) : null}

          {matchPhase === 'live' || matchPhase === 'settled' ? (
            <>
      <View style={[styles.playerRail, isCompactPhone && styles.playerRailCompact]}>
        <PlayerBadge
          active={game.currentPlayer === 2}
          compact={isCompactPhone}
          coinKind={game.playerCoins[2]}
          player={2}
          remaining={remaining[2]}
          score={game.scores[2]}
        />
        <View style={[styles.turnCenter, isCompactPhone && styles.turnCenterCompact]}>
          <Text
            numberOfLines={1}
            style={[styles.turnLabel, isCompactPhone && styles.turnLabelCompact]}
          >
            {game.status === 'moving' ? 'الضربة قيد الحركة' : `دور اللاعب ${game.currentPlayer}`}
          </Text>
          <Text
            numberOfLines={isCompactPhone ? 1 : 2}
            style={[styles.targetLabel, isCompactPhone && styles.targetLabelCompact]}
          >
            {getQueenLabel(game)}
          </Text>
        </View>
        <PlayerBadge
          active={game.currentPlayer === 1}
          compact={isCompactPhone}
          coinKind={game.playerCoins[1]}
          player={1}
          remaining={remaining[1]}
          score={game.scores[1]}
        />
      </View>

      <View style={[styles.settingsRail, isCompactPhone && styles.settingsRailCompact]}>
        <SettingToggle
          active={soundEnabled}
          compact={isCompactPhone}
          label="الصوت"
          onPress={() => setSoundEnabled((enabled) => !enabled)}
        />
        <SettingToggle
          active={aimAssistEnabled}
          compact={isCompactPhone}
          label="المساعدة"
          onPress={() => setAimAssistEnabled((enabled) => !enabled)}
        />
        <SettingToggle
          active={effectsEnabled}
          compact={isCompactPhone}
          label="الحركة"
          onPress={() => setEffectsEnabled((enabled) => !enabled)}
        />
      </View>

      <View style={styles.matchArea}>
        <View
          style={[
            styles.boardGlow,
            {
              height: boardSize + (isCompactPhone ? 10 : 16),
              width: boardSize + (isCompactPhone ? 10 : 16),
            },
          ]}
        />
        <CarromBoard
          ref={boardRef}
          boardImage={boardImage}
          boardSize={boardSize}
          discs={game.discs}
          effectsEnabled={effectsEnabled}
          isMoving={isMoving}
          queenPulse={queenPulse}
          scale={scale}
          showDebugOverlay={SHOW_CARROM_DEBUG_OVERLAY}
          touchHandlers={panResponder.panHandlers}
        >
          {SHOW_CARROM_PERF_OVERLAY && perfFps !== undefined ? (
            <View pointerEvents="none" style={styles.perfOverlay}>
              <Text style={styles.perfOverlayText}>{perfFps} FPS</Text>
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
                  numberOfLines={isCompactPhone ? 1 : 2}
                  style={[styles.eventBannerText, isCompactPhone && styles.eventBannerTextCompact]}
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

          {game.status === 'placing' ? (
            <View pointerEvents="none" style={styles.placementLayer}>
              <View
                style={[
                  styles.placementRail,
                  {
                    left: CARROM_STRIKER_MIN_X * scale,
                    top: baselineY * scale - 1,
                    width: (CARROM_STRIKER_MAX_X - CARROM_STRIKER_MIN_X) * scale,
                  },
                ]}
              />
              <View
                style={[
                  styles.placementHandle,
                  {
                    left: CARROM_STRIKER_MIN_X * scale - 4,
                    top: baselineY * scale - 4,
                  },
                ]}
              />
              <View
                style={[
                  styles.placementHandle,
                  {
                    left: CARROM_STRIKER_MAX_X * scale - 4,
                    top: baselineY * scale - 4,
                  },
                ]}
              />
            </View>
          ) : null}

          {shotGuide && striker ? (
            <>
              <View
                pointerEvents="none"
                style={[
                  styles.strikerAimAura,
                  {
                    height: (striker.radius * 2 + 34 + powerPercent * 28) * scale,
                    left:
                      striker.x * scale -
                      ((striker.radius * 2 + 34 + powerPercent * 28) * scale) / 2,
                    opacity: 0.22 + powerPercent * 0.34,
                    top:
                      striker.y * scale -
                      ((striker.radius * 2 + 34 + powerPercent * 28) * scale) / 2,
                    width: (striker.radius * 2 + 34 + powerPercent * 28) * scale,
                  },
                ]}
              />
              {aimAssistEnabled ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.aimProjection,
                    {
                      left: striker.x * scale,
                      top: striker.y * scale,
                      transform: [{ rotate: `${aimAngle}rad` }],
                      width: aimReach,
                    },
                  ]}
                />
              ) : null}
              <View
                pointerEvents="none"
                style={[
                  styles.aimLine,
                  {
                    backgroundColor: powerTone,
                    left: striker.x * scale,
                    top: striker.y * scale,
                    transform: [{ rotate: `${aimAngle}rad` }],
                    width: aimLength,
                  },
                ]}
              />
              {aimAssistEnabled
                ? aimDots.map((dot, index) => (
                    <View
                      key={`aim-dot-${index}`}
                      pointerEvents="none"
                      style={[
                        styles.trajectoryDot,
                        {
                          left: dot.x * scale - 3,
                          opacity: dot.opacity,
                          top: dot.y * scale - 3,
                        },
                      ]}
                    />
                  ))
                : null}
              <View
                pointerEvents="none"
                style={[
                  styles.aimDot,
                  {
                    backgroundColor: powerTone,
                    left: shotGuide.x * scale - 7,
                    top: shotGuide.y * scale - 7,
                  },
                ]}
              >
                <View style={styles.aimDotCore} />
              </View>
              <View
                pointerEvents="none"
                style={[
                  styles.powerBadge,
                  {
                    left: clampLayout(shotGuide.x * scale - 28, spacing.sm, boardSize - 56),
                    top: clampLayout(shotGuide.y * scale - 42, spacing.sm, boardSize - 34),
                  },
                ]}
              >
                <Text style={styles.powerBadgeText}>{Math.round(powerPercent * 100)}%</Text>
              </View>
              <View pointerEvents="none" style={styles.powerTrack}>
                <LinearGradient
                  colors={['#63F4C4', colors.goldSoft, '#FF6B6B']}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={[styles.powerFill, { width: `${powerPercent * 100}%` }]}
                />
              </View>
            </>
          ) : null}

          {effectsEnabled && !isMoving ? pocketSparkles.map((sparkle) => {
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
                {Array.from({ length: 8 }, (_, index) => {
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
          }) : null}

          {game.status === 'gameOver' && game.winner ? (
            <Animated.View
              pointerEvents="none"
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
                {Array.from({ length: 12 }, (_, index) => (
                  <Animated.View
                    key={`win-ray-${index}`}
                    style={[
                      styles.winRay,
                      {
                        transform: [
                          { rotate: `${index * 30}deg` },
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
                  <Pressable onPress={prepareRound} style={[styles.winButton, styles.winButtonPrimary]}>
                    <Text style={styles.winButtonPrimaryText}>جولة جديدة</Text>
                  </Pressable>
                  <Pressable onPress={() => navigation.goBack()} style={styles.winButton}>
                    <Text style={styles.winButtonText}>الألعاب</Text>
                  </Pressable>
                </View>
              </View>
            </Animated.View>
          ) : null}
        </CarromBoard>
      </View>

      {game.status === 'placing' ? (
        <View
          style={[
            styles.strikerSlider,
            {
              width: sliderWidth,
            },
          ]}
          {...sliderPanResponder.panHandlers}
        >
          <View pointerEvents="none" style={styles.strikerSliderTrack} />
          <LinearGradient
            pointerEvents="none"
            colors={[colors.goldSoft, colors.gold]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[
              styles.strikerSliderFill,
              {
                width: `${Math.min(100, Math.max(0, sliderProgress * 100))}%`,
              },
            ]}
          />
          <View
            pointerEvents="none"
            style={[
              styles.strikerSliderThumb,
              {
                transform: [{ translateX: sliderProgress * sliderWidth - 17 }],
              },
            ]}
          >
            <View style={styles.strikerSliderThumbCore} />
          </View>
        </View>
      ) : null}

      <View style={[styles.controlDock, isCompactPhone && styles.controlDockCompact]}>
        <View style={styles.statusCopy}>
          <Text
            numberOfLines={1}
            style={[styles.statusTitle, isCompactPhone && styles.statusTitleCompact]}
          >
            {statusText}
          </Text>
          <Text
            numberOfLines={isCompactPhone ? 2 : 3}
            style={[styles.statusSubtitle, isCompactPhone && styles.statusSubtitleCompact]}
          >
            {getStatusSubtitle(game)}
          </Text>
        </View>
        <View style={[styles.strikerChip, isCompactPhone && styles.strikerChipCompact]}>
          <View style={[styles.strikerDot, isCompactPhone && styles.strikerDotCompact]} />
          <Text style={styles.strikerText}>Striker</Text>
        </View>
      </View>

      <Pressable
        onPress={() => setHistoryExpanded((expanded) => !expanded)}
        style={[styles.historyPanel, isCompactPhone && styles.historyPanelCompact]}
      >
        <View style={styles.historyHeader}>
          <Text style={styles.historyTitle}>سجل الضربات</Text>
          <Text style={styles.historyToggle}>{historyExpanded ? 'إخفاء' : 'عرض'}</Text>
        </View>
        {shotHistory.length > 0 ? (
          <View style={styles.historyList}>
            {(historyExpanded ? shotHistory.slice(0, 5) : shotHistory.slice(0, 1)).map(
              (item) => (
                <View key={item.id} style={styles.historyItem}>
                  <View style={[styles.historyDot, styles[getHistoryToneStyle(item.tone)]]} />
                  <Text
                    numberOfLines={historyExpanded ? 2 : 1}
                    style={styles.historyText}
                  >
                    {item.message}
                  </Text>
                </View>
              ),
            )}
          </View>
        ) : (
          <Text numberOfLines={1} style={styles.historyEmpty}>
            ستظهر نتيجة كل ضربة هنا
          </Text>
        )}
      </Pressable>
            </>
          ) : null}
        </>
      )}
    </ScreenContainer>
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
        <Text
          numberOfLines={1}
          style={[styles.playerName, compact && styles.playerNameCompact]}
        >
          اللاعب {player}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.playerMeta, compact && styles.playerMetaCompact]}
        >
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
      <Text
        numberOfLines={1}
        style={[styles.settingToggleText, compact && styles.settingToggleTextCompact]}
      >
        {label}
      </Text>
      <View style={[styles.settingSwitch, active && styles.settingSwitchActive]}>
        <View style={[styles.settingSwitchThumb, active && styles.settingSwitchThumbActive]} />
      </View>
    </Pressable>
  );
}

function createShotHistoryItem(game: CarromGameState, shotPlayer: CarromPlayer): ShotHistoryItem {
  const tone = getHistoryTone(game);
  const pocketSummary = getPocketSummary(game, shotPlayer);
  const message =
    game.status === 'gameOver' && game.winner
      ? `اللاعب ${game.winner} فاز - ضربة اللاعب ${shotPlayer} - ${pocketSummary}`
      : `ضربة اللاعب ${shotPlayer}: ${game.message} - ${pocketSummary} - الدور للاعب ${game.currentPlayer}`;

  return {
    id: `${Date.now()}-${shotPlayer}-${game.currentPlayer}-${game.message}`,
    message,
    player: shotPlayer,
    tone,
  };
}

function getPocketSummary(game: CarromGameState, shotPlayer: CarromPlayer) {
  const pocketed = game.pocketedThisTurn;

  if (pocketed.length === 0) {
    return 'لا توجد قطع داخلة';
  }

  const ownKind = game.playerCoins[shotPlayer];
  const ownCount = pocketed.filter((disc) => disc.kind === ownKind).length;
  const opponentCount = pocketed.filter(
    (disc) => disc.owner && disc.kind !== ownKind,
  ).length;
  const queenCount = pocketed.filter((disc) => disc.kind === 'queen').length;
  const strikerCount = pocketed.filter((disc) => disc.kind === 'striker').length;
  const parts = [
    ownCount > 0 ? `${ownCount} من قطع اللاعب` : undefined,
    opponentCount > 0 ? `${opponentCount} من قطع الخصم` : undefined,
    queenCount > 0 ? 'الملكة' : undefined,
    strikerCount > 0 ? 'حجر الضربة' : undefined,
  ].filter(Boolean);

  return parts.join('، ');
}

function getHistoryTone(game: CarromGameState): ShotHistoryItem['tone'] {
  if (game.status === 'gameOver') {
    return 'win';
  }

  const eventTone = getEventTone(game.message, game.status);

  return eventTone === 'success' ? 'success' : eventTone;
}

function getHistoryToneStyle(tone: ShotHistoryItem['tone']) {
  if (tone === 'foul') {
    return 'historyDotFoul' as const;
  }

  if (tone === 'queen') {
    return 'historyDotQueen' as const;
  }

  if (tone === 'success' || tone === 'win') {
    return 'historyDotSuccess' as const;
  }

  return 'historyDotNeutral' as const;
}

function getCoinLabel(kind: CarromCoinKind) {
  return kind === 'white' ? 'الأبيض' : 'الأسود';
}

function getQueenLabel(game: CarromGameState) {
  if (game.queen.coveredBy) {
    return `الملكة مغطاة للاعب ${game.queen.coveredBy}`;
  }

  if (game.queen.pendingBy) {
    return `الملكة تنتظر تغطية اللاعب ${game.queen.pendingBy}`;
  }

  return 'أدخل كل قطعك وغطِّ الملكة';
}

function getEndGameQueenLabel(game: CarromGameState) {
  if (game.queen.coveredBy) {
    return `الملكة مغطاة للاعب ${game.queen.coveredBy}`;
  }

  return 'انتهت الجولة';
}

function shouldShowEventBanner(game: CarromGameState) {
  if (game.status === 'moving') {
    return false;
  }

  return ![
    'حرّك حجر الضربة على الخط',
    'اسحب للخلف ثم اترك للتصويب',
  ].includes(game.message);
}

function getEventTone(message: string, status: CarromGameState['status']) {
  if (status === 'gameOver') {
    return 'success';
  }

  if (message.includes('خطأ')) {
    return 'foul';
  }

  if (message.includes('الملكة')) {
    return 'queen';
  }

  if (message.includes('ناجح') || message.includes('تغطية') || message.includes('مجدداً')) {
    return 'success';
  }

  return 'neutral';
}

function getEventGradient(tone: ReturnType<typeof getEventTone>) {
  if (tone === 'foul') {
    return ['rgba(184,41,75,0.95)', 'rgba(58,15,30,0.92)'] as const;
  }

  if (tone === 'queen') {
    return ['rgba(126,53,174,0.94)', 'rgba(184,41,75,0.92)'] as const;
  }

  if (tone === 'success') {
    return ['rgba(43,203,136,0.92)', 'rgba(12,80,68,0.92)'] as const;
  }

  return ['rgba(8,5,15,0.92)', 'rgba(58,29,103,0.88)'] as const;
}

function getSparkleColor(tone: PocketSparkle['tone']) {
  if (tone === 'queen') {
    return '#F6D991';
  }

  if (tone === 'striker') {
    return '#FF8E9F';
  }

  return '#63F4C4';
}

function getPowerTone(powerPercent: number) {
  if (powerPercent > 0.72) {
    return '#FF7B6E';
  }

  if (powerPercent > 0.42) {
    return colors.goldSoft;
  }

  return '#63F4C4';
}

function getAimReachToRail(x: number, y: number, angle: number) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const distances = [
    dx > 0 ? (CARROM_EDGE_RIGHT - x) / dx : (CARROM_EDGE_LEFT - x) / dx,
    dy > 0 ? (CARROM_EDGE_BOTTOM - y) / dy : (CARROM_EDGE_TOP - y) / dy,
  ].filter((distance) => Number.isFinite(distance) && distance > 0);

  return Math.max(0, Math.min(...distances));
}

function clampLayout(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function playSound(player: { play: () => void; seekTo: (seconds: number) => void }) {
  try {
    player.seekTo(0);
    player.play();
  } catch {
    // Sound polish should never interrupt the game loop.
  }
}

function getStatusText(game: CarromGameState) {
  if (game.status === 'gameOver' && game.winner) {
    return `فاز اللاعب ${game.winner}`;
  }

  if (game.status === 'placing') {
    return 'حرّك حجر الضربة';
  }

  if (game.status === 'moving') {
    return 'الضربة تتحرك';
  }

  return 'اسحب للخلف للتصويب';
}

function getStatusSubtitle(game: CarromGameState) {
  if (game.status === 'placing') {
    return 'حرّك المؤشر يميناً ويساراً لضبط موضع الحجر، ثم اسحب على اللوح للتصويب.';
  }

  if (game.status === 'aiming') {
    return 'اسحب على اللوح للخلف ثم اترك. لا توجد مراهنة أو أموال حقيقية.';
  }

  if (game.status === 'gameOver') {
    return 'اضغط إعادة للعب جولة محلية جديدة.';
  }

  return 'انتظر حتى تتوقف كل القطع.';
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  headerCompact: {
    gap: spacing.xs,
    marginBottom: spacing.xs,
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
  headerCenter: {
    alignItems: 'center',
    flex: 1,
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
  playerBadgeCompact: {
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.xs,
  },
  playerBadgeActive: {
    backgroundColor: 'rgba(232,190,97,0.13)',
    borderColor: 'rgba(232,190,97,0.45)',
  },
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
  avatarCompact: {
    height: 26,
    width: 26,
  },
  avatarBlack: {
    backgroundColor: '#16131C',
    borderColor: 'rgba(255,255,255,0.35)',
  },
  avatarText: {
    color: colors.goldSoft,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.black,
  },
  avatarTextCompact: {
    fontSize: 12,
  },
  playerCopy: {
    flex: 1,
    minWidth: 0,
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
  matchArea: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 0,
  },
  boardGlow: {
    backgroundColor: 'rgba(25, 173, 154, 0.13)',
    borderRadius: radius.xl,
    position: 'absolute',
    shadowColor: '#00D5C7',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 28,
  },
  eventBannerWrap: {
    alignItems: 'center',
    left: spacing.md,
    position: 'absolute',
    right: spacing.md,
    top: spacing.md,
    zIndex: 26,
  },
  eventBanner: {
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: radius.full,
    borderWidth: 1,
    maxWidth: '96%',
    minHeight: 46,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
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
    fontSize: 10,
    fontWeight: typography.weights.bold,
    marginTop: 1,
    writingDirection: 'rtl',
  },
  eventBannerQueen: {
    borderColor: 'rgba(246,217,145,0.56)',
  },
  eventBannerSuccess: {
    borderColor: 'rgba(124,255,199,0.42)',
  },
  eventBannerText: {
    color: colors.text,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  eventBannerTextCompact: {
    fontSize: 10,
  },
  turnBanner: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(8,5,15,0.84)',
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
  placementLayer: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 18,
  },
  placementRail: {
    backgroundColor: 'rgba(246,217,145,0.86)',
    borderRadius: radius.full,
    height: 2,
    position: 'absolute',
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 8,
  },
  placementHandle: {
    backgroundColor: colors.goldSoft,
    borderColor: colors.backgroundDeep,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 8,
    position: 'absolute',
    width: 8,
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
  aimLine: {
    backgroundColor: colors.goldSoft,
    borderRadius: radius.full,
    height: 5,
    opacity: 0.95,
    position: 'absolute',
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    transformOrigin: 'left center',
    zIndex: 20,
  },
  aimProjection: {
    borderColor: 'rgba(255,247,232,0.42)',
    borderRadius: radius.full,
    borderStyle: 'dashed',
    borderTopWidth: 2,
    height: 1,
    position: 'absolute',
    transformOrigin: 'left center',
    zIndex: 19,
  },
  aimDot: {
    alignItems: 'center',
    backgroundColor: colors.goldSoft,
    borderColor: colors.backgroundDeep,
    borderRadius: radius.full,
    borderWidth: 2,
    height: 14,
    justifyContent: 'center',
    position: 'absolute',
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 8,
    width: 14,
    zIndex: 21,
  },
  aimDotCore: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: radius.full,
    height: 4,
    width: 4,
  },
  powerBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(8,5,15,0.82)',
    borderColor: 'rgba(246,217,145,0.5)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 26,
    justifyContent: 'center',
    position: 'absolute',
    width: 56,
    zIndex: 23,
  },
  powerBadgeText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: typography.weights.black,
  },
  strikerAimAura: {
    backgroundColor: 'rgba(246,217,145,0.22)',
    borderColor: 'rgba(246,217,145,0.68)',
    borderRadius: radius.full,
    borderWidth: 2,
    position: 'absolute',
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 14,
    zIndex: 18,
  },
  trajectoryDot: {
    backgroundColor: 'rgba(246,217,145,0.95)',
    borderRadius: radius.full,
    height: 6,
    position: 'absolute',
    width: 6,
    zIndex: 21,
  },
  powerTrack: {
    backgroundColor: 'rgba(8,5,15,0.58)',
    borderColor: 'rgba(255,255,255,0.22)',
    borderRadius: radius.full,
    borderWidth: 1,
    bottom: spacing.md,
    height: 10,
    left: spacing.xl,
    overflow: 'hidden',
    position: 'absolute',
    right: spacing.xl,
    zIndex: 22,
  },
  powerFill: {
    height: '100%',
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
  strikerSlider: {
    alignSelf: 'center',
    height: 38,
    justifyContent: 'center',
    marginTop: spacing.xs,
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
  strikerSliderFill: {
    borderRadius: radius.full,
    height: 10,
    left: 0,
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
  winOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(8,5,15,0.56)',
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
    backgroundColor: 'rgba(8,5,15,0.84)',
    borderColor: 'rgba(246,217,145,0.52)',
    borderRadius: radius.xl,
    borderWidth: 1,
    maxWidth: '86%',
    minWidth: 230,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  winBurst: {
    alignItems: 'center',
    height: 150,
    justifyContent: 'center',
    position: 'absolute',
    width: 150,
  },
  winRay: {
    backgroundColor: 'rgba(246,217,145,0.34)',
    borderRadius: radius.full,
    height: 108,
    position: 'absolute',
    width: 5,
  },
  winTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  winSubtitle: {
    color: colors.goldSoft,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    marginTop: spacing.xs,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  winScoreRow: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginTop: spacing.md,
    width: '100%',
  },
  winScoreBlock: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    paddingVertical: spacing.sm,
  },
  winScoreValue: {
    color: colors.text,
    fontSize: 24,
    fontWeight: typography.weights.black,
    lineHeight: 28,
  },
  winScoreLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    marginTop: 2,
    writingDirection: 'rtl',
  },
  winActions: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginTop: spacing.md,
    width: '100%',
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
  winButtonText: {
    color: colors.text,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  winButtonPrimaryText: {
    color: colors.backgroundDeep,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
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
  historyHeader: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
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
  historyList: {
    gap: spacing.xs,
  },
  historyItem: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.xs,
    minHeight: 20,
  },
  historyDot: {
    borderRadius: radius.full,
    height: 8,
    width: 8,
  },
  historyDotNeutral: {
    backgroundColor: colors.textSubtle,
  },
  historyDotSuccess: {
    backgroundColor: '#63F4C4',
  },
  historyDotFoul: {
    backgroundColor: '#FF8E9F',
  },
  historyDotQueen: {
    backgroundColor: colors.goldSoft,
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
  historyEmpty: {
    color: colors.textSubtle,
    fontSize: 10,
    fontWeight: typography.weights.semibold,
    textAlign: 'right',
    writingDirection: 'rtl',
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
  statusCopy: {
    flex: 1,
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
  strikerText: {
    color: colors.textSubtle,
    fontSize: 10,
    fontWeight: typography.weights.bold,
  },
});
