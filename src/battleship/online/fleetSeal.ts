export type BattleshipFleetReadySeal = {
  commitment: string;
  fleetCellCount: number;
  targetCount: number;
};

export const fleetSealLooksSafe = (value: unknown): value is BattleshipFleetReadySeal => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const seal = value as Record<string, unknown>;
  if ('cells' in seal || 'targets' in seal || 'fleet' in seal || 'board' in seal) {
    return false;
  }

  return (
    typeof seal.commitment === 'string'
    && /^[a-f0-9]{64}$/i.test(seal.commitment)
    && typeof seal.fleetCellCount === 'number'
    && Number.isInteger(seal.fleetCellCount)
    && seal.fleetCellCount > 0
    && typeof seal.targetCount === 'number'
    && Number.isInteger(seal.targetCount)
    && seal.targetCount > 0
  );
};
