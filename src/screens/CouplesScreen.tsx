import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { useCallback, useMemo, useState } from 'react';
import type { ComponentProps, PropsWithChildren } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '../components/ScreenContainer';
import { RepresentativeBadge } from '../components/RepresentativeBadge';
import { getRoomCountry } from '../data/roomCountries';
import { requestCoupleMutation, requestCouplesOverview } from '../social/requestSocialCommand';
import type { CoupleConnectionSummary, CoupleMutationAction, CouplesOverview } from '../social/types';
import { useRepresentativeBadgeProjection } from '../social/useRepresentativeBadgeProjection';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { AvatarFrameLayer } from '../components/AvatarPresentation';
import { useCosmeticsFeatureFlags, type CosmeticsFeatureFlags } from '../cosmetics/featureFlags';

type Props = NativeStackScreenProps<RootStackParamList, 'Couples'>;
const emptyOverview: CouplesOverview = { incoming: [], outgoing: [] };

export function CouplesScreen({ navigation }: Props) {
  const cosmeticsFlags = useCosmeticsFeatureFlags();
  const [overview, setOverview] = useState<CouplesOverview>(emptyOverview);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [busyUid, setBusyUid] = useState('');
  const badgeUids = useMemo(() => [
    ...(overview.current ? [overview.current.profile.uid] : []),
    ...overview.incoming.map((row) => row.profile.uid),
    ...overview.outgoing.map((row) => row.profile.uid),
  ], [overview]);
  const activeBadges = useRepresentativeBadgeProjection(badgeUids);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    const response = await requestCouplesOverview();
    if (response.ok) setOverview(response.result);
    else setErrorMessage(response.error.messageAr);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const runAction = async (action: CoupleMutationAction, targetUid: string) => {
    setBusyUid(targetUid);
    const response = await requestCoupleMutation(action, targetUid);
    setBusyUid('');
    if (!response.ok) {
      Alert.alert('تعذر تنفيذ الطلب', response.error.messageAr);
      return;
    }
    await load();
  };

  const confirmDissolve = (row: CoupleConnectionSummary) => {
    Alert.alert('إنهاء الارتباط', `هل تريد إنهاء ارتباطك مع ${row.profile.displayName}؟`, [
      { style: 'cancel', text: 'تراجع' },
      { style: 'destructive', text: 'إنهاء الارتباط', onPress: () => void runAction('dissolve-couple', row.profile.uid) },
    ]);
  };

  return (
    <ScreenContainer decorativeGlows={false} variant="ruby">
      <View style={styles.page}>
        <View style={styles.header}>
          <RoundButton label="رجوع" name={{ ios: 'chevron.right', android: 'arrow_forward', web: 'arrow_forward' }} onPress={navigation.goBack} />
          <View style={styles.heading}>
            <Text style={styles.eyebrow}>مساحتكما الخاصة</Text>
            <Text style={styles.title}>الارتباط</Text>
          </View>
          <RoundButton label="تحديث" name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }} onPress={() => void load()} />
        </View>

        {loading ? (
          <StateCard icon={undefined} text="جارٍ تحديث الارتباط والطلبات..." loading />
        ) : errorMessage ? (
          <StateCard icon={{ ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }} text={errorMessage} title="تعذر تحميل الارتباط">
            <ActionButton label="إعادة المحاولة" onPress={() => void load()} primary />
          </StateCard>
        ) : (
          <>
            {overview.current ? (
              <LinearGradient colors={['#7B1420', '#2A080C', '#0A0505']} style={styles.currentCard}>
                <View style={styles.heartHalo} />
                <SymbolView name={{ ios: 'heart.fill', android: 'favorite', web: 'favorite' }} size={30} tintColor="#FFE095" />
                <Text style={styles.currentEyebrow}>شريك الارتباط</Text>
                <ProfileIdentity
                  badgeActive={activeBadges[overview.current.profile.uid] ?? overview.current.profile.representativeBadgeActive}
                  cosmeticsFlags={cosmeticsFlags}
                  row={overview.current}
                  onOpen={() => navigation.navigate('UserProfile', { uid: overview.current!.profile.uid })}
                  large
                />
                <View style={styles.currentActions}>
                  <ActionButton label="عرض الملف" onPress={() => navigation.navigate('UserProfile', { uid: overview.current!.profile.uid })} primary />
                  <ActionButton
                    busy={busyUid === overview.current.profile.uid}
                    label="إنهاء الارتباط"
                    onPress={() => confirmDissolve(overview.current!)}
                  />
                </View>
              </LinearGradient>
            ) : (
              <View style={styles.emptyHero}>
                <View style={styles.emptyIcon}>
                  <SymbolView name={{ ios: 'heart', android: 'favorite_border', web: 'favorite_border' }} size={38} tintColor={colors.gold} />
                </View>
                <Text style={styles.emptyTitle}>لا يوجد ارتباط حالي</Text>
                <Text style={styles.emptyText}>افتح ملف مستخدم وأرسل طلب ارتباط. لا يمكن لكل حساب امتلاك أكثر من شريك واحد.</Text>
                <ActionButton label="اكتشاف مستخدمين" onPress={() => navigation.navigate('UsersDiscovery')} primary />
              </View>
            )}

            <RequestSection
              activeBadges={activeBadges}
              busyUid={busyUid}
              cosmeticsFlags={cosmeticsFlags}
              empty="لا توجد طلبات ارتباط واردة."
              onAction={(row, action) => void runAction(action, row.profile.uid)}
              onOpen={(uid) => navigation.navigate('UserProfile', { uid })}
              rows={overview.incoming}
              title="الطلبات الواردة"
              type="incoming"
            />
            <RequestSection
              activeBadges={activeBadges}
              busyUid={busyUid}
              cosmeticsFlags={cosmeticsFlags}
              empty="لا توجد طلبات ارتباط مرسلة."
              onAction={(row, action) => void runAction(action, row.profile.uid)}
              onOpen={(uid) => navigation.navigate('UserProfile', { uid })}
              rows={overview.outgoing}
              title="الطلبات المرسلة"
              type="outgoing"
            />
          </>
        )}
      </View>
    </ScreenContainer>
  );
}

function RequestSection({ activeBadges, busyUid, cosmeticsFlags, empty, onAction, onOpen, rows, title, type }: {
  activeBadges: Record<string, boolean>;
  busyUid: string;
  cosmeticsFlags: CosmeticsFeatureFlags;
  empty: string;
  onAction: (row: CoupleConnectionSummary, action: CoupleMutationAction) => void;
  onOpen: (uid: string) => void;
  rows: CoupleConnectionSummary[];
  title: string;
  type: 'incoming' | 'outgoing';
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.countPill}><Text style={styles.countText}>{rows.length}</Text></View>
      </View>
      {rows.length === 0 ? <Text style={styles.sectionEmpty}>{empty}</Text> : rows.map((row) => (
        <View key={row.profile.uid} style={styles.requestCard}>
          <ProfileIdentity
            badgeActive={activeBadges[row.profile.uid] ?? row.profile.representativeBadgeActive}
            cosmeticsFlags={cosmeticsFlags}
            row={row}
            onOpen={() => onOpen(row.profile.uid)}
          />
          <View style={styles.requestActions}>
            {busyUid === row.profile.uid ? <ActivityIndicator color={colors.gold} /> : type === 'incoming' ? (
              <>
                <ActionButton label="قبول" onPress={() => onAction(row, 'accept-couple-request')} primary small />
                <ActionButton label="رفض" onPress={() => onAction(row, 'decline-couple-request')} small />
              </>
            ) : <ActionButton label="إلغاء" onPress={() => onAction(row, 'cancel-couple-request')} small />}
          </View>
        </View>
      ))}
    </View>
  );
}

function ProfileIdentity({ badgeActive, cosmeticsFlags, large = false, onOpen, row }: {
  badgeActive?: boolean;
  cosmeticsFlags: CosmeticsFeatureFlags;
  large?: boolean;
  onOpen: () => void;
  row: CoupleConnectionSummary;
}) {
  const country = getRoomCountry(row.profile.countryCode);
  return (
    <Pressable onPress={onOpen} style={[styles.identity, large && styles.identityLarge]}>
      <View style={[styles.avatar, large && styles.avatarLarge]}>
        {row.profile.avatarModerationStatus === 'clear' && row.profile.avatarUrl
          ? <Image source={{ uri: row.profile.avatarUrl }} style={styles.avatarImage} />
          : <Text style={[styles.avatarText, large && styles.avatarTextLarge]}>{[...row.profile.displayName][0] || '؟'}</Text>}
        <AvatarFrameLayer flags={cosmeticsFlags} frame={row.profile.equippedAvatarFrame} />
      </View>
      <View style={[styles.identityCopy, large && styles.identityCopyLarge]}>
        <View style={styles.nameRow}>
          {country ? <Image accessibilityLabel={country.label} source={country.flag} style={styles.flag} /> : null}
          <Text numberOfLines={1} style={[styles.name, large && styles.nameLarge]}>{row.profile.displayName}</Text>
          <RepresentativeBadge active={badgeActive} />
        </View>
        <Text style={styles.publicId}>ID {row.profile.publicId}</Text>
      </View>
    </Pressable>
  );
}

function ActionButton({ busy = false, label, onPress, primary = false, small = false }: { busy?: boolean; label: string; onPress: () => void; primary?: boolean; small?: boolean }) {
  return (
    <Pressable disabled={busy} onPress={onPress} style={[styles.action, primary && styles.actionPrimary, small && styles.actionSmall]}>
      {busy ? <ActivityIndicator color={primary ? '#2B090C' : colors.gold} /> : <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>{label}</Text>}
    </Pressable>
  );
}

function RoundButton({ label, name, onPress }: { label: string; name: ComponentProps<typeof SymbolView>['name']; onPress: () => void }) {
  return <Pressable accessibilityLabel={label} onPress={onPress} style={styles.roundButton}><SymbolView name={name} size={21} tintColor={colors.goldSoft} /></Pressable>;
}

function StateCard({ children, icon, loading = false, text, title }: PropsWithChildren<{ icon?: ComponentProps<typeof SymbolView>['name']; loading?: boolean; text: string; title?: string }>) {
  return (
    <View style={styles.stateCard}>
      {loading ? <ActivityIndicator color={colors.gold} size="large" /> : icon ? <SymbolView name={icon} size={32} tintColor={colors.gold} /> : null}
      {title ? <Text style={styles.stateTitle}>{title}</Text> : null}
      <Text style={styles.stateText}>{text}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { alignSelf: 'center', gap: spacing.lg, maxWidth: 720, width: '100%' },
  header: { alignItems: 'center', flexDirection: 'row-reverse', justifyContent: 'space-between', minHeight: 58 },
  heading: { alignItems: 'center' },
  eyebrow: { color: colors.gold, fontSize: 11, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  title: { color: colors.text, fontSize: 23, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  roundButton: { alignItems: 'center', backgroundColor: '#17090A', borderColor: 'rgba(232,190,97,0.42)', borderRadius: radius.full, borderWidth: 1, height: 46, justifyContent: 'center', width: 46 },
  currentCard: { alignItems: 'center', borderColor: 'rgba(255,218,133,0.58)', borderRadius: radius.xl, borderWidth: 1, gap: spacing.sm, overflow: 'hidden', padding: spacing.xl },
  heartHalo: { backgroundColor: 'rgba(255,195,90,0.1)', borderRadius: 90, height: 180, position: 'absolute', top: -95, width: 180 },
  currentEyebrow: { color: '#F6CB72', fontSize: 12, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  currentActions: { flexDirection: 'row-reverse', gap: spacing.sm, marginTop: spacing.sm },
  emptyHero: { alignItems: 'center', backgroundColor: '#110607', borderColor: 'rgba(232,190,97,0.28)', borderRadius: radius.xl, borderWidth: 1, gap: spacing.md, padding: spacing.xl },
  emptyIcon: { alignItems: 'center', backgroundColor: '#3A0A10', borderColor: 'rgba(232,190,97,0.46)', borderRadius: radius.full, borderWidth: 1, height: 72, justifyContent: 'center', width: 72 },
  emptyTitle: { color: colors.text, fontSize: 20, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  emptyText: { color: colors.textMuted, fontSize: 13, lineHeight: 22, maxWidth: 440, textAlign: 'center', writingDirection: 'rtl' },
  section: { gap: spacing.sm },
  sectionHeading: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.sm },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  countPill: { alignItems: 'center', backgroundColor: '#72121A', borderRadius: radius.full, minWidth: 25, paddingHorizontal: 7, paddingVertical: 3 },
  countText: { color: colors.goldSoft, fontSize: 11, fontWeight: typography.weights.black },
  sectionEmpty: { backgroundColor: '#0E0607', borderColor: 'rgba(232,190,97,0.18)', borderRadius: radius.lg, borderWidth: 1, color: colors.textSubtle, padding: spacing.lg, textAlign: 'center', writingDirection: 'rtl' },
  requestCard: { alignItems: 'center', backgroundColor: '#120708', borderColor: 'rgba(232,190,97,0.24)', borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row-reverse', gap: spacing.sm, minHeight: 86, padding: spacing.md },
  requestActions: { alignItems: 'flex-end', flexDirection: 'row-reverse', gap: 6 },
  identity: { alignItems: 'center', flex: 1, flexDirection: 'row-reverse', gap: spacing.md },
  identityLarge: { flex: 0, flexDirection: 'column' },
  identityCopy: { alignItems: 'flex-end', flex: 1, gap: 4 },
  identityCopyLarge: { alignItems: 'center', flex: 0 },
  avatar: { alignItems: 'center', backgroundColor: '#2B0A0E', borderColor: colors.gold, borderRadius: radius.full, borderWidth: 2, height: 58, justifyContent: 'center', overflow: 'hidden', width: 58 },
  avatarLarge: { height: 92, width: 92 },
  avatarImage: { height: '100%', width: '100%' },
  avatarText: { color: colors.goldSoft, fontSize: 22, fontWeight: typography.weights.black },
  avatarTextLarge: { fontSize: 34 },
  nameRow: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.xs },
  name: { color: colors.text, fontSize: 16, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  nameLarge: { fontSize: 21 },
  publicId: { color: colors.textSubtle, fontSize: 11, fontWeight: typography.weights.bold },
  flag: { borderRadius: 2, height: 16, width: 24 },
  action: { alignItems: 'center', borderColor: 'rgba(232,190,97,0.42)', borderRadius: radius.full, borderWidth: 1, justifyContent: 'center', minHeight: 44, minWidth: 108, paddingHorizontal: spacing.lg },
  actionPrimary: { backgroundColor: colors.gold, borderColor: colors.gold },
  actionSmall: { minHeight: 36, minWidth: 58, paddingHorizontal: spacing.sm },
  actionText: { color: colors.goldSoft, fontSize: 12, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  actionTextPrimary: { color: '#2B090C' },
  stateCard: { alignItems: 'center', backgroundColor: '#100607', borderColor: 'rgba(232,190,97,0.28)', borderRadius: radius.xl, borderWidth: 1, gap: spacing.md, justifyContent: 'center', minHeight: 260, padding: spacing.xl },
  stateTitle: { color: colors.text, fontSize: 18, fontWeight: typography.weights.black, textAlign: 'center', writingDirection: 'rtl' },
  stateText: { color: colors.textMuted, fontSize: 13, textAlign: 'center', writingDirection: 'rtl' },
});
