import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';

export function HomeHeader() {
  return (
    <View style={styles.header}>
      <View style={styles.appBar}>
        <View style={styles.infoButton}>
          <Text style={styles.infoText}>i</Text>
        </View>
        <View style={styles.titleBlock}>
          <Text style={styles.kicker}>سكاي رويال</Text>
          <Text style={styles.title}>الرئيسية</Text>
        </View>
        <View style={styles.vipBadge}>
          <Text style={styles.vipText}>VIP</Text>
        </View>
      </View>

      <LinearGradient
        colors={['rgba(255,255,255,0.085)', 'rgba(232,190,97,0.10)', 'rgba(124,58,237,0.08)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.statsRail}
      >
        <View style={styles.statItem}>
          <Text style={styles.statValue}>ذهبي</Text>
          <Text style={styles.statLabel}>المستوى</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>Live</Text>
          <Text style={styles.statLabel}>الصوت</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>جاهز</Text>
          <Text style={styles.statLabel}>الحالة</Text>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.md,
  },
  appBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  titleBlock: {
    flex: 1,
  },
  kicker: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: typography.weights.black,
    lineHeight: 32,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  vipBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(232,190,97,0.12)',
    borderColor: colors.borderGold,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 46,
    justifyContent: 'center',
    marginLeft: spacing.md,
    width: 46,
  },
  vipText: {
    color: colors.goldSoft,
    fontSize: 12,
    fontWeight: typography.weights.black,
  },
  infoButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  infoText: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: typography.weights.black,
  },
  statsRail: {
    alignItems: 'center',
    borderColor: 'rgba(232,190,97,0.20)',
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 68,
    paddingHorizontal: spacing.md,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  statLabel: {
    color: colors.textSubtle,
    fontSize: 11,
    marginTop: 3,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  divider: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    height: 30,
    width: 1,
  },
});
