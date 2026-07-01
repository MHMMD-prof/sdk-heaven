import { MiniGameTarget } from '../types/miniGame';
import { parseCellId } from '../utils/miniGameEngine';
import { createShipVisual } from './shipSprites';

type UseBattleshipShipFramesOptions = {
  activeGuesses: Set<string>;
  activeTargets: MiniGameTarget[];
  boardCellSize: number;
  cellGap: number;
  currentPlayer: 1 | 2;
  darkenedShipIds: Set<string>;
  explodingShipIds: Set<string>;
  isNaval: boolean;
  isSetupPhase: boolean;
  miniCellSize: number;
  ownTargets: MiniGameTarget[];
  selectedTarget?: MiniGameTarget;
  selectedTargetId?: string;
  setupTargets: MiniGameTarget[];
};

export function useBattleshipShipFrames({
  activeGuesses,
  activeTargets,
  boardCellSize,
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
}: UseBattleshipShipFramesOptions) {
  const selectedGhostWidth = selectedTarget
    ? selectedTarget.footprint.columns * boardCellSize +
      (selectedTarget.footprint.columns - 1) * cellGap
    : 0;
  const selectedGhostHeight = selectedTarget
    ? selectedTarget.footprint.rows * boardCellSize +
      (selectedTarget.footprint.rows - 1) * cellGap
    : 0;
  const selectedGhostVisual =
    selectedTarget && selectedGhostWidth && selectedGhostHeight
      ? createShipVisual(selectedTarget, selectedGhostWidth, selectedGhostHeight)
      : undefined;

  const createShipFrame = (
    target: MiniGameTarget,
    effectKey?: string,
    frameCellSize = boardCellSize,
    frameCellGap = cellGap,
  ) => {
    if (!target.cells.length) {
      return undefined;
    }

    const positions = target.cells.map(parseCellId);
    const startRow = Math.min(...positions.map((position) => position.row));
    const startColumn = Math.min(...positions.map((position) => position.column));
    const frameHeight =
      target.footprint.rows * frameCellSize + (target.footprint.rows - 1) * frameCellGap;
    const frameWidth =
      target.footprint.columns * frameCellSize +
      (target.footprint.columns - 1) * frameCellGap;
    const visual = createShipVisual(target, frameWidth, frameHeight);

    if (!visual) {
      return undefined;
    }

    return {
      id: target.id,
      image: visual.image,
      isDarkened: Boolean(effectKey && darkenedShipIds.has(effectKey)),
      isExploding: Boolean(effectKey && explodingShipIds.has(effectKey)),
      imageStyle: visual.imageStyle,
      style: {
        height: frameHeight,
        left: startColumn * (frameCellSize + frameCellGap),
        opacity: selectedTargetId === target.id && isSetupPhase ? 0.5 : 1,
        top: startRow * (frameCellSize + frameCellGap),
        width: frameWidth,
      },
    };
  };

  const defendingPlayer = currentPlayer === 1 ? 2 : 1;
  const boardShipFrames = (isSetupPhase ? setupTargets : activeTargets)
    .filter((target) =>
      isSetupPhase
        ? target.isPlaced
        : isNaval && target.cells.every((cell) => activeGuesses.has(cell)),
    )
    .map((target) =>
      createShipFrame(target, isSetupPhase ? undefined : `${defendingPlayer}-${target.id}`),
    )
    .filter((ship): ship is NonNullable<ReturnType<typeof createShipFrame>> => Boolean(ship));
  const ownShipFrames = ownTargets
    .map((target) => createShipFrame(target, `${currentPlayer}-${target.id}`, miniCellSize, cellGap))
    .filter((ship): ship is NonNullable<ReturnType<typeof createShipFrame>> => Boolean(ship));

  return {
    boardShipFrames,
    ownShipFrames,
    selectedGhostHeight,
    selectedGhostVisual,
    selectedGhostWidth,
  };
}
