import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GamePreviewCard } from '../components/GamePreviewCard';
import { GlassCard } from '../components/GlassCard';
import { ScreenContainer } from '../components/ScreenContainer';
import { SectionHeader } from '../components/SectionHeader';
import { featuredGames } from '../data/featuredGames';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types/navigation';
import { createFutureWebViewBridgeNote } from '../utils/webViewBridge';

type GamesScreenProps = {
  bottomNavigation: ReactNode;
  navigation: NativeStackNavigationProp<RootStackParamList, 'Main'>;
};

export function GamesScreen({ bottomNavigation, navigation }: GamesScreenProps) {
  // Future wave: this placeholder marks where WebView game bridge setup will be invoked.
  createFutureWebViewBridgeNote();

  return (
    <ScreenContainer bottomInset fixedBottom={bottomNavigation}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>مركز الألعاب</Text>
        <Text style={styles.title}>الألعاب</Text>
        <Text style={styles.subtitle}>
          اختر من التجارب الجاهزة الآن. الألعاب هنا للمتعة الاجتماعية فقط، بلا مراهنات أو محافظ.
        </Text>
      </View>

      <View style={styles.summaryRow}>
        <InfoPill label="نشطة" value="2" />
        <InfoPill label="قريبا" value="2" />
        <InfoPill label="النمط" value="اجتماعي" />
      </View>

      <SectionHeader actionLabel="هذا الشهر" title="كتالوج الألعاب" />
      <View style={styles.gamesGrid}>
        {featuredGames.map((game, index) => (
          <GamePreviewCard
            featured={index === 0}
            game={game}
            key={game.id}
            onPress={
              game.id === 'carrom-royal'
                ? () => navigation.navigate('Carrom')
                : game.id === 'royal-majlis'
                  ? () => navigation.navigate('MiniGame', { initialMode: 'naval' })
                  : undefined
            }
          />
        ))}
      </View>

      <GlassCard style={styles.sdkCard}>
        <Text style={styles.sdkTitle}>بوابة الألعاب الخارجية</Text>
        <Text style={styles.sdkBody}>
          مساحة جاهزة لربط ألعاب WebView لاحقا عبر طبقة منظمة بين اللعبة والتطبيق.
        </Text>
      </GlassCard>
    </ScreenContainer>
  );
}

type InfoPillProps = {
  label: string;
  value: string;
};

function InfoPill({ label, value }: InfoPillProps) {
  return (
    <View style={styles.infoPill}>
      <Text style={styles.infoValue}>{value}</Text>
      <Text style={styles.infoLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.lg,
  },
  eyebrow: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  title: {
    color: colors.text,
    fontSize: typography.sizes.headline,
    fontWeight: typography.weights.black,
    marginTop: spacing.xs,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    lineHeight: 23,
    marginTop: spacing.sm,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  summaryRow: {
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  infoPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flex: 1,
    minHeight: 64,
    justifyContent: 'center',
  },
  infoValue: {
    color: colors.goldSoft,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  infoLabel: {
    color: colors.textSubtle,
    fontSize: typography.sizes.caption,
    marginTop: 2,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  gamesGrid: {
    marginBottom: spacing.md,
  },
  sdkCard: {
    borderColor: 'rgba(232,190,97,0.28)',
    marginBottom: spacing.xxl,
    padding: spacing.lg,
  },
  sdkTitle: {
    color: colors.goldSoft,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  sdkBody: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    lineHeight: 22,
    marginTop: spacing.sm,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
