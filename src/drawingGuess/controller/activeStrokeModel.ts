import { DrawingPoint, DrawingStroke } from '../model/types';
import { DrawingToolState } from '../rendering/drawingTools';

export const createActiveDrawingStroke = ({
  canvasRevision,
  point,
  strokeId,
  toolState,
  userId,
}: {
  strokeId: string;
  userId: string;
  point: DrawingPoint;
  canvasRevision: number;
  toolState: DrawingToolState;
}): DrawingStroke => {
  const tool = toolState.selectedTool;

  return {
    id: strokeId,
    authorId: userId,
    tool,
    color: tool === 'eraser' ? '#F7F2E8' : toolState.brushColor,
    width: tool === 'eraser' ? toolState.eraserWidth : toolState.brushWidth,
    points: [point],
    createdAt: Date.now(),
    revision: canvasRevision,
  };
};

export const appendPointToActiveStroke = (
  stroke: DrawingStroke | undefined,
  point: DrawingPoint,
) =>
  stroke
    ? {
        ...stroke,
        points: [...stroke.points, point],
      }
    : stroke;

export const commitActiveDrawingStroke = (stroke: DrawingStroke | undefined) => ({
  committedStroke: stroke,
  activeStroke: undefined,
});

export const cancelActiveDrawingStroke = () => undefined;

export const createCommittedDrawingStrokeFromPoints = ({
  canvasRevision,
  points,
  strokeId,
  toolState,
  userId,
}: {
  strokeId: string;
  userId: string;
  points: DrawingPoint[];
  canvasRevision: number;
  toolState: DrawingToolState;
}): DrawingStroke | undefined => {
  const validPoints = points.filter(
    (point) =>
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      point.x >= 0 &&
      point.x <= 1 &&
      point.y >= 0 &&
      point.y <= 1,
  );

  if (!validPoints.length) {
    return undefined;
  }

  return {
    ...createActiveDrawingStroke({
      strokeId,
      userId,
      point: validPoints[0],
      canvasRevision,
      toolState,
    }),
    points: validPoints,
  };
};
