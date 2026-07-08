import { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '../components/GlassCard';
import { HomeHeader } from '../components/HomeHeader';
import { PromoBanner } from '../components/PromoBanner';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';

type HomeScreenProps = {
  bottomNavigation: ReactNode;
  onOpenAccountSettings: () => void;
  onOpenGames: () => void;
  onOpenGroups: () => void;
};

export function HomeScreen({ bottomNavigation, onOpenAccountSettings, onOpenGames, onOpenGroups }: HomeScreenProps) {
  return (
    <ScreenContainer bottomInset fixedBottom={bottomNavigation}>
      <HomeHeader onOpenAccountSettings={onOpenAccountSettings} />
      <PromoBanner />

      <View style={styles.quickGrid}>
        <DashboardCard
          accent="gold"
          body="كتالوج الألعاب والتجارب النشطة لهذا الشهر."
          label="الألعاب"
          onPress={onOpenGames}
          stat="4"
          title="ادخل إلى الطاولات"
        />
        <DashboardCard
          accent="emerald"
          body="مجالس صوتية مباشرة للمحادثة واللعب مع الآخرين."
          label="المجموعات"
          onPress={onOpenGroups}
          stat="Live"
          title="انضم إلى مجلس"
        />
      </View>

      <GlassCard style={styles.statusCard}>
        <View style={styles.statusHeader}>
          <Text style={styles.statusBadge}>جاهز</Text>
          <Text style={styles.statusTitle}>مركز اللعب الاجتماعي</Text>
        </View>
        <Text style={styles.statusBody}>
          تم فصل الألعاب والمجموعات لتصبح التجربة أوضح: اختر اللعبة من تبويب الألعاب، أو ادخل
          إلى المجالس من تبويب المجموعات.
        </Text>
      </GlassCard>
    </ScreenContainer>
  );
}

type DashboardCardProps = {
  accent: 'gold' | 'emerald';
  body: string;
  label: string;
  onPress: () => void;
  stat: string;
  title: string;
};

function DashboardCard({ accent, body, label, onPress, stat, title }: DashboardCardProps) {
  const isGold = accent === 'gold';

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.dashboardCard, pressed && styles.pressed]}>
      <View style={[styles.metric, isGold ? styles.goldMetric : styles.emeraldMetric]}>
        <Text style={[styles.metricText, isGold ? styles.goldText : styles.emeraldText]}>{stat}</Text>
      </View>
      <Text style={styles.cardLabel}>{label}</Text>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  quickGrid: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  dashboardCard: {
    backgroundColor: 'rgba(255,255,255,0.065)',
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    minHeight: 156,
    padding: spacing.lg,
  },
  pressed: {
    opacity: 0.86,
    transform: [{ scale: 0.99 }],
  },
  metric: {
    alignItems: 'center',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 46,
    justifyContent: 'center',
    marginBottom: spacing.md,
    width: 66,
  },
  goldMetric: {
    backgroundColor: 'rgba(232,190,97,0.12)',
    borderColor: colors.borderGold,
  },
  emeraldMetric: {
    backgroundColor: 'rgba(43,203,136,0.12)',
    borderColor: 'rgba(43,203,136,0.36)',
  },
  metricText: {
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.black,
  },
  goldText: {
    color: colors.goldSoft,
  },
  emeraldText: {
    color: colors.emerald,
  },
  cardLabel: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  cardTitle: {
    color: colors.text,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
    marginTop: spacing.xs,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  cardBody: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    lineHeight: 22,
    marginTop: spacing.sm,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  statusCard: {
    borderColor: 'rgba(232,190,97,0.24)',
    marginBottom: spacing.xxl,
  },
  statusHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statusBadge: {
    backgroundColor: 'rgba(43,203,136,0.12)',
    borderColor: 'rgba(43,203,136,0.32)',
    borderRadius: radius.full,
    borderWidth: 1,
    color: colors.emerald,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    writingDirection: 'rtl',
  },
  statusTitle: {
    color: colors.goldSoft,
    flex: 1,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  statusBody: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    lineHeight: 23,
    marginTop: spacing.md,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
