import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ScreenContainer } from '../components/ScreenContainer';
import { RepresentativeBadge } from '../components/RepresentativeBadge';
import { getRoomCountry } from '../data/roomCountries';
import { requestFollowList, requestFollowMutation } from '../social/requestSocialCommand';
import type { FollowConnectionSummary } from '../social/types';
import { useRepresentativeBadgeProjection } from '../social/useRepresentativeBadgeProjection';
import { useSocialFeatureFlags } from '../social/useSocialFeatureFlags';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { AvatarFrameLayer } from '../components/AvatarPresentation';
import { useCosmeticsFeatureFlags, type CosmeticsFeatureFlags } from '../cosmetics/featureFlags';

type FollowingScreenProps = NativeStackScreenProps<RootStackParamList, 'Following'>;
type FollowTab = 'following' | 'followers';

export function FollowingScreen({ navigation, route }: FollowingScreenProps) {
  const flags = useSocialFeatureFlags();
  const cosmeticsFlags = useCosmeticsFeatureFlags();
  const subjectUid = route.params?.uid;
  const initialTab = route.params?.tab === 'followers' ? 'followers' : 'following';
  const [activeTab, setActiveTab] = useState<FollowTab>(initialTab);
  const [busyUid, setBusyUid] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState<FollowConnectionSummary[]>([]);
  const [followers, setFollowers] = useState<FollowConnectionSummary[]>([]);

  const load = useCallback(async () => {
    if (!flags.following) {
      setLoading(false);
      setErrorMessage('ميزة المتابعة غير متاحة حالياً.');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    const [followingResponse, followersResponse] = await Promise.all([
      requestFollowList('following', subjectUid),
      requestFollowList('followers', subjectUid),
    ]);
    if (followingResponse.ok) setFollowing(followingResponse.result.items);
    if (followersResponse.ok) setFollowers(followersResponse.result.items);
    if (!followingResponse.ok) setErrorMessage(followingResponse.error.messageAr);
    else if (!followersResponse.ok) setErrorMessage(followersResponse.error.messageAr);
    setLoading(false);
  }, [flags.following, subjectUid]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const rows = activeTab === 'following' ? following : followers;
  const badgeUids = useMemo(() => rows.map((row) => row.profile.uid), [rows]);
  const activeBadges = useRepresentativeBadgeProjection(badgeUids);

  const runUnfollow = async (targetUid: string) => {
    setBusyUid(targetUid);
    const response = await requestFollowMutation('unfollow-user', targetUid);
    setBusyUid('');
    if (!response.ok) {
      Alert.alert('تعذر تنفيذ الطلب', response.error.messageAr);
      return;
    }
    await load();
  };

  return (
    <ScreenContainer decorativeGlows={false} variant="ruby">
      <View style={styles.page}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="رجوع" onPress={navigation.goBack} style={styles.roundButton}>
            <SymbolView
              name={{ ios: 'chevron.right', android: 'arrow_forward', web: 'arrow_forward' }}
              size={22}
              tintColor={colors.goldSoft}
            />
          </Pressable>
          <View style={styles.headingCopy}>
            <Text style={styles.eyebrow}>شبكة المتابعة</Text>
            <Text style={styles.title}>المتابعون ويتابع</Text>
          </View>
          <Pressable accessibilityLabel="تحديث" onPress={() => void load()} style={styles.roundButton}>
            <SymbolView
              name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }}
              size={21}
              tintColor={colors.goldSoft}
            />
          </Pressable>
        </View>

        <View style={styles.summaryCard}>
          <SummaryStat label="يتابع" value={following.length} />
          <View style={styles.summaryDivider} />
          <SummaryStat label="المتابعون" value={followers.length} />
        </View>

        <View style={styles.tabs}>
          <TabButton active={activeTab === 'following'} label="يتابع" onPress={() => setActiveTab('following')} />
          <TabButton active={activeTab === 'followers'} label="المتابعون" onPress={() => setActiveTab('followers')} />
        </View>

        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colors.gold} size="large" />
            <Text style={styles.stateText}>جارٍ تحديث المتابعة...</Text>
          </View>
        ) : errorMessage ? (
          <View style={styles.stateCard}>
            <SymbolView name={{ ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }} size={30} tintColor="#FF9E9E" />
            <Text style={styles.stateTitle}>تعذر تحميل المتابعة</Text>
            <Text style={styles.stateText}>{errorMessage}</Text>
            <Pressable onPress={() => void load()} style={styles.retryButton}>
              <Text style={styles.retryText}>إعادة المحاولة</Text>
            </Pressable>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.stateCard}>
            <SymbolView name={{ ios: 'person.2.slash', android: 'group_off', web: 'group_off' }} size={36} tintColor={colors.gold} />
            <Text style={styles.stateTitle}>{activeTab === 'following' ? 'لا تتابع أحداً بعد' : 'لا يوجد متابعون بعد'}</Text>
            <Text style={styles.stateText}>
              {activeTab === 'following'
                ? 'اكتشف مستخدمين وابدأ بمتابعتهم.'
                : 'سيظهر هنا من يتابع هذا الحساب.'}
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {rows.map((row) => (
              <FollowRow
                badgeActive={activeBadges[row.profile.uid] ?? row.profile.representativeBadgeActive}
                busy={busyUid === row.profile.uid}
                canUnfollow={!subjectUid && activeTab === 'following'}
                cosmeticsFlags={cosmeticsFlags}
                key={`${activeTab}-${row.profile.uid}`}
                onOpen={() => navigation.navigate('UserProfile', { uid: row.profile.uid })}
                onUnfollow={() => {
                  Alert.alert('إلغاء المتابعة', `هل تريد إلغاء متابعة ${row.profile.displayName}؟`, [
                    { style: 'cancel', text: 'تراجع' },
                    { style: 'destructive', text: 'إلغاء المتابعة', onPress: () => void runUnfollow(row.profile.uid) },
                  ]);
                }}
                row={row}
              />
            ))}
          </View>
        )}
      </View>
    </ScreenContainer>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.summaryStat}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function TabButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, active && styles.tabActive]}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function FollowRow({
  badgeActive,
  busy,
  canUnfollow,
  cosmeticsFlags,
  onOpen,
  onUnfollow,
  row,
}: {
  badgeActive?: boolean;
  busy: boolean;
  canUnfollow: boolean;
  cosmeticsFlags: CosmeticsFeatureFlags;
  onOpen: () => void;
  onUnfollow: () => void;
  row: FollowConnectionSummary;
}) {
  const { profile } = row;
  const country = getRoomCountry(profile.countryCode);

  return (
    <View style={styles.friendCard}>
      <Pressable onPress={onOpen} style={styles.friendIdentity}>
        <View style={styles.avatar}>
          {profile.avatarModerationStatus === 'clear' && profile.avatarUrl ? (
            <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText}>{[...profile.displayName][0] || '؟'}</Text>
          )}
          <AvatarFrameLayer flags={cosmeticsFlags} frame={profile.equippedAvatarFrame} />
        </View>
        <View style={styles.friendCopy}>
          <View style={styles.nameRow}>
            {country ? <Image accessibilityLabel={country.label} source={country.flag} style={styles.flag} /> : null}
            <Text numberOfLines={1} style={styles.friendName}>{profile.displayName}</Text>
            <RepresentativeBadge active={badgeActive} />
          </View>
          <Text style={styles.accountId}>ID {profile.publicId}</Text>
        </View>
      </Pressable>
      {canUnfollow ? (
        <View style={styles.rowActions}>
          {busy ? (
            <ActivityIndicator color={colors.gold} />
          ) : (
            <Pressable onPress={onUnfollow} style={styles.actionButton}>
              <Text style={styles.actionText}>إلغاء</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  accountId: { color: colors.textMuted, fontSize: 12, writingDirection: 'rtl' },
  actionButton: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  actionText: { color: colors.goldSoft, fontSize: 13, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  avatar: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: 24, height: 48, justifyContent: 'center', overflow: 'hidden', width: 48 },
  avatarImage: { height: '100%', width: '100%' },
  avatarText: { color: colors.goldSoft, fontSize: 18, fontWeight: typography.weights.black },
  eyebrow: { color: colors.goldSoft, fontSize: 12, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  flag: { borderRadius: 2, height: 14, width: 20 },
  friendCard: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.08)', borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row-reverse', gap: spacing.md, padding: spacing.md },
  friendCopy: { flex: 1, gap: 4 },
  friendIdentity: { alignItems: 'center', flex: 1, flexDirection: 'row-reverse', gap: spacing.md },
  friendName: { color: colors.text, flexShrink: 1, fontSize: 15, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  header: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.md },
  headingCopy: { flex: 1, gap: 2 },
  list: { gap: spacing.sm },
  nameRow: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.xs },
  page: { flex: 1, gap: spacing.lg, paddingBottom: spacing.xxl, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  retryButton: { backgroundColor: colors.gold, borderRadius: radius.full, marginTop: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  retryText: { color: '#2A090C', fontWeight: typography.weights.black, writingDirection: 'rtl' },
  roundButton: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 22, height: 44, justifyContent: 'center', width: 44 },
  rowActions: { minWidth: 64 },
  stateCard: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: radius.lg, gap: spacing.sm, padding: spacing.xl },
  stateText: { color: colors.textMuted, textAlign: 'center', writingDirection: 'rtl' },
  stateTitle: { color: colors.text, fontSize: 16, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  summaryCard: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: radius.lg, flexDirection: 'row-reverse', paddingVertical: spacing.md },
  summaryDivider: { backgroundColor: 'rgba(255,255,255,0.1)', height: 36, width: 1 },
  summaryLabel: { color: colors.textMuted, fontSize: 12, writingDirection: 'rtl' },
  summaryStat: { alignItems: 'center', flex: 1, gap: 4 },
  summaryValue: { color: colors.goldSoft, fontSize: 20, fontWeight: typography.weights.black },
  tab: { alignItems: 'center', borderRadius: radius.full, flex: 1, paddingVertical: spacing.sm },
  tabActive: { backgroundColor: 'rgba(243,199,92,0.18)' },
  tabText: { color: colors.textMuted, fontSize: 13, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  tabTextActive: { color: colors.goldSoft },
  tabs: { backgroundColor: 'rgba(0,0,0,0.22)', borderRadius: radius.full, flexDirection: 'row-reverse', padding: 4 },
  title: { color: colors.text, fontSize: 22, fontWeight: typography.weights.black, writingDirection: 'rtl' },
});
