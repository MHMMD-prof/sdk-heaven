import { useState } from 'react';

import { MiniGameModeId, MiniGameTarget } from '../types/miniGame';
import { MAX_ATTEMPTS } from '../utils/miniGameEngine';
import { labels } from './constants';
import {
  BattleshipConfirmAction,
  BattleshipConfirmDialogState,
  createBattleshipConfirmDialogState,
  getBattleshipPersistenceScreenState,
  getSavedMatchSummary,
} from './BattleshipReleasePolish';
import { useBattleshipGame } from './useBattleshipGame';

type UseBattleshipScreenModelOptions = {
  initialMode: MiniGameModeId;
  onBack: () => void;
  onOnlineFleetConfirmed?: (targets: MiniGameTarget[]) => void;
  persistenceEnabled?: boolean;
  screenWidth: number;
  skipPreMatch?: boolean;
};

export function useBattleshipScreenModel({
  initialMode,
  onBack,
  onOnlineFleetConfirmed,
  persistenceEnabled = true,
  screenWidth,
  skipPreMatch = false,
}: UseBattleshipScreenModelOptions) {
  const game = useBattleshipGame({
    initialMode,
    onOnlineFleetConfirmed,
    persistenceEnabled,
    screenWidth,
    skipPreMatch,
  });
  const [confirmDialog, setConfirmDialog] = useState<BattleshipConfirmDialogState | undefined>();
  const handoffPlayer: 1 | 2 =
    game.phase === 'handoff-to-player-2' ? 2 : game.currentPlayer === 1 ? 2 : 1;
  const savedMatchSummary = getSavedMatchSummary(game.savedMatch);
  const persistenceState = getBattleshipPersistenceScreenState({
    hasSavedMatch: Boolean(game.savedMatch),
    persistenceReady: game.persistenceReady,
  });
  const closeConfirmDialog = () => setConfirmDialog(undefined);
  const requestConfirmation = (
    action: BattleshipConfirmAction,
    onConfirm: () => void,
  ) => {
    setConfirmDialog(createBattleshipConfirmDialogState({
      action,
      onClose: closeConfirmDialog,
      onConfirm,
    }));
  };
  const confirmIfActiveMatch = (
    action: BattleshipConfirmAction,
    onConfirm: () => void,
  ) => {
    if (game.phase === 'pre-match' && !game.savedMatch) {
      onConfirm();
      return;
    }

    requestConfirmation(action, onConfirm);
  };

  return {
    confirmDialog,
    confirmDialogProps: {
      dialog: confirmDialog,
      onCancel: closeConfirmDialog,
    },
    phase: game.phase,
    isBattleGameOver: game.phase === 'battle' && game.isGameOver,
    scrollEnabled: !game.isSetupPhase || !game.selectedTarget,
    handoffProps: {
      confirmHint: labels.passConfirmHint,
      continueLabel:
        game.phase === 'handoff-to-player-2' ? labels.passSetupReady : labels.passTurnReady,
      message:
        game.phase === 'handoff-to-player-2' ? labels.passSetupText : labels.passTurnText,
      onContinue:
        game.phase === 'handoff-to-player-2'
          ? game.startPlayerTwoSetup
          : game.continueTurnHandoff,
      player: handoffPlayer,
    },
    preMatchProps: {
      attemptsEnabled: game.attemptsEnabled,
      canResumeSavedMatch: persistenceState.canResumeSavedMatch,
      canStartNewMatch: persistenceState.canStartNewMatch,
      hasSavedMatch: persistenceState.canResumeSavedMatch,
      isPersistenceLoading: persistenceState.isPersistenceLoading,
      mode: game.mode,
      onResumeMatch: game.resumeSavedMatch,
      onStartMatch: () =>
        !persistenceState.canStartNewMatch
          ? undefined
          : game.savedMatch
          ? requestConfirmation('new-match', game.startMatch)
          : game.startMatch(),
      onToggleAttempts: game.toggleAttemptsEnabled,
      savedMatchLabel: savedMatchSummary?.line,
    },
    victoryProps: {
      mode: game.mode,
      onReset: () => requestConfirmation('reset-victory', () => game.resetGame()),
      playerOneHits: game.playerOneHits,
      playerOneShots: game.playerOneGuesses.size,
      playerTwoHits: game.playerTwoHits,
      playerTwoShots: game.playerTwoGuesses.size,
      totalTargetCells: game.totalTargetCells,
      winner: game.winner,
    },
    headerProps: {
      mode: game.mode,
      modeId: game.modeId,
      onBack,
      onModeChange: (nextModeId: MiniGameModeId) => {
        if (nextModeId === game.modeId) {
          return;
        }

        confirmIfActiveMatch('mode-change', () => game.resetGame(nextModeId, true));
      },
      onToggleSound: game.toggleSound,
      soundMuted: game.soundMuted,
    },
    boardCardProps: {
      attemptsLeftText: game.attemptsLeftText,
      hits: game.hits,
      isSetupPhase: game.isSetupPhase,
      lastShot: game.lastShot,
      mode: game.mode,
      onClearSetup: () => requestConfirmation('clear-setup', game.handleClearSetup),
      onRandomizeSetup: game.handleRandomizeSetup,
      onRotateSelected: game.handleRotateSelected,
      ownBoardProps: {
        boardCells: game.boardCells,
        boardWidth: game.miniBoardWidth,
        cellGap: game.cellGap,
        cellSize: game.miniCellSize,
        incomingGuesses: game.ownIncomingGuesses,
        metaText: game.attemptsEnabled
          ? `${game.ownIncomingGuesses.size}/${MAX_ATTEMPTS}`
          : game.ownIncomingGuesses.size,
        ownShipFrames: game.ownShipFrames,
        targets: game.ownTargets,
      },
      phase: game.phase,
      selectedTargetId: game.selectedTargetId,
      shotsTaken: game.shotsTaken,
      statusText: game.statusText,
      targetBoardProps: {
        activeGuesses: game.activeGuesses,
        activeTargets: game.activeTargets,
        boardCells: game.boardCells,
        boardShipFrames: game.boardShipFrames,
        boardWidth: game.boardWidth,
        cellGap: game.cellGap,
        cellSize: game.cellSize,
        isCellDisabled: game.isCellDisabled,
        isSetupPhase: game.isSetupPhase,
        modeAccentColor: game.mode.accentColor,
        onCellPress: game.handleCellPress,
        onDragCancel: game.handleDragCancel,
        onDragMoveFromCell: game.handleDragHoverCell,
        onDragReleaseFromCell: game.handleDragReleaseCell,
        onTargetBoardLayout: game.handleTargetBoardLayout,
        previewCells: game.previewCells,
        previewIsValid: game.previewIsValid,
        selectedGhostHeight: game.selectedGhostHeight,
        selectedGhostVisual: game.selectedGhostVisual,
        selectedGhostWidth: game.selectedGhostWidth,
        setupTargets: game.setupTargets,
        shouldStartDragResponder: Boolean(game.isSetupPhase && game.selectedTarget),
        shotAnimation: game.shotAnimation,
        shotAnimationPosition: game.shotAnimationPosition,
        shotOpacity: game.shotOpacity,
        shotScale: game.shotScale,
        shotTranslateY: game.shotTranslateY,
        targetBoardRef: game.targetBoardRef,
      },
      totalTargetCells: game.totalTargetCells,
    },
    fleetPanelProps: {
      activeGuesses: game.activeGuesses,
      activeTargets: game.activeTargets,
      hits: game.hits,
      isSetupPhase: game.isSetupPhase,
      modeAccentColor: game.mode.accentColor,
      onConfirmFleet: game.confirmSetupFleet,
      onPickUpTarget: game.pickUpTarget,
      selectedTargetId: game.selectedTargetId,
      setupFleetReady: game.setupFleetReady,
      setupTargets: game.setupTargets,
      totalTargetCells: game.totalTargetCells,
    },
    footerAction:
      game.phase !== 'battle'
        ? undefined
        : game.pendingTurnPass
          ? {
              accessibilityHint: labels.passTurnHint,
              onPress: game.passTurn,
              title: labels.passTurn,
            }
          : {
              accessibilityHint: labels.newRoundHint,
              onPress: () => requestConfirmation('reset-battle', () => game.resetGame()),
              title: labels.newRound,
            },
  };
}
