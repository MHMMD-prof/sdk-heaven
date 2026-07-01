import { Image } from 'react-native';
import Animated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { boardStyles as styles } from './BattleshipBoardStyles';
import { ShipVisual } from './BattleshipBoardTypes';

type BattleshipPlacementGhostProps = {
  dragVisible: SharedValue<number>;
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
  height: number;
  isSetupPhase: boolean;
  isValid: boolean;
  visual?: ShipVisual;
  width: number;
};

export function BattleshipPlacementGhost({
  dragVisible,
  dragX,
  dragY,
  height,
  isSetupPhase,
  isValid,
  visual,
  width,
}: BattleshipPlacementGhostProps) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: dragVisible.value ? (isValid ? 0.82 : 0.56) : 0,
    transform: [
      { translateX: dragX.value - width / 2 },
      { translateY: dragY.value - height / 2 },
    ],
  }));

  if (!isSetupPhase || !visual) {
    return null;
  }

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.dragGhost,
        isValid ? styles.dragGhostValid : styles.dragGhostInvalid,
        {
          height,
          width,
        },
        animatedStyle,
      ]}
    >
      <Image resizeMode="stretch" source={visual.image} style={[styles.shipImage, visual.imageStyle]} />
    </Animated.View>
  );
}
