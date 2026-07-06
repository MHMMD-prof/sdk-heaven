import { Pressable, Text, View } from 'react-native';

import { CellResult, MiniGameTarget } from '../types/miniGame';
import { findTargetAtCell, getCellResult, parseCellId } from '../utils/miniGameEngine';
import { boardStyles as styles } from './BattleshipBoardStyles';
import { columnLabels, labels, rowLabels } from './constants';

const getBoardCellAccessibilityLabel = (cellId: string) => {
  const position = parseCellId(cellId);
  const columnLabel = columnLabels[position.column] ?? String(position.column + 1);
  const rowLabel = rowLabels[position.row] ?? String(position.row + 1);

  return `${columnLabel}${rowLabel}`;
};

type BattleshipTargetCellGridProps = {
  activeGuesses: Set<string>;
  activeTargets: MiniGameTarget[];
  boardCells: string[];
  cellSize: number;
  isCellDisabled: (cellId: string) => boolean;
  isSetupPhase: boolean;
  modeAccentColor: string;
  onCellPress: (cellId: string) => void;
  previewCells: string[];
  previewIsValid: boolean;
  setupTargets: MiniGameTarget[];
};

export function BattleshipTargetCellGrid({
  activeGuesses,
  activeTargets,
  boardCells,
  cellSize,
  isCellDisabled,
  isSetupPhase,
  modeAccentColor,
  onCellPress,
  previewCells,
  previewIsValid,
  setupTargets,
}: BattleshipTargetCellGridProps) {
  return (
    <>
      {boardCells.map((cellId) => {
        const result: CellResult = isSetupPhase
          ? 'hidden'
          : getCellResult(cellId, activeGuesses, activeTargets);
        const target = isSetupPhase
          ? setupTargets.find((item) => item.cells.includes(cellId))
          : findTargetAtCell(cellId, activeTargets);
        const isHit = result === 'hit';
        const isMiss = result === 'miss';
        const targetComplete = Boolean(target) && target!.cells.every((cell) => activeGuesses.has(cell));
        const isPreviewCell = previewCells.includes(cellId);
        const isPlacedCell = isSetupPhase && Boolean(target);
        const disabled = isCellDisabled(cellId);

        return (
          <Pressable
            accessibilityLabel={getBoardCellAccessibilityLabel(cellId)}
            accessibilityHint={isSetupPhase ? labels.setupShipHint : labels.fireCellHint}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            key={cellId}
            disabled={disabled}
            onPress={() => onCellPress(cellId)}
            style={[
              styles.cell,
              {
                height: cellSize,
                width: cellSize,
              },
              isPlacedCell && styles.cellPlaced,
              isPreviewCell && (previewIsValid ? styles.cellPreviewValid : styles.cellPreviewInvalid),
              isHit && { backgroundColor: `${modeAccentColor}38`, borderColor: modeAccentColor },
              targetComplete && styles.cellRevealedShip,
              isMiss && styles.cellMiss,
              disabled && styles.cellLocked,
            ]}
          >
            {!isHit && !isMiss ? <View style={styles.waterSheen} /> : null}
            {isMiss ? <Text style={styles.missText}>{'\u00d7'}</Text> : null}
            {isHit && !targetComplete ? (
              <View style={styles.hitMarker}>
                <View style={styles.hitMarkerCore} />
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </>
  );
}

type BattleshipOwnCellGridProps = {
  boardCells: string[];
  cellSize: number;
  incomingGuesses: Set<string>;
  targets: MiniGameTarget[];
};

export function BattleshipOwnCellGrid({
  boardCells,
  cellSize,
  incomingGuesses,
  targets,
}: BattleshipOwnCellGridProps) {
  return (
    <>
      {boardCells.map((cellId) => {
        const result = getCellResult(cellId, incomingGuesses, targets);
        const isMiss = result === 'miss';

        return (
          <View
            accessibilityLabel={`${getBoardCellAccessibilityLabel(cellId)} ${
              isMiss ? labels.miss : labels.ownFleet
            }`}
            accessible
            key={`own-${cellId}`}
            style={[
              styles.cell,
              styles.miniCell,
              {
                height: cellSize,
                width: cellSize,
              },
              isMiss && styles.cellMiss,
            ]}
          >
            {!isMiss ? <View style={styles.waterSheen} /> : null}
            {isMiss ? <Text style={styles.miniMissText}>{'\u00d7'}</Text> : null}
          </View>
        );
      })}
    </>
  );
}
