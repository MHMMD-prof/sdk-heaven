import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';

type DrawingGuessConnectionBannerProps = {
  label: string;
};

export function DrawingGuessConnectionBanner({ label }: DrawingGuessConnectionBannerProps) {
  return (
    <View style={styles.banner}>
      <View style={styles.dot} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'center',
    backgroundColor: 'rgba(43,203,136,0.12)',
    borderColor: 'rgba(43,203,136,0.35)',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    marginBottom: spacing.md,
    padding: spacing.sm,
  },
  dot: {
    backgroundColor: colors.emerald,
    borderRadius: radius.full,
    height: 8,
    width: 8,
  },
  text: {
    color: colors.emerald,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
  },
});
