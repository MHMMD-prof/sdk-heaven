import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder } from 'react-native';

import { CarromStrikerSliderHandle } from '../components/CarromHudControls';
import { CarromSkiaBoardHandle } from '../components/CarromSkiaBoard';
import type { SubmitShotResult } from './useLocalCarromMatch';
import { spacing } from '../theme';
import { CarromGameState, CarromShotGuide } from '../types/carrom';
import { MatchSession } from '../types/carromMatch';
import {
  CARROM_BOTTOM_BASELINE_Y,
  CARROM_EDGE_BOTTOM,
  CARROM_EDGE_LEFT,
  CARROM_EDGE_RIGHT,
  CARROM_EDGE_TOP,
  CARROM_STRIKER_MAX_X,
  CARROM_STRIKER_MIN_X,
  CARROM_TOP_BASELINE_Y,
  applyShot,
  createInitialCarromState,
  lockStrikerPlacement,
  moveStrikerPlacement,
  stepCarrom,
} from '../utils/carromEngine';
import {
  advanceFixedTimestep,
  createFixedTimestepTiming,
} from '../utils/fixedTimestep';

const MIN_SHOT_POWER = 20;
const MAX_DRAG_POWER = 260;
const AIM_DOT_COUNT = 7;

type CarromPerfStats = {
  fps: number;
  steps: number;
  worstFrameMs: number;
};

type SubmitShotOptions = {
  beforeState: CarromGameState;
  striker: {
    x: number;
    y: number;
  };
  velocity: {
    vx: number;
    vy: number;
  };
};

type UseCarromGameplayOptions = {
  boardRef: RefObject<CarromSkiaBoardHandle | null>;
  boardSize: number;
  clearPendingShot: () => void;
  isCompactPhone: boolean;
  matchHealthy: boolean;
  matchSessionRef: RefObject<MatchSession | undefined>;
  onShotStarted: (player: CarromGameState['currentPlayer']) => void;
  playHit: () => void;
  scale: number;
  screenWidth: number;
  showPerfOverlay: boolean;
  sliderRef: RefObject<CarromStrikerSliderHandle | null>;
  submitShot: (options: SubmitShotOptions) => SubmitShotResult;
};

export function useCarromGameplay({
  boardRef,
  boardSize,
  clearPendingShot,
  isCompactPhone,
  matchHealthy,
  matchSessionRef,
  onShotStarted,
  playHit,
  scale,
  screenWidth,
  showPerfOverlay,
  sliderRef,
  submitShot,
}: UseCarromGameplayOptions) {
  const [game, setGame] = useState<CarromGameState>(() => createInitialCarromState());
  const [shotGuide, setShotGuide] = useState<CarromShotGuide | undefined>();
  const [perfStats, setPerfStats] = useState<CarromPerfStats | undefined>();
  const gameRef = useRef(game);
  const shotGuideRef = useRef<CarromShotGuide | undefined>(undefined);
  const interactionModeRef = useRef<'none' | 'aiming' | 'slider'>('none');
  const sliderStartProgressRef = useRef(0.5);
  const perfFrameRef = useRef({
    frames: 0,
    lastReportAt: 0,
    lastTickAt: 0,
    steps: 0,
    worstFrameMs: 0,
  });
  const loopTimingRef = useRef(createFixedTimestepTiming());

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    const current = gameRef.current;

    boardRef.current?.syncDiscPositions(current.discs, scale);
    boardRef.current?.setDiscVisibility(current.discs);
    boardRef.current?.setMovingMode(current.status === 'moving');
  }, [boardRef, game.discs, game.status, scale]);

  const updateShotGuide = useCallback((nextGuide: CarromShotGuide | undefined) => {
    shotGuideRef.current = nextGuide;
    boardRef.current?.syncShotGuide(
      nextGuide,
      gameRef.current.discs.find((disc) => disc.kind === 'striker'),
      scale,
    );
    setShotGuide(nextGuide);
  }, [boardRef, scale]);

  const updateShotGuideVisual = useCallback(
    (nextGuide: CarromShotGuide | undefined, strikerOverride?: CarromGameState['discs'][number]) => {
      shotGuideRef.current = nextGuide;
      boardRef.current?.syncShotGuide(nextGuide, strikerOverride, scale);
    },
    [boardRef, scale],
  );

  const trackFrameRate = useCallback((timestamp: number, steps: number) => {
    if (!showPerfOverlay) {
      return;
    }

    const frame = perfFrameRef.current;

    if (frame.lastTickAt === 0) {
      frame.lastTickAt = timestamp;
      frame.lastReportAt = timestamp;
      return;
    }

    frame.frames += 1;
    frame.steps += steps;
    frame.worstFrameMs = Math.max(frame.worstFrameMs, timestamp - frame.lastTickAt);

    if (timestamp - frame.lastReportAt >= 1000) {
      setPerfStats({
        fps: Math.round((frame.frames * 1000) / (timestamp - frame.lastReportAt)),
        steps: frame.steps,
        worstFrameMs: Math.round(frame.worstFrameMs),
      });
      frame.frames = 0;
      frame.steps = 0;
      frame.worstFrameMs = 0;
      frame.lastReportAt = timestamp;
    }

    frame.lastTickAt = timestamp;
  }, [showPerfOverlay]);

  useEffect(() => {
    if (game.status !== 'moving') {
      return undefined;
    }

    let frameId = 0;
    let running = true;

    const tick = (timestamp: number) => {
      if (!running) {
        return;
      }

      const current = gameRef.current;

      if (current.status === 'moving') {
        const advanced = advanceFixedTimestep({
          isComplete: (state) => state.status !== 'moving',
          state: current,
          step: stepCarrom,
          timestamp,
          timing: loopTimingRef.current,
        });
        const next = advanced.state;

        loopTimingRef.current = advanced.timing;
        gameRef.current = next;
        if (advanced.didStep) {
          boardRef.current?.syncDiscPositions(next.discs, scale);
        }
        trackFrameRate(timestamp, advanced.steps);

        if (next.status !== 'moving') {
          loopTimingRef.current = createFixedTimestepTiming();
          boardRef.current?.setMovingMode(false);
          boardRef.current?.setDiscVisibility(next.discs);
          setGame(next);
          return;
        }
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      running = false;
      loopTimingRef.current = createFixedTimestepTiming();
      cancelAnimationFrame(frameId);
    };
  }, [boardRef, game.status, scale, trackFrameRate]);

  const canAimOnBoard = () => {
    const status = gameRef.current.status;
    const sessionStatus = matchSessionRef.current?.status;

    return matchHealthy && sessionStatus === 'live' && (status === 'placing' || status === 'aiming');
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
            updateShotGuideVisual(undefined, activeStriker);
            return;
          }

          const angle = Math.atan2(dy, dx);

          updateShotGuideVisual({
            x: activeStriker.x + Math.cos(angle) * distance,
            y: activeStriker.y + Math.sin(angle) * distance,
            power: distance,
          }, activeStriker);
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
          const next = applyShot(beforeState, velocity);

          onShotStarted(beforeState.currentPlayer);
          const submission = submitShot({
            beforeState,
            striker: {
              x: activeStriker.x,
              y: activeStriker.y,
            },
            velocity,
          });

          if (!submission.accepted) {
            updateShotGuide(undefined);
            return;
          }

          playHit();
          updateShotGuide(undefined);
          loopTimingRef.current = createFixedTimestepTiming();
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
    [
      boardRef,
      matchHealthy,
      matchSessionRef,
      onShotStarted,
      playHit,
      scale,
      submitShot,
      updateShotGuide,
      updateShotGuideVisual,
    ],
  );

  const sliderWidth = Math.min(
    boardSize * (isCompactPhone ? 0.86 : 0.72),
    screenWidth - (isCompactPhone ? spacing.lg : spacing.xxl) * 2,
  );
  const striker = game.discs.find((disc) => disc.kind === 'striker');
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
    boardRef.current?.syncDiscPositions(next.discs, scale);
    sliderRef.current?.setProgress(clampedProgress);
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
          if (interactionModeRef.current === 'slider') {
            setGame(gameRef.current);
          }

          interactionModeRef.current = 'none';
        },
        onPanResponderTerminate: () => {
          if (interactionModeRef.current === 'slider') {
            setGame(gameRef.current);
          }

          interactionModeRef.current = 'none';
        },
      }),
    [scale, sliderRef, sliderWidth],
  );

  const reset = () => {
    const next = createInitialCarromState();
    gameRef.current = next;
    interactionModeRef.current = 'none';
    perfFrameRef.current = {
      frames: 0,
      lastReportAt: 0,
      lastTickAt: 0,
      steps: 0,
      worstFrameMs: 0,
    };
    loopTimingRef.current = createFixedTimestepTiming();
    boardRef.current?.setMovingMode(false);
    boardRef.current?.syncDiscPositions(next.discs, scale);
    boardRef.current?.setDiscVisibility(next.discs);
    clearPendingShot();
    updateShotGuide(undefined);
    setGame(next);

    return next;
  };

  const aimAngle =
    shotGuide && striker ? Math.atan2(shotGuide.y - striker.y, shotGuide.x - striker.x) : 0;
  const aimLength = shotGuide ? Math.max(shotGuide.power * scale, 1) : 0;
  const powerPercent = shotGuide ? Math.min(shotGuide.power / MAX_DRAG_POWER, 1) : 0;
  const aimReach =
    shotGuide && striker ? getAimReachToRail(striker.x, striker.y, aimAngle) * scale : 0;
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

  return {
    aimAngle,
    aimDots,
    aimLength,
    aimReach,
    baselineY,
    game,
    isMoving: game.status === 'moving',
    panHandlers: panResponder.panHandlers,
    perfFps: perfStats?.fps,
    perfSteps: perfStats?.steps,
    perfWorstFrameMs: perfStats?.worstFrameMs,
    powerPercent,
    reset,
    shotGuide,
    sliderPanHandlers: sliderPanResponder.panHandlers,
    sliderProgress,
    sliderWidth,
    striker,
  };
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
