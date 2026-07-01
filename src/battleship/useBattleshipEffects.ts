import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

import { ShotAnimation } from './BattleshipGameTypes';

type UseBattleshipEffectsOptions = {
  isGameOver: boolean;
  notifySuccess: () => void;
  notifyWarning: () => void;
  playVictorySound: () => void;
  playerOneGuesses: Set<string>;
  playerTwoGuesses: Set<string>;
  setDarkenedShipIds: (updater: (currentIds: Set<string>) => Set<string>) => void;
  setExplodingShipIds: (updater: (currentIds: Set<string>) => Set<string>) => void;
  setShotAnimation: (shotAnimation: ShotAnimation | undefined) => void;
  shotAnimation?: ShotAnimation;
  shotAnimationValue: Animated.Value;
  winner?: 1 | 2;
};

export function useBattleshipEffects({
  isGameOver,
  notifySuccess,
  notifyWarning,
  playVictorySound,
  playerOneGuesses,
  playerTwoGuesses,
  setDarkenedShipIds,
  setExplodingShipIds,
  setShotAnimation,
  shotAnimation,
  shotAnimationValue,
  winner,
}: UseBattleshipEffectsOptions) {
  const explosionTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const shotTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const victoryFeedbackKey = useRef<string | undefined>(undefined);

  useEffect(
    () => () => {
      explosionTimers.current.forEach((timer) => clearTimeout(timer));
      shotTimers.current.forEach((timer) => clearTimeout(timer));
    },
    [],
  );

  useEffect(() => {
    if (!shotAnimation) {
      return;
    }

    shotAnimationValue.setValue(0);
    Animated.sequence([
      Animated.timing(shotAnimationValue, {
        duration: 260,
        toValue: 0.7,
        useNativeDriver: true,
      }),
      Animated.timing(shotAnimationValue, {
        duration: 220,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setShotAnimation(undefined);
    });
  }, [setShotAnimation, shotAnimation, shotAnimationValue]);

  useEffect(() => {
    if (!isGameOver) {
      victoryFeedbackKey.current = undefined;
      return;
    }

    const feedbackKey = `${winner ?? 'draw'}-${playerOneGuesses.size}-${playerTwoGuesses.size}`;

    if (victoryFeedbackKey.current === feedbackKey) {
      return;
    }

    victoryFeedbackKey.current = feedbackKey;
    playVictorySound();
    if (winner) {
      notifySuccess();
    } else {
      notifyWarning();
    }
  });

  const clearSunkEffects = () => {
    explosionTimers.current.forEach((timer) => clearTimeout(timer));
    explosionTimers.current = [];
    setExplodingShipIds(() => new Set());
    setDarkenedShipIds(() => new Set());
  };

  const clearShotAnimation = () => {
    shotTimers.current.forEach((timer) => clearTimeout(timer));
    shotTimers.current = [];
    setShotAnimation(undefined);
    shotAnimationValue.setValue(0);
  };

  const triggerSunkEffect = (effectKey: string, onTrigger: () => void) => {
    onTrigger();

    setExplodingShipIds((currentIds) => {
      if (currentIds.has(effectKey)) {
        return currentIds;
      }

      return new Set(currentIds).add(effectKey);
    });

    const timer = setTimeout(() => {
      setExplodingShipIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(effectKey);
        return nextIds;
      });
      setDarkenedShipIds((currentIds) => new Set(currentIds).add(effectKey));
    }, 1200);

    explosionTimers.current.push(timer);
  };

  const scheduleShotResolution = (onResolve: () => void) => {
    const timer = setTimeout(onResolve, 500);
    shotTimers.current.push(timer);
  };

  return {
    clearShotAnimation,
    clearSunkEffects,
    scheduleShotResolution,
    triggerSunkEffect,
  };
}
