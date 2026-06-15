import {
  Image,
  ImageSourcePropType,
  ImageStyle,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';

import { colors, radius } from '../theme';

type ShipSpriteFrameProps = {
  image: ImageSourcePropType;
  imageStyle: StyleProp<ImageStyle>;
  isDarkened?: boolean;
  isExploding?: boolean;
  style: StyleProp<ViewStyle>;
};

export function ShipSpriteFrame({
  image,
  imageStyle,
  isDarkened = false,
  isExploding = false,
  style,
}: ShipSpriteFrameProps) {
  return (
    <View pointerEvents="none" style={[styles.shipFrame, style]}>
      <Image resizeMode="stretch" source={image} style={[styles.shipImage, imageStyle]} />
      {isDarkened ? <View style={styles.shipDarkOverlay} /> : null}
      {isExploding ? (
        <View style={styles.explosionLayer}>
          <View style={[styles.explosionBurst, styles.explosionBurstTop]} />
          <View style={[styles.explosionBurst, styles.explosionBurstMid]} />
          <View style={[styles.explosionBurst, styles.explosionBurstBottom]} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shipFrame: {
    borderRadius: radius.sm,
    overflow: 'hidden',
    position: 'absolute',
    shadowColor: colors.shadow,
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 5,
    zIndex: 2,
  },
  shipImage: {
    position: 'absolute',
  },
  shipDarkOverlay: {
    backgroundColor: 'rgba(0,0,0,0.34)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  explosionLayer: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  explosionBurst: {
    backgroundColor: 'rgba(255, 207, 89, 0.88)',
    borderColor: 'rgba(255,255,255,0.7)',
    borderRadius: radius.full,
    borderWidth: 2,
    height: 28,
    position: 'absolute',
    shadowColor: colors.gold,
    shadowOffset: { height: 0, width: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 12,
    width: 28,
  },
  explosionBurstTop: {
    left: '20%',
    top: '16%',
  },
  explosionBurstMid: {
    height: 36,
    left: '48%',
    top: '38%',
    width: 36,
  },
  explosionBurstBottom: {
    bottom: '14%',
    right: '18%',
  },
});
