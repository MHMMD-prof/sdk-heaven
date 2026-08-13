import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { compactStatusBadges, type StatusPresentation } from '../../status/statusPresentation';

export function StatusBadgeRow({ compact = false, presentation, style }: { compact?: boolean; presentation?: StatusPresentation; style?: StyleProp<ViewStyle> }) {
  const badges = compactStatusBadges(presentation);
  if (!badges.length) return null;
  return (
    <View accessibilityRole="summary" style={[styles.row, style]}>
      {badges.map((badge) => (
        <View accessibilityLabel={badge.accessibilityLabel} key={badge.kind} style={[styles.badge, compact && styles.badgeCompact, { borderColor: badge.accentColor }]}>
          {!compact ? <View style={[styles.signal, { backgroundColor: badge.accentColor }]} /> : null}
          <Text maxFontSizeMultiplier={1.5} numberOfLines={1} style={[styles.label, compact && styles.labelCompact, { color: badge.accentColor }]}>{badge.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', backgroundColor: 'rgba(8,3,4,0.76)', borderRadius: 999, borderWidth: 1, flexDirection: 'row-reverse', gap: 5, minHeight: 24, paddingHorizontal: 8, paddingVertical: 2 },
  badgeCompact: { minHeight: 14, paddingHorizontal: 4, paddingVertical: 0 },
  label: { fontSize: 10, fontWeight: '800', writingDirection: 'rtl' },
  labelCompact: { fontSize: 7 },
  row: { alignItems: 'center', flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 5 },
  signal: { borderRadius: 4, height: 6, transform: [{ rotate: '45deg' }], width: 6 },
});
