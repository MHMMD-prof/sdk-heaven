import { Animated, ImageSourcePropType, ImageStyle, StyleProp, ViewStyle } from 'react-native';

export type ShipFrame = {
  id: string;
  image: ImageSourcePropType;
  imageStyle: StyleProp<ImageStyle>;
  isDarkened: boolean;
  isExploding: boolean;
  style: StyleProp<ViewStyle>;
};

export type ShipVisual = {
  image: ImageSourcePropType;
  imageStyle: StyleProp<ImageStyle>;
};

export type ShotAnimation = {
  result: 'hit' | 'miss';
};

export type BoardPosition = {
  column: number;
  row: number;
};

export type ShotAnimationValues = {
  opacity: Animated.AnimatedInterpolation<string | number>;
  scale: Animated.AnimatedInterpolation<string | number>;
  translateY: Animated.AnimatedInterpolation<string | number>;
};
