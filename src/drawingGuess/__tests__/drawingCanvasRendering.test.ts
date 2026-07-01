import { describe, expect, it } from 'vitest';

import {
  appendPointToActiveStroke,
  cancelActiveDrawingStroke,
  commitActiveDrawingStroke,
  createActiveDrawingStroke,
  createCommittedDrawingStrokeFromPoints,
} from '../controller/activeStrokeModel';
import { createDefaultDrawingToolState } from '../controller/drawingGuessControllerModel';
import {
  applyRemoteStrokePreview,
  createStrokePreviewPayload,
  initialStrokePreviewThrottleState,
  markStrokePreviewPublished,
  removeRemoteStrokePreview,
  shouldPublishStrokePreviewUpdate,
} from '../controller/strokePreviewModel';
import {
  denormalizeCanvasPoint,
  normalizeCanvasPoint,
} from '../rendering/canvasGeometry';
import { drawingGuessBrushColors } from '../rendering/drawingTools';
import { createStrokePathCommands } from '../rendering/strokePath';

describe('Drawing Guess canvas geometry', () => {
  it('converts gesture coordinates to normalized points', () => {
    expect(normalizeCanvasPoint({ x: 50, y: 25 }, { width: 100, height: 50 })).toEqual({
      x: 0.5,
      y: 0.5,
    });
    expect(denormalizeCanvasPoint({ x: 0.5, y: 0.25 }, { width: 200, height: 100 })).toEqual({
      x: 100,
      y: 25,
    });
  });

  it('rejects out-of-bounds and invalid canvas coordinates', () => {
    expect(normalizeCanvasPoint({ x: -1, y: 10 }, { width: 100, height: 100 })).toBeUndefined();
    expect(normalizeCanvasPoint({ x: 10, y: 101 }, { width: 100, height: 100 })).toBeUndefined();
    expect(normalizeCanvasPoint({ x: 10, y: 10 }, { width: 0, height: 100 })).toBeUndefined();
  });
});

describe('Drawing Guess stroke paths', () => {
  it('creates a visible path for one-point strokes', () => {
    expect(createStrokePathCommands([{ x: 0.25, y: 0.5 }], { width: 200, height: 100 })).toEqual([
      { type: 'moveTo', x: 50, y: 50 },
      { type: 'lineTo', x: 50.01, y: 50.01 },
    ]);
  });

  it('creates smoothed quadratic commands for multi-point strokes', () => {
    expect(
      createStrokePathCommands(
        [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.5 },
          { x: 1, y: 1 },
        ],
        { width: 100, height: 80 },
      ),
    ).toEqual([
      { type: 'moveTo', x: 0, y: 0 },
      { type: 'quadTo', controlX: 0, controlY: 0, x: 25, y: 20 },
      { type: 'quadTo', controlX: 50, controlY: 40, x: 75, y: 60 },
      { type: 'lineTo', x: 100, y: 80 },
    ]);
  });
});

describe('Drawing Guess drawing tools', () => {
  it('exposes a showcase-ready 16 color brush palette', () => {
    expect(drawingGuessBrushColors).toHaveLength(16);
    expect(drawingGuessBrushColors).toEqual([
      '#111827',
      '#6B7280',
      '#FFFFFF',
      '#EF4444',
      '#F472B6',
      '#F97316',
      '#FACC15',
      '#2BCB88',
      '#14B8A6',
      '#22D3EE',
      '#4BA3FF',
      '#7C3AED',
      '#8B5A2B',
      '#F2C6A0',
      '#D7A54A',
      '#0F172A',
    ]);
  });
});

describe('Drawing Guess active stroke model', () => {
  it('commits and cancels active strokes without mutating the original stroke', () => {
    const stroke = createActiveDrawingStroke({
      strokeId: 'stroke-1',
      userId: 'user-1',
      point: { x: 0.1, y: 0.1 },
      canvasRevision: 3,
      toolState: createDefaultDrawingToolState(),
    });
    const appendedStroke = appendPointToActiveStroke(stroke, { x: 0.2, y: 0.2 });

    expect(stroke.points).toHaveLength(1);
    expect(appendedStroke?.points).toHaveLength(2);
    expect(commitActiveDrawingStroke(appendedStroke)).toEqual({
      committedStroke: appendedStroke,
      activeStroke: undefined,
    });
    expect(cancelActiveDrawingStroke()).toBeUndefined();
  });

  it('uses brush and eraser styling when creating active strokes', () => {
    const brushStroke = createActiveDrawingStroke({
      strokeId: 'brush-1',
      userId: 'user-1',
      point: { x: 0.1, y: 0.1 },
      canvasRevision: 1,
      toolState: {
        selectedTool: 'brush',
        brushColor: '#ABCDEF',
        brushWidth: 12,
        eraserWidth: 30,
      },
    });
    const eraserStroke = createActiveDrawingStroke({
      strokeId: 'eraser-1',
      userId: 'user-1',
      point: { x: 0.1, y: 0.1 },
      canvasRevision: 1,
      toolState: {
        selectedTool: 'eraser',
        brushColor: '#ABCDEF',
        brushWidth: 12,
        eraserWidth: 30,
      },
    });

    expect(brushStroke).toMatchObject({ tool: 'brush', color: '#ABCDEF', width: 12 });
    expect(eraserStroke).toMatchObject({ tool: 'eraser', color: '#F7F2E8', width: 30 });
  });

  it('creates committed strokes from UI-thread points and ignores invalid commits', () => {
    const toolState = createDefaultDrawingToolState();
    const committedStroke = createCommittedDrawingStrokeFromPoints({
      strokeId: 'stroke-2',
      userId: 'user-1',
      canvasRevision: 4,
      toolState,
      points: [
        { x: 0.1, y: 0.2 },
        { x: Number.NaN, y: 0.3 },
        { x: 0.4, y: 0.5 },
      ],
    });

    expect(committedStroke).toMatchObject({
      id: 'stroke-2',
      authorId: 'user-1',
      revision: 4,
      points: [
        { x: 0.1, y: 0.2 },
        { x: 0.4, y: 0.5 },
      ],
    });
    expect(
      createCommittedDrawingStrokeFromPoints({
        strokeId: 'invalid',
        userId: 'user-1',
        canvasRevision: 4,
        toolState,
        points: [{ x: 2, y: 0.5 }],
      }),
    ).toBeUndefined();
  });
});

describe('Drawing Guess remote stroke previews', () => {
  const stroke = {
    id: 'stroke-1',
    authorId: 'drawer-1',
    tool: 'brush' as const,
    color: '#111827',
    width: 8,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
    ],
    createdAt: 1000,
    revision: 2,
  };

  it('builds and clears transient preview strokes without reducer state', () => {
    const payload = createStrokePreviewPayload(stroke, 'begin');
    const previews = applyRemoteStrokePreview({
      previews: {},
      payload,
      drawerId: 'drawer-1',
      canvasRevision: 2,
    });

    expect(previews['stroke-1']).toMatchObject({
      id: 'stroke-1',
      authorId: 'drawer-1',
      points: stroke.points,
    });
    expect(removeRemoteStrokePreview(previews, 'stroke-1')).toEqual({});
  });

  it('ignores previews from non-drawers, wrong revisions, and malformed points', () => {
    const payload = createStrokePreviewPayload(stroke, 'update');

    expect(
      applyRemoteStrokePreview({
        previews: {},
        payload,
        drawerId: 'other-player',
        canvasRevision: 2,
      }),
    ).toEqual({});
    expect(
      applyRemoteStrokePreview({
        previews: {},
        payload,
        drawerId: 'drawer-1',
        canvasRevision: 3,
      }),
    ).toEqual({});
    expect(
      applyRemoteStrokePreview({
        previews: {},
        payload: { ...payload, points: [{ x: 2, y: 0.2 }] },
        drawerId: 'drawer-1',
        canvasRevision: 2,
      }),
    ).toEqual({});
  });

  it('throttles preview updates by time or unsent point count', () => {
    const state = markStrokePreviewPublished({
      now: 1000,
      pointCount: 1,
    });

    expect(
      shouldPublishStrokePreviewUpdate({
        now: 1020,
        pointCount: 2,
        state,
      }),
    ).toBe(false);
    expect(
      shouldPublishStrokePreviewUpdate({
        now: 1020,
        pointCount: 5,
        state,
      }),
    ).toBe(true);
    expect(
      shouldPublishStrokePreviewUpdate({
        now: 1050,
        pointCount: 2,
        state,
      }),
    ).toBe(true);
    expect(
      shouldPublishStrokePreviewUpdate({
        now: 1100,
        pointCount: initialStrokePreviewThrottleState.lastSentPointCount,
        state: initialStrokePreviewThrottleState,
      }),
    ).toBe(false);
  });
});
