import { Image, StyleSheet, Text, View } from 'react-native';

import { CarromDiscKind } from '../types/carrom';

const pieceImages: Record<CarromDiscKind, number> = {
  white: require('../../assets/carrom/piece-red.png'),
  black: require('../../assets/carrom/piece-black.png'),
  queen: require('../../assets/carrom/piece-red.png'),
  striker: require('../../assets/carrom/piece-striker.png'),
};

type CarromPieceSpriteProps = {
  kind: CarromDiscKind;
  moving?: boolean;
  size: number;
};

export function CarromPieceSprite({ kind, moving = false, size }: CarromPieceSpriteProps) {
  if (kind === 'queen') {
    return (
      <View
        style={[
          styles.queenWrap,
          moving && styles.movingPiece,
          {
            borderRadius: size / 2,
            height: size,
            width: size,
          },
        ]}
      >
        <Image
          resizeMode="contain"
          source={pieceImages.queen}
          style={[
            styles.piece,
            styles.queenPiece,
            moving && styles.movingPiece,
            {
              height: size,
              width: size,
            },
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.queenRing,
            {
              borderRadius: size / 2,
            },
          ]}
        />
        <Text
          pointerEvents="none"
          style={[
            styles.queenMark,
            {
              fontSize: Math.max(8, size * 0.28),
              lineHeight: Math.max(10, size * 0.32),
            },
          ]}
        >
          Q
        </Text>
      </View>
    );
  }

  return (
    <Image
      resizeMode="contain"
      source={pieceImages[kind] ?? pieceImages.striker}
      style={[
        styles.piece,
        kind === 'white' && styles.whitePiece,
        moving && styles.movingPiece,
        {
          height: size,
          width: size,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  piece: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
  },
  movingPiece: {
    shadowOpacity: 0,
    shadowRadius: 0,
  },
  queenPiece: {
    tintColor: '#D52F58',
  },
  queenMark: {
    color: '#FFF7E8',
    fontWeight: '900',
    position: 'absolute',
    textAlign: 'center',
  },
  queenRing: {
    borderColor: '#F6D991',
    borderWidth: 2,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  queenWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#E8BE61',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
  },
  whitePiece: {
    tintColor: '#F6E8CF',
  },
});
