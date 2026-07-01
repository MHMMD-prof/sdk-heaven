import { ReactNode } from 'react';
import { Text, View } from 'react-native';

import { columnLabels, rowLabels } from './constants';
import { boardStyles as styles } from './BattleshipBoardStyles';

type BattleshipCoordinateFrameProps = {
  boardWidth: number;
  cellSize: number;
  children: ReactNode;
  isMini?: boolean;
};

export function BattleshipCoordinateFrame({
  boardWidth,
  cellSize,
  children,
  isMini = false,
}: BattleshipCoordinateFrameProps) {
  const labelStyle = isMini ? styles.coordinateLabelSmall : styles.coordinateLabel;

  return (
    <View style={[styles.coordinateFrame, { width: boardWidth + (isMini ? 24 : 28) }]}>
      <View style={[styles.columnLabels, { marginLeft: isMini ? 20 : 24, width: boardWidth }]}>
        {columnLabels.map((label) => (
          <Text key={`${isMini ? 'own-col-' : ''}${label}`} style={[labelStyle, { width: cellSize }]}>
            {label}
          </Text>
        ))}
      </View>
      <View style={styles.boardRow}>
        <View style={[isMini ? styles.rowLabelsSmall : styles.rowLabels, { height: boardWidth }]}>
          {rowLabels.map((label) => (
            <Text key={`${isMini ? 'own-row-' : ''}${label}`} style={[labelStyle, { height: cellSize }]}>
              {label}
            </Text>
          ))}
        </View>
        {children}
      </View>
    </View>
  );
}
