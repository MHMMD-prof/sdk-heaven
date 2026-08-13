import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated } from 'react-native';

import { miniGameModes } from '../../data/miniGameModes';
import { labels } from '../constants';
import { LastShot, ShotAnimation } from '../BattleshipGameTypes';
import { useBattleshipBoardLayout } from '../useBattleshipBoardLayout';
import { useBattleshipFeedback } from '../useBattleshipFeedback';
import { useBattleshipShipFrames } from '../useBattleshipShipFrames';
import {
  createFogHitTargets,
  getOpponentPlayerId,
} from './onlineBattleCore';
import { BattleshipOnlineState } from './onlineSessionModel';

type UseBattleshipOnlineBattleViewOptions = {
  fireShot: (cellId: string) => void | Promise<void>;
  onBack: () => void;
  screenWidth: number;
  state: BattleshipOnlineState;
};

export function useBattleshipOnlineBattleView({
  fireShot,
  onBack,
  screenWidth,
  state,
}: UseBattleshipOnlineBattleViewOptions) {
  const mode = miniGameModes.find((item) => item.id === 'naval') ?? miniGameModes[0];
  const [shotAnimation, setShotAnimation] = useState<ShotAnimation | undefined>();
  const shotAnimationValue = useRef(new Animated.Value(0)).current;
  const lastAnimatedShotKey = useRef<string | undefined>(undefined);
  const { playSound, soundMuted, toggleSound, impactHeavy, impactLight } = useBattleshipFeedback();
  const {
    boardCells,
    boardWidth,
    cellGap,
    cellSize,
    handleTargetBoardLayout,
    miniBoardWidth,
    miniCellSize,
    shotAnimationPosition,
    shotOpacity,
    shotScale,
    shotTranslateY,
    targetBoardRef,
  } = useBattleshipBoardLayout({
    screenWidth,
    shotAnimation,
    shotAnimationValue,
  });

  const opponentId = getOpponentPlayerId({
    localPlayerId: state.localPlayerId,
    players: state.players,
  });
  const opponentSeal = opponentId ? state.readySeals[opponentId] : undefined;
  const totalTargetCells = opponentSeal?.fleetCellCount
    ?? state.readySeals[state.localPlayerId]?.fleetCellCount
    ?? 0;
  const outgoingGuesses = useMemo(
    () => new Set(Object.keys(state.outgoingResults)),
    [state.outgoingResults],
  );
  const incomingGuesses = useMemo(
    () => new Set(Object.keys(state.incomingResults)),
    [state.incomingResults],
  );
  const hitCells = useMemo(
    () =>
      Object.entries(state.outgoingResults)
        .filter(([, result]) => result === 'hit')
        .map(([cellId]) => cellId),
    [state.outgoingResults],
  );
  const fogTargets = useMemo(() => createFogHitTargets(hitCells), [hitCells]);
  const hits = hitCells.length;
  const localFleet = state.localFleet ?? [];
  const isMyTurn = state.currentTurnPlayerId === state.localPlayerId && !state.winnerId;
  const isGameOver = Boolean(state.winnerId);
  const lastShot: LastShot | undefined = state.lastShot
    ? {
        result: state.lastShot.result,
        text: state.lastShot.result === 'hit' ? labels.hit : labels.miss,
      }
    : undefined;

  useEffect(() => {
    if (!state.lastShot) {
      return;
    }

    const shotKey = `${state.lastShot.attackerId}:${state.lastShot.cellId}:${state.lastShot.result}`;
    if (shotKey === lastAnimatedShotKey.current) {
      return;
    }

    lastAnimatedShotKey.current = shotKey;
    const result = state.lastShot.result;
    setShotAnimation({ cellId: state.lastShot.cellId, result });
    if (result === 'hit') {
      playSound('hit');
      impactHeavy();
    } else {
      playSound('miss');
      impactLight();
    }
  }, [impactHeavy, impactLight, playSound, state.lastShot]);

  useEffect(() => {
    if (!shotAnimation) {
      return;
    }

    shotAnimationValue.setValue(0);
    const animation = Animated.sequence([
      Animated.timing(shotAnimationValue, {
        duration: 260,
        toValue: 0.7,
        useNativeDriver: true,
      }),
      Animated.timing(shotAnimationValue, {
        duration: 220,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]);
    animation.start(() => setShotAnimation(undefined));
    return () => animation.stop();
  }, [shotAnimation, shotAnimationValue]);

  const { boardShipFrames, ownShipFrames } = useBattleshipShipFrames({
    activeGuesses: outgoingGuesses,
    activeTargets: fogTargets,
    boardCellSize: cellSize,
    cellGap,
    currentPlayer: 1,
    darkenedShipIds: new Set(),
    explodingShipIds: new Set(),
    isNaval: true,
    isSetupPhase: false,
    miniCellSize,
    ownTargets: localFleet,
    setupTargets: localFleet,
  });

  const statusText = isGameOver
    ? state.winnerId === state.localPlayerId
      ? `${labels.winner} ${labels.player} 1`
      : `${labels.winner} ${labels.player} 2`
    : state.pendingShotId
      ? labels.shotFlying
      : isMyTurn
        ? `${labels.turn} ${labels.player} 1`
        : `${labels.turn} ${labels.player} 2`;

  const isCellDisabled = (cellId: string) =>
    !isMyTurn
    || Boolean(state.pendingShotId)
    || Boolean(state.outgoingResults[cellId])
    || isGameOver;

  return {
    boardCardProps: {
      attemptsLeftText: '\u221e',
      hits,
      isSetupPhase: false,
      lastShot,
      mode,
      onClearSetup: () => undefined,
      onRandomizeSetup: () => undefined,
      onRotateSelected: () => undefined,
      ownBoardProps: {
        boardCells,
        boardWidth: miniBoardWidth,
        cellGap,
        cellSize: miniCellSize,
        incomingGuesses,
        metaText: incomingGuesses.size,
        ownShipFrames,
        targets: localFleet,
      },
      phase: 'battle' as const,
      shotsTaken: outgoingGuesses.size,
      statusText,
      targetBoardProps: {
        activeGuesses: outgoingGuesses,
        activeTargets: fogTargets,
        boardCells,
        boardShipFrames,
        boardWidth,
        cellGap,
        cellSize,
        isCellDisabled,
        isSetupPhase: false,
        modeAccentColor: mode.accentColor,
        onCellPress: (cellId: string) => {
          if (isCellDisabled(cellId)) {
            return;
          }
          playSound('tap');
          impactLight();
          void fireShot(cellId);
        },
        onDragCancel: () => undefined,
        onDragMoveFromCell: () => undefined,
        onDragReleaseFromCell: () => undefined,
        onTargetBoardLayout: handleTargetBoardLayout,
        previewCells: [] as string[],
        previewIsValid: false,
        selectedGhostHeight: 0,
        selectedGhostWidth: 0,
        setupTargets: [] as typeof localFleet,
        shouldStartDragResponder: false,
        shotAnimation,
        shotAnimationPosition,
        shotOpacity,
        shotScale,
        shotTranslateY,
        targetBoardRef,
      },
      totalTargetCells,
    },
    headerProps: {
      mode,
      modeId: mode.id,
      onBack,
      onModeChange: () => undefined,
      onToggleSound: toggleSound,
      soundMuted,
    },
    isGameOver,
    victoryProps: {
      mode,
      onReset: onBack,
      playerOneHits: hits,
      playerOneShots: outgoingGuesses.size,
      playerTwoHits: Object.values(state.incomingResults).filter((result) => result === 'hit').length,
      playerTwoShots: incomingGuesses.size,
      totalTargetCells,
      winner: state.winnerId
        ? state.winnerId === state.localPlayerId
          ? (1 as const)
          : (2 as const)
        : undefined,
    },
  };
}
