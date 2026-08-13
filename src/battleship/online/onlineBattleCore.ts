import { MiniGameTarget } from '../../types/miniGame';
import { countHits, findTargetAtCell, getFleetCellCount } from '../../utils/miniGameEngine';

export type BattleshipShotResult = 'hit' | 'miss';

export type BattleshipResolvedShot = {
  attackerId: string;
  cellId: string;
  nextTurnPlayerId: string;
  result: BattleshipShotResult;
  shotId: string;
  sunkTargetId?: string;
  winnerId?: string;
};

export const createFogHitTargets = (hitCells: string[]): MiniGameTarget[] =>
  [...hitCells]
    .sort()
    .map((cellId) => ({
      id: `fog-${cellId}`,
      name: 'Hit',
      shortLabel: 'H',
      footprint: { columns: 1, rows: 1 },
      cells: [cellId],
      isPlaced: true,
    }));

export const resolveIncomingShot = ({
  attackerId,
  cellId,
  defenderId,
  incomingGuesses,
  localFleet,
  shotId,
}: {
  attackerId: string;
  cellId: string;
  defenderId: string;
  incomingGuesses: ReadonlySet<string>;
  localFleet: MiniGameTarget[];
  shotId: string;
}): BattleshipResolvedShot => {
  if (incomingGuesses.has(cellId)) {
    throw new Error('Cell was already resolved.');
  }

  const nextGuesses = new Set(incomingGuesses);
  nextGuesses.add(cellId);
  const target = findTargetAtCell(cellId, localFleet);
  const isHit = Boolean(target);
  const sunkTarget =
    target && target.cells.every((cell) => nextGuesses.has(cell)) ? target : undefined;
  const totalCells = getFleetCellCount(localFleet);
  const hits = countHits(nextGuesses, localFleet);
  const winnerId = isHit && hits >= totalCells && totalCells > 0 ? attackerId : undefined;
  const nextTurnPlayerId = winnerId
    ? attackerId
    : isHit
      ? attackerId
      : defenderId;

  return {
    attackerId,
    cellId,
    nextTurnPlayerId,
    result: isHit ? 'hit' : 'miss',
    shotId,
    ...(sunkTarget ? { sunkTargetId: sunkTarget.id } : {}),
    ...(winnerId ? { winnerId } : {}),
  };
};

export const getOpponentPlayerId = ({
  localPlayerId,
  players,
}: {
  localPlayerId: string;
  players: Array<{ id: string; isConnected: boolean }>;
}) =>
  players.find((player) => player.id !== localPlayerId && player.isConnected)?.id
  ?? players.find((player) => player.id !== localPlayerId)?.id;
