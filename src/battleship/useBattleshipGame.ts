import { useRef, useState } from 'react';
import { Animated } from 'react-native';

import { miniGameModes } from '../data/miniGameModes';
import { MiniGameModeId, MiniGameTarget } from '../types/miniGame';
import { useBattleshipBattleActions } from './useBattleshipBattleActions';
import { useBattleshipBoardLayout } from './useBattleshipBoardLayout';
import { useBattleshipEffects } from './useBattleshipEffects';
import { useBattleshipFeedback } from './useBattleshipFeedback';
import {
  createModeTargets,
  getInitialSelectedTargetId,
  getPlacementPreview,
  getResetPhase,
  isBattleCellDisabled,
} from './BattleshipGameHelpers';
import { GamePhase, LastShot, ShotAnimation } from './BattleshipGameTypes';
import { useBattleshipMatchState } from './useBattleshipMatchState';
import { useBattleshipSetupActions } from './useBattleshipSetupActions';
import { useBattleshipShipFrames } from './useBattleshipShipFrames';

type UseBattleshipGameOptions = {
  initialMode: MiniGameModeId;
  screenWidth: number;
};

export function useBattleshipGame({ initialMode, screenWidth }: UseBattleshipGameOptions) {
  const initialModeConfig =
    miniGameModes.find((item) => item.id === initialMode) ?? miniGameModes[0];
  const [modeId, setModeId] = useState<MiniGameModeId>(initialModeConfig.id);
  const mode = miniGameModes.find((item) => item.id === modeId) ?? miniGameModes[0];
  const [phase, setPhase] = useState<GamePhase>(getResetPhase(initialModeConfig, true));
  const [selectedTargetId, setSelectedTargetId] = useState<string | undefined>(
    getInitialSelectedTargetId(initialModeConfig),
  );
  const [previewCellId, setPreviewCellId] = useState<string | undefined>();
  const [attemptsEnabled, setAttemptsEnabled] = useState(true);
  const [playerOneTargets, setPlayerOneTargets] = useState<MiniGameTarget[]>(() =>
    createModeTargets(initialModeConfig),
  );
  const [playerTwoTargets, setPlayerTwoTargets] = useState<MiniGameTarget[]>(() =>
    createModeTargets(initialModeConfig),
  );
  const [playerOneGuesses, setPlayerOneGuesses] = useState<Set<string>>(() => new Set());
  const [playerTwoGuesses, setPlayerTwoGuesses] = useState<Set<string>>(() => new Set());
  const [currentPlayer, setCurrentPlayer] = useState<1 | 2>(1);
  const [pendingTurnPass, setPendingTurnPass] = useState(false);
  const [lastShot, setLastShot] = useState<LastShot | undefined>();
  const [shotAnimation, setShotAnimation] = useState<ShotAnimation | undefined>();
  const [explodingShipIds, setExplodingShipIds] = useState<Set<string>>(() => new Set());
  const [darkenedShipIds, setDarkenedShipIds] = useState<Set<string>>(() => new Set());
  const shotAnimationValue = useRef(new Animated.Value(0)).current;
  const {
    impactHeavy,
    impactLight,
    impactMedium,
    notifyError,
    notifySuccess,
    notifyWarning,
    playSound,
    soundMuted,
    toggleSound,
  } = useBattleshipFeedback();
  const {
    activeGuesses,
    activeTargets,
    attemptsLeftText,
    hits,
    isGameOver,
    isSetupPhase,
    ownIncomingGuesses,
    ownTargets,
    playerOneHits,
    playerTwoHits,
    setupFleetReady,
    setupPlayer,
    setupTargets,
    selectedTarget,
    shotsTaken,
    statusText,
    totalTargetCells,
    winner,
  } = useBattleshipMatchState({
    attemptsEnabled,
    currentPlayer,
    pendingTurnPass,
    phase,
    playerOneGuesses,
    playerOneTargets,
    playerTwoGuesses,
    playerTwoTargets,
    selectedTargetId,
    shotAnimation,
  });
  const isNaval = mode.id === 'naval';
  const {
    boardCells,
    boardWidth,
    cellGap,
    cellSize,
    getCellIdFromBoardEvent,
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
  const { previewCells, previewIsValid } = getPlacementPreview({
    previewCellId,
    selectedTarget,
    setupTargets,
  });
  const defendingPlayer: 1 | 2 = currentPlayer === 1 ? 2 : 1;
  const {
    boardShipFrames,
    ownShipFrames,
    selectedGhostHeight,
    selectedGhostVisual,
    selectedGhostWidth,
  } = useBattleshipShipFrames({
    activeGuesses,
    activeTargets,
    boardCellSize: cellSize,
    cellGap,
    currentPlayer,
    darkenedShipIds,
    explodingShipIds,
    isNaval,
    isSetupPhase,
    miniCellSize,
    ownTargets,
    selectedTarget,
    selectedTargetId,
    setupTargets,
  });
  const {
    clearShotAnimation,
    clearSunkEffects,
    scheduleShotResolution,
    triggerSunkEffect,
  } = useBattleshipEffects({
    isGameOver,
    notifySuccess,
    notifyWarning,
    playVictorySound: () => playSound('victory'),
    playerOneGuesses,
    playerTwoGuesses,
    setDarkenedShipIds,
    setExplodingShipIds,
    setShotAnimation,
    shotAnimation,
    shotAnimationValue,
    winner,
  });

  const startMatch = () => {
    playSound('tap');
    impactMedium();
    resetGame(modeId, false);
  };

  const resetSetupSelection = (nextMode = mode) => {
    setSelectedTargetId(getInitialSelectedTargetId(nextMode));
    setPreviewCellId(undefined);
  };

  const resetBattleState = () => {
    setPlayerOneGuesses(new Set());
    setPlayerTwoGuesses(new Set());
    setCurrentPlayer(1);
    setPendingTurnPass(false);
    setLastShot(undefined);
  };

  const resetGame = (nextModeId = modeId, showPreMatch = false) => {
    const nextMode = miniGameModes.find((item) => item.id === nextModeId) ?? miniGameModes[0];

    clearShotAnimation();
    clearSunkEffects();
    setModeId(nextMode.id);
    setPhase(getResetPhase(nextMode, showPreMatch));
    resetSetupSelection(nextMode);
    setPlayerOneTargets(createModeTargets(nextMode));
    setPlayerTwoTargets(createModeTargets(nextMode));
    resetBattleState();
  };

  const isCellDisabled = (cellId: string) =>
    isBattleCellDisabled({
      activeGuesses,
      cellId,
      isGameOver,
      pendingTurnPass,
      phase,
      shotAnimation,
    });

  const {
    confirmSetupFleet,
    handleClearSetup,
    handleDragCancel,
    handleDragHoverCell,
    handleDragReleaseCell,
    handleRandomizeSetup,
    handleRotateSelected,
    handleSetupBoardPress,
    handleSetupCellPress,
    pickUpTarget,
    startPlayerTwoSetup,
  } = useBattleshipSetupActions({
    clearSunkEffects,
    getCellIdFromBoardEvent,
    impactLight,
    impactMedium,
    mode,
    notifyError,
    notifySuccess,
    phase,
    playInvalidSound: () => playSound('invalid'),
    playTapSound: () => playSound('tap'),
    previewCellId,
    selectedTarget,
    selectedTargetId,
    setCurrentPlayer,
    setLastShot,
    setPendingTurnPass,
    setPhase,
    setPlayerOneGuesses,
    setPlayerOneTargets,
    setPlayerTwoGuesses,
    setPlayerTwoTargets,
    setPreviewCellId,
    setSelectedTargetId,
    setupFleetReady,
    setupPlayer,
    setupTargets,
    playerTwoTargets,
  });

  const { continueTurnHandoff, handleCellPress, passTurn } = useBattleshipBattleActions({
    activeGuesses,
    activeTargets,
    attemptsEnabled,
    currentPlayer,
    defendingPlayer,
    handleSetupCellPress,
    impactHeavy,
    impactLight,
    isCellDisabled,
    isSetupPhase,
    playHitSound: () => playSound('hit'),
    playMissSound: () => playSound('miss'),
    playTapSound: () => playSound('tap'),
    scheduleShotResolution,
    setCurrentPlayer,
    setLastShot,
    setPendingTurnPass,
    setPhase,
    setPlayerOneGuesses,
    setPlayerTwoGuesses,
    setShotAnimation,
    totalTargetCells,
    triggerSunkEffect: (effectKey) =>
      triggerSunkEffect(effectKey, () => {
        playSound('sunk');
        notifyWarning();
      }),
  });

  const toggleAttemptsEnabled = () => {
    setAttemptsEnabled((enabled) => !enabled);
    playSound('tap');
    impactLight();
  };

  return {
    activeGuesses,
    activeTargets,
    attemptsEnabled,
    attemptsLeftText,
    boardCells,
    boardShipFrames,
    boardWidth,
    cellGap,
    cellSize,
    confirmSetupFleet,
    continueTurnHandoff,
    currentPlayer,
    handleCellPress,
    handleClearSetup,
    handleDragCancel,
    handleDragHoverCell,
    handleDragReleaseCell,
    handleTargetBoardLayout,
    handleRandomizeSetup,
    handleRotateSelected,
    handleSetupBoardPress,
    hits,
    isCellDisabled,
    isGameOver,
    isSetupPhase,
    lastShot,
    miniBoardWidth,
    miniCellSize,
    mode,
    modeId,
    ownIncomingGuesses,
    ownShipFrames,
    ownTargets,
    passTurn,
    pendingTurnPass,
    phase,
    pickUpTarget,
    playerOneGuesses,
    playerOneHits,
    playerTwoGuesses,
    playerTwoHits,
    previewCells,
    previewIsValid,
    resetGame,
    selectedGhostHeight,
    selectedGhostVisual,
    selectedGhostWidth,
    selectedTarget,
    selectedTargetId,
    setupFleetReady,
    setupPlayer,
    setupTargets,
    shotAnimation,
    shotAnimationPosition,
    shotOpacity,
    shotScale,
    shotTranslateY,
    shotsTaken,
    soundMuted,
    startMatch,
    startPlayerTwoSetup,
    statusText,
    targetBoardRef,
    toggleAttemptsEnabled,
    toggleSound,
    totalTargetCells,
    winner,
  };
}
