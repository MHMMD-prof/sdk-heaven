import { MiniGameMode, MiniGameTarget } from '../types/miniGame';
import {
  canPlaceTarget,
  createEmptyTargets,
  createHiddenTargets,
  getPlacementCells,
} from '../utils/miniGameEngine';
import { GamePhase, ShotAnimation } from './BattleshipGameTypes';

export const createModeTargets = (mode: MiniGameMode) =>
  mode.id === 'naval' ? createEmptyTargets(mode) : createHiddenTargets(mode);

export const getResetPhase = (mode: MiniGameMode, showPreMatch: boolean): GamePhase => {
  if (mode.id !== 'naval') {
    return 'battle';
  }

  return showPreMatch ? 'pre-match' : 'setup-player-1';
};

export const getInitialSelectedTargetId = (mode: MiniGameMode) =>
  mode.id === 'naval' ? mode.targets[0]?.id : undefined;

export const getPlacementPreview = ({
  previewCellId,
  selectedTarget,
  setupTargets,
}: {
  previewCellId?: string;
  selectedTarget?: MiniGameTarget;
  setupTargets: MiniGameTarget[];
}) => {
  const previewCells =
    selectedTarget && previewCellId
      ? getPlacementCells(previewCellId, selectedTarget.footprint)
      : [];
  const previewIsValid =
    Boolean(selectedTarget && previewCellId) &&
    canPlaceTarget(selectedTarget!.id, previewCellId!, selectedTarget!.footprint, setupTargets);

  return { previewCells, previewIsValid };
};

export const isBattleCellDisabled = ({
  activeGuesses,
  cellId,
  isGameOver,
  pendingTurnPass,
  phase,
  shotAnimation,
}: {
  activeGuesses: Set<string>;
  cellId: string;
  isGameOver: boolean;
  pendingTurnPass: boolean;
  phase: GamePhase;
  shotAnimation?: ShotAnimation;
}) =>
  phase === 'battle' &&
  (pendingTurnPass || isGameOver || Boolean(shotAnimation) || activeGuesses.has(cellId));
