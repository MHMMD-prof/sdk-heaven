import { StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';

type LuxuryInputProps = TextInputProps & {
  label: string;
};

export function LuxuryInput({ label, ...props }: LuxuryInputProps) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textSubtle}
        selectionColor={colors.gold}
        style={styles.input}
        textAlign="right"
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.sm,
  },
  label: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  input: {
    minHeight: 54,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderGold,
    backgroundColor: colors.input,
    color: colors.text,
    fontSize: typography.sizes.body,
    paddingHorizontal: spacing.lg,
    writingDirection: 'rtl',
  },
});
