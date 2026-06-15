import { StyleSheet, Text, View } from 'react-native';

import {
  CARROM_BOTTOM_BASELINE_Y,
  CARROM_EDGE_BOTTOM,
  CARROM_EDGE_LEFT,
  CARROM_EDGE_RIGHT,
  CARROM_EDGE_TOP,
  CARROM_POCKET_RADIUS,
  CARROM_POCKETS,
  CARROM_TOP_BASELINE_Y,
} from '../utils/carromEngine';

type CarromDebugOverlayProps = {
  scale: number;
};

export function CarromDebugOverlay({ scale }: CarromDebugOverlayProps) {
  const edgeLeft = CARROM_EDGE_LEFT * scale;
  const edgeTop = CARROM_EDGE_TOP * scale;
  const edgeWidth = (CARROM_EDGE_RIGHT - CARROM_EDGE_LEFT) * scale;
  const edgeHeight = (CARROM_EDGE_BOTTOM - CARROM_EDGE_TOP) * scale;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={[
          styles.bounds,
          {
            height: edgeHeight,
            left: edgeLeft,
            top: edgeTop,
            width: edgeWidth,
          },
        ]}
      />

      <View
        style={[
          styles.baseline,
          {
            left: edgeLeft,
            top: CARROM_TOP_BASELINE_Y * scale,
            width: edgeWidth,
          },
        ]}
      />
      <View
        style={[
          styles.baseline,
          {
            left: edgeLeft,
            top: CARROM_BOTTOM_BASELINE_Y * scale,
            width: edgeWidth,
          },
        ]}
      />

      {CARROM_POCKETS.map((pocket, index) => {
        const size = CARROM_POCKET_RADIUS * 2 * scale;

        return (
          <View
            key={`${pocket.x}-${pocket.y}`}
            style={[
              styles.pocket,
              {
                height: size,
                left: pocket.x * scale - size / 2,
                top: pocket.y * scale - size / 2,
                width: size,
              },
            ]}
          >
            <Text style={styles.pocketLabel}>{index + 1}</Text>
          </View>
        );
      })}

      <Text style={[styles.label, { left: edgeLeft + 4, top: edgeTop + 4 }]}>
        bounds
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bounds: {
    borderColor: 'rgba(0, 255, 140, 0.95)',
    borderWidth: 2,
    position: 'absolute',
  },
  baseline: {
    backgroundColor: 'rgba(80, 180, 255, 0.95)',
    height: 2,
    position: 'absolute',
  },
  pocket: {
    alignItems: 'center',
    borderColor: 'rgba(255, 50, 80, 0.95)',
    borderRadius: 999,
    borderWidth: 2,
    justifyContent: 'center',
    position: 'absolute',
  },
  pocketLabel: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
  label: {
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 4,
    position: 'absolute',
  },
});
