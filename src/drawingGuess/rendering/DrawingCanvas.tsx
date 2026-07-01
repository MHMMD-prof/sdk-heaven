import { Canvas, Group, notifyChange, Path, Skia } from '@shopify/react-native-skia';
import { useCallback, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

import { DrawingPoint, DrawingStroke } from '../model/types';
import { CanvasBounds } from './canvasGeometry';
import { DrawingTool } from './drawingTools';
import { createStrokePathCommands } from './strokePath';

type DrawingCanvasProps = {
  strokes: DrawingStroke[];
  previewStrokes?: DrawingStroke[];
  canDraw: boolean;
  selectedTool: DrawingTool;
  brushColor: string;
  brushWidth: number;
  eraserWidth: number;
  authorId: string;
  canvasRevision: number;
  onCommitStrokePoints: (points: DrawingPoint[]) => void;
  onPreviewStrokePoints?: (points: DrawingPoint[]) => void;
  onCancelStroke: () => void;
};

export function DrawingCanvas({
  authorId,
  brushColor,
  brushWidth,
  canvasRevision,
  canDraw,
  eraserWidth,
  onCancelStroke,
  onCommitStrokePoints,
  onPreviewStrokePoints,
  selectedTool,
  previewStrokes = [],
  strokes,
}: DrawingCanvasProps) {
  void authorId;
  void canvasRevision;

  const [bounds, setBounds] = useState<CanvasBounds>({ width: 0, height: 0 });
  const activePath = useSharedValue(Skia.Path.Make());
  const activePoints = useSharedValue<DrawingPoint[]>([]);
  const previousPixelPoint = useSharedValue<{ x: number; y: number } | undefined>(undefined);
  const isDrawing = useSharedValue(false);
  const lastPreviewAt = useSharedValue(0);
  const lastPreviewPointCount = useSharedValue(0);

  const onLayout = (event: LayoutChangeEvent) => {
    const { height, width } = event.nativeEvent.layout;
    setBounds({ width, height });
  };

  const commitStrokePoints = useCallback(
    (points: DrawingPoint[]) => {
      onCommitStrokePoints(points);
    },
    [onCommitStrokePoints],
  );

  const previewStrokePoints = useCallback(
    (points: DrawingPoint[]) => {
      onPreviewStrokePoints?.(points);
    },
    [onPreviewStrokePoints],
  );

  const cancelStroke = useCallback(() => {
    onCancelStroke();
  }, [onCancelStroke]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(canDraw)
        .minDistance(0)
        .onBegin((event) => {
          const point = normalizeCanvasPointOnUiThread(event.x, event.y, bounds.width, bounds.height);

          if (point) {
            activePath.value.reset();
            activePath.value.moveTo(event.x, event.y);
            activePath.value.lineTo(event.x + 0.01, event.y + 0.01);
            notifyChange(activePath);
            activePoints.value = [point];
            previousPixelPoint.value = { x: event.x, y: event.y };
            isDrawing.value = true;
            lastPreviewAt.value = Date.now();
            lastPreviewPointCount.value = 1;
            runOnJS(previewStrokePoints)([point]);
          }
        })
        .onUpdate((event) => {
          const point = normalizeCanvasPointOnUiThread(event.x, event.y, bounds.width, bounds.height);

          if (point && isDrawing.value) {
            activePoints.value.push(point);

            const previous = previousPixelPoint.value;

            if (previous) {
              activePath.value.quadTo(
                previous.x,
                previous.y,
                (previous.x + event.x) / 2,
                (previous.y + event.y) / 2,
              );
            } else {
              activePath.value.lineTo(event.x, event.y);
            }

            previousPixelPoint.value = { x: event.x, y: event.y };
            notifyChange(activePath);

            const now = Date.now();
            const pointCount = activePoints.value.length;

            if (now - lastPreviewAt.value >= 50 || pointCount - lastPreviewPointCount.value >= 4) {
              lastPreviewAt.value = now;
              lastPreviewPointCount.value = pointCount;
              runOnJS(previewStrokePoints)([...activePoints.value]);
            }
          }
        })
        .onEnd(() => {
          if (isDrawing.value && activePoints.value.length) {
            runOnJS(commitStrokePoints)([...activePoints.value]);
          }

          activePath.value.reset();
          notifyChange(activePath);
          activePoints.value = [];
          previousPixelPoint.value = undefined;
          isDrawing.value = false;
        })
        .onFinalize((_event, success) => {
          if (!success && isDrawing.value) {
            activePath.value.reset();
            notifyChange(activePath);
            activePoints.value = [];
            previousPixelPoint.value = undefined;
            isDrawing.value = false;
            runOnJS(cancelStroke)();
          }
        }),
    [
      activePath,
      activePoints,
      bounds.height,
      bounds.width,
      canDraw,
      cancelStroke,
      commitStrokePoints,
      isDrawing,
      lastPreviewAt,
      lastPreviewPointCount,
      previousPixelPoint,
      previewStrokePoints,
    ],
  );

  return (
    <GestureDetector gesture={panGesture}>
      <View onLayout={onLayout} style={styles.wrapper}>
        <Canvas style={styles.canvas}>
          <Group>
            {[...strokes, ...previewStrokes].map((stroke) => (
              <StrokePath bounds={bounds} key={stroke.id} stroke={stroke} />
            ))}
            <Path
              blendMode={selectedTool === 'eraser' ? 'clear' : 'srcOver'}
              color={selectedTool === 'eraser' ? '#F7F2E8' : brushColor}
              path={activePath}
              strokeCap="round"
              strokeJoin="round"
              strokeWidth={selectedTool === 'eraser' ? eraserWidth : brushWidth}
              style="stroke"
            />
          </Group>
        </Canvas>
      </View>
    </GestureDetector>
  );
}

type StrokePathProps = {
  stroke: DrawingStroke;
  bounds: CanvasBounds;
};

function StrokePath({ bounds, stroke }: StrokePathProps) {
  const path = useMemo(() => {
    const nextPath = Skia.Path.Make();
    const commands = createStrokePathCommands(stroke.points, bounds);

    commands.forEach((command) => {
      if (command.type === 'moveTo') {
        nextPath.moveTo(command.x, command.y);
      } else if (command.type === 'lineTo') {
        nextPath.lineTo(command.x, command.y);
      } else {
        nextPath.quadTo(command.controlX, command.controlY, command.x, command.y);
      }
    });

    return nextPath;
  }, [bounds, stroke.points]);

  return (
    <Path
      blendMode={stroke.tool === 'eraser' ? 'clear' : 'srcOver'}
      color={stroke.color}
      path={path}
      strokeCap="round"
      strokeJoin="round"
      strokeWidth={stroke.width}
      style="stroke"
    />
  );
}

const normalizeCanvasPointOnUiThread = (
  x: number,
  y: number,
  width: number,
  height: number,
): DrawingPoint | undefined => {
  'worklet';

  if (
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x > width ||
    y > height
  ) {
    return undefined;
  }

  return {
    x: Math.min(1, Math.max(0, x / width)),
    y: Math.min(1, Math.max(0, y / height)),
  };
};

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
  },
  canvas: {
    flex: 1,
  },
});
