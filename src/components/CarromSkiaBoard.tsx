import {
  Canvas,
  Circle,
  Group,
  Image as SkiaImage,
  Line,
  Rect,
  useImage,
} from '@shopify/react-native-skia';
import { forwardRef, memo, ReactNode, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';

import { colors, radius, spacing } from '../theme';
import { CarromDisc, CarromShotGuide } from '../types/carrom';
import {
  CARROM_STRIKER_MAX_X,
  CARROM_STRIKER_MIN_X,
} from '../utils/carromEngine';
import { CarromDebugOverlay } from './CarromDebugOverlay';

const whitePieceImage = require('../../assets/carrom/piece-red.png');
const blackPieceImage = require('../../assets/carrom/piece-black.png');
const strikerPieceImage = require('../../assets/carrom/piece-striker.png');

export type CarromSkiaBoardHandle = {
  syncDiscPositions: (discs: CarromDisc[], scale: number) => void;
  setDiscVisibility: (discs: CarromDisc[]) => void;
  setMovingMode: (isMoving: boolean) => void;
  syncShotGuide: (
    guide: CarromShotGuide | undefined,
    striker: CarromDisc | undefined,
    scale: number,
  ) => void;
};

type CarromSkiaBoardProps = {
  aimAngle: number;
  aimAssistEnabled: boolean;
  aimDots: Array<{ opacity: number; x: number; y: number }>;
  aimLength: number;
  aimReach: number;
  baselineY: number;
  boardImage: number;
  boardSize: number;
  children?: ReactNode;
  discs: CarromDisc[];
  effectsEnabled: boolean;
  isMoving: boolean;
  powerPercent: number;
  powerTone: string;
  scale: number;
  shotGuide?: CarromShotGuide;
  showDebugOverlay: boolean;
  striker?: CarromDisc;
  touchHandlers: ViewProps;
};

type CarromSkiaDiscHandle = {
  setVisibility: (disc: CarromDisc) => void;
  sync: (disc: CarromDisc, scale: number) => void;
};

type DiscRenderLayout = {
  opacity: number;
  size: number;
  x: number;
  y: number;
};

export const CarromSkiaBoard = memo(
  forwardRef<CarromSkiaBoardHandle, CarromSkiaBoardProps>(function CarromSkiaBoard(
    {
      aimAngle,
      aimAssistEnabled,
      aimDots,
      aimLength,
      aimReach,
      baselineY,
      boardImage,
      boardSize,
      children,
      discs,
      effectsEnabled,
      isMoving,
      powerPercent,
      powerTone,
      scale,
      shotGuide,
      showDebugOverlay,
      striker,
      touchHandlers,
    },
    ref,
  ) {
    const board = useImage(boardImage);
    const pieceImages = {
      black: useImage(blackPieceImage),
      queen: useImage(whitePieceImage),
      striker: useImage(strikerPieceImage),
      white: useImage(whitePieceImage),
    };
    const discHandlesRef = useRef<Record<string, CarromSkiaDiscHandle | undefined>>({});
    const [movingMode, setMovingMode] = useState(isMoving);
    const aimVisible = useSharedValue(0);
    const aimStartX = useSharedValue(0);
    const aimStartY = useSharedValue(0);
    const aimEndX = useSharedValue(0);
    const aimEndY = useSharedValue(0);
    const aimReachX = useSharedValue(0);
    const aimReachY = useSharedValue(0);
    const aimPower = useSharedValue(0);

    useEffect(() => {
      setMovingMode(isMoving);
    }, [isMoving]);

    const syncShotGuideVisual = useCallback(
      (
        nextGuide: CarromShotGuide | undefined,
        nextStriker: CarromDisc | undefined,
        nextScale: number,
      ) => {
        if (!nextGuide || !nextStriker) {
          aimVisible.value = 0;
          aimPower.value = 0;
          return;
        }

        const angle = Math.atan2(nextGuide.y - nextStriker.y, nextGuide.x - nextStriker.x);
        const reach = getAimReachToRail(nextStriker.x, nextStriker.y, angle);

        aimVisible.value = 1;
        aimStartX.value = nextStriker.x * nextScale;
        aimStartY.value = nextStriker.y * nextScale;
        aimEndX.value = nextGuide.x * nextScale;
        aimEndY.value = nextGuide.y * nextScale;
        aimReachX.value = (nextStriker.x + Math.cos(angle) * reach) * nextScale;
        aimReachY.value = (nextStriker.y + Math.sin(angle) * reach) * nextScale;
        aimPower.value = Math.min(nextGuide.power / 260, 1);
      },
      [
        aimEndX,
        aimEndY,
        aimPower,
        aimReachX,
        aimReachY,
        aimStartX,
        aimStartY,
        aimVisible,
      ],
    );

    useEffect(() => {
      syncShotGuideVisual(shotGuide, striker, scale);
    }, [scale, shotGuide, striker, syncShotGuideVisual]);

    const registerDiscHandle = useCallback(
      (id: string, handle: CarromSkiaDiscHandle | undefined) => {
        discHandlesRef.current[id] = handle;
      },
      [],
    );

    useImperativeHandle(
      ref,
      () => ({
        syncDiscPositions(nextDiscs, nextScale) {
          nextDiscs.forEach((disc) => {
            discHandlesRef.current[disc.id]?.sync(disc, nextScale);
          });
        },
        setDiscVisibility(nextDiscs) {
          nextDiscs.forEach((disc) => {
            discHandlesRef.current[disc.id]?.setVisibility(disc);
          });
        },
        setMovingMode(nextMovingMode) {
          setMovingMode(nextMovingMode);
        },
        syncShotGuide(nextGuide, nextStriker, nextScale) {
          syncShotGuideVisual(nextGuide, nextStriker, nextScale);
        },
      }),
      [syncShotGuideVisual],
    );

    return (
      <View style={[styles.boardWrap, { height: boardSize, width: boardSize }]}>
        <Canvas style={styles.canvas}>
          <SkiaImage fit="fill" height={boardSize} image={board} width={boardSize} x={0} y={0} />

          {discs.map((disc) => (
            <CarromSkiaDisc
              disc={disc}
              effectsEnabled={effectsEnabled}
              image={pieceImages[disc.kind]}
              key={disc.id}
              moving={movingMode}
              onRegister={registerDiscHandle}
              scale={scale}
            />
          ))}

          {!movingMode ? (
            <CarromSkiaAimLayer
              aimAngle={aimAngle}
              aimAssistEnabled={aimAssistEnabled}
              aimDots={aimDots}
              aimLength={aimLength}
              aimReach={aimReach}
              aimReachX={aimReachX}
              aimReachY={aimReachY}
              baselineY={baselineY}
              boardSize={boardSize}
              guideEndX={aimEndX}
              guideEndY={aimEndY}
              guidePower={aimPower}
              guideStartX={aimStartX}
              guideStartY={aimStartY}
              guideVisible={aimVisible}
              powerPercent={powerPercent}
              powerTone={powerTone}
              scale={scale}
              shotGuide={shotGuide}
              striker={striker}
            />
          ) : null}
        </Canvas>

        {showDebugOverlay ? <CarromDebugOverlay scale={scale} /> : null}
        {children}
        <View style={styles.touchLayer} {...touchHandlers} />
      </View>
    );
  }),
);

type CarromSkiaDiscProps = {
  disc: CarromDisc;
  effectsEnabled: boolean;
  image: ReturnType<typeof useImage>;
  moving: boolean;
  onRegister: (id: string, handle: CarromSkiaDiscHandle | undefined) => void;
  scale: number;
};

function CarromSkiaDisc({
  disc,
  effectsEnabled,
  image,
  moving,
  onRegister,
  scale,
}: CarromSkiaDiscProps) {
  const initial = getDiscLayout(disc, scale);
  const x = useSharedValue(initial.x);
  const y = useSharedValue(initial.y);
  const size = useSharedValue(initial.size);
  const opacity = useSharedValue(disc.pocketed ? 0 : 1);
  const centerX = useDerivedValue(() => x.value + size.value / 2);
  const centerY = useDerivedValue(() => y.value + size.value / 2);
  const discRadius = useDerivedValue(() => size.value / 2);
  const queenHaloRadius = useDerivedValue(() => size.value / 2 + 10);
  const queenRingRadius = useDerivedValue(() => size.value / 2 - 1);
  const lastLayoutRef = useRef<DiscRenderLayout>({
    ...initial,
    opacity: disc.pocketed ? 0 : 1,
  });

  useEffect(() => {
    const handle: CarromSkiaDiscHandle = {
      setVisibility(nextDisc) {
        const nextOpacity = nextDisc.pocketed ? 0 : 1;

        if (lastLayoutRef.current.opacity === nextOpacity) {
          return;
        }

        lastLayoutRef.current = {
          ...lastLayoutRef.current,
          opacity: nextOpacity,
        };
        opacity.value = nextOpacity;
      },
      sync(nextDisc, nextScale) {
        const next = {
          ...getDiscLayout(nextDisc, nextScale),
          opacity: nextDisc.pocketed ? 0 : 1,
        };
        const last = lastLayoutRef.current;

        if (
          last.opacity === next.opacity &&
          last.size === next.size &&
          last.x === next.x &&
          last.y === next.y
        ) {
          return;
        }

        lastLayoutRef.current = next;
        x.value = next.x;
        y.value = next.y;
        size.value = next.size;
        opacity.value = next.opacity;
      },
    };

    onRegister(disc.id, handle);

    return () => onRegister(disc.id, undefined);
  }, [disc.id, onRegister, opacity, size, x, y]);

  useEffect(() => {
    const next = getDiscLayout(disc, scale);

    const nextLayout = {
      ...next,
      opacity: disc.pocketed ? 0 : 1,
    };

    lastLayoutRef.current = nextLayout;
    x.value = nextLayout.x;
    y.value = nextLayout.y;
    size.value = nextLayout.size;
    opacity.value = nextLayout.opacity;
  }, [disc, opacity, scale, size, x, y]);

  return (
    <Group opacity={opacity}>
      {effectsEnabled && !moving && disc.kind === 'queen' ? (
        <Circle
          color="rgba(246,217,145,0.18)"
          cx={centerX}
          cy={centerY}
          r={queenHaloRadius}
        />
      ) : null}
      {image ? (
        <SkiaImage fit="contain" height={size} image={image} width={size} x={x} y={y} />
      ) : (
        <Circle
          color={getFallbackDiscColor(disc)}
          cx={centerX}
          cy={centerY}
          r={discRadius}
        />
      )}
      {disc.kind === 'queen' ? (
        <Circle
          color="rgba(246,217,145,0.82)"
          cx={centerX}
          cy={centerY}
          r={queenRingRadius}
          style="stroke"
          strokeWidth={2}
        />
      ) : null}
    </Group>
  );
}

type CarromSkiaAimLayerProps = Pick<
  CarromSkiaBoardProps,
  | 'aimAngle'
  | 'aimAssistEnabled'
  | 'aimDots'
  | 'aimLength'
  | 'aimReach'
  | 'baselineY'
  | 'boardSize'
  | 'powerPercent'
  | 'powerTone'
  | 'scale'
  | 'shotGuide'
  | 'striker'
> & {
  aimReachX: ReturnType<typeof useSharedValue<number>>;
  aimReachY: ReturnType<typeof useSharedValue<number>>;
  guideEndX: ReturnType<typeof useSharedValue<number>>;
  guideEndY: ReturnType<typeof useSharedValue<number>>;
  guidePower: ReturnType<typeof useSharedValue<number>>;
  guideStartX: ReturnType<typeof useSharedValue<number>>;
  guideStartY: ReturnType<typeof useSharedValue<number>>;
  guideVisible: ReturnType<typeof useSharedValue<number>>;
};

function CarromSkiaAimLayer({
  aimAngle,
  aimAssistEnabled,
  aimDots,
  aimLength,
  aimReach,
  aimReachX,
  aimReachY,
  baselineY,
  boardSize,
  guideEndX,
  guideEndY,
  guidePower,
  guideStartX,
  guideStartY,
  guideVisible,
  powerPercent,
  powerTone,
  scale,
  shotGuide,
  striker,
}: CarromSkiaAimLayerProps) {
  const baseline = baselineY * scale;
  const railStart = CARROM_STRIKER_MIN_X * scale;
  const railEnd = CARROM_STRIKER_MAX_X * scale;
  const auraRadius = useDerivedValue(() => (45 + guidePower.value * 14) * scale);
  const guideStart = useDerivedValue(() => ({ x: guideStartX.value, y: guideStartY.value }));
  const guideEnd = useDerivedValue(() => ({ x: guideEndX.value, y: guideEndY.value }));
  const reachEnd = useDerivedValue(() => ({ x: aimReachX.value, y: aimReachY.value }));
  const powerWidth = useDerivedValue(() => (boardSize - spacing.xl * 2) * guidePower.value);

  return (
    <Group>
      <Line
        color="rgba(246,217,145,0.86)"
        p1={{ x: railStart, y: baseline }}
        p2={{ x: railEnd, y: baseline }}
        strokeWidth={2}
      />
      <Circle color={colors.goldSoft} cx={railStart} cy={baseline} r={4} />
      <Circle color={colors.goldSoft} cx={railEnd} cy={baseline} r={4} />

      <Group opacity={guideVisible}>
          <Circle
            color="rgba(246,217,145,0.38)"
            cx={guideStartX}
            cy={guideStartY}
            r={auraRadius}
          />
          {aimAssistEnabled ? (
            <Line
              color="rgba(255,247,232,0.42)"
              p1={guideStart}
              p2={reachEnd}
              strokeWidth={2}
            />
          ) : null}
          <Line
            color={powerTone}
            p1={guideStart}
            p2={guideEnd}
            strokeWidth={5}
          />
          {aimAssistEnabled
            ? aimDots.map((dot, index) => (
                <Circle
                  color={`rgba(246,217,145,${dot.opacity})`}
                  cx={dot.x * scale}
                  cy={dot.y * scale}
                  key={`aim-dot-${index}`}
                  r={3}
                />
              ))
            : null}
          <Circle color={powerTone} cx={guideEndX} cy={guideEndY} r={7} />
          <Circle color="rgba(255,255,255,0.92)" cx={guideEndX} cy={guideEndY} r={2} />
          <Rect
            color="rgba(8,5,15,0.58)"
            height={10}
            width={boardSize - spacing.xl * 2}
            x={spacing.xl}
            y={boardSize - spacing.md - 10}
          />
          <Rect
            color={powerTone}
            height={10}
            width={powerWidth}
            x={spacing.xl}
            y={boardSize - spacing.md - 10}
          />
        </Group>
    </Group>
  );
}

function getDiscLayout(disc: CarromDisc, scale: number) {
  const size = disc.radius * 2 * scale;

  return {
    size,
    x: disc.x * scale - size / 2,
    y: disc.y * scale - size / 2,
  };
}

function getFallbackDiscColor(disc: CarromDisc) {
  if (disc.kind === 'black') {
    return '#101014';
  }

  if (disc.kind === 'striker') {
    return '#F6E8CF';
  }

  return '#D52F58';
}

const styles = StyleSheet.create({
  boardWrap: {
    alignSelf: 'center',
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  canvas: {
    height: '100%',
    position: 'absolute',
    width: '100%',
  },
  touchLayer: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 30,
  },
});

function getAimReachToRail(x: number, y: number, angle: number) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const distances = [
    dx > 0 ? (850 - x) / dx : (150 - x) / dx,
    dy > 0 ? (770 - y) / dy : (128 - y) / dy,
  ].filter((distance) => Number.isFinite(distance) && distance > 0);

  return Math.max(0, Math.min(...distances));
}
