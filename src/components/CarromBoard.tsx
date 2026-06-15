import { forwardRef, memo, ReactNode, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Animated, Image, ImageSourcePropType, StyleSheet, View, ViewProps } from 'react-native';

import { CarromDisc } from '../types/carrom';
import { CarromPieceSprite } from './CarromPieceSprite';
import { CarromDebugOverlay } from './CarromDebugOverlay';
import { colors, radius } from '../theme';

export type CarromBoardHandle = {
  syncDiscPositions: (discs: CarromDisc[], scale: number) => void;
  setDiscVisibility: (discs: CarromDisc[]) => void;
  setMovingMode: (isMoving: boolean) => void;
};

type CarromBoardProps = {
  boardImage: ImageSourcePropType;
  boardSize: number;
  children?: ReactNode;
  discs: CarromDisc[];
  effectsEnabled: boolean;
  isMoving: boolean;
  queenPulse: Animated.Value;
  scale: number;
  showDebugOverlay: boolean;
  touchHandlers: ViewProps;
};

export const CarromBoard = memo(
  forwardRef<CarromBoardHandle, CarromBoardProps>(function CarromBoard(
    {
      boardImage,
      boardSize,
      children,
      discs,
      effectsEnabled,
      isMoving,
      queenPulse,
      scale,
      showDebugOverlay,
      touchHandlers,
    },
    ref,
  ) {
    const discRefs = useRef<Record<string, View | null>>({});
    const [movingMode, setMovingMode] = useState(isMoving);

    useEffect(() => {
      setMovingMode(isMoving);
    }, [isMoving]);

    useImperativeHandle(
      ref,
      () => ({
        syncDiscPositions(nextDiscs, nextScale) {
          nextDiscs.forEach((disc) => {
            const node = discRefs.current[disc.id];

            if (!node) {
              return;
            }

            const size = disc.radius * 2 * nextScale;

            node.setNativeProps({
              style: {
                opacity: disc.pocketed ? 0 : 1,
                transform: [
                  { translateX: disc.x * nextScale - size / 2 },
                  { translateY: disc.y * nextScale - size / 2 },
                ],
              },
            });
          });
        },
        setDiscVisibility(nextDiscs) {
          nextDiscs.forEach((disc) => {
            discRefs.current[disc.id]?.setNativeProps({
              style: {
                opacity: disc.pocketed ? 0 : 1,
              },
            });
          });
        },
        setMovingMode(nextMovingMode) {
          setMovingMode(nextMovingMode);
        },
      }),
      [],
    );

    return (
      <View style={[styles.boardWrap, { height: boardSize, width: boardSize }]}>
        <Image source={boardImage} style={styles.boardImage} />
        {showDebugOverlay ? <CarromDebugOverlay scale={scale} /> : null}
        {children}

        <View style={styles.touchLayer} {...touchHandlers}>
          {discs.map((disc) => {
            const size = disc.radius * 2 * scale;

            return (
              <View
                key={disc.id}
                pointerEvents="none"
                ref={(node) => {
                  discRefs.current[disc.id] = node;
                }}
                style={[
                  styles.disc,
                  {
                    height: size,
                    opacity: disc.pocketed ? 0 : 1,
                    transform: [
                      { translateX: disc.x * scale - size / 2 },
                      { translateY: disc.y * scale - size / 2 },
                    ],
                    width: size,
                  },
                  !movingMode && disc.kind === 'striker' && styles.strikerShadow,
                ]}
              >
                {effectsEnabled && !movingMode && disc.kind === 'queen' ? (
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.queenHalo,
                      {
                        borderRadius: size / 2 + 10,
                        height: size + 20,
                        opacity: queenPulse.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.28, 0.76],
                        }),
                        transform: [
                          {
                            scale: queenPulse.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0.95, 1.18],
                            }),
                          },
                        ],
                        width: size + 20,
                      },
                    ]}
                  />
                ) : null}
                <CarromPieceSprite kind={disc.kind} moving={movingMode} size={size} />
              </View>
            );
          })}
        </View>
      </View>
    );
  }),
);

const styles = StyleSheet.create({
  boardImage: {
    height: '100%',
    position: 'absolute',
    width: '100%',
  },
  boardWrap: {
    alignSelf: 'center',
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  disc: {
    position: 'absolute',
  },
  queenHalo: {
    backgroundColor: 'rgba(246,217,145,0.16)',
    borderColor: 'rgba(246,217,145,0.82)',
    borderWidth: 2,
    left: -10,
    position: 'absolute',
    top: -10,
  },
  strikerShadow: {
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
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
