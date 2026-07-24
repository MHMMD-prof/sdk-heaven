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
import { requestFriendMutation, requestFriendsOverview } from '../social/requestSocialCommand';
import type { FriendConnectionSummary, FriendMutationAction, FriendsOverview } from '../social/types';
import { useRepresentativeBadgeProjection } from '../social/useRepresentativeBadgeProjection';
import { useSocialFeatureFlags } from '../social/useSocialFeatureFlags';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';

type FriendsScreenProps = NativeStackScreenProps<RootStackParamList, 'Friends'>;
type FriendsTab = keyof FriendsOverview;

const emptyOverview: FriendsOverview = { friends: [], incoming: [], outgoing: [] };

export function FriendsScreen({ navigation }: FriendsScreenProps) {
  const flags = useSocialFeatureFlags();
  const [activeTab, setActiveTab] = useState<FriendsTab>('friends');
  const [busyUid, setBusyUid] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<FriendsOverview>(emptyOverview);
  const badgeUids = useMemo(
    () => overview[activeTab].map((row) => row.profile.uid),
    [activeTab, overview],
  );
  const activeBadges = useRepresentativeBadgeProjection(badgeUids);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    const response = await requestFriendsOverview();

    if (response.ok) {
      setOverview(response.result);
    } else {
      setErrorMessage(response.error.messageAr);
    }

    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const runAction = async (action: FriendMutationAction, targetUid: string) => {
    setBusyUid(targetUid);
    const response = await requestFriendMutation(action, targetUid);
    setBusyUid('');

    if (!response.ok) {
      Alert.alert('تعذر تنفيذ الطلب', response.error.messageAr);
      return;
    }

    await load();
  };

  const rows = overview[activeTab];

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
            <Text style={styles.eyebrow}>دائرتك الاجتماعية</Text>
            <Text style={styles.title}>الأصدقاء والطلبات</Text>
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
          <SummaryStat label="أصدقاء" value={overview.friends.length} />
          <View style={styles.summaryDivider} />
          <SummaryStat label="طلبات واردة" value={overview.incoming.length} highlighted={overview.incoming.length > 0} />
          <View style={styles.summaryDivider} />
          <SummaryStat label="مرسلة" value={overview.outgoing.length} />
        </View>

        <View style={styles.tabs}>
          <TabButton active={activeTab === 'friends'} label="الأصدقاء" onPress={() => setActiveTab('friends')} />
          <TabButton
            active={activeTab === 'incoming'}
            badge={overview.incoming.length}
            label="الواردة"
            onPress={() => setActiveTab('incoming')}
          />
          <TabButton active={activeTab === 'outgoing'} label="المرسلة" onPress={() => setActiveTab('outgoing')} />
        </View>

        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colors.gold} size="large" />
            <Text style={styles.stateText}>جارٍ تحديث العلاقات...</Text>
          </View>
        ) : errorMessage ? (
          <View style={styles.stateCard}>
            <SymbolView name={{ ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }} size={30} tintColor="#FF9E9E" />
            <Text style={styles.stateTitle}>تعذر تحميل الأصدقاء</Text>
            <Text style={styles.stateText}>{errorMessage}</Text>
            <Pressable onPress={() => void load()} style={styles.retryButton}>
              <Text style={styles.retryText}>إعادة المحاولة</Text>
            </Pressable>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.stateCard}>
            <SymbolView name={{ ios: 'person.2.slash', android: 'group_off', web: 'group_off' }} size={36} tintColor={colors.gold} />
            <Text style={styles.stateTitle}>{emptyTitle(activeTab)}</Text>
            <Text style={styles.stateText}>{emptyBody(activeTab)}</Text>
            {activeTab === 'friends' && flags.usersDiscovery ? (
              <Pressable onPress={() => navigation.navigate('UsersDiscovery')} style={styles.retryButton}>
                <Text style={styles.retryText}>اكتشاف مستخدمين</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.list}>
            {rows.map((row) => (
              <FriendRow
                badgeActive={activeBadges[row.profile.uid] ?? row.profile.representativeBadgeActive}
                busy={busyUid === row.profile.uid}
                key={row.profile.uid}
                kind={activeTab}
                onAction={(action) => {
                  if (action === 'remove-friend') {
                    Alert.alert('إزالة الصديق', `هل تريد إزالة ${row.profile.displayName} من قائمة أصدقائك؟`, [
                      { style: 'cancel', text: 'تراجع' },
                      { style: 'destructive', text: 'إزالة', onPress: () => void runAction(action, row.profile.uid) },
                    ]);
                  } else {
                    void runAction(action, row.profile.uid);
                  }
                }}
                onOpen={() => navigation.navigate('UserProfile', { uid: row.profile.uid })}
                row={row}
              />
            ))}
          </View>
        )}
      </View>
    </ScreenContainer>
  );
}

function SummaryStat({ highlighted = false, label, value }: { highlighted?: boolean; label: string; value: number }) {
  return (
    <View style={styles.summaryStat}>
      <Text style={[styles.summaryValue, highlighted && styles.summaryValueHighlighted]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function TabButton({ active, badge = 0, label, onPress }: { active: boolean; badge?: number; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, active && styles.tabActive]}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
      {badge > 0 ? <Text style={styles.tabBadge}>{badge}</Text> : null}
    </Pressable>
  );
}

function FriendRow({
  badgeActive,
  busy,
  kind,
  onAction,
  onOpen,
  row,
}: {
  badgeActive?: boolean;
  busy: boolean;
  kind: FriendsTab;
  onAction: (action: FriendMutationAction) => void;
  onOpen: () => void;
  row: FriendConnectionSummary;
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
        </View>
        <View style={styles.friendCopy}>
          <View style={styles.nameRow}>
            {country ? <Image accessibilityLabel={country.label} source={country.flag} style={styles.flag} /> : null}
            <Text numberOfLines={1} style={styles.friendName}>{profile.displayName}</Text>
            <RepresentativeBadge active={badgeActive} />
          </View>
          <View style={styles.idsRow}>
            {profile.specialId ? <Text style={styles.specialId}>VIP {profile.specialId}</Text> : null}
            <Text style={styles.accountId}>ID {profile.publicId}</Text>
          </View>
        </View>
      </Pressable>
      <View style={styles.rowActions}>
        {busy ? <ActivityIndicator color={colors.gold} /> : <RowActions kind={kind} onAction={onAction} />}
      </View>
    </View>
  );
}

function RowActions({ kind, onAction }: { kind: FriendsTab; onAction: (action: FriendMutationAction) => void }) {
  if (kind === 'incoming') {
    return (
      <>
        <SmallAction label="قبول" onPress={() => onAction('accept-friend-request')} primary />
        <SmallAction label="رفض" onPress={() => onAction('decline-friend-request')} />
      </>
    );
  }

  if (kind === 'outgoing') {
    return <SmallAction label="إلغاء" onPress={() => onAction('cancel-friend-request')} />;
  }

  return <SmallAction label="إزالة" onPress={() => onAction('remove-friend')} />;
}

function SmallAction({ label, onPress, primary = false }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.smallAction, primary && styles.smallActionPrimary]}>
      <Text style={[styles.smallActionText, primary && styles.smallActionTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

function emptyTitle(tab: FriendsTab) {
  if (tab === 'incoming') return 'لا توجد طلبات واردة';
  if (tab === 'outgoing') return 'لا توجد طلبات مرسلة';
  return 'قائمة الأصدقاء فارغة';
}

function emptyBody(tab: FriendsTab) {
  if (tab === 'incoming') return 'ستظهر طلبات الصداقة الجديدة هنا.';
  if (tab === 'outgoing') return 'الطلبات التي ترسلها ستبقى هنا حتى الرد.';
  return 'اكتشف مستخدمين وأرسل أول طلب صداقة.';
}

const styles = StyleSheet.create({
  page: { alignSelf: 'center', gap: spacing.lg, maxWidth: 720, width: '100%' },
  header: { alignItems: 'center', flexDirection: 'row-reverse', justifyContent: 'space-between', minHeight: 58 },
  roundButton: { alignItems: 'center', backgroundColor: '#17090A', borderColor: 'rgba(232,190,97,0.42)', borderRadius: radius.full, borderWidth: 1, height: 46, justifyContent: 'center', width: 46 },
  headingCopy: { alignItems: 'center' },
  eyebrow: { color: colors.gold, fontSize: 11, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  title: { color: colors.text, fontSize: 21, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  summaryCard: { backgroundColor: '#120607', borderColor: 'rgba(232,190,97,0.3)', borderRadius: radius.xl, borderWidth: 1, flexDirection: 'row-reverse', paddingVertical: spacing.md },
  summaryStat: { alignItems: 'center', flex: 1 },
  summaryValue: { color: colors.goldSoft, fontSize: 24, fontWeight: typography.weights.black },
  summaryValueHighlighted: { color: '#FF7E87' },
  summaryLabel: { color: colors.textMuted, fontSize: 11, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  summaryDivider: { alignSelf: 'center', backgroundColor: 'rgba(232,190,97,0.18)', height: 38, width: 1 },
  tabs: { backgroundColor: '#0C0405', borderColor: 'rgba(232,190,97,0.22)', borderRadius: radius.full, borderWidth: 1, flexDirection: 'row-reverse', padding: 4 },
  tab: { alignItems: 'center', borderRadius: radius.full, flex: 1, flexDirection: 'row-reverse', gap: 5, justifyContent: 'center', minHeight: 42 },
  tabActive: { backgroundColor: '#72121A' },
  tabText: { color: colors.textMuted, fontSize: 13, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  tabTextActive: { color: colors.goldSoft },
  tabBadge: { backgroundColor: '#FF5361', borderRadius: radius.full, color: '#FFF', fontSize: 10, fontWeight: typography.weights.black, minWidth: 18, overflow: 'hidden', paddingHorizontal: 5, textAlign: 'center' },
  list: { gap: spacing.sm },
  friendCard: { alignItems: 'center', backgroundColor: '#120708', borderColor: 'rgba(232,190,97,0.24)', borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row-reverse', gap: spacing.sm, minHeight: 88, padding: spacing.md },
  friendIdentity: { alignItems: 'center', flex: 1, flexDirection: 'row-reverse', gap: spacing.md },
  avatar: { alignItems: 'center', backgroundColor: '#2B0A0E', borderColor: colors.gold, borderRadius: radius.full, borderWidth: 2, height: 58, justifyContent: 'center', overflow: 'hidden', width: 58 },
  avatarImage: { height: '100%', width: '100%' },
  avatarText: { color: colors.goldSoft, fontSize: 22, fontWeight: typography.weights.black },
  friendCopy: { alignItems: 'flex-end', flex: 1, gap: 5 },
  nameRow: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.xs, maxWidth: '100%' },
  flag: { borderRadius: 2, height: 16, width: 24 },
  friendName: { color: colors.text, flexShrink: 1, fontSize: 16, fontWeight: typography.weights.black, textAlign: 'right', writingDirection: 'rtl' },
  idsRow: { flexDirection: 'row-reverse', gap: spacing.xs },
  specialId: { color: '#FFE89A', fontSize: 11, fontWeight: typography.weights.black },
  accountId: { color: colors.textSubtle, fontSize: 11, fontWeight: typography.weights.bold },
  rowActions: { alignItems: 'flex-end', gap: 6, minWidth: 58 },
  smallAction: { alignItems: 'center', borderColor: 'rgba(232,190,97,0.35)', borderRadius: radius.full, borderWidth: 1, justifyContent: 'center', minHeight: 34, minWidth: 58, paddingHorizontal: spacing.sm },
  smallActionPrimary: { backgroundColor: colors.gold, borderColor: colors.gold },
  smallActionText: { color: colors.goldSoft, fontSize: 11, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  smallActionTextPrimary: { color: '#2B090C' },
  stateCard: { alignItems: 'center', backgroundColor: '#100607', borderColor: 'rgba(232,190,97,0.28)', borderRadius: radius.xl, borderWidth: 1, gap: spacing.md, justifyContent: 'center', minHeight: 260, padding: spacing.xl },
  stateTitle: { color: colors.text, fontSize: 18, fontWeight: typography.weights.black, textAlign: 'center', writingDirection: 'rtl' },
  stateText: { color: colors.textMuted, fontSize: 13, textAlign: 'center', writingDirection: 'rtl' },
  retryButton: { backgroundColor: colors.gold, borderRadius: radius.full, minHeight: 44, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  retryText: { color: '#2B090C', fontWeight: typography.weights.black, writingDirection: 'rtl' },
});
