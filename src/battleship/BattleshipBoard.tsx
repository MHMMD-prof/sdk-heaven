import type { RefObject } from 'react';
import { useCallback, useMemo, useRef } from 'react';
import { Animated as RNAnimated, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

import { MiniGameTarget } from '../types/miniGame';
import { BOARD_SIZE } from '../utils/miniGameEngine';
import { BattleshipCoordinateFrame } from './BattleshipCoordinateFrame';
import { BattleshipOwnCellGrid, BattleshipTargetCellGrid } from './BattleshipCellGrid';
import { BattleshipOwnHitLayer } from './BattleshipOwnHitLayer';
import { BattleshipPlacementGhost } from './BattleshipPlacementGhost';
import { BattleshipShipLayer } from './BattleshipShipLayer';
import { BattleshipShotImpact } from './BattleshipShotImpact';
import { boardStyles as styles } from './BattleshipBoardStyles';
import { BoardPosition, ShipFrame, ShipVisual, ShotAnimation } from './BattleshipBoardTypes';
import { labels } from './constants';

type BattleshipTargetBoardProps = {
  activeGuesses: Set<string>;
  activeTargets: MiniGameTarget[];
  boardCells: string[];
  boardShipFrames: ShipFrame[];
  boardWidth: number;
  cellGap: number;
  cellSize: number;
  isCellDisabled: (cellId: string) => boolean;
  isSetupPhase: boolean;
  modeAccentColor: string;
  onCellPress: (cellId: string) => void;
  onDragCancel: () => void;
  onDragMoveFromCell: (cellId?: string) => void;
  onDragReleaseFromCell: (cellId?: string) => void;
  onTargetBoardLayout: () => void;
  previewCells: string[];
  previewIsValid: boolean;
  selectedGhostHeight: number;
  selectedGhostVisual?: ShipVisual;
  selectedGhostWidth: number;
  shouldStartDragResponder: boolean;
  setupTargets: MiniGameTarget[];
  shotAnimation?: ShotAnimation;
  shotAnimationPosition?: BoardPosition;
  shotOpacity: RNAnimated.AnimatedInterpolation<string | number>;
  shotScale: RNAnimated.AnimatedInterpolation<string | number>;
  shotTranslateY: RNAnimated.AnimatedInterpolation<string | number>;
  targetBoardRef: RefObject<View | null>;
};

export function BattleshipTargetBoard({
  activeGuesses,
  activeTargets,
  boardCells,
  boardShipFrames,
  boardWidth,
  cellGap,
  cellSize,
  isCellDisabled,
  isSetupPhase,
  modeAccentColor,
  onCellPress,
  onDragCancel,
  onDragMoveFromCell,
  onDragReleaseFromCell,
  onTargetBoardLayout,
  previewCells,
  previewIsValid,
  selectedGhostHeight,
  selectedGhostVisual,
  selectedGhostWidth,
  shouldStartDragResponder,
  setupTargets,
  shotAnimation,
  shotAnimationPosition,
  shotOpacity,
  shotScale,
  shotTranslateY,
  targetBoardRef,
}: BattleshipTargetBoardProps) {
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragVisible = useSharedValue(0);
  const lastHoveredCell = useSharedValue('');
  const onCellPressRef = useRef(onCellPress);
  const onDragCancelRef = useRef(onDragCancel);
  const onDragMoveFromCellRef = useRef(onDragMoveFromCell);
  const onDragReleaseFromCellRef = useRef(onDragReleaseFromCell);
  const onTargetBoardLayoutRef = useRef(onTargetBoardLayout);

  onCellPressRef.current = onCellPress;
  onDragCancelRef.current = onDragCancel;
  onDragMoveFromCellRef.current = onDragMoveFromCell;
  onDragReleaseFromCellRef.current = onDragReleaseFromCell;
  onTargetBoardLayoutRef.current = onTargetBoardLayout;

  const handleCellPress = useCallback((cellId: string) => {
    onCellPressRef.current(cellId);
  }, []);
  const handleDragCancel = useCallback(() => {
    onDragCancelRef.current();
  }, []);
  const handleDragMoveFromCell = useCallback((cellId?: string) => {
    onDragMoveFromCellRef.current(cellId);
  }, []);
  const handleDragReleaseFromCell = useCallback((cellId?: string) => {
    onDragReleaseFromCellRef.current(cellId);
  }, []);
  const handleTargetBoardLayout = useCallback(() => {
    onTargetBoardLayoutRef.current();
  }, []);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(shouldStartDragResponder)
        .minDistance(0)
        .onBegin((event) => {
          dragX.value = event.x;
          dragY.value = event.y;
          dragVisible.value = 0;
          lastHoveredCell.value = '';
          runOnJS(handleTargetBoardLayout)();
        })
        .onUpdate((event) => {
          const moved =
            Math.abs(event.translationX) > 4 || Math.abs(event.translationY) > 4;
          const cellId = getCellIdFromGesturePoint(event.x, event.y, cellSize, cellGap) ?? '';

          dragX.value = event.x;
          dragY.value = event.y;
          dragVisible.value = moved ? 1 : 0;

          if (cellId !== lastHoveredCell.value) {
            lastHoveredCell.value = cellId;
            runOnJS(handleDragMoveFromCell)(cellId || undefined);
          }
        })
        .onEnd((event) => {
          const moved =
            Math.abs(event.translationX) > 4 || Math.abs(event.translationY) > 4;
          const cellId = getCellIdFromGesturePoint(event.x, event.y, cellSize, cellGap);

          dragVisible.value = 0;
          lastHoveredCell.value = '';

          if (moved) {
            runOnJS(handleDragReleaseFromCell)(cellId);
            return;
          }

          runOnJS(handleDragCancel)();

          if (cellId) {
            runOnJS(handleCellPress)(cellId);
          }
        })
        .onFinalize((_event, success) => {
          dragVisible.value = 0;
          lastHoveredCell.value = '';

          if (!success) {
            runOnJS(handleDragCancel)();
          }
        }),
    [
      cellGap,
      cellSize,
      dragVisible,
      dragX,
      dragY,
      handleCellPress,
      handleDragCancel,
      handleDragMoveFromCell,
      handleDragReleaseFromCell,
      handleTargetBoardLayout,
      lastHoveredCell,
      shouldStartDragResponder,
    ],
  );

  return (
    <BattleshipCoordinateFrame boardWidth={boardWidth} cellSize={cellSize}>
      <GestureDetector gesture={panGesture}>
        <View
          ref={targetBoardRef}
          onLayout={handleTargetBoardLayout}
          style={[styles.board, { height: boardWidth, width: boardWidth }]}
          testID="battleship-target-board"
        >
          <BattleshipTargetCellGrid
            activeGuesses={activeGuesses}
            activeTargets={activeTargets}
            boardCells={boardCells}
            cellSize={cellSize}
            isCellDisabled={isCellDisabled}
            isSetupPhase={isSetupPhase}
            modeAccentColor={modeAccentColor}
            onCellPress={onCellPress}
            previewCells={previewCells}
            previewIsValid={previewIsValid}
            setupTargets={setupTargets}
          />
          <BattleshipShipLayer ships={boardShipFrames} />
          <BattleshipPlacementGhost
            dragVisible={dragVisible}
            dragX={dragX}
            dragY={dragY}
            height={selectedGhostHeight}
            isSetupPhase={isSetupPhase}
            isValid={previewIsValid}
            visual={selectedGhostVisual}
            width={selectedGhostWidth}
          />
          <BattleshipShotImpact
            animation={shotAnimation}
            cellGap={cellGap}
            cellSize={cellSize}
            position={shotAnimationPosition}
            values={{ opacity: shotOpacity, scale: shotScale, translateY: shotTranslateY }}
          />
        </View>
      </GestureDetector>
    </BattleshipCoordinateFrame>
  );
}

type BattleshipOwnBoardProps = {
  boardCells: string[];
  boardWidth: number;
  cellGap: number;
  cellSize: number;
  incomingGuesses: Set<string>;
  metaText: string | number;
  ownShipFrames: ShipFrame[];
  targets: MiniGameTarget[];
};

export function BattleshipOwnBoard({
  boardCells,
  boardWidth,
  cellGap,
  cellSize,
  incomingGuesses,
  metaText,
  ownShipFrames,
  targets,
}: BattleshipOwnBoardProps) {
  return (
    <View style={styles.ownBoardPanel}>
      <View style={styles.ownBoardHeader}>
        <Text style={styles.ownBoardMeta}>{metaText}</Text>
        <Text style={styles.ownBoardTitle}>{labels.ownFleet}</Text>
      </View>
      <BattleshipCoordinateFrame boardWidth={boardWidth} cellSize={cellSize} isMini>
        <View
          style={[styles.board, styles.miniBoard, { height: boardWidth, width: boardWidth }]}
          testID="battleship-own-board"
        >
          <BattleshipOwnCellGrid
            boardCells={boardCells}
            cellSize={cellSize}
            incomingGuesses={incomingGuesses}
            targets={targets}
          />
          <BattleshipShipLayer keyPrefix="own-" ships={ownShipFrames} />
          <BattleshipOwnHitLayer
            cellGap={cellGap}
            cellSize={cellSize}
            incomingGuesses={incomingGuesses}
            targets={targets}
          />
        </View>
      </BattleshipCoordinateFrame>
    </View>
  );
}

const getCellIdFromGesturePoint = (
  x: number,
  y: number,
  cellSize: number,
  cellGap: number,
) => {
  'worklet';

  const column = Math.floor(x / (cellSize + cellGap));
  const row = Math.floor(y / (cellSize + cellGap));
  const columnOffset = x - column * (cellSize + cellGap);
  const rowOffset = y - row * (cellSize + cellGap);

  if (
    row < 0 ||
    column < 0 ||
    row >= BOARD_SIZE ||
    column >= BOARD_SIZE ||
    rowOffset > cellSize ||
    columnOffset > cellSize
  ) {
    return undefined;
  }

  return `${row}-${column}`;
};
