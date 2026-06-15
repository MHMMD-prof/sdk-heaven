import { CellResult, MiniGameMode, MiniGameTarget } from '../types/miniGame';

export const BOARD_SIZE = 6;
export const MAX_ATTEMPTS = 18;

const fallbackFootprints = [
  { columns: 3, rows: 1 },
  { columns: 2, rows: 1 },
  { columns: 2, rows: 1 },
];

export const createCellId = (row: number, column: number) => `${row}-${column}`;

export const parseCellId = (cellId: string) => {
  const [row, column] = cellId.split('-').map(Number);

  return { row, column };
};

export const createEmptyTargets = (mode: MiniGameMode): MiniGameTarget[] =>
  mode.targets.map((target, index) => ({
    ...target,
    cells: [],
    footprint: target.footprint ?? fallbackFootprints[index] ?? { columns: 2, rows: 1 },
    isPlaced: false,
  }));

export const createBoardCells = () =>
  Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
    const row = Math.floor(index / BOARD_SIZE);
    const column = index % BOARD_SIZE;
    return createCellId(row, column);
  });

export const createHiddenTargets = (mode: MiniGameMode): MiniGameTarget[] => {
  const occupied = new Set<string>();

  return mode.targets.map((target, index) => {
    const footprint = target.footprint ?? fallbackFootprints[index] ?? { columns: 2, rows: 1 };
    const placement = placeTarget(footprint, occupied);

    placement.cells.forEach((cell) => occupied.add(cell));

    return {
      ...target,
      cells: placement.cells,
      footprint: placement.footprint,
      isPlaced: true,
    };
  });
};

export const getCellResult = (
  cellId: string,
  guesses: Set<string>,
  targets: MiniGameTarget[],
): CellResult => {
  if (!guesses.has(cellId)) {
    return 'hidden';
  }

  return targets.some((target) => target.cells.includes(cellId)) ? 'hit' : 'miss';
};

export const findTargetAtCell = (cellId: string, targets: MiniGameTarget[]) =>
  targets.find((target) => target.cells.includes(cellId));

export const countHits = (guesses: Set<string>, targets: MiniGameTarget[]) =>
  targets.reduce(
    (total, target) => total + target.cells.filter((cell) => guesses.has(cell)).length,
    0,
  );

export const getTotalTargetCells = (targets: MiniGameTarget[]) =>
  targets.reduce((total, target) => total + target.cells.length, 0);

export const getFleetCellCount = (targets: MiniGameTarget[]) =>
  targets.reduce((total, target) => total + target.footprint.columns * target.footprint.rows, 0);

export const rotateFootprint = (footprint: MiniGameTarget['footprint']) => ({
  columns: footprint.rows,
  rows: footprint.columns,
});

export const getPlacementCells = (
  anchorCellId: string,
  footprint: MiniGameTarget['footprint'],
) => {
  const anchor = parseCellId(anchorCellId);

  return createFootprintCells(anchor.row, anchor.column, footprint);
};

export const canPlaceTarget = (
  targetId: string,
  anchorCellId: string,
  footprint: MiniGameTarget['footprint'],
  targets: MiniGameTarget[],
) => {
  const anchor = parseCellId(anchorCellId);
  const maxRow = anchor.row + footprint.rows - 1;
  const maxColumn = anchor.column + footprint.columns - 1;

  if (
    anchor.row < 0 ||
    anchor.column < 0 ||
    maxRow >= BOARD_SIZE ||
    maxColumn >= BOARD_SIZE
  ) {
    return false;
  }

  const placementCells = getPlacementCells(anchorCellId, footprint);
  const occupied = new Set(
    targets
      .filter((target) => target.id !== targetId)
      .flatMap((target) => target.cells),
  );

  return placementCells.every((cell) => !occupied.has(cell));
};

export const placeTargetAtCell = (
  targets: MiniGameTarget[],
  targetId: string,
  anchorCellId: string,
  footprint?: MiniGameTarget['footprint'],
) =>
  targets.map((target) => {
    if (target.id !== targetId) {
      return target;
    }

    const nextFootprint = footprint ?? target.footprint;

    if (!canPlaceTarget(target.id, anchorCellId, nextFootprint, targets)) {
      return target;
    }

    return {
      ...target,
      cells: getPlacementCells(anchorCellId, nextFootprint),
      footprint: nextFootprint,
      isPlaced: true,
    };
  });

export const removeTargetPlacement = (targets: MiniGameTarget[], targetId: string) =>
  targets.map((target) =>
    target.id === targetId
      ? {
          ...target,
          cells: [],
          isPlaced: false,
        }
      : target,
  );

export const rotatePlacedTarget = (targets: MiniGameTarget[], targetId: string) =>
  targets.map((target) => {
    if (target.id !== targetId) {
      return target;
    }

    const rotatedFootprint = rotateFootprint(target.footprint);

    if (!target.cells.length) {
      return {
        ...target,
        footprint: rotatedFootprint,
      };
    }

    if (!canPlaceTarget(target.id, target.cells[0], rotatedFootprint, targets)) {
      return {
        ...target,
        footprint: rotatedFootprint,
        cells: [],
        isPlaced: false,
      };
    }

    return {
      ...target,
      cells: getPlacementCells(target.cells[0], rotatedFootprint),
      footprint: rotatedFootprint,
      isPlaced: true,
    };
  });

export const isFleetPlaced = (targets: MiniGameTarget[]) =>
  targets.every((target) => target.isPlaced && target.cells.length === target.footprint.columns * target.footprint.rows);

export const randomizeTargets = (targets: MiniGameTarget[]) => {
  const occupied = new Set<string>();

  return targets.map((target) => {
    const placement = placeTarget(target.footprint, occupied);

    placement.cells.forEach((cell) => occupied.add(cell));

    return {
      ...target,
      cells: placement.cells,
      footprint: placement.footprint,
      isPlaced: true,
    };
  });
};

const placeTarget = (
  footprint: MiniGameTarget['footprint'],
  occupied: Set<string>,
): Pick<MiniGameTarget, 'cells' | 'footprint'> => {
  const placementOptions = createPlacementOptions(footprint);

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const placedFootprint = placementOptions[randomBetween(0, placementOptions.length - 1)];
    const maxRow = BOARD_SIZE - placedFootprint.rows;
    const maxColumn = BOARD_SIZE - placedFootprint.columns;

    if (maxRow < 0 || maxColumn < 0) {
      continue;
    }

    const row = randomBetween(0, maxRow);
    const column = randomBetween(0, maxColumn);

    const cells = createFootprintCells(row, column, placedFootprint);

    if (cells.every((cell) => !occupied.has(cell))) {
      return { cells, footprint: placedFootprint };
    }
  }

  const fallbackCells = createBoardCells()
    .filter((cell) => !occupied.has(cell))
    .slice(0, footprint.columns * footprint.rows);

  return { cells: fallbackCells, footprint };
};

const createPlacementOptions = (footprint: MiniGameTarget['footprint']) => {
  if (footprint.columns === footprint.rows) {
    return [footprint];
  }

  return [
    footprint,
    {
      columns: footprint.rows,
      rows: footprint.columns,
    },
  ];
};

const createFootprintCells = (
  startRow: number,
  startColumn: number,
  footprint: MiniGameTarget['footprint'],
) =>
  Array.from({ length: footprint.rows }).flatMap((_, rowOffset) =>
    Array.from({ length: footprint.columns }, (_, columnOffset) =>
      createCellId(startRow + rowOffset, startColumn + columnOffset),
    ),
  );

const randomBetween = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
