import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ScreenContainer } from '../components/ScreenContainer';
import { useGrowthFeatureFlags } from '../growth/featureFlags';
import { requestLeaderboard, requestVipStatus } from '../social/requestSocialCommand';
import type {
  LeaderboardKind,
  LeaderboardResult,
  LeaderboardWindow,
  VipStatusResult,
} from '../social/types';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { useAuth } from '../auth/AuthProvider';
import { usePublicProfile } from '../social/usePublicProfile';

type Props = NativeStackScreenProps<RootStackParamList, 'Leaderboards'>;

const kinds: ReadonlyArray<{ key: LeaderboardKind; label: string }> = [
  { key: 'wealth', label: 'الثروة' },
  { key: 'charm', label: 'السحر' },
];

const familyKinds: ReadonlyArray<{ key: LeaderboardKind; label: string }> = [
  { key: 'family_wealth', label: 'ثروة العائلات' },
  { key: 'family_charm', label: 'سحر العائلات' },
];

const windows: ReadonlyArray<{ key: LeaderboardWindow; label: string }> = [
  { key: 'daily', label: 'يومي' },
  { key: 'weekly', label: 'أسبوعي' },
  { key: 'all', label: 'الكل' },
];

export function LeaderboardsScreen({ navigation }: Props) {
  const growthFlags = useGrowthFeatureFlags();
  const { user } = useAuth();
  const { profile } = usePublicProfile(user?.uid);
  const [kind, setKind] = useState<LeaderboardKind>('wealth');
  const [window, setWindow] = useState<LeaderboardWindow>('daily');
  const [scopeMode, setScopeMode] = useState<'global' | 'country'>('global');
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [board, setBoard] = useState<LeaderboardResult | null>(null);
  const [vip, setVip] = useState<VipStatusResult | null>(null);

  const isFamilyBoard = kind === 'family_wealth' || kind === 'family_charm';
  const visibleKinds = useMemo(
    () => (growthFlags.families ? [...kinds, ...familyKinds] : kinds),
    [growthFlags.families],
  );

  const scope = useMemo(() => {
    if (isFamilyBoard) return 'global';
    if (scopeMode === 'country' && profile?.countryCode) return profile.countryCode;
    return 'global';
  }, [isFamilyBoard, profile?.countryCode, scopeMode]);

  const load = useCallback(async () => {
    if (!growthFlags.leaderboards) {
      setLoading(false);
      setBoard(null);
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      const effectiveWindow = isFamilyBoard ? 'weekly' : window;
      const [boardResponse, vipResponse] = await Promise.all([
        requestLeaderboard({ kind, scope, window: effectiveWindow }),
        growthFlags.vipTiers ? requestVipStatus() : Promise.resolve(null),
      ]);
      if (!boardResponse.ok) {
        setErrorMessage(boardResponse.error.messageAr || 'تعذر تحميل لوحة المتصدرين.');
        setBoard(null);
      } else {
        setBoard(boardResponse.result);
      }
      if (vipResponse && vipResponse.ok) setVip(vipResponse.result);
    } catch {
      setErrorMessage('تعذر تحميل لوحة المتصدرين. تحقق من الاتصال.');
      setBoard(null);
    } finally {
      setLoading(false);
    }
  }, [growthFlags.leaderboards, growthFlags.vipTiers, isFamilyBoard, kind, scope, window]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  if (!growthFlags.leaderboards) {
    return (
      <ScreenContainer topPadding={spacing.lg} variant="ruby">
        <View style={styles.header}>
          <Pressable accessibilityLabel="رجوع" onPress={() => navigation.goBack()} style={styles.back}>
            <SymbolView name={{ ios: 'chevron.forward', android: 'arrow_forward', web: 'arrow_forward' }} size={20} tintColor="#F1CD79" />
          </Pressable>
          <Text style={styles.title}>المتصدرون</Text>
        </View>
        <Text style={styles.empty}>لوحة المتصدرين غير متاحة حالياً.</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer topPadding={spacing.lg} variant="ruby">
      <View style={styles.header}>
        <Pressable accessibilityLabel="رجوع" onPress={() => navigation.goBack()} style={styles.back}>
          <SymbolView name={{ ios: 'chevron.forward', android: 'arrow_forward', web: 'arrow_forward' }} size={20} tintColor="#F1CD79" />
        </Pressable>
        <Text style={styles.title}>المتصدرون</Text>
      </View>

      {vip?.tier ? (
        <View style={[styles.vipCard, { borderColor: vip.tier.accentColor }]}>
          <Text style={styles.vipLabel}>رتبتك</Text>
          <Text style={[styles.vipName, { color: vip.tier.accentColor }]}>{vip.tier.nameAr}</Text>
          <Text style={styles.vipMeta}>
            شحن تراكمي {vip.lifetimeCreditCoins.toLocaleString('ar-IQ')}
            {vip.nextTier ? ` · التالي ${vip.nextTier.nameAr}` : ''}
          </Text>
        </View>
      ) : null}

      <View style={styles.tabs}>
        {visibleKinds.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => {
              setKind(item.key);
              if (item.key === 'family_wealth' || item.key === 'family_charm') {
                setWindow('weekly');
                setScopeMode('global');
              }
            }}
            style={[styles.tab, kind === item.key && styles.tabActive]}
          >
            <Text style={[styles.tabLabel, kind === item.key && styles.tabLabelActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      {!isFamilyBoard ? (
      <View style={styles.tabs}>
        {windows.map((item) => (
          <Pressable
            key={item.key}
            onPress={() => setWindow(item.key)}
            style={[styles.chip, window === item.key && styles.chipActive]}
          >
            <Text style={[styles.chipLabel, window === item.key && styles.chipLabelActive]}>{item.label}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setScopeMode((current) => (current === 'global' ? 'country' : 'global'))}
          style={[styles.chip, scopeMode === 'country' && styles.chipActive]}
        >
          <Text style={[styles.chipLabel, scopeMode === 'country' && styles.chipLabelActive]}>
            {scopeMode === 'country' ? 'بلدي' : 'عالمي'}
          </Text>
        </Pressable>
      </View>
      ) : (
        <Text style={styles.empty}>لوحة أسبوعية عالمية للعائلات.</Text>
      )}

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      {loading ? (
        <ActivityIndicator color="#F1CD79" style={{ marginTop: spacing.xl }} />
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {(board?.board.entries || []).map((entry) => (
            <Pressable
              key={entry.uid}
              onPress={() => {
                if (isFamilyBoard) return;
                navigation.navigate('UserProfile', { uid: entry.uid });
              }}
              style={styles.row}
            >
              <Text style={styles.rank}>{entry.rank}</Text>
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={styles.name}>{entry.displayName}</Text>
                <Text style={styles.meta}>
                  {isFamilyBoard ? 'عائلة' : `ID ${entry.publicId || '—'}`}
                </Text>
              </View>
              <Text style={styles.score}>{entry.score.toLocaleString('ar-IQ')}</Text>
            </Pressable>
          ))}
          {!board?.board.entries?.length ? (
            <Text style={styles.empty}>لا يوجد متصدرون في هذه الفترة بعد.</Text>
          ) : null}
          {board?.viewer && board.viewer.rank == null ? (
            <View style={styles.viewerCard}>
              <Text style={styles.viewerLabel}>ترتيبك خارج الخمسين الأولى</Text>
              <Text style={styles.score}>{board.viewer.score.toLocaleString('ar-IQ')}</Text>
            </View>
          ) : null}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  back: {
    padding: spacing.xs,
  },
  title: {
    color: colors.gold,
    flex: 1,
    fontSize: 21,
    fontWeight: typography.weights.black,
    textAlign: 'right',
  },
  vipCard: {
    backgroundColor: 'rgba(20,8,10,0.85)',
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
    marginHorizontal: spacing.md,
    padding: spacing.md,
  },
  vipLabel: {
    color: '#B8975D',
    fontSize: 12,
    textAlign: 'right',
  },
  vipName: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: 4,
    textAlign: 'right',
  },
  vipMeta: {
    color: '#C9B08A',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'right',
  },
  tabs: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  tab: {
    backgroundColor: 'rgba(80,20,28,0.55)',
    borderRadius: radius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  tabActive: {
    backgroundColor: '#7C111B',
    borderColor: '#DDB65D',
    borderWidth: 1,
  },
  tabLabel: {
    color: '#C9B08A',
    fontSize: 13,
  },
  tabLabelActive: {
    color: '#F7D67C',
    fontWeight: '700',
  },
  chip: {
    backgroundColor: 'rgba(40,20,22,0.7)',
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: 'rgba(124,17,27,0.9)',
  },
  chipLabel: {
    color: '#A89078',
    fontSize: 12,
  },
  chipLabelActive: {
    color: '#F1CD79',
  },
  list: {
    gap: 8,
    paddingBottom: spacing.xl * 2,
    paddingHorizontal: spacing.md,
  },
  row: {
    alignItems: 'center',
    backgroundColor: 'rgba(24,10,12,0.88)',
    borderColor: 'rgba(221,182,93,0.2)',
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  rank: {
    color: '#F1CD79',
    fontSize: 16,
    fontWeight: '700',
    minWidth: 28,
    textAlign: 'center',
  },
  rowCopy: {
    flex: 1,
  },
  name: {
    color: '#F5E6C8',
    fontSize: 15,
    textAlign: 'right',
  },
  meta: {
    color: '#8C7B72',
    fontSize: 11,
    marginTop: 2,
    textAlign: 'right',
  },
  score: {
    color: '#F7D67C',
    fontSize: 14,
    fontWeight: '700',
  },
  viewerCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(60,20,24,0.7)',
    borderRadius: radius.md,
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  viewerLabel: {
    color: '#C9B08A',
    flex: 1,
    textAlign: 'right',
  },
  empty: {
    color: '#8C7B72',
    marginTop: spacing.xl,
    textAlign: 'center',
  },
  error: {
    color: '#EE8C94',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    textAlign: 'right',
  },
});
