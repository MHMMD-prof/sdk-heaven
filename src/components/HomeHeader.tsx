import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { colors, radius, spacing, typography } from '../theme';

export function HomeHeader() {
  const { authUser, signOut } = useAuth();

  return (
    <View style={styles.header}>
      <View style={styles.appBar}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void signOut();
          }}
          style={({ pressed }) => [styles.signOutButton, pressed && styles.pressed]}
        >
          <Text style={styles.signOutText}>خروج</Text>
        </Pressable>
        <View style={styles.titleBlock}>
          <Text numberOfLines={1} style={styles.kicker}>
            {authUser?.displayName ?? 'سكاي رويال'}
          </Text>
          <Text style={styles.title}>الرئيسية</Text>
        </View>
        <View style={styles.vipBadge}>
          <Text style={styles.vipText}>{authUser?.avatarLabel ?? 'VIP'}</Text>
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
  signOutButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  signOutText: {
    color: colors.textMuted,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
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
