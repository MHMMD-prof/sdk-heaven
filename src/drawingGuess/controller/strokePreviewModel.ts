import { DRAWING_GUESS_STROKES } from '../model/constants';
import { isNormalizedPoint, simplifyStrokePoints } from '../model/strokeUtils';
import { DrawingPoint, DrawingStroke } from '../model/types';
import { DrawingGuessStrokePreviewPayload } from '../transport/drawingGuessMessages';

export type RemotePreviewStrokeMap = Record<string, DrawingStroke>;

export type StrokePreviewThrottleState = {
  lastSentAt: number;
  lastSentPointCount: number;
};

export const DRAWING_GUESS_PREVIEW_THROTTLE_MS = 50;
export const DRAWING_GUESS_PREVIEW_POINT_BATCH_SIZE = 4;

export const initialStrokePreviewThrottleState: StrokePreviewThrottleState = {
  lastSentAt: 0,
  lastSentPointCount: 0,
};

export const shouldPublishStrokePreviewUpdate = ({
  now,
  pointCount,
  state,
}: {
  now: number;
  pointCount: number;
  state: StrokePreviewThrottleState;
}) =>
  pointCount > state.lastSentPointCount &&
  (now - state.lastSentAt >= DRAWING_GUESS_PREVIEW_THROTTLE_MS ||
    pointCount - state.lastSentPointCount >= DRAWING_GUESS_PREVIEW_POINT_BATCH_SIZE);

export const markStrokePreviewPublished = ({
  now,
  pointCount,
}: {
  now: number;
  pointCount: number;
}): StrokePreviewThrottleState => ({
  lastSentAt: now,
  lastSentPointCount: pointCount,
});

export const createStrokePreviewPayload = (
  stroke: DrawingStroke,
  status: DrawingGuessStrokePreviewPayload['status'],
): DrawingGuessStrokePreviewPayload => ({
  type: 'stroke-preview',
  strokeId: stroke.id,
  authorId: stroke.authorId,
  tool: stroke.tool,
  color: stroke.color,
  width: stroke.width,
  revision: stroke.revision,
  points: simplifyStrokePreviewPoints(stroke.points),
  status,
});

export const applyRemoteStrokePreview = ({
  canvasRevision,
  drawerId,
  payload,
  previews,
}: {
  previews: RemotePreviewStrokeMap;
  payload: DrawingGuessStrokePreviewPayload;
  drawerId?: string;
  canvasRevision: number;
}): RemotePreviewStrokeMap => {
  if (
    payload.authorId !== drawerId ||
    payload.revision !== canvasRevision ||
    payload.points.length === 0 ||
    payload.points.some((point) => !isNormalizedPoint(point))
  ) {
    return previews;
  }

  if (payload.status === 'cancel') {
    return removeRemoteStrokePreview(previews, payload.strokeId);
  }

  return {
    ...previews,
    [payload.strokeId]: {
      id: payload.strokeId,
      authorId: payload.authorId,
      tool: payload.tool,
      color: payload.color,
      width: payload.width,
      revision: payload.revision,
      points: payload.points,
      createdAt: Date.now(),
    },
  };
};

export const removeRemoteStrokePreview = (
  previews: RemotePreviewStrokeMap,
  strokeId: string,
): RemotePreviewStrokeMap => {
  if (!previews[strokeId]) {
    return previews;
  }

  const nextPreviews = { ...previews };
  delete nextPreviews[strokeId];

  return nextPreviews;
};

export const clearRemoteStrokePreviews = (): RemotePreviewStrokeMap => ({});

const simplifyStrokePreviewPoints = (points: DrawingPoint[]) =>
  simplifyStrokePoints(points, DRAWING_GUESS_STROKES.minPointDistance);
