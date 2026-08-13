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
import { requestBlockMutation, requestBlockedUsers } from '../social/requestSocialCommand';
import type { FollowConnectionSummary } from '../social/types';
import { useRepresentativeBadgeProjection } from '../social/useRepresentativeBadgeProjection';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { AvatarFrameLayer } from '../components/AvatarPresentation';
import { useCosmeticsFeatureFlags, type CosmeticsFeatureFlags } from '../cosmetics/featureFlags';

type BlockedUsersScreenProps = NativeStackScreenProps<RootStackParamList, 'BlockedUsers'>;

export function BlockedUsersScreen({ navigation }: BlockedUsersScreenProps) {
  const cosmeticsFlags = useCosmeticsFeatureFlags();
  const [busyUid, setBusyUid] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<FollowConnectionSummary[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    const response = await requestBlockedUsers();
    if (response.ok) setItems(response.result.items);
    else setErrorMessage(response.error.messageAr);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const badgeUids = useMemo(() => items.map((row) => row.profile.uid), [items]);
  const activeBadges = useRepresentativeBadgeProjection(badgeUids);

  const runUnblock = async (targetUid: string) => {
    setBusyUid(targetUid);
    const response = await requestBlockMutation('unblock-user', targetUid);
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
            <Text style={styles.eyebrow}>السلامة</Text>
            <Text style={styles.title}>المستخدمون المحظورون</Text>
          </View>
          <Pressable accessibilityLabel="تحديث" onPress={() => void load()} style={styles.roundButton}>
            <SymbolView
              name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }}
              size={21}
              tintColor={colors.goldSoft}
            />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colors.gold} size="large" />
            <Text style={styles.stateText}>جارٍ تحميل قائمة الحظر...</Text>
          </View>
        ) : errorMessage ? (
          <View style={styles.stateCard}>
            <SymbolView name={{ ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }} size={30} tintColor="#FF9E9E" />
            <Text style={styles.stateTitle}>تعذر تحميل المحظورين</Text>
            <Text style={styles.stateText}>{errorMessage}</Text>
            <Pressable onPress={() => void load()} style={styles.retryButton}>
              <Text style={styles.retryText}>إعادة المحاولة</Text>
            </Pressable>
          </View>
        ) : items.length === 0 ? (
          <View style={styles.stateCard}>
            <SymbolView name={{ ios: 'hand.raised.slash', android: 'block', web: 'block' }} size={36} tintColor={colors.gold} />
            <Text style={styles.stateTitle}>لا يوجد محظورون</Text>
            <Text style={styles.stateText}>عند حظر مستخدم من المحادثة أو الغرفة سيظهر هنا ويمكنك إلغاء الحظر.</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {items.map((row) => (
              <BlockedRow
                badgeActive={activeBadges[row.profile.uid] ?? row.profile.representativeBadgeActive}
                busy={busyUid === row.profile.uid}
                cosmeticsFlags={cosmeticsFlags}
                key={row.profile.uid}
                onOpen={() => navigation.navigate('UserProfile', { uid: row.profile.uid })}
                onUnblock={() => {
                  Alert.alert('إلغاء الحظر', `هل تريد إلغاء حظر ${row.profile.displayName}؟`, [
                    { style: 'cancel', text: 'تراجع' },
                    { text: 'إلغاء الحظر', onPress: () => void runUnblock(row.profile.uid) },
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

function BlockedRow({
  badgeActive,
  busy,
  cosmeticsFlags,
  onOpen,
  onUnblock,
  row,
}: {
  badgeActive?: boolean;
  busy: boolean;
  cosmeticsFlags: CosmeticsFeatureFlags;
  onOpen: () => void;
  onUnblock: () => void;
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
      <View style={styles.rowActions}>
        {busy ? (
          <ActivityIndicator color={colors.gold} />
        ) : (
          <Pressable onPress={onUnblock} style={styles.actionButton}>
            <Text style={styles.actionText}>إلغاء الحظر</Text>
          </Pressable>
        )}
      </View>
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
  rowActions: { minWidth: 88 },
  stateCard: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: radius.lg, gap: spacing.sm, padding: spacing.xl },
  stateText: { color: colors.textMuted, textAlign: 'center', writingDirection: 'rtl' },
  stateTitle: { color: colors.text, fontSize: 16, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  title: { color: colors.text, fontSize: 22, fontWeight: typography.weights.black, writingDirection: 'rtl' },
});
