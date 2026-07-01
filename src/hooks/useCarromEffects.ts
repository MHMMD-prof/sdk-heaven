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
  const queenPulse = useRef(new Animated.Value(0)).current;
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
      if (!effectsEnabled) {
        return;
      }

      const nextSparkles = sparkles.map((sparkle) => ({
        ...sparkle,
        id: `${sparkle.id}-${Date.now()}`,
        progress: new Animated.Value(0),
      }));

      setPocketSparkles((current) => [...current, ...nextSparkles]);

      nextSparkles.forEach((sparkle) => {
        Animated.timing(sparkle.progress, {
          duration: 720,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }).start(() => {
          if (!mountedRef.current) {
            return;
          }

          setPocketSparkles((current) => current.filter((item) => item.id !== sparkle.id));
        });
      });
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

  const resetEffects = useCallback(() => {
    setPocketSparkles([]);
    setTurnBanner(undefined);
    queenPulse.setValue(0);
    winProgress.setValue(0);
  }, [queenPulse, winProgress]);

  useEffect(() => {
    if (!effectsEnabled || gameStatus === 'moving') {
      queenPulse.setValue(0);
      return undefined;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(queenPulse, {
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(queenPulse, {
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();

    return () => loop.stop();
  }, [effectsEnabled, gameStatus, queenPulse]);

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
    queenPulse,
    resetEffects,
    showPocketSparkles,
    showTurnBanner,
    turnBanner,
    winProgress,
  };
}
