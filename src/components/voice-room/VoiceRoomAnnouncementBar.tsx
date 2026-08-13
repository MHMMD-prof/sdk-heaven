import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, Text, View } from 'react-native';

import { layers, radius, typography } from '../../theme';

export function VoiceRoomAnnouncementBar({
  connected,
  statusLabel,
  text,
}: {
  connected: boolean;
  statusLabel: string;
  text: string;
}) {
  return (
    <LinearGradient
      accessibilityLabel={`إعلان الغرفة: ${text}. الحالة: ${statusLabel}`}
      accessibilityRole="summary"
      colors={['rgba(18,7,8,0.94)', 'rgba(48,10,14,0.90)', 'rgba(18,7,8,0.94)']}
      end={{ x: 0, y: 0.5 }}
      start={{ x: 1, y: 0.5 }}
      style={styles.root}
    >
      <View pointerEvents="none" style={[styles.finial, styles.finialStart]} />
      <View pointerEvents="none" style={[styles.finial, styles.finialEnd]} />
      <View style={styles.iconWell}>
        <SymbolView
          name={{ ios: 'megaphone.fill', android: 'campaign', web: 'campaign' }}
          size={13}
          tintColor="#F4D58A"
        />
      </View>
      <Text maxFontSizeMultiplier={1.25} numberOfLines={1} style={styles.text}>{text}</Text>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.status}>
        <View style={[styles.statusDot, !connected && styles.statusDotOffline]} />
        <Text numberOfLines={1} style={styles.statusText}>{statusLabel}</Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    borderColor: 'rgba(230, 184, 94, 0.46)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: 8,
    marginTop: 7,
    minHeight: 38,
    overflow: 'visible',
    paddingHorizontal: 12,
    paddingVertical: 6,
    zIndex: layers.roomSafety,
  },
  finial: {
    backgroundColor: '#B98335',
    borderColor: '#F4D58A',
    borderRadius: 2,
    borderWidth: 1,
    height: 8,
    position: 'absolute',
    top: 14,
    transform: [{ rotate: '45deg' }],
    width: 8,
  },
  finialStart: { right: -4 },
  finialEnd: { left: -4 },
  iconWell: {
    alignItems: 'center',
    backgroundColor: 'rgba(214,168,79,0.12)',
    borderRadius: radius.full,
    height: 25,
    justifyContent: 'center',
    width: 25,
  },
  text: {
    color: '#FFF4DE',
    flex: 1,
    fontSize: 11,
    fontWeight: typography.weights.bold,
    minWidth: 0,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  status: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    maxWidth: 74,
  },
  statusDot: {
    backgroundColor: '#2BCB88',
    borderRadius: radius.full,
    height: 5,
    width: 5,
  },
  statusDotOffline: { backgroundColor: '#D12D45' },
  statusText: {
    color: '#CDBB9D',
    flexShrink: 1,
    fontSize: 8,
    writingDirection: 'rtl',
  },
});
