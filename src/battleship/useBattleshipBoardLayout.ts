import { useCallback, useMemo, useRef } from 'react';
import { Animated, GestureResponderEvent, View } from 'react-native';

import { spacing } from '../theme';
import { BOARD_SIZE, createBoardCells, parseCellId } from '../utils/miniGameEngine';
import { ShotAnimation } from './BattleshipGameTypes';

type UseBattleshipBoardLayoutOptions = {
  screenWidth: number;
  shotAnimation?: ShotAnimation;
  shotAnimationValue: Animated.Value;
};

export type BoardPoint = {
  x: number;
  y: number;
};

export const getBoardPointFromResponderEvent = (
  event: GestureResponderEvent,
  boardOrigin?: BoardPoint,
): BoardPoint => {
  const { locationX, locationY, pageX, pageY } = event.nativeEvent;

  if (boardOrigin && Number.isFinite(pageX) && Number.isFinite(pageY)) {
    return {
      x: pageX - boardOrigin.x,
      y: pageY - boardOrigin.y,
    };
  }

  return {
    x: locationX,
    y: locationY,
  };
};

export const getCellIdFromBoardPointValue = (
  point: BoardPoint,
  cellSize: number,
  cellGap: number,
) => {
  const column = Math.floor(point.x / (cellSize + cellGap));
  const row = Math.floor(point.y / (cellSize + cellGap));
  const columnOffset = point.x - column * (cellSize + cellGap);
  const rowOffset = point.y - row * (cellSize + cellGap);

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

export function useBattleshipBoardLayout({
  screenWidth,
  shotAnimation,
  shotAnimationValue,
}: UseBattleshipBoardLayoutOptions) {
  const targetBoardRef = useRef<View>(null);
  const targetBoardOriginRef = useRef<BoardPoint | undefined>(undefined);
  const boardCells = useMemo(() => createBoardCells(), []);
  const cellGap = spacing.xs;
  const availableBoardWidth = screenWidth - spacing.lg * 2 - spacing.md * 2;
  const cellSize = Math.min(
    (availableBoardWidth - cellGap * (BOARD_SIZE - 1)) / BOARD_SIZE,
    50,
  );
  const boardWidth = cellSize * BOARD_SIZE + cellGap * (BOARD_SIZE - 1);
  const miniCellSize = Math.min(
    (availableBoardWidth - cellGap * (BOARD_SIZE - 1)) / BOARD_SIZE,
    34,
  );
  const miniBoardWidth = miniCellSize * BOARD_SIZE + cellGap * (BOARD_SIZE - 1);
  const shotAnimationPosition = shotAnimation ? parseCellId(shotAnimation.cellId) : undefined;
  const shotTranslateY = shotAnimationValue.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [-cellSize * 1.25, 0, 0],
  });
  const shotScale = shotAnimationValue.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [0.5, 1, 1.35],
  });
  const shotOpacity = shotAnimationValue.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [0, 1, 0],
  });

  const handleTargetBoardLayout = useCallback(() => {
    targetBoardRef.current?.measureInWindow((x, y) => {
      targetBoardOriginRef.current = { x, y };
    });
  }, []);

  const getBoardPointFromEvent = useCallback(
    (event: GestureResponderEvent) =>
      getBoardPointFromResponderEvent(event, targetBoardOriginRef.current),
    [],
  );

  const getCellIdFromBoardPoint = useCallback(
    (point: BoardPoint) => getCellIdFromBoardPointValue(point, cellSize, cellGap),
    [cellGap, cellSize],
  );

  const getCellIdFromBoardEvent = useCallback(
    (event: GestureResponderEvent) => getCellIdFromBoardPoint(getBoardPointFromEvent(event)),
    [getBoardPointFromEvent, getCellIdFromBoardPoint],
  );

  return {
    boardCells,
    boardWidth,
    cellGap,
    cellSize,
    getBoardPointFromEvent,
    getCellIdFromBoardEvent,
    getCellIdFromBoardPoint,
    handleTargetBoardLayout,
    miniBoardWidth,
    miniCellSize,
    shotAnimationPosition,
    shotOpacity,
    shotScale,
    shotTranslateY,
    targetBoardRef,
  };
}
