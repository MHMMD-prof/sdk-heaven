import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';

import { MiniGameTarget } from '../../types/miniGame';
import { getFleetCellCount, isFleetPlaced } from '../../utils/miniGameEngine';
import { BattleshipFleetReadySeal } from './fleetSeal';

export type { BattleshipFleetReadySeal } from './fleetSeal';
export { fleetSealLooksSafe } from './fleetSeal';

/** Deterministic fleet fingerprint. Never include this string on the wire with cells. */
export const canonicalizeFleet = (targets: MiniGameTarget[]) =>
  JSON.stringify(
    targets
      .map((target) => ({
        cells: [...target.cells].sort(),
        footprint: {
          columns: target.footprint.columns,
          rows: target.footprint.rows,
        },
        id: target.id,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  );

export const createFleetCommitment = async (targets: MiniGameTarget[]) =>
  digestStringAsync(CryptoDigestAlgorithm.SHA256, canonicalizeFleet(targets));

export const createFleetReadySeal = async (
  targets: MiniGameTarget[],
): Promise<BattleshipFleetReadySeal> => {
  if (!isFleetPlaced(targets)) {
    throw new Error('Fleet must be fully placed before sealing.');
  }

  return {
    commitment: await createFleetCommitment(targets),
    fleetCellCount: getFleetCellCount(targets),
    targetCount: targets.length,
  };
};
