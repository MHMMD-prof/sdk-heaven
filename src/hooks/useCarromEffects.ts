import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';

import { PocketSparkle, TurnBanner } from '../components/CarromBoardOverlays';
import { CarromGameState, CarromPlayer } from '../types/carrom';

type UseCarromEffectsOptions = {
  effectsEnabled: boolean;
  gameStatus: CarromGameState['status'];
};

export function useCarromEffects({ effectsEnabled, gameStatus }: UseCarromEffectsOptions) {
  const [pocketSparkles, setPocketSparkles] = useState<PocketSparkle[]>([]);
  const [turnBanner, setTurnBanner] = useState<TurnBanner | undefined>();
  const winProgress = useRef(new Animated.Value(0)).current;
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const showPocketSparkles = useCallback(
    (sparkles: Array<Omit<PocketSparkle, 'progress'>>) => {
      if (!effectsEnabled || sparkles.length === 0) {
        return;
      }

      const nextSparkles: PocketSparkle[] = new Array(sparkles.length);

      for (let index = 0; index < sparkles.length; index += 1) {
        const sparkle = sparkles[index]!;
        nextSparkles[index] = {
          ...sparkle,
          id: `${sparkle.id}-${Date.now()}`,
          progress: new Animated.Value(0),
        };
      }

      setPocketSparkles((current) => {
        const mergedSparkles: PocketSparkle[] = new Array(current.length + nextSparkles.length);

        for (let index = 0; index < current.length; index += 1) {
          mergedSparkles[index] = current[index]!;
        }

        for (let index = 0; index < nextSparkles.length; index += 1) {
          mergedSparkles[current.length + index] = nextSparkles[index]!;
        }

        return mergedSparkles;
      });

      for (const sparkle of nextSparkles) {
        Animated.timing(sparkle.progress, {
          duration: 720,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }).start(() => {
          if (!mountedRef.current) {
            return;
          }

          setPocketSparkles((current) => {
            let sparkleIndex = -1;

            for (let index = 0; index < current.length; index += 1) {
              if (current[index]?.id === sparkle.id) {
                sparkleIndex = index;
                break;
              }
            }

            if (sparkleIndex < 0) {
              return current;
            }

            const remainingSparkles: PocketSparkle[] = new Array(current.length - 1);

            for (let index = 0; index < sparkleIndex; index += 1) {
              remainingSparkles[index] = current[index]!;
            }

            for (let index = sparkleIndex + 1; index < current.length; index += 1) {
              remainingSparkles[index - 1] = current[index]!;
            }

            return remainingSparkles;
          });
        });
      }
    },
    [effectsEnabled],
  );

  const showTurnBanner = useCallback(
    (player: CarromPlayer) => {
      if (!effectsEnabled) {
        return;
      }

      const nextBanner = {
        id: `${player}-${Date.now()}`,
        player,
        progress: new Animated.Value(0),
      };

      setTurnBanner(nextBanner);
      Animated.sequence([
        Animated.timing(nextBanner.progress, {
          duration: 180,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.delay(780),
        Animated.timing(nextBanner.progress, {
          duration: 220,
          easing: Easing.in(Easing.cubic),
          toValue: 0,
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (!mountedRef.current) {
        return;
      }

      setTurnBanner((current) => (current?.id === nextBanner.id ? undefined : current));
    });
    },
    [effectsEnabled],
  );

  useEffect(() => {
    if (gameStatus === 'gameOver') {
      winProgress.setValue(0);
      if (!effectsEnabled) {
        winProgress.setValue(1);
        return;
      }

      Animated.spring(winProgress, {
        damping: 11,
        mass: 0.9,
        stiffness: 90,
        toValue: 1,
        useNativeDriver: true,
      }).start();
    } else {
      winProgress.setValue(0);
    }
  }, [effectsEnabled, gameStatus, winProgress]);

  return {
    pocketSparkles,
    showPocketSparkles,
    showTurnBanner,
    turnBanner,
    winProgress,
  };
}
