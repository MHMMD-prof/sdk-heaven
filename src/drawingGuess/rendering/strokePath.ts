import { DrawingPoint } from '../model/types';
import { CanvasBounds, denormalizeCanvasPoint } from './canvasGeometry';

export type PathCommand =
  | {
      type: 'moveTo';
      x: number;
      y: number;
    }
  | {
      type: 'lineTo';
      x: number;
      y: number;
    }
  | {
      type: 'quadTo';
      controlX: number;
      controlY: number;
      x: number;
      y: number;
    };

export const createStrokePathCommands = (
  points: DrawingPoint[],
  bounds: CanvasBounds,
): PathCommand[] => {
  if (!points.length || bounds.width <= 0 || bounds.height <= 0) {
    return [];
  }

  if (points.length === 1) {
    const point = denormalizeCanvasPoint(points[0], bounds);
    return [
      { type: 'moveTo', x: point.x, y: point.y },
      { type: 'lineTo', x: point.x + 0.01, y: point.y + 0.01 },
    ];
  }

  const commands: PathCommand[] = [];
  let previousPoint = denormalizeCanvasPoint(points[0], bounds);

  commands.push({ type: 'moveTo', x: previousPoint.x, y: previousPoint.y });

  points.slice(1).forEach((point) => {
    const pixelPoint = denormalizeCanvasPoint(point, bounds);
    const midPoint = {
      x: (previousPoint.x + pixelPoint.x) / 2,
      y: (previousPoint.y + pixelPoint.y) / 2,
    };

    commands.push({
      type: 'quadTo',
      controlX: previousPoint.x,
      controlY: previousPoint.y,
      x: midPoint.x,
      y: midPoint.y,
    });
    previousPoint = pixelPoint;
  });

  commands.push({ type: 'lineTo', x: previousPoint.x, y: previousPoint.y });

  return commands;
};
