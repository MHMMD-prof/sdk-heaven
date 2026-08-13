import { Dispatch, SetStateAction } from 'react';
import { GestureResponderEvent } from 'react-native';

import { MiniGameMode, MiniGameTarget } from '../types/miniGame';
import {
  canPlaceTarget,
  createEmptyTargets,
  placeTargetAtCell,
  randomizeTargets,
  removeTargetPlacement,
  rotatePlacedTarget,
} from '../utils/miniGameEngine';
import { GamePhase, LastShot } from './BattleshipGameTypes';

type UseBattleshipSetupActionsOptions = {
  clearSunkEffects: () => void;
  getCellIdFromBoardEvent: (event: GestureResponderEvent) => string | undefined;
  impactLight: () => void;
  impactMedium: () => void;
  mode: MiniGameMode;
  notifyError: () => void;
  notifySuccess: () => void;
  onOnlineFleetConfirmed?: (targets: MiniGameTarget[]) => void;
  phase: GamePhase;
  playInvalidSound: () => void;
  playTapSound: () => void;
  previewCellId?: string;
  selectedTarget?: MiniGameTarget;
  selectedTargetId?: string;
  setCurrentPlayer: Dispatch<SetStateAction<1 | 2>>;
  setLastShot: Dispatch<SetStateAction<LastShot | undefined>>;
  setPendingTurnPass: Dispatch<SetStateAction<boolean>>;
  setPhase: Dispatch<SetStateAction<GamePhase>>;
  setPlayerOneGuesses: Dispatch<SetStateAction<Set<string>>>;
  setPlayerOneTargets: Dispatch<SetStateAction<MiniGameTarget[]>>;
  setPlayerTwoGuesses: Dispatch<SetStateAction<Set<string>>>;
  setPlayerTwoTargets: Dispatch<SetStateAction<MiniGameTarget[]>>;
  setPreviewCellId: Dispatch<SetStateAction<string | undefined>>;
  setSelectedTargetId: Dispatch<SetStateAction<string | undefined>>;
  setupFleetReady: boolean;
  setupPlayer: 1 | 2;
  setupTargets: MiniGameTarget[];
  playerTwoTargets: MiniGameTarget[];
};

export function useBattleshipSetupActions({
  clearSunkEffects,
  getCellIdFromBoardEvent,
  impactLight,
  impactMedium,
  mode,
  notifyError,
  notifySuccess,
  onOnlineFleetConfirmed,
  phase,
  playInvalidSound,
  playTapSound,
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
}: UseBattleshipSetupActionsOptions) {
  const setCurrentSetupTargets = (updater: (targets: MiniGameTarget[]) => MiniGameTarget[]) => {
    if (setupPlayer === 1) {
      setPlayerOneTargets((targets) => updater(targets));
    } else {
      setPlayerTwoTargets((targets) => updater(targets));
    }
  };

  const selectNextUnplacedTarget = (targets: MiniGameTarget[]) => {
    const nextTarget = targets.find((target) => !target.isPlaced);
    setSelectedTargetId(nextTarget?.id);
  };

  const resetPlacementPreview = () => {
    setPreviewCellId(undefined);
  };

  const playPlacementSuccessFeedback = () => {
    playTapSound();
    impactLight();
  };

  const playPlacementErrorFeedback = () => {
    playInvalidSound();
    notifyError();
  };

  const commitSelectedTargetPlacement = (cellId: string) => {
    if (!selectedTarget) {
      return;
    }

    setPreviewCellId(cellId);

    if (!canPlaceTarget(selectedTarget.id, cellId, selectedTarget.footprint, setupTargets)) {
      playPlacementErrorFeedback();
      return;
    }

    const nextTargets = placeTargetAtCell(
      setupTargets,
      selectedTarget.id,
      cellId,
      selectedTarget.footprint,
    );
    setCurrentSetupTargets(() => nextTargets);
    selectNextUnplacedTarget(nextTargets);
    resetPlacementPreview();
    playPlacementSuccessFeedback();
  };

  const pickUpTarget = (targetId: string, anchorCellId?: string) => {
    playPlacementSuccessFeedback();
    setSelectedTargetId(targetId);
    setPreviewCellId(anchorCellId);
    setCurrentSetupTargets((targets) => removeTargetPlacement(targets, targetId));
  };

  const handleSetupCellPress = (cellId: string) => {
    const placedTarget = setupTargets.find((target) => target.cells.includes(cellId));

    if (placedTarget) {
      pickUpTarget(placedTarget.id, placedTarget.cells[0]);
      return;
    }

    commitSelectedTargetPlacement(cellId);
  };

  const handleSetupBoardPress = (event: GestureResponderEvent) => {
    const cellId = getCellIdFromBoardEvent(event);

    if (cellId) {
      handleSetupCellPress(cellId);
    }
  };

  const handleDragHoverCell = (cellId?: string) => {
    if (cellId && cellId !== previewCellId) {
      setPreviewCellId(cellId);
    }
  };

  const handleDragReleaseCell = (cellId?: string) => {
    const targetCellId = cellId ?? previewCellId;

    if (!selectedTarget || !targetCellId) {
      return;
    }

    commitSelectedTargetPlacement(targetCellId);
  };

  const handleDragCancel = () => {
    setPreviewCellId(undefined);
  };

  const handleRotateSelected = () => {
    if (!selectedTargetId) {
      return;
    }

    setCurrentSetupTargets((targets) => rotatePlacedTarget(targets, selectedTargetId));
    playTapSound();
    impactMedium();
  };

  const handleRandomizeSetup = () => {
    const nextTargets = randomizeTargets(setupTargets);
    setCurrentSetupTargets(() => nextTargets);
    setSelectedTargetId(undefined);
    resetPlacementPreview();
    playTapSound();
    impactMedium();
  };

  const handleClearSetup = () => {
    const clearedTargets = createEmptyTargets(mode);
    setCurrentSetupTargets(() => clearedTargets);
    setSelectedTargetId(clearedTargets[0]?.id);
    resetPlacementPreview();
    playTapSound();
    impactLight();
  };

  const confirmSetupFleet = () => {
    if (!setupFleetReady) {
      playPlacementErrorFeedback();
      return;
    }

    playTapSound();
    notifySuccess();
    setSelectedTargetId(undefined);
    resetPlacementPreview();

    if (onOnlineFleetConfirmed) {
      onOnlineFleetConfirmed(setupTargets);
      return;
    }

    if (phase === 'setup-player-1') {
      setPhase('handoff-to-player-2');
      return;
    }

    setPlayerOneGuesses(new Set());
    setPlayerTwoGuesses(new Set());
    setCurrentPlayer(1);
    setPendingTurnPass(false);
    setLastShot(undefined);
    clearSunkEffects();
    setPhase('battle');
  };

  const startPlayerTwoSetup = () => {
    playTapSound();
    impactLight();
    setSelectedTargetId(playerTwoTargets.find((target) => !target.isPlaced)?.id);
    setPhase('setup-player-2');
  };

  return {
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
  };
}
