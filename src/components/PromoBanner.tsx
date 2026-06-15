import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';

export function PromoBanner() {
  return (
    <LinearGradient
      colors={['rgba(232,190,97,0.16)', 'rgba(124,58,237,0.13)', 'rgba(255,255,255,0.055)']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.banner}
    >
      <View style={styles.token}>
        <Text style={styles.tokenText}>♕</Text>
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>تجربة الصوت أصبحت مباشرة</Text>
        <Text style={styles.body}>ادخل إلى المجموعات لاختبار مجالس LiveKit على الهاتف.</Text>
      </View>
      <View style={styles.timePill}>
        <Text style={styles.timeText}>Live</Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'center',
    borderColor: 'rgba(232,190,97,0.24)',
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
    minHeight: 82,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  token: {
    alignItems: 'center',
    backgroundColor: 'rgba(8,5,15,0.44)',
    borderColor: colors.borderGold,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  tokenText: {
    color: colors.goldSoft,
    fontSize: 23,
  },
  copy: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  body: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 2,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  timePill: {
    backgroundColor: 'rgba(8,5,15,0.38)',
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  timeText: {
    color: colors.goldSoft,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
  },
});
