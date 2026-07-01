import { MiniGameModeId } from '../types/miniGame';
import { MAX_ATTEMPTS } from '../utils/miniGameEngine';
import { labels } from './constants';
import { useBattleshipGame } from './useBattleshipGame';

type UseBattleshipScreenModelOptions = {
  initialMode: MiniGameModeId;
  onBack: () => void;
  screenWidth: number;
};

export function useBattleshipScreenModel({
  initialMode,
  onBack,
  screenWidth,
}: UseBattleshipScreenModelOptions) {
  const game = useBattleshipGame({ initialMode, screenWidth });
  const handoffPlayer: 1 | 2 =
    game.phase === 'handoff-to-player-2' ? 2 : game.currentPlayer === 1 ? 2 : 1;

  return {
    phase: game.phase,
    isBattleGameOver: game.phase === 'battle' && game.isGameOver,
    scrollEnabled: !game.isSetupPhase || !game.selectedTarget,
    handoffProps: {
      onContinue:
        game.phase === 'handoff-to-player-2'
          ? game.startPlayerTwoSetup
          : game.continueTurnHandoff,
      player: handoffPlayer,
    },
    preMatchProps: {
      attemptsEnabled: game.attemptsEnabled,
      mode: game.mode,
      onStartMatch: game.startMatch,
      onToggleAttempts: game.toggleAttemptsEnabled,
    },
    victoryProps: {
      mode: game.mode,
      onReset: () => game.resetGame(),
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
      onModeChange: (nextModeId: MiniGameModeId) => game.resetGame(nextModeId, true),
      onToggleSound: game.toggleSound,
      soundMuted: game.soundMuted,
    },
    boardCardProps: {
      attemptsLeftText: game.attemptsLeftText,
      hits: game.hits,
      isSetupPhase: game.isSetupPhase,
      lastShot: game.lastShot,
      mode: game.mode,
      onClearSetup: game.handleClearSetup,
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
          ? { onPress: game.passTurn, title: labels.passTurn }
          : { onPress: () => game.resetGame(), title: labels.newRound },
  };
}
