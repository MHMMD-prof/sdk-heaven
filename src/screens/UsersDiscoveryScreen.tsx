import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { ScreenContainer } from '../components/ScreenContainer';
import { RepresentativeBadge } from '../components/RepresentativeBadge';
import { getRoomCountry, roomCountries } from '../data/roomCountries';
import { requestUserDiscovery } from '../social/requestSocialCommand';
import type { PublicUserProfile } from '../social/types';
import { useRepresentativeBadgeProjection } from '../social/useRepresentativeBadgeProjection';
import { useSocialFeatureFlags } from '../social/useSocialFeatureFlags';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import type { RoomCountryCode } from '../types/voice';
import { AvatarFrameLayer } from '../components/AvatarPresentation';
import { useCosmeticsFeatureFlags, type CosmeticsFeatureFlags } from '../cosmetics/featureFlags';

type UsersDiscoveryScreenProps = NativeStackScreenProps<RootStackParamList, 'UsersDiscovery'>;
type CountryFilter = 'all' | RoomCountryCode;

export function UsersDiscoveryScreen({ navigation }: UsersDiscoveryScreenProps) {
  const flags = useSocialFeatureFlags();
  const cosmeticsFlags = useCosmeticsFeatureFlags();
  const { width } = useWindowDimensions();
  const countryRailRef = useRef<ScrollView>(null);
  const requestSequence = useRef(0);
  const [country, setCountry] = useState<CountryFilter>('all');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState<PublicUserProfile[]>([]);
  const badgeUids = useMemo(() => users.map((profile) => profile.uid), [users]);
  const activeBadges = useRepresentativeBadgeProjection(badgeUids);
  const columns = width >= 620 ? 2 : 1;

  const search = useCallback(async (nextQuery: string, nextCountry: CountryFilter) => {
    const trimmedQuery = nextQuery.trim();

    if (trimmedQuery && !/^[0-9]{7}$/.test(trimmedQuery) && [...trimmedQuery].length < 2) {
      setErrorMessage('اكتب حرفين على الأقل أو رقم مستخدم من ثمانية أرقام.');
      setUsers([]);
      return;
    }

    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setErrorMessage('');
    setLoading(true);
    const result = await requestUserDiscovery({
      ...(nextCountry === 'all' ? {} : { countryCode: nextCountry }),
      limit: 16,
      query: trimmedQuery,
    });

    if (sequence !== requestSequence.current) {
      return;
    }

    setLoading(false);

    if (!result.ok) {
      setUsers([]);
      setErrorMessage(result.error.messageAr);
      return;
    }

    setUsers(result.result.users);
  }, []);

  useEffect(() => {
    if (flags.usersDiscovery) {
      void search('', 'all');
    }
  }, [flags.usersDiscovery, search]);

  const chooseCountry = (nextCountry: CountryFilter) => {
    setCountry(nextCountry);
    void search(query, nextCountry);
  };

  if (!flags.usersDiscovery) {
    return <DiscoveryUnavailable onBack={navigation.goBack} />;
  }

  return (
    <ScreenContainer
      decorativeGlows={false}
      horizontalPadding={0}
      scroll={false}
      topPadding={0}
      variant="ruby"
    >
      <View style={styles.page}>
        <LinearGradient colors={['#080303', '#4F0C13', '#160506']} style={styles.header}>
          <View style={styles.titleRail}>
            <Pressable
              accessibilityLabel="رجوع"
              onPress={navigation.goBack}
              style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}
            >
              <SymbolView
                name={{ ios: 'chevron.right', android: 'arrow_forward', web: 'arrow_forward' }}
                size={22}
                tintColor={colors.goldSoft}
              />
            </Pressable>
            <View style={styles.titleCopy}>
              <Text style={styles.eyebrow}>المجتمع</Text>
              <Text style={styles.title}>اكتشف المستخدمين</Text>
            </View>
            <View style={styles.roundPlaceholder} />
          </View>

          <View style={styles.searchShell}>
            <Pressable
              accessibilityLabel="بحث"
              onPress={() => void search(query, country)}
              style={({ pressed }) => [styles.searchButton, pressed && styles.pressed]}
            >
              <SymbolView
                name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
                size={23}
                tintColor="#2A080B"
              />
            </Pressable>
            <TextInput
              autoCorrect={false}
              onChangeText={setQuery}
              onSubmitEditing={() => void search(query, country)}
              placeholder="ابحث بالاسم أو رقم المستخدم"
              placeholderTextColor={colors.textSubtle}
              returnKeyType="search"
              style={styles.searchInput}
              textAlign="right"
              value={query}
            />
          </View>
        </LinearGradient>

        <View style={styles.countrySection}>
          <ScrollView
            contentContainerStyle={styles.countryRail}
            horizontal
            onContentSizeChange={() => countryRailRef.current?.scrollToEnd({ animated: false })}
            ref={countryRailRef}
            showsHorizontalScrollIndicator={false}
          >
            <Pressable
              accessibilityLabel="كل الدول"
              accessibilityState={{ selected: country === 'all' }}
              onPress={() => chooseCountry('all')}
              style={[styles.countryChoice, country === 'all' && styles.countryChoiceSelected]}
            >
              <SymbolView
                name={{ ios: 'globe', android: 'public', web: 'public' }}
                size={27}
                tintColor={country === 'all' ? colors.goldSoft : colors.textMuted}
              />
            </Pressable>
            {roomCountries.map((item) => {
              const selected = country === item.code;
              return (
                <Pressable
                  accessibilityLabel={item.label}
                  accessibilityState={{ selected }}
                  key={item.code}
                  onPress={() => chooseCountry(item.code)}
                  style={[styles.countryChoice, selected && styles.countryChoiceSelected]}
                >
                  <Image source={item.flag} style={styles.countryFlag} />
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.resultsHeading}>
          <Text style={styles.resultsCount}>{formatNumber(users.length)}</Text>
          <View style={styles.resultsCopy}>
            <Text style={styles.resultsTitle}>{query.trim() ? 'نتائج البحث' : 'حسابات مقترحة'}</Text>
            <Text style={styles.resultsSubtitle}>ملفات عامة موثوقة ومتاحة لك</Text>
          </View>
        </View>

        <FlatList
          columnWrapperStyle={columns > 1 ? styles.columns : undefined}
          contentContainerStyle={styles.listContent}
          data={users}
          key={columns}
          keyboardShouldPersistTaps="handled"
          keyExtractor={(item) => item.uid}
          ListEmptyComponent={
            loading
              ? <DiscoveryLoading />
              : <DiscoveryEmpty message={errorMessage || 'لا توجد حسابات مطابقة حالياً.'} />
          }
          numColumns={columns}
          renderItem={({ item }) => (
            <UserCard
              badgeActive={activeBadges[item.uid] ?? item.representativeBadgeActive}
              cosmeticsFlags={cosmeticsFlags}
              onPress={() => navigation.navigate('UserProfile', { uid: item.uid })}
              profile={item}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </ScreenContainer>
  );
}

function UserCard({ badgeActive, cosmeticsFlags, onPress, profile }: {
  badgeActive?: boolean;
  cosmeticsFlags: CosmeticsFeatureFlags;
  onPress: () => void;
  profile: PublicUserProfile;
}) {
  const country = getRoomCountry(profile.countryCode);
  const avatarLabel = [...profile.displayName][0] || '؟';

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.userCard, pressed && styles.pressed]}
    >
      <LinearGradient colors={['rgba(104,15,24,0.48)', 'rgba(10,5,5,0.98)']} style={styles.userCardGradient}>
        <View style={styles.userIdentity}>
          <View style={styles.avatarBorder}>
            <View style={styles.avatarInner}>
              {profile.avatarUrl ? (
                <Image source={{ uri: profile.avatarUrl }} style={styles.avatarImage} />
              ) : <Text style={styles.avatarLabel}>{avatarLabel}</Text>}
            </View>
            <AvatarFrameLayer flags={cosmeticsFlags} frame={profile.equippedAvatarFrame} />
          </View>
          <View style={styles.userCopy}>
            <View style={styles.userNameRow}>
              {country ? <Image accessibilityLabel={country.label} source={country.flag} style={styles.smallFlag} /> : null}
              <Text numberOfLines={1} style={styles.userName}>{profile.displayName}</Text>
              <RepresentativeBadge active={badgeActive} />
            </View>
            <Text style={styles.userId}>ID: {profile.publicId}</Text>
          </View>
        </View>
        <Text numberOfLines={2} style={[styles.userBio, !profile.bio && styles.emptyBio]}>
          {profile.bio || 'لم يضف المستخدم نبذة بعد.'}
        </Text>
        <View style={styles.cardFooter}>
          <View style={styles.cardMetric}>
            <SymbolView
              name={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
              size={17}
              tintColor={colors.gold}
            />
            <Text style={styles.cardMetricText}>{formatNumber(profile.friendCount)}</Text>
          </View>
          <View style={styles.openProfilePill}>
            <Text style={styles.openProfileText}>عرض الملف</Text>
            <SymbolView
              name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
              size={17}
              tintColor={colors.goldSoft}
            />
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

function DiscoveryLoading() {
  return (
    <View style={styles.emptyState}>
      <ActivityIndicator color={colors.gold} size="large" />
      <Text style={styles.emptyTitle}>جارٍ البحث عن حسابات</Text>
    </View>
  );
}

function DiscoveryEmpty({ message }: { message: string }) {
  return (
    <View style={styles.emptyState}>
      <SymbolView
        name={{ ios: 'person.2.slash', android: 'person_search', web: 'person_search' }}
        size={42}
        tintColor={colors.gold}
      />
      <Text style={styles.emptyTitle}>{message}</Text>
      <Text style={styles.emptyBody}>جرّب اسماً آخر، رقماً كاملاً، أو اختر كل الدول.</Text>
    </View>
  );
}

function DiscoveryUnavailable({ onBack }: { onBack: () => void }) {
  return (
    <ScreenContainer variant="ruby">
      <View style={styles.unavailable}>
        <SymbolView
          name={{ ios: 'lock.shield.fill', android: 'shield_lock', web: 'shield_lock' }}
          size={48}
          tintColor={colors.gold}
        />
        <Text style={styles.unavailableTitle}>اكتشاف المستخدمين غير متاح حالياً</Text>
        <Text style={styles.emptyBody}>سيظهر هنا عند تفعيله من إدارة التطبيق.</Text>
        <Pressable onPress={onBack} style={styles.backPill}>
          <Text style={styles.backPillText}>رجوع</Text>
        </Pressable>
      </View>
    </ScreenContainer>
  );
}

function formatNumber(value: number) {
  try {
    return new Intl.NumberFormat('ar-IQ').format(value);
  } catch {
    return String(value);
  }
}

const styles = StyleSheet.create({
  page: { alignSelf: 'center', flex: 1, maxWidth: 720, width: '100%' },
  header: { borderBottomColor: 'rgba(232,190,97,0.4)', borderBottomWidth: 1, gap: spacing.lg, paddingBottom: spacing.xl, paddingHorizontal: spacing.lg },
  titleRail: { alignItems: 'center', flexDirection: 'row-reverse', justifyContent: 'space-between', minHeight: 64 },
  titleCopy: { alignItems: 'center' },
  eyebrow: { color: colors.gold, fontSize: 11, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  title: { color: colors.text, fontSize: 22, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  roundButton: { alignItems: 'center', backgroundColor: 'rgba(7,3,3,0.72)', borderColor: 'rgba(232,190,97,0.48)', borderRadius: radius.full, borderWidth: 1, height: 46, justifyContent: 'center', width: 46 },
  roundPlaceholder: { height: 46, width: 46 },
  searchShell: { alignItems: 'center', backgroundColor: '#090405', borderColor: 'rgba(232,190,97,0.42)', borderRadius: radius.full, borderWidth: 1, flexDirection: 'row', minHeight: 54, paddingLeft: 5, paddingRight: spacing.lg },
  searchInput: { color: colors.text, flex: 1, fontSize: 15, minHeight: 50, writingDirection: 'rtl' },
  searchButton: { alignItems: 'center', backgroundColor: colors.gold, borderRadius: radius.full, height: 44, justifyContent: 'center', width: 44 },
  countrySection: { backgroundColor: '#090505', borderBottomColor: 'rgba(232,190,97,0.18)', borderBottomWidth: 1, paddingVertical: spacing.md },
  countryRail: { flexDirection: 'row-reverse', gap: spacing.sm, paddingHorizontal: spacing.lg },
  countryChoice: { alignItems: 'center', backgroundColor: '#211719', borderColor: 'transparent', borderRadius: radius.md, borderWidth: 2, height: 50, justifyContent: 'center', width: 60 },
  countryChoiceSelected: { backgroundColor: '#72121A', borderColor: colors.gold },
  countryFlag: { borderRadius: 3, height: 26, resizeMode: 'cover', width: 40 },
  resultsHeading: { alignItems: 'center', flexDirection: 'row', paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  resultsCopy: { alignItems: 'flex-end', flex: 1 },
  resultsTitle: { color: colors.text, fontSize: 18, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  resultsSubtitle: { color: colors.textSubtle, fontSize: 11, writingDirection: 'rtl' },
  resultsCount: { color: colors.gold, fontSize: 18, fontWeight: typography.weights.black },
  listContent: { flexGrow: 1, gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.xxl },
  columns: { gap: spacing.md },
  userCard: { flex: 1, minWidth: 0 },
  userCardGradient: { borderColor: 'rgba(232,190,97,0.28)', borderRadius: radius.xl, borderWidth: 1, gap: spacing.md, minHeight: 188, padding: spacing.md },
  userIdentity: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.md },
  avatarBorder: { backgroundColor: colors.gold, borderRadius: radius.full, height: 68, padding: 2, width: 68 },
  avatarInner: { alignItems: 'center', backgroundColor: '#21080B', borderRadius: radius.full, flex: 1, justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { height: '100%', resizeMode: 'cover', width: '100%' },
  avatarLabel: { color: colors.goldSoft, fontSize: 28, fontWeight: typography.weights.black },
  userCopy: { alignItems: 'flex-end', flex: 1, gap: 5 },
  userNameRow: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.sm, maxWidth: '100%' },
  userName: { color: colors.text, flexShrink: 1, fontSize: 17, fontWeight: typography.weights.black, textAlign: 'right', writingDirection: 'rtl' },
  smallFlag: { borderRadius: 2, height: 17, resizeMode: 'cover', width: 25 },
  userId: { color: colors.gold, fontSize: 12, fontWeight: typography.weights.bold },
  userBio: { color: colors.textMuted, fontSize: 13, lineHeight: 20, minHeight: 40, textAlign: 'right', writingDirection: 'rtl' },
  emptyBio: { color: colors.textSubtle },
  cardFooter: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  cardMetric: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  cardMetricText: { color: colors.goldSoft, fontSize: 13, fontWeight: typography.weights.bold },
  openProfilePill: { alignItems: 'center', backgroundColor: 'rgba(114,18,26,0.64)', borderColor: 'rgba(232,190,97,0.25)', borderRadius: radius.full, borderWidth: 1, flexDirection: 'row-reverse', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: 7 },
  openProfileText: { color: colors.goldSoft, fontSize: 12, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  emptyState: { alignItems: 'center', gap: spacing.md, justifyContent: 'center', minHeight: 260, padding: spacing.xl },
  emptyTitle: { color: colors.text, fontSize: 17, fontWeight: typography.weights.black, textAlign: 'center', writingDirection: 'rtl' },
  emptyBody: { color: colors.textMuted, fontSize: 13, lineHeight: 21, textAlign: 'center', writingDirection: 'rtl' },
  unavailable: { alignItems: 'center', flex: 1, gap: spacing.md, justifyContent: 'center', padding: spacing.xl },
  unavailableTitle: { color: colors.text, fontSize: 20, fontWeight: typography.weights.black, textAlign: 'center', writingDirection: 'rtl' },
  backPill: { backgroundColor: colors.gold, borderRadius: radius.full, marginTop: spacing.md, minWidth: 120, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  backPillText: { color: '#2A080B', fontWeight: typography.weights.black, textAlign: 'center', writingDirection: 'rtl' },
  pressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
});
