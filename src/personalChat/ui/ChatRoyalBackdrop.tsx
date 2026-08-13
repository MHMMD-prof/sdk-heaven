import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

import { chatColors } from './chatTheme';

export function ChatRoyalBackdrop() {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={[chatColors.royalRedSoft, chatColors.canvasRaised, chatColors.canvas]}
        locations={[0, 0.34, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.goldAtmosphere} />
    </View>
  );
}

const styles = StyleSheet.create({
  goldAtmosphere: {
    alignSelf: 'center',
    backgroundColor: chatColors.gold,
    borderRadius: 180,
    height: 180,
    opacity: 0.035,
    top: -112,
    width: 360,
  },
});
