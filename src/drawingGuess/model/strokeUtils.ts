import { DRAWING_GUESS_STROKES } from './constants';
import { DrawingPoint, DrawingStroke } from './types';

export const isNormalizedPoint = (point: DrawingPoint) =>
  Number.isFinite(point.x) &&
  Number.isFinite(point.y) &&
  point.x >= 0 &&
  point.x <= 1 &&
  point.y >= 0 &&
  point.y <= 1;

export const isValidStroke = (stroke: DrawingStroke) =>
  Boolean(stroke.id) &&
  Boolean(stroke.authorId) &&
  stroke.width > 0 &&
  stroke.points.length > 0 &&
  stroke.points.every(isNormalizedPoint);

export const simplifyStrokePoints = (
  points: DrawingPoint[],
  minDistance = DRAWING_GUESS_STROKES.minPointDistance,
) => {
  if (points.length <= 2) {
    return points.filter(isNormalizedPoint);
  }

  const simplified: DrawingPoint[] = [];

  points.forEach((point) => {
    if (!isNormalizedPoint(point)) {
      return;
    }

    const previous = simplified[simplified.length - 1];
    const distance = previous
      ? Math.hypot(point.x - previous.x, point.y - previous.y)
      : Number.POSITIVE_INFINITY;

    if (!previous || distance >= minDistance) {
      simplified.push(point);
    }
  });

  const lastPoint = points[points.length - 1];
  const lastSimplified = simplified[simplified.length - 1];

  if (
    lastPoint &&
    isNormalizedPoint(lastPoint) &&
    lastSimplified &&
    (lastSimplified.x !== lastPoint.x || lastSimplified.y !== lastPoint.y)
  ) {
    simplified.push(lastPoint);
  }

  return simplified;
};

export const canCommitStroke = (
  stroke: DrawingStroke,
  strokeIndex: Record<string, true>,
  canvasRevision: number,
) => isValidStroke(stroke) && !strokeIndex[stroke.id] && stroke.revision === canvasRevision;

export const filterStrokesForRevision = (strokes: DrawingStroke[], canvasRevision: number) =>
  strokes.filter((stroke) => stroke.revision === canvasRevision);
