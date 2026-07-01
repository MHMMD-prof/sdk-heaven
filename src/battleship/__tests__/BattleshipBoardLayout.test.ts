import type { GestureResponderEvent } from 'react-native';
import { describe, expect, it } from 'vitest';

import {
  getBoardPointFromResponderEvent,
  getCellIdFromBoardPointValue,
} from '../useBattleshipBoardLayout';

describe('Battleship board layout helpers', () => {
  it('resolves drag points from page coordinates instead of child-local coordinates', () => {
    const event = {
      nativeEvent: {
        locationX: 4,
        locationY: 5,
        pageX: 228,
        pageY: 287,
      },
    } as unknown as GestureResponderEvent;

    const boardPoint = getBoardPointFromResponderEvent(event, { x: 100, y: 140 });

    expect(boardPoint).toEqual({ x: 128, y: 147 });
    expect(getCellIdFromBoardPointValue(boardPoint, 30, 2)).toBe('4-4');
  });

  it('falls back to native location when the board origin is not measured yet', () => {
    const event = {
      nativeEvent: {
        locationX: 42,
        locationY: 74,
        pageX: 142,
        pageY: 214,
      },
    } as unknown as GestureResponderEvent;

    expect(getBoardPointFromResponderEvent(event)).toEqual({ x: 42, y: 74 });
  });
});
