import { View } from 'react-native';

import { MiniGameTarget } from '../types/miniGame';
import { parseCellId } from '../utils/miniGameEngine';
import { boardStyles as styles } from './BattleshipBoardStyles';

type BattleshipOwnHitLayerProps = {
  cellGap: number;
  cellSize: number;
  incomingGuesses: Set<string>;
  targets: MiniGameTarget[];
};

export function BattleshipOwnHitLayer({
  cellGap,
  cellSize,
  incomingGuesses,
  targets,
}: BattleshipOwnHitLayerProps) {
  return (
    <>
      {targets.flatMap((target) =>
        target.cells
          .filter((cell) => incomingGuesses.has(cell))
          .map((cell) => {
            const position = parseCellId(cell);

            return (
              <View
                key={`own-hit-${target.id}-${cell}`}
                pointerEvents="none"
                style={[
                  styles.ownHitMarker,
                  {
                    left: position.column * (cellSize + cellGap) + cellSize / 2 - 7,
                    top: position.row * (cellSize + cellGap) + cellSize / 2 - 7,
                  },
                ]}
              />
            );
          }),
      )}
    </>
  );
}
