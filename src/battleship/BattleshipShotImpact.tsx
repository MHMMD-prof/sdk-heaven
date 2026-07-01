import { Animated, View } from 'react-native';

import { boardStyles as styles } from './BattleshipBoardStyles';
import { BoardPosition, ShotAnimation, ShotAnimationValues } from './BattleshipBoardTypes';

type BattleshipShotImpactProps = {
  animation?: ShotAnimation;
  cellGap: number;
  cellSize: number;
  position?: BoardPosition;
  values: ShotAnimationValues;
};

export function BattleshipShotImpact({
  animation,
  cellGap,
  cellSize,
  position,
  values,
}: BattleshipShotImpactProps) {
  if (!animation || !position) {
    return null;
  }

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.shotImpact,
        animation.result === 'hit' ? styles.shotImpactHit : styles.shotImpactMiss,
        {
          left: position.column * (cellSize + cellGap) + cellSize / 2 - 25,
          opacity: values.opacity,
          top: position.row * (cellSize + cellGap) + cellSize / 2 - 25,
          transform: [{ translateY: values.translateY }, { scale: values.scale }],
        },
      ]}
    >
      <View style={styles.shotCore} />
    </Animated.View>
  );
}
