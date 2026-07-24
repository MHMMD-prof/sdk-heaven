import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { ScreenContainer } from './ScreenContainer';
import { RepresentativeBadge } from './RepresentativeBadge';
import { getRoomCountry, roomCountries } from '../data/roomCountries';
import { updatePublicProfilePresentation } from '../social/publicProfile';
import type {
  ProfileGender,
  PublicProfileLoadStatus,
  PublicUserProfile,
  StoreCurrencyAmounts,
} from '../social/types';
import { colors, radius, spacing, typography } from '../theme';
import type { RoomCountryCode } from '../types/voice';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

type MeProfilePageProps = {
  balances?: StoreCurrencyAmounts;
  bottomNavigation?: ReactNode;
  fallbackAvatarLabel?: string;
  fallbackDisplayName?: string;
  loadError?: string;
  onOpenCouples?: () => void;
  onOpenDiscovery?: () => void;
  onOpenFriends?: () => void;
  onOpenGifts?: () => void;
  onOpenMyItems: () => void;
  onOpenNotifications?: () => void;
  onOpenRepresentativeTransfer?: () => void;
  onOpenSettings: () => void;
  onOpenStore: () => void;
  onOpenWallet?: () => void;
  onRetry: () => void;
  profile?: PublicUserProfile;
  status: PublicProfileLoadStatus;
};

type ActionItem = {
  icon: SymbolName;
  label: string;
  onPress?: () => void;
};

export function MeProfilePage({
  balances,
  bottomNavigation,
  fallbackAvatarLabel = '؟',
  fallbackDisplayName = 'الملف الشخصي',
  loadError = '',
  onOpenCouples,
  onOpenDiscovery,
  onOpenFriends,
  onOpenGifts,
  onOpenMyItems,
  onOpenNotifications,
  onOpenRepresentativeTransfer,
  onOpenSettings,
  onOpenStore,
  onOpenWallet,
  onRetry,
  profile,
  status,
}: MeProfilePageProps) {
  const { width } = useWindowDimensions();
  const compact = width < 390;
  const [editorVisible, setEditorVisible] = useState(false);
  const country = getRoomCountry(profile?.countryCode);

  const quickActions = useMemo<ActionItem[]>(() => [
    {
      icon: { ios: 'wallet.bifold.fill', android: 'account_balance_wallet', web: 'account_balance_wallet' } as SymbolName,
      label: 'المحفظة',
      onPress: onOpenWallet,
    },
    {
      icon: { ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' },
      label: 'عناصري',
      onPress: onOpenMyItems,
    },
    {
      icon: { ios: 'bag.fill', android: 'storefront', web: 'storefront' },
      label: 'المتجر',
      onPress: onOpenStore,
    },
    {
      icon: { ios: 'bell.fill', android: 'notifications', web: 'notifications' } as SymbolName,
      label: 'الإشعارات',
      onPress: onOpenNotifications,
    },
    {
      icon: { ios: 'person.2.fill', android: 'group', web: 'group' } as SymbolName,
      label: 'الأصدقاء',
      onPress: onOpenFriends,
    },
    {
      icon: { ios: 'gift.fill', android: 'redeem', web: 'redeem' } as SymbolName,
      label: 'الهدايا',
      onPress: onOpenGifts,
    },
  ], [
    onOpenFriends,
    onOpenGifts,
    onOpenMyItems,
    onOpenNotifications,
    onOpenStore,
    onOpenWallet,
  ]);

  const secondaryActions = useMemo<Array<ActionItem & { onPress: () => void }>>(() => [
    ...(onOpenCouples ? [{
      icon: { ios: 'heart.fill', android: 'favorite', web: 'favorite' } as SymbolName,
      label: 'الارتباط والطلبات',
      onPress: onOpenCouples,
    }] : []),
    ...(onOpenDiscovery ? [{
      icon: { ios: 'person.2.fill', android: 'person_search', web: 'person_search' } as SymbolName,
      label: 'اكتشاف المستخدمين',
      onPress: onOpenDiscovery,
    }] : []),
    ...(onOpenRepresentativeTransfer ? [{
      icon: { ios: 'arrow.left.arrow.right.circle.fill', android: 'currency_exchange', web: 'currency_exchange' } as SymbolName,
      label: 'إعادة شحن الوكيل',
      onPress: onOpenRepresentativeTransfer,
    }] : []),
  ], [onOpenCouples, onOpenDiscovery, onOpenRepresentativeTransfer]);

  return (
    <ScreenContainer
      bottomInset={Boolean(bottomNavigation)}
      decorativeGlows={false}
      fixedBottom={bottomNavigation}
      horizontalPadding={0}
      topPadding={0}
      variant="ruby"
    >
      <View style={styles.page}>
        <View style={styles.header}>
          <HeaderAction
            accessibilityLabel="الإشعارات"
            disabled={!onOpenNotifications}
            icon={{ ios: 'ellipsis.message.fill', android: 'chat', web: 'chat' }}
            onPress={onOpenNotifications}
          />
          <Text style={styles.headerTitle}>أنا</Text>
          <HeaderAction
            accessibilityLabel="الإعدادات"
            icon={{ ios: 'gearshape.fill', android: 'settings', web: 'settings' }}
            onPress={onOpenSettings}
          />
        </View>
        <View style={styles.headerRule}><View style={styles.headerGem} /></View>

        {status === 'loading' ? <ProfileLoading /> : null}
        {status === 'error' || status === 'missing' ? (
          <ProfileError
            message={loadError || (status === 'missing'
              ? 'لم يكتمل هذا الملف الشخصي بعد.'
              : 'تعذر تحميل الملف الشخصي الآن.')}
            onRetry={onRetry}
          />
        ) : null}

        {profile ? (
          <View style={styles.content}>
            <View style={styles.profileCardShell}>
              <LinearGradient
                colors={['#F2D68B', '#8E5A1D', '#E6BD63', '#6B3D13']}
                end={{ x: 0.1, y: 1 }}
                start={{ x: 0.9, y: 0 }}
                style={styles.profileCardFrame}
              >
                <LinearGradient
                  colors={['#651019', '#31090E', '#110506']}
                  end={{ x: 0.08, y: 1 }}
                  start={{ x: 0.95, y: 0 }}
                  style={styles.profileCard}
                >
                  <LinearGradient
                    colors={['rgba(255,224,143,0.13)', 'rgba(255,224,143,0.025)', 'transparent']}
                    end={{ x: 0.15, y: 1 }}
                    pointerEvents="none"
                    start={{ x: 0.9, y: 0 }}
                    style={styles.cardSheen}
                  />
                  <View style={styles.cardGlow} />
                  <View style={[styles.identityRow, compact && styles.identityRowCompact]}>
                    <View style={styles.identityCopy}>
                      <View style={styles.nameRow}>
                        {country ? <Image accessibilityLabel={country.label} source={country.flag} style={styles.flag} /> : null}
                        <Text
                          ellipsizeMode="tail"
                          maxFontSizeMultiplier={1.15}
                          numberOfLines={2}
                          style={[styles.displayName, compact && styles.displayNameCompact]}
                        >
                          {profile.displayName || fallbackDisplayName}
                        </Text>
                      </View>
                      <RepresentativeBadge
                        active={profile.representativeBadgeActive}
                        variant="full"
                      />
                      <Text selectable style={styles.publicId}>ID: {profile.publicId}</Text>
                      {profile.specialId ? <Text selectable style={styles.specialId}>المعرّف المميز {profile.specialId}</Text> : null}
                      <View style={styles.balanceRow}>
                        <BalancePill
                          icon={{ ios: 'diamond.fill', android: 'diamond', web: 'diamond' }}
                          tint="#91DFFF"
                          value={balances?.diamonds}
                        />
                        <BalancePill
                          icon={{ ios: 'circle.hexagongrid.fill', android: 'paid', web: 'paid' }}
                          tint="#F3C75C"
                          value={balances?.coins}
                        />
                      </View>
                    </View>
                  </View>

                  <View style={styles.statsPanel}>
                    <View style={styles.statsNotch} />
                    <ProfileStat icon={{ ios: 'person.2.fill', android: 'group', web: 'group' }} label="الأصدقاء" value={profile.friendCount} />
                    <View style={styles.statDivider} />
                    <ProfileStat icon={{ ios: 'heart.fill', android: 'favorite', web: 'favorite' }} label="نقاط الهدايا" value={profile.giftScore} />
                    <View style={styles.statDivider} />
                    <ProfileStat icon={{ ios: 'link', android: 'link', web: 'link' }} label="مستوى الارتباط" value={profile.coupleLevel} />
                    <View style={styles.statDivider} />
                    <ProfileStat icon={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }} label="عضو منذ" value={formatMemberYear(profile.createdAt)} />
                  </View>
                </LinearGradient>
              </LinearGradient>
              <View style={[styles.avatarOverlay, compact && styles.avatarOverlayCompact]}>
                <Avatar
                  avatarLabel={fallbackAvatarLabel}
                  avatarUrl={profile.avatarModerationStatus === 'clear' ? profile.avatarUrl : ''}
                  compact={compact}
                />
              </View>
            </View>

            <Text style={styles.sectionLabel}>الوصول السريع</Text>
            <View style={styles.quickGrid}>
              {quickActions.map((action, index) => {
                const row = Math.floor(index / 3);
                const column = index % 3;
                const rowCount = Math.ceil(quickActions.length / 3);
                const itemsInRow = Math.min(3, quickActions.length - (row * 3));
                return (
                  <QuickAction
                    action={action}
                    key={action.label}
                    showBottomBorder={row < rowCount - 1}
                    showSideBorder={column < itemsInRow - 1}
                  />
                );
              })}
            </View>

            <View style={styles.settingsCard}>
              <SettingsRow
                icon={{ ios: 'pencil', android: 'manage_accounts', web: 'manage_accounts' }}
                label="تعديل الملف"
                onPress={() => setEditorVisible(true)}
              />
              <SettingsRow
                icon={{ ios: 'gearshape.fill', android: 'settings', web: 'settings' }}
                label="الإعدادات"
                onPress={onOpenSettings}
              />
              <SettingsRow
                icon={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }}
                label="تحديث البيانات"
                last
                onPress={onRetry}
              />
            </View>

            {secondaryActions.length ? (
              <View style={styles.settingsCard}>
                {secondaryActions.map((action, index) => (
                  <SettingsRow
                    icon={action.icon}
                    key={action.label}
                    label={action.label}
                    last={index === secondaryActions.length - 1}
                    onPress={action.onPress}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {profile ? (
        <ProfileEditor
          onClose={() => setEditorVisible(false)}
          profile={profile}
          visible={editorVisible}
        />
      ) : null}
    </ScreenContainer>
  );
}

function HeaderAction({ accessibilityLabel, disabled = false, icon, onPress }: {
  accessibilityLabel: string;
  disabled?: boolean;
  icon: SymbolName;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.headerAction, disabled && styles.headerActionDisabled, pressed && styles.pressed]}
    >
      <SymbolView name={icon} size={27} tintColor="#D6AA57" />
    </Pressable>
  );
}

function Avatar({ avatarLabel, avatarUrl, compact }: { avatarLabel: string; avatarUrl: string; compact: boolean }) {
  const size = compact ? 108 : 124;
  return (
    <View style={[styles.avatarFrame, { height: size, width: size }]}>
      <LinearGradient colors={['#FFE9A5', '#A96D18', '#F8D981']} style={styles.avatarBorder}>
        <View style={styles.avatarInner}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
          ) : (
            <LinearGradient colors={['#31090D', '#150506', '#080303']} style={styles.avatarFallback}>
              <View style={styles.avatarMonogramGlow} />
              <Text style={styles.avatarLabel}>{[...avatarLabel.trim()][0] || '؟'}</Text>
            </LinearGradient>
          )}
          <View pointerEvents="none" style={styles.avatarInnerRing} />
        </View>
      </LinearGradient>
      <View style={[styles.avatarSideJewel, styles.avatarSideJewelLeft]} />
      <View style={[styles.avatarSideJewel, styles.avatarSideJewelRight]} />
      <View style={styles.avatarJewel} />
    </View>
  );
}

function BalancePill({ icon, tint, value }: {
  icon: SymbolName;
  tint: string;
  value?: number;
}) {
  return (
    <LinearGradient colors={['rgba(35,9,11,0.94)', 'rgba(8,3,3,0.9)']} style={styles.balancePill}>
      <SymbolView name={icon} size={20} tintColor={tint} />
      <Text maxFontSizeMultiplier={1.15} style={styles.balanceValue}>{formatNumber(value || 0)}</Text>
    </LinearGradient>
  );
}

function ProfileStat({ icon, label, value }: { icon: SymbolName; label: string; value: number | string }) {
  return (
    <View style={styles.stat}>
      <View style={styles.statIconShell}>
        <SymbolView name={icon} size={16} tintColor="#E1B95E" />
      </View>
      <Text style={styles.statValue}>{typeof value === 'number' ? formatNumber(value) : value}</Text>
      <Text numberOfLines={1} style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function QuickAction({ action, showBottomBorder, showSideBorder }: {
  action: ActionItem;
  showBottomBorder: boolean;
  showSideBorder: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={action.label}
      accessibilityRole="button"
      accessibilityState={{ disabled: !action.onPress }}
      disabled={!action.onPress}
      onPress={action.onPress}
      style={({ pressed }) => [
        styles.quickAction,
        showBottomBorder && styles.quickActionBottomBorder,
        showSideBorder && styles.quickActionSideBorder,
        !action.onPress && styles.quickActionDisabled,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.quickIconShell}>
        <SymbolView name={action.icon} size={22} tintColor="#DDB761" />
      </View>
      <Text maxFontSizeMultiplier={1.15} numberOfLines={1} style={styles.quickActionLabel}>{action.label}</Text>
    </Pressable>
  );
}

function SettingsRow({ icon, label, last = false, onPress }: {
  icon: SymbolName;
  label: string;
  last?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.settingsRow, !last && styles.settingsRowBorder, pressed && styles.pressed]}
    >
      <SymbolView name={icon} size={25} tintColor="#DDB761" />
      <Text style={styles.settingsLabel}>{label}</Text>
      <SymbolView
        name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
        size={19}
        tintColor="#B68E4A"
      />
    </Pressable>
  );
}

function ProfileLoading() {
  return (
    <View style={styles.stateCard}>
      <ActivityIndicator color={colors.gold} size="large" />
      <Text style={styles.stateTitle}>جارٍ تجهيز ملفك الشخصي</Text>
    </View>
  );
}

function ProfileError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.stateCard}>
      <Text style={styles.stateTitle}>{message}</Text>
      <Pressable onPress={onRetry} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
        <Text style={styles.retryText}>إعادة المحاولة</Text>
      </Pressable>
    </View>
  );
}

function ProfileEditor({ onClose, profile, visible }: {
  onClose: () => void;
  profile: PublicUserProfile;
  visible: boolean;
}) {
  const [bio, setBio] = useState(profile.bio);
  const countryRailRef = useRef<ScrollView>(null);
  const [countryCode, setCountryCode] = useState<RoomCountryCode>(profile.countryCode);
  const [errorMessage, setErrorMessage] = useState('');
  const [gender, setGender] = useState<ProfileGender | undefined>(profile.gender);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setBio(profile.bio);
      setCountryCode(profile.countryCode);
      setGender(profile.gender);
      setErrorMessage('');
    }
  }, [profile.bio, profile.countryCode, profile.gender, visible]);

  const remaining = useMemo(() => 160 - bio.length, [bio.length]);
  const save = async () => {
    setSaving(true);
    setErrorMessage('');
    try {
      await updatePublicProfilePresentation(profile.uid, { bio, countryCode, gender });
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'تعذر حفظ الملف الشخصي.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalBackdrop}>
        <View style={styles.editor}>
          <View style={styles.editorHeader}>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={20} tintColor={colors.text} />
            </Pressable>
            <View style={styles.editorHeadingCopy}>
              <Text style={styles.editorTitle}>تعديل الملف العام</Text>
              <Text style={styles.editorSubtitle}>المعلومات التي يراها المستخدمون</Text>
            </View>
          </View>

          <Text style={styles.fieldLabel}>نبذة عني</Text>
          <View style={styles.bioInputShell}>
            <TextInput
              maxLength={160}
              multiline
              onChangeText={setBio}
              placeholder="اكتب نبذة قصيرة عنك"
              placeholderTextColor={colors.textSubtle}
              style={styles.bioInput}
              textAlign="right"
              value={bio}
            />
            <Text style={styles.remaining}>{remaining}</Text>
          </View>

          <Text style={styles.fieldLabel}>الدولة</Text>
          <ScrollView
            contentContainerStyle={styles.countryRail}
            horizontal
            onContentSizeChange={() => countryRailRef.current?.scrollToEnd({ animated: false })}
            ref={countryRailRef}
            showsHorizontalScrollIndicator={false}
          >
            {roomCountries.map((country) => {
              const selected = country.code === countryCode;
              return (
                <Pressable
                  accessibilityLabel={country.label}
                  accessibilityState={{ selected }}
                  key={country.code}
                  onPress={() => setCountryCode(country.code)}
                  style={[styles.countryChoice, selected && styles.countryChoiceSelected]}
                >
                  <Image source={country.flag} style={styles.countryFlag} />
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={styles.fieldLabel}>الجنس</Text>
          <View style={styles.genderRow}>
            <ChoiceChip label="غير محدد" onPress={() => setGender(undefined)} selected={!gender} />
            <ChoiceChip label="ذكر" onPress={() => setGender('male')} selected={gender === 'male'} />
            <ChoiceChip label="أنثى" onPress={() => setGender('female')} selected={gender === 'female'} />
          </View>

          {errorMessage ? <Text style={styles.editorError}>{errorMessage}</Text> : null}
          <Pressable
            disabled={saving}
            onPress={() => void save()}
            style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, saving && styles.disabled]}
          >
            {saving ? <ActivityIndicator color="#27080B" /> : <Text style={styles.saveText}>حفظ التغييرات</Text>}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ChoiceChip({ label, onPress, selected }: { label: string; onPress: () => void; selected: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.choiceChip, selected && styles.choiceChipSelected]}>
      <Text style={[styles.choiceChipText, selected && styles.choiceChipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function formatNumber(value: number) {
  try {
    return new Intl.NumberFormat('en-US').format(value);
  } catch {
    return String(value);
  }
}

function formatMemberYear(value: unknown) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return String((value.toDate() as Date).getFullYear());
  }
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return String(new Date(value.toMillis() as number).getFullYear());
  }
  return 'حديثاً';
}

const styles = StyleSheet.create({
  page: { alignSelf: 'center', maxWidth: 720, minHeight: '100%', paddingHorizontal: spacing.lg, width: '100%' },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 52 },
  headerTitle: { color: '#FFF1CC', fontSize: 20, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  headerAction: { alignItems: 'center', height: 46, justifyContent: 'center', position: 'relative', width: 46 },
  headerActionDisabled: { opacity: 0.52 },
  headerRule: { alignItems: 'center', backgroundColor: 'rgba(216,168,78,0.72)', height: 1, justifyContent: 'center', marginBottom: spacing.md },
  headerGem: { backgroundColor: '#120506', borderColor: '#D8A84E', borderWidth: 1, height: 10, transform: [{ rotate: '45deg' }], width: 10 },
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  profileCardShell: { elevation: 10, paddingTop: 18, position: 'relative', shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.45, shadowRadius: 20 },
  profileCardFrame: { borderRadius: 26, padding: 1 },
  profileCard: { borderRadius: 25, overflow: 'hidden' },
  cardSheen: { height: 128, left: 0, position: 'absolute', right: 0, top: 0 },
  cardGlow: { backgroundColor: 'rgba(204,45,58,0.13)', borderRadius: 110, height: 220, left: -70, position: 'absolute', top: -90, width: 220 },
  identityRow: { alignItems: 'center', minHeight: 162, paddingBottom: spacing.md, paddingLeft: spacing.lg, paddingRight: 150, paddingTop: spacing.md },
  identityRowCompact: { minHeight: 150, paddingLeft: spacing.md, paddingRight: 128 },
  identityCopy: { alignItems: 'flex-end', flex: 1, gap: spacing.sm, minWidth: 0 },
  nameRow: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.sm, maxWidth: '100%' },
  flag: { borderColor: 'rgba(245,210,126,0.58)', borderRadius: 4, borderWidth: 1, height: 20, resizeMode: 'cover', width: 29 },
  displayName: { color: '#FFF4D7', flexShrink: 1, fontSize: 25, fontWeight: typography.weights.black, lineHeight: 31, textAlign: 'right', writingDirection: 'rtl' },
  displayNameCompact: { fontSize: 21, lineHeight: 27 },
  publicId: { color: '#DDB761', fontSize: 15, fontWeight: typography.weights.bold },
  specialId: { color: '#F7D982', fontSize: 12, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  balanceRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'flex-start', marginTop: spacing.xs },
  balancePill: { alignItems: 'center', borderColor: 'rgba(226,183,91,0.44)', borderRadius: radius.full, borderWidth: 1, flexDirection: 'row-reverse', gap: 6, minHeight: 35, minWidth: 78, paddingHorizontal: spacing.sm, shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.24, shadowRadius: 8 },
  balanceValue: { color: '#FFF1CC', fontSize: 14, fontWeight: typography.weights.black },
  avatarFrame: { backgroundColor: '#120405', borderColor: 'rgba(255,231,164,0.26)', borderRadius: radius.full, borderWidth: 1, padding: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.58, shadowRadius: 18 },
  avatarBorder: { borderRadius: radius.full, flex: 1, padding: 3 },
  avatarInner: { alignItems: 'center', backgroundColor: '#170607', borderColor: '#5C3112', borderRadius: radius.full, borderWidth: 1, flex: 1, justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { height: '100%', resizeMode: 'cover', width: '100%' },
  avatarFallback: { alignItems: 'center', flex: 1, justifyContent: 'center', overflow: 'hidden', width: '100%' },
  avatarMonogramGlow: { backgroundColor: 'rgba(190,42,53,0.18)', borderRadius: 48, height: 96, position: 'absolute', right: -32, top: -34, width: 96 },
  avatarInnerRing: { borderColor: 'rgba(255,229,153,0.17)', borderRadius: radius.full, borderWidth: 1, bottom: 6, left: 6, position: 'absolute', right: 6, top: 6 },
  avatarLabel: { color: colors.goldSoft, fontSize: 42, fontWeight: typography.weights.black, textShadowColor: 'rgba(0,0,0,0.65)', textShadowOffset: { width: 0, height: 3 }, textShadowRadius: 6 },
  avatarSideJewel: { backgroundColor: '#9D1825', borderColor: '#F1CD72', borderRadius: 4, borderWidth: 1, height: 8, position: 'absolute', top: '50%', transform: [{ rotate: '45deg' }], width: 8 },
  avatarSideJewelLeft: { left: -2 },
  avatarSideJewelRight: { right: -2 },
  avatarJewel: { backgroundColor: '#A71928', borderColor: '#F1CD72', borderRadius: 7, borderWidth: 2, bottom: -3, height: 14, left: '50%', marginLeft: -7, position: 'absolute', transform: [{ rotate: '45deg' }], width: 14 },
  avatarOverlay: { position: 'absolute', right: 20, top: 0, zIndex: 2 },
  avatarOverlayCompact: { right: 15, top: 4 },
  statsPanel: { alignItems: 'stretch', backgroundColor: 'rgba(8,3,3,0.76)', borderTopColor: 'rgba(226,183,91,0.38)', borderTopWidth: 1, flexDirection: 'row-reverse', minHeight: 96, paddingVertical: spacing.sm, position: 'relative' },
  statsNotch: { backgroundColor: '#21080B', borderColor: 'rgba(226,183,91,0.58)', borderLeftWidth: 1, borderTopWidth: 1, height: 16, left: '50%', marginLeft: -8, position: 'absolute', top: -8, transform: [{ rotate: '45deg' }], width: 16 },
  stat: { alignItems: 'center', flex: 1, gap: 2, justifyContent: 'center', paddingHorizontal: 2 },
  statIconShell: { alignItems: 'center', backgroundColor: 'rgba(103,27,32,0.34)', borderColor: 'rgba(226,183,91,0.22)', borderRadius: radius.full, borderWidth: 1, height: 29, justifyContent: 'center', marginBottom: 1, width: 29 },
  statValue: { color: '#FFF1CC', fontSize: 16, fontWeight: typography.weights.black },
  statLabel: { color: '#C8BCA8', fontSize: 10, fontWeight: typography.weights.semibold, textAlign: 'center', writingDirection: 'rtl' },
  statDivider: { alignSelf: 'center', backgroundColor: 'rgba(226,183,91,0.18)', height: 54, width: 1 },
  sectionLabel: { color: '#DDB761', fontSize: 15, fontWeight: typography.weights.black, marginBottom: -spacing.xs, textAlign: 'right', writingDirection: 'rtl' },
  quickGrid: { backgroundColor: 'rgba(13,7,7,0.96)', borderColor: 'rgba(216,168,78,0.42)', borderRadius: 23, borderWidth: 1, flexDirection: 'row-reverse', flexWrap: 'wrap', overflow: 'hidden' },
  quickAction: { alignItems: 'center', gap: spacing.xs, justifyContent: 'center', minHeight: 92, paddingHorizontal: spacing.xs, width: '33.3333%' },
  quickActionBottomBorder: { borderBottomColor: 'rgba(216,168,78,0.16)', borderBottomWidth: 1 },
  quickActionSideBorder: { borderLeftColor: 'rgba(216,168,78,0.16)', borderLeftWidth: 1 },
  quickIconShell: { alignItems: 'center', backgroundColor: 'rgba(70,21,24,0.35)', borderColor: 'rgba(216,168,78,0.38)', borderRadius: radius.full, borderWidth: 1, height: 46, justifyContent: 'center', width: 46 },
  quickActionLabel: { color: '#F8E8C1', fontSize: 12, fontWeight: typography.weights.bold, textAlign: 'center', writingDirection: 'rtl' },
  quickActionDisabled: { opacity: 0.48 },
  settingsCard: { backgroundColor: 'rgba(13,7,7,0.96)', borderColor: 'rgba(216,168,78,0.38)', borderRadius: 23, borderWidth: 1, overflow: 'hidden' },
  settingsRow: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.md, minHeight: 58, paddingHorizontal: spacing.lg },
  settingsRowBorder: { borderBottomColor: 'rgba(216,168,78,0.14)', borderBottomWidth: 1 },
  settingsLabel: { color: '#FFF0D0', flex: 1, fontSize: 15, fontWeight: typography.weights.bold, textAlign: 'right', writingDirection: 'rtl' },
  stateCard: { alignItems: 'center', backgroundColor: '#100607', borderColor: 'rgba(232,190,97,0.3)', borderRadius: radius.xl, borderWidth: 1, gap: spacing.md, justifyContent: 'center', minHeight: 260, padding: spacing.xl },
  stateTitle: { color: colors.text, fontSize: 18, fontWeight: typography.weights.black, textAlign: 'center', writingDirection: 'rtl' },
  retryButton: { backgroundColor: colors.gold, borderRadius: radius.full, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  retryText: { color: '#2A090C', fontWeight: typography.weights.black, writingDirection: 'rtl' },
  pressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
  modalBackdrop: { backgroundColor: 'rgba(0,0,0,0.82)', flex: 1, justifyContent: 'flex-end' },
  editor: { alignSelf: 'center', backgroundColor: '#100607', borderColor: 'rgba(232,190,97,0.42)', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, gap: spacing.md, maxWidth: 720, paddingBottom: spacing.xxl, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, width: '100%' },
  editorHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  editorHeadingCopy: { alignItems: 'flex-end', flex: 1 },
  editorTitle: { color: colors.text, fontSize: 20, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  editorSubtitle: { color: colors.textMuted, fontSize: 12, writingDirection: 'rtl' },
  closeButton: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.full, height: 42, justifyContent: 'center', width: 42 },
  fieldLabel: { color: colors.goldSoft, fontSize: 13, fontWeight: typography.weights.bold, textAlign: 'right', writingDirection: 'rtl' },
  bioInputShell: { backgroundColor: '#090405', borderColor: 'rgba(232,190,97,0.26)', borderRadius: radius.lg, borderWidth: 1, minHeight: 112, padding: spacing.md },
  bioInput: { color: colors.text, flex: 1, fontSize: 15, minHeight: 72, textAlignVertical: 'top', writingDirection: 'rtl' },
  remaining: { color: colors.textSubtle, fontSize: 11, textAlign: 'left' },
  countryRail: { flexDirection: 'row-reverse', gap: spacing.sm, paddingVertical: 2 },
  countryChoice: { alignItems: 'center', backgroundColor: colors.surface, borderColor: 'transparent', borderRadius: radius.md, borderWidth: 2, height: 48, justifyContent: 'center', width: 58 },
  countryChoiceSelected: { backgroundColor: 'rgba(123,20,30,0.7)', borderColor: colors.gold },
  countryFlag: { borderRadius: 3, height: 25, resizeMode: 'cover', width: 38 },
  genderRow: { flexDirection: 'row-reverse', gap: spacing.sm },
  choiceChip: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.full, borderWidth: 1, flex: 1, minHeight: 42, justifyContent: 'center' },
  choiceChipSelected: { backgroundColor: '#72121A', borderColor: colors.gold },
  choiceChipText: { color: colors.textMuted, fontSize: 13, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  choiceChipTextSelected: { color: colors.goldSoft },
  editorError: { color: '#FF8690', fontSize: 13, textAlign: 'right', writingDirection: 'rtl' },
  saveButton: { alignItems: 'center', backgroundColor: colors.gold, borderRadius: radius.full, justifyContent: 'center', minHeight: 52 },
  saveText: { color: '#27080B', fontSize: 15, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  disabled: { opacity: 0.55 },
});
