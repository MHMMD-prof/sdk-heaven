import { DrawingPoint } from '../model/types';

export type CanvasBounds = {
  width: number;
  height: number;
};

export type CanvasGesturePoint = {
  x: number;
  y: number;
};

export const isValidCanvasBounds = (bounds: CanvasBounds) =>
  Number.isFinite(bounds.width) && Number.isFinite(bounds.height) && bounds.width > 0 && bounds.height > 0;

export const normalizeCanvasPoint = (
  point: CanvasGesturePoint,
  bounds: CanvasBounds,
): DrawingPoint | undefined => {
  if (!isValidCanvasBounds(bounds) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return undefined;
  }

  if (point.x < 0 || point.y < 0 || point.x > bounds.width || point.y > bounds.height) {
    return undefined;
  }

  return {
    x: point.x / bounds.width,
    y: point.y / bounds.height,
  };
};

export const denormalizeCanvasPoint = (point: DrawingPoint, bounds: CanvasBounds) => ({
  x: point.x * bounds.width,
  y: point.y * bounds.height,
});
