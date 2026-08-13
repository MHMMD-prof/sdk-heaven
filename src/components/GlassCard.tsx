import { PropsWithChildren } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle, type ViewProps } from 'react-native';

import { colors, radius, spacing } from '../theme';

type GlassCardProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
}> & Pick<ViewProps, 'testID'>;

export function GlassCard({ children, style, testID }: GlassCardProps) {
  return <View style={[styles.card, style]} testID={testID}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.35,
    shadowRadius: 26,
    elevation: 10,
  },
});
