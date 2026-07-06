import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder } from 'react-native';

import { CarromSkiaBoardHandle } from '../components/CarromSkiaBoard';
import type { SubmitShotResult } from './useLocalCarromMatch';
import { CarromGameState, CarromShotGuide } from '../types/carrom';
import { MatchSession } from '../types/carromMatch';
import {
  CARROM_BOTTOM_BASELINE_Y,
  CARROM_TOP_BASELINE_Y,
  CARROM_WORLD_SIZE,
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
const MAX_DRAG_POWER_SQ = MAX_DRAG_POWER * MAX_DRAG_POWER;
const MIN_VISIBLE_AIM_DISTANCE_SQ = 1;
const MIN_SHOT_POWER_SQ = MIN_SHOT_POWER * MIN_SHOT_POWER;
const CARROM_MAX_STEPS_PER_FRAME = 3;

type CarromPerfStats = {
  durationMs: number;
  fps: number;
  frames: number;
  maxSteps: number;
  phase: 'live' | 'last';
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
  clearPendingShot: () => void;
  matchHealthy: boolean;
  matchSessionRef: RefObject<MatchSession | undefined>;
  onShotStarted: (player: CarromGameState['currentPlayer']) => void;
  playHit: () => void;
  scale: number;
  showPerfOverlay: boolean;
  submitShot: (options: SubmitShotOptions) => SubmitShotResult;
};

export function useCarromGameplay({
  boardRef,
  clearPendingShot,
  matchHealthy,
  matchSessionRef,
  onShotStarted,
  playHit,
  scale,
  showPerfOverlay,
  submitShot,
}: UseCarromGameplayOptions) {
  const [game, setGame] = useState<CarromGameState>(() => createInitialCarromState());
  const [perfStats, setPerfStats] = useState<CarromPerfStats | undefined>();
  const gameRef = useRef(game);
  const shotGuideRef = useRef<CarromShotGuide | undefined>(undefined);
  const interactionModeRef = useRef<'none' | 'aiming' | 'placing'>('none');
  const perfFrameRef = useRef({
    frames: 0,
    lastReportAt: 0,
    lastTickAt: 0,
    maxSteps: 0,
    shotDurationMs: 0,
    shotFrames: 0,
    shotMaxSteps: 0,
    shotStartedAtMs: 0,
    shotSteps: 0,
    shotWorstFrameMs: 0,
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
      findStrikerDisc(gameRef.current),
      scale,
    );
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
      frame.shotFrames += 1;
      frame.shotDurationMs =
        frame.shotStartedAtMs > 0 ? Math.max(0, timestamp - frame.shotStartedAtMs) : 0;
      return;
    }

    frame.frames += 1;
    frame.steps += steps;
    frame.maxSteps = Math.max(frame.maxSteps, steps);
    frame.worstFrameMs = Math.max(frame.worstFrameMs, timestamp - frame.lastTickAt);
    frame.shotFrames += 1;
    frame.shotMaxSteps = Math.max(frame.shotMaxSteps, steps);
    frame.shotSteps += steps;
    frame.shotDurationMs =
      frame.shotStartedAtMs > 0 ? Math.max(0, timestamp - frame.shotStartedAtMs) : 0;
    frame.shotWorstFrameMs = Math.max(frame.shotWorstFrameMs, timestamp - frame.lastTickAt);

    if (timestamp - frame.lastReportAt >= 1000) {
      setPerfStats({
        durationMs: Math.round(frame.shotDurationMs),
        fps: Math.round((frame.frames * 1000) / (timestamp - frame.lastReportAt)),
        frames: frame.shotFrames,
        maxSteps: frame.shotMaxSteps,
        phase: 'live',
        steps: frame.shotSteps,
        worstFrameMs: Math.round(frame.shotWorstFrameMs),
      });
      frame.frames = 0;
      frame.maxSteps = 0;
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
          maxStepsPerFrame: CARROM_MAX_STEPS_PER_FRAME,
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
          finishShotPerfCounters(perfFrameRef.current, timestamp, setPerfStats, showPerfOverlay);
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
        onPanResponderGrant: (event) => {
          const current = gameRef.current;
          const next =
            current.status === 'placing'
              ? moveStrikerPlacementFromBoardTouch(current, event.nativeEvent.locationX, scale)
              : current;

          interactionModeRef.current =
            current.status === 'placing' ? 'placing' : next.status === 'aiming' ? 'aiming' : 'none';
          gameRef.current = next;
          boardRef.current?.syncDiscPositions(next.discs, scale);
          updateShotGuide(undefined);
        },
        onPanResponderMove: (event, gesture) => {
          const activeStriker = findStrikerDisc(gameRef.current);
          const mode = interactionModeRef.current;

          if (!activeStriker || mode === 'none') {
            return;
          }

          if (mode === 'placing' && gameRef.current.status === 'placing') {
            const next = moveStrikerPlacementFromBoardTouch(
              gameRef.current,
              event.nativeEvent.locationX,
              scale,
            );

            gameRef.current = next;
            boardRef.current?.syncDiscPositions(next.discs, scale);
            return;
          }

          if (mode !== 'aiming' || gameRef.current.status !== 'aiming') {
            return;
          }

          const dx = -gesture.dx / scale;
          const dy = -gesture.dy / scale;
          const distanceSq = dx * dx + dy * dy;

          if (distanceSq < MIN_VISIBLE_AIM_DISTANCE_SQ) {
            updateShotGuideVisual(undefined, activeStriker);
            return;
          }

          const distance = Math.sqrt(Math.min(distanceSq, MAX_DRAG_POWER_SQ));
          const angle = Math.atan2(dy, dx);

          updateShotGuideVisual({
            x: activeStriker.x + Math.cos(angle) * distance,
            y: activeStriker.y + Math.sin(angle) * distance,
            power: distance,
          }, activeStriker);
        },
        onPanResponderRelease: () => {
          const activeStriker = findStrikerDisc(gameRef.current);
          const guide = shotGuideRef.current;
          const mode = interactionModeRef.current;

          interactionModeRef.current = 'none';

          if (mode === 'placing' && gameRef.current.status === 'placing') {
            const next = lockStrikerPlacement(gameRef.current);

            gameRef.current = next;
            setGame(next);
            return;
          }

          if (mode !== 'aiming' || !activeStriker || !guide || gameRef.current.status !== 'aiming') {
            updateShotGuide(undefined);
            return;
          }

          const dx = guide.x - activeStriker.x;
          const dy = guide.y - activeStriker.y;
          const powerSq = dx * dx + dy * dy;

          if (powerSq < MIN_SHOT_POWER_SQ) {
            updateShotGuide(undefined);
            return;
          }

          const power = Math.sqrt(Math.min(powerSq, MAX_DRAG_POWER_SQ));
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
          startShotPerfCounters(perfFrameRef.current, setPerfStats, showPerfOverlay);
          boardRef.current?.setMovingMode(true);
          boardRef.current?.syncDiscPositions(next.discs, scale);
          gameRef.current = next;
          setGame(next);
        },
        onPanResponderTerminate: () => {
          if (interactionModeRef.current === 'placing') {
            setGame(gameRef.current);
          }

          resetShotPerfCounters(perfFrameRef.current);
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
  const reset = () => {
    const next = createInitialCarromState();
    gameRef.current = next;
    interactionModeRef.current = 'none';
    perfFrameRef.current = {
      frames: 0,
      lastReportAt: 0,
      lastTickAt: 0,
      maxSteps: 0,
      shotDurationMs: 0,
      shotFrames: 0,
      shotMaxSteps: 0,
      shotStartedAtMs: 0,
      shotSteps: 0,
      shotWorstFrameMs: 0,
      steps: 0,
      worstFrameMs: 0,
    };
    loopTimingRef.current = createFixedTimestepTiming();
    setPerfStats(undefined);
    boardRef.current?.setMovingMode(false);
    boardRef.current?.syncDiscPositions(next.discs, scale);
    boardRef.current?.setDiscVisibility(next.discs);
    clearPendingShot();
    updateShotGuide(undefined);
    setGame(next);

    return next;
  };

  const baselineY =
    game.currentPlayer === 1 ? CARROM_BOTTOM_BASELINE_Y : CARROM_TOP_BASELINE_Y;

  return {
    baselineY,
    game,
    isMoving: game.status === 'moving',
    panHandlers: panResponder.panHandlers,
    perfFps: perfStats?.fps,
    perfDurationMs: perfStats?.durationMs,
    perfFrames: perfStats?.frames,
    perfMaxSteps: perfStats?.maxSteps,
    perfPhase: perfStats?.phase,
    perfSteps: perfStats?.steps,
    perfWorstFrameMs: perfStats?.worstFrameMs,
    reset,
  };
}

function moveStrikerPlacementFromBoardTouch(
  state: CarromGameState,
  locationX: number,
  scale: number,
) {
  const worldX = scale > 0 ? locationX / scale : CARROM_WORLD_SIZE / 2;

  return moveStrikerPlacement(state, worldX);
}

function findStrikerDisc(state: CarromGameState) {
  for (let index = 0; index < state.discs.length; index += 1) {
    const disc = state.discs[index]!;

    if (disc.kind === 'striker') {
      return disc;
    }
  }

  return undefined;
}

function resetShotPerfCounters(frame: {
  frames: number;
  lastReportAt: number;
  lastTickAt: number;
  maxSteps: number;
  shotDurationMs: number;
  shotFrames: number;
  shotMaxSteps: number;
  shotStartedAtMs: number;
  shotSteps: number;
  shotWorstFrameMs: number;
  steps: number;
  worstFrameMs: number;
}) {
  frame.frames = 0;
  frame.lastReportAt = 0;
  frame.lastTickAt = 0;
  frame.maxSteps = 0;
  frame.shotDurationMs = 0;
  frame.shotFrames = 0;
  frame.shotMaxSteps = 0;
  frame.shotStartedAtMs = 0;
  frame.shotSteps = 0;
  frame.shotWorstFrameMs = 0;
  frame.steps = 0;
  frame.worstFrameMs = 0;
}

function startShotPerfCounters(
  frame: Parameters<typeof resetShotPerfCounters>[0],
  setPerfStats: (stats: CarromPerfStats | undefined) => void,
  enabled: boolean,
) {
  resetShotPerfCounters(frame);

  if (!enabled) {
    return;
  }

  frame.shotStartedAtMs = getPerfTimestamp();
  setPerfStats({
    durationMs: 0,
    fps: 0,
    frames: 0,
    maxSteps: 0,
    phase: 'live',
    steps: 0,
    worstFrameMs: 0,
  });
}

function finishShotPerfCounters(
  frame: Parameters<typeof resetShotPerfCounters>[0],
  timestamp: number,
  setPerfStats: (stats: CarromPerfStats | undefined) => void,
  enabled: boolean,
) {
  if (!enabled || frame.shotStartedAtMs === 0) {
    resetShotPerfCounters(frame);
    return;
  }

  frame.shotDurationMs = Math.max(0, timestamp - frame.shotStartedAtMs);
  const stats: CarromPerfStats = {
    durationMs: Math.round(frame.shotDurationMs),
    fps:
      frame.shotDurationMs > 0
        ? Math.round((frame.shotFrames * 1000) / frame.shotDurationMs)
        : 0,
    frames: frame.shotFrames,
    maxSteps: frame.shotMaxSteps,
    phase: 'last',
    steps: frame.shotSteps,
    worstFrameMs: Math.round(frame.shotWorstFrameMs),
  };

  setPerfStats(stats);
  logCarromPerfStats(stats);
  resetShotPerfCounters(frame);
}

function getPerfTimestamp() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function logCarromPerfStats(stats: CarromPerfStats) {
  console.log(
    `[carrom perf] ${stats.phase} FPS ${stats.fps} worst ${stats.worstFrameMs}ms steps ${stats.steps} max ${stats.maxSteps} frames ${stats.frames} duration ${stats.durationMs}ms`,
  );
}
