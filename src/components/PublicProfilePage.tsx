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
} from '../social/types';
import { colors, radius, spacing, typography } from '../theme';
import type { RoomCountryCode } from '../types/voice';
import { AvatarFrameLayer } from './AvatarPresentation';
import { useCosmeticsFeatureFlags, type CosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import type { AvatarFrameProjection } from '../cosmetics/avatarFrameProjection';
import { EquipmentCosmeticAsset } from './EquipmentCosmeticAsset';
import { CoupleEffectPresentation } from './CoupleEffectPresentation';
import { StatusBadgeRow } from './status/StatusBadgeRow';
import { StatusBenefitAsset } from './status/StatusBenefitAsset';
import { useStatusFeatureFlags } from '../status/featureFlags';

type PublicProfilePageProps = {
  bottomNavigation?: ReactNode;
  chatAction?: {
    disabled?: boolean;
    onPress: () => void;
  };
  coupleAction?: {
    disabled?: boolean;
    label: string;
    onPress: () => void;
  };
  followAction?: {
    disabled?: boolean;
    label: string;
    onPress: () => void;
  };
  friendAction?: {
    disabled?: boolean;
    label: string;
    onPress: () => void;
  };
  giftAction?: {
    disabled?: boolean;
    onPress: () => void;
  };
  fallbackAvatarLabel?: string;
  fallbackDisplayName?: string;
  isSelf?: boolean;
  loadError?: string;
  onBack: () => void;
  onOpenDiscovery?: () => void;
  onOpenCouples?: () => void;
  onOpenFollowing?: (tab?: 'following' | 'followers') => void;
  onOpenFriends?: () => void;
  onOpenGifts?: () => void;
  onOpenNotifications?: () => void;
  onOpenSettings?: () => void;
  onOpenWallet?: () => void;
  onOpenStore?: () => void;
  onOpenMyItems?: () => void;
  onOpenRepresentativeTransfer?: () => void;
  onRetry: () => void;
  profile?: PublicUserProfile;
  status: PublicProfileLoadStatus;
};

export function PublicProfilePage({
  bottomNavigation,
  chatAction,
  coupleAction,
  followAction,
  friendAction,
  giftAction,
  fallbackAvatarLabel = '؟',
  fallbackDisplayName = 'الملف الشخصي',
  isSelf = false,
  loadError = '',
  onBack,
  onOpenDiscovery,
  onOpenCouples,
  onOpenFollowing,
  onOpenFriends,
  onOpenGifts,
  onOpenNotifications,
  onOpenSettings,
  onOpenWallet,
  onOpenStore,
  onOpenMyItems,
  onOpenRepresentativeTransfer,
  onRetry,
  profile,
  status,
}: PublicProfilePageProps) {
  const cosmeticsFlags = useCosmeticsFeatureFlags();
  const statusFlags = useStatusFeatureFlags();
  const { width } = useWindowDimensions();
  const [editorVisible, setEditorVisible] = useState(false);
  const compact = width < 390;
  const country = getRoomCountry(profile?.countryCode);

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
        <LinearGradient
          colors={['#050303', '#27080B', '#72121A', '#140506']}
          end={{ x: 0, y: 1 }}
          start={{ x: 1, y: 0 }}
          style={styles.hero}
        >
          <EquipmentCosmeticAsset category="profile-skin" enabled={cosmeticsFlags.profileSkins} flags={cosmeticsFlags} projection={profile?.equippedCosmetics?.profileSkin} style={styles.profileSkin} />
          <CoupleEffectPresentation
            flags={cosmeticsFlags}
            projection={profile?.coupleEffect}
            style={styles.coupleEffectHero}
            surface="profile"
          />
          <View style={styles.heroHaloLarge} />
          <View style={styles.heroHaloSmall} />
          <View style={styles.header}>
            <RoundAction
              accessibilityLabel="رجوع"
              icon={{ ios: 'chevron.right', android: 'arrow_forward', web: 'arrow_forward' }}
              onPress={onBack}
            />
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerEyebrow}>{isSelf ? 'حسابي' : 'ملف المستخدم'}</Text>
              <Text style={styles.headerTitle}>{isSelf ? 'ملفي الشخصي' : 'الملف الشخصي'}</Text>
            </View>
            {isSelf && onOpenSettings ? (
              <RoundAction
                accessibilityLabel="إعدادات الحساب"
                icon={{ ios: 'gearshape.fill', android: 'settings', web: 'settings' }}
                onPress={onOpenSettings}
              />
            ) : <View style={styles.actionPlaceholder} />}
          </View>

          <View style={styles.identity}>
            <Avatar
              avatarLabel={fallbackAvatarLabel}
              avatarUrl={profile?.avatarModerationStatus === 'clear' ? profile.avatarUrl : ''}
              compact={compact}
              flags={cosmeticsFlags}
              frame={profile?.equippedAvatarFrame}
              statusPresentation={statusFlags.statusPresentation ? profile?.statusPresentation : undefined}
            />
            <View style={styles.identityCopy}>
              <View style={styles.nameRow}>
                <EquipmentCosmeticAsset category="nameplate" enabled={cosmeticsFlags.nameplates} flags={cosmeticsFlags} projection={profile?.equippedCosmetics?.nameplate} style={styles.nameplate} />
                {country ? <Image accessibilityLabel={country.label} source={country.flag} style={styles.flag} /> : null}
                <Text numberOfLines={1} style={styles.displayName}>
                  {profile?.displayName || fallbackDisplayName}
                </Text>
                <EquipmentCosmeticAsset category="cosmetic-badge" enabled={cosmeticsFlags.cosmeticBadges} flags={cosmeticsFlags} projection={profile?.equippedCosmetics?.cosmeticBadge} style={styles.cosmeticBadge} />
              </View>
              <RepresentativeBadge
                active={profile?.representativeBadgeActive}
                variant="full"
              />
              {statusFlags.statusPresentation ? <StatusBadgeRow presentation={profile?.statusPresentation} /> : null}
              {profile?.family ? (
                <View style={[styles.familyChip, { borderColor: profile.family.badgeColor }]}>
                  <Text style={[styles.familyChipText, { color: profile.family.badgeColor }]}>
                    عائلة {profile.family.nameAr}
                  </Text>
                </View>
              ) : null}
              {profile ? (
                <View style={styles.identityIds}>
                  {profile.specialId ? (
                    <LinearGradient colors={['#FFE8A0', '#B97819', '#FFF0B8']} style={styles.specialIdPill}>
                      <SymbolView
                        name={{ ios: 'sparkles', android: 'diamond', web: 'diamond' }}
                        size={16}
                        tintColor="#3A1208"
                      />
                      <Text selectable style={styles.specialIdText}>المعرّف المميز {profile.specialId}</Text>
                    </LinearGradient>
                  ) : null}
                  <View style={styles.publicIdPill}>
                    <SymbolView
                      name={{ ios: 'number.square.fill', android: 'badge', web: 'badge' }}
                      size={17}
                      tintColor={colors.goldSoft}
                    />
                    <Text selectable style={styles.publicIdText}>معرّف الحساب {profile.publicId}</Text>
                  </View>
                </View>
              ) : null}
            </View>
          </View>
        </LinearGradient>

        <View style={styles.content}>
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
            <>
              <View style={styles.statsPanel}>
                <Pressable disabled={!onOpenFollowing} onPress={() => onOpenFollowing?.('followers')} style={styles.statPressable}>
                  <ProfileStat label="المتابعون" value={profile.followerCount} />
                </Pressable>
                <View style={styles.statDivider} />
                <Pressable disabled={!onOpenFollowing} onPress={() => onOpenFollowing?.('following')} style={styles.statPressable}>
                  <ProfileStat label="يتابع" value={profile.followingCount} />
                </Pressable>
                <View style={styles.statDivider} />
                <ProfileStat label="الأصدقاء" value={profile.friendCount} />
                <View style={styles.statDivider} />
                <ProfileStat label="نقاط الهدايا" value={profile.giftScore} />
              </View>

              {!isSelf && followAction ? (
                <Pressable
                  disabled={followAction.disabled}
                  onPress={followAction.onPress}
                  style={({ pressed }) => [
                    styles.friendAction,
                    pressed && styles.pressed,
                    followAction.disabled && styles.disabled,
                  ]}
                >
                  {followAction.disabled ? (
                    <ActivityIndicator color="#2A090C" />
                  ) : (
                    <SymbolView
                      name={{ ios: 'person.crop.circle.badge.plus', android: 'person_add_alt', web: 'person_add_alt' }}
                      size={21}
                      tintColor="#2A090C"
                    />
                  )}
                  <Text style={styles.friendActionText}>{followAction.label}</Text>
                </Pressable>
              ) : null}

              {!isSelf && friendAction ? (
                <Pressable
                  disabled={friendAction.disabled}
                  onPress={friendAction.onPress}
                  style={({ pressed }) => [
                    styles.friendAction,
                    pressed && styles.pressed,
                    friendAction.disabled && styles.disabled,
                  ]}
                >
                  {friendAction.disabled ? (
                    <ActivityIndicator color="#2A090C" />
                  ) : (
                    <SymbolView
                      name={{ ios: 'person.badge.plus', android: 'person_add', web: 'person_add' }}
                      size={21}
                      tintColor="#2A090C"
                    />
                  )}
                  <Text style={styles.friendActionText}>{friendAction.label}</Text>
                </Pressable>
              ) : null}

              {!isSelf && chatAction ? (
                <Pressable
                  disabled={chatAction.disabled}
                  onPress={chatAction.onPress}
                  style={({ pressed }) => [styles.chatAction, pressed && styles.pressed, chatAction.disabled && styles.disabled]}
                >
                  <SymbolView name={{ ios: 'bubble.left.fill', android: 'chat', web: 'chat' }} size={22} tintColor="#2A090C" />
                  <Text style={styles.chatActionText}>محادثة خاصة</Text>
                </Pressable>
              ) : null}

              {!isSelf && giftAction ? (
                <Pressable
                  disabled={giftAction.disabled}
                  onPress={giftAction.onPress}
                  style={({ pressed }) => [styles.giftAction, pressed && styles.pressed, giftAction.disabled && styles.disabled]}
                >
                  <SymbolView name={{ ios: 'gift.fill', android: 'redeem', web: 'redeem' }} size={22} tintColor="#FFF0BE" />
                  <Text style={styles.giftActionText}>إرسال هدية</Text>
                </Pressable>
              ) : null}

              {!isSelf && coupleAction ? (
                <Pressable
                  disabled={coupleAction.disabled}
                  onPress={coupleAction.onPress}
                  style={({ pressed }) => [styles.coupleAction, pressed && styles.pressed, coupleAction.disabled && styles.disabled]}
                >
                  {coupleAction.disabled ? (
                    <ActivityIndicator color="#FFE8A0" />
                  ) : (
                    <SymbolView name={{ ios: 'heart.fill', android: 'favorite', web: 'favorite' }} size={22} tintColor="#FFE8A0" />
                  )}
                  <Text style={styles.coupleActionText}>{coupleAction.label}</Text>
                </Pressable>
              ) : null}

              <View style={styles.profileCard}>
                <View style={styles.sectionHeading}>
                  <SymbolView
                    name={{ ios: 'quote.bubble.fill', android: 'chat_bubble', web: 'chat_bubble' }}
                    size={21}
                    tintColor={colors.gold}
                  />
                  <Text style={styles.sectionTitle}>نبذة عني</Text>
                </View>
                <Text style={[styles.bio, !profile.bio && styles.emptyBio]}>
                  {profile.bio || (isSelf ? 'أضف نبذة قصيرة ليعرفك الآخرون.' : 'لم يضف المستخدم نبذة بعد.')}
                </Text>
              </View>

              <View style={styles.detailsGrid}>
                <DetailCard
                  icon={{ ios: 'globe.asia.australia.fill', android: 'public', web: 'public' }}
                  label="الدولة"
                  value={country?.label || 'غير محددة'}
                />
                <DetailCard
                  icon={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }}
                  label="عضو منذ"
                  value={formatMemberSince(profile.createdAt)}
                />
              </View>

              {isSelf ? (
                <View style={styles.actionsCard}>
                  {onOpenNotifications ? (
                    <ProfileAction
                      icon={{ ios: 'bell.badge.fill', android: 'notifications_active', web: 'notifications_active' }}
                      label="إعدادات الإشعارات"
                      onPress={onOpenNotifications}
                    />
                  ) : null}
                  {onOpenCouples ? (
                    <ProfileAction
                      icon={{ ios: 'heart.fill', android: 'favorite', web: 'favorite' }}
                      label="الارتباط والطلبات"
                      onPress={onOpenCouples}
                    />
                  ) : null}
                  {onOpenGifts ? (
                    <ProfileAction
                      icon={{ ios: 'gift.fill', android: 'redeem', web: 'redeem' }}
                      label="الهدايا المرسلة والمستلمة"
                      onPress={onOpenGifts}
                    />
                  ) : null}
                  {onOpenWallet ? (
                    <ProfileAction
                      icon={{ ios: 'wallet.bifold.fill', android: 'account_balance_wallet', web: 'account_balance_wallet' }}
                      label="المحفظة ومتجر المعرّفات"
                      onPress={onOpenWallet}
                    />
                  ) : null}
                  {onOpenStore ? (
                    <ProfileAction
                      icon={{ ios: 'bag.fill', android: 'storefront', web: 'storefront' }}
                      label="المتجر"
                      onPress={onOpenStore}
                    />
                  ) : null}
                  {onOpenMyItems ? (
                    <ProfileAction
                      icon={{ ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' }}
                      label="عناصري"
                      onPress={onOpenMyItems}
                    />
                  ) : null}
                  {onOpenRepresentativeTransfer ? (
                    <ProfileAction
                      icon={{ ios: 'arrow.left.arrow.right.circle.fill', android: 'currency_exchange', web: 'currency_exchange' }}
                      label="إعادة شحن الوكيل"
                      onPress={onOpenRepresentativeTransfer}
                    />
                  ) : null}
                  {onOpenFriends ? (
                    <ProfileAction
                      icon={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
                      label="الأصدقاء والطلبات"
                      onPress={onOpenFriends}
                    />
                  ) : null}
                  {onOpenFollowing ? (
                    <ProfileAction
                      icon={{ ios: 'person.line.dotted.person.fill', android: 'group', web: 'group' }}
                      label="المتابعون ويتابع"
                      onPress={() => onOpenFollowing()}
                    />
                  ) : null}
                  {onOpenDiscovery ? (
                    <ProfileAction
                      icon={{ ios: 'person.2.fill', android: 'person_search', web: 'person_search' }}
                      label="اكتشاف المستخدمين"
                      onPress={onOpenDiscovery}
                    />
                  ) : null}
                  <ProfileAction
                    icon={{ ios: 'pencil', android: 'edit', web: 'edit' }}
                    label="تعديل الملف العام"
                    onPress={() => setEditorVisible(true)}
                  />
                  {onOpenSettings ? (
                    <ProfileAction
                      icon={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
                      label="إعدادات الحساب والأمان"
                      onPress={onOpenSettings}
                    />
                  ) : null}
                  <ProfileAction
                    icon={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }}
                    label="تحديث بيانات الملف"
                    onPress={onRetry}
                  />
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </View>

      {profile && isSelf ? (
        <ProfileEditor
          onClose={() => setEditorVisible(false)}
          profile={profile}
          visible={editorVisible}
        />
      ) : null}
    </ScreenContainer>
  );
}

function Avatar({ avatarLabel, avatarUrl, compact, flags, frame, statusPresentation }: {
  avatarLabel: string;
  avatarUrl: string;
  compact: boolean;
  flags: CosmeticsFeatureFlags;
  frame?: AvatarFrameProjection;
  statusPresentation?: import('../status/statusPresentation').StatusPresentation;
}) {
  const size = compact ? 96 : 112;
  return (
    <View style={[styles.avatarFrame, { height: size, width: size }]}>
      <LinearGradient colors={['#FFE7A2', '#B77A1F', '#FFF1B5']} style={styles.avatarBorder}>
        <View style={styles.avatarInner}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarLabel}>{[...avatarLabel.trim()][0] || '؟'}</Text>
          )}
        </View>
      </LinearGradient>
      <AvatarFrameLayer flags={flags} frame={frame} />
      <StatusBenefitAsset flags={flags} presentation={statusPresentation} slot="frame" style={styles.statusAvatarFrame} />
    </View>
  );
}

function ProfileStat({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{typeof value === 'number' ? formatNumber(value) : value}</Text>
      <Text numberOfLines={1} style={styles.statLabel}>{label}</Text>
    </View>
  );
}

type SymbolName = ComponentProps<typeof SymbolView>['name'];

function DetailCard({ icon, label, value }: { icon: SymbolName; label: string; value: string }) {
  return (
    <LinearGradient colors={['rgba(96,15,23,0.55)', 'rgba(10,6,6,0.96)']} style={styles.detailCard}>
      <View style={styles.detailIcon}>
        <SymbolView name={icon} size={21} tintColor={colors.goldSoft} />
      </View>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.detailValue}>{value}</Text>
    </LinearGradient>
  );
}

function ProfileAction({ icon, label, onPress }: { icon: SymbolName; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.profileAction, pressed && styles.pressed]}
    >
      <View style={styles.actionIcon}>
        <SymbolView name={icon} size={21} tintColor={colors.goldSoft} />
      </View>
      <Text style={styles.profileActionLabel}>{label}</Text>
      <SymbolView
        name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
        size={20}
        tintColor={colors.textSubtle}
      />
    </Pressable>
  );
}

function RoundAction({ accessibilityLabel, icon, onPress }: {
  accessibilityLabel: string;
  icon: SymbolName;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.roundAction, pressed && styles.pressed]}
    >
      <SymbolView name={icon} size={22} tintColor={colors.goldSoft} />
    </Pressable>
  );
}

function ProfileLoading() {
  return (
    <View style={styles.stateCard}>
      <ActivityIndicator color={colors.gold} size="large" />
      <Text style={styles.stateTitle}>جارٍ تجهيز ملفك الشخصي</Text>
      <Text style={styles.stateBody}>نراجع رقم المستخدم وبيانات الحساب بأمان.</Text>
    </View>
  );
}

function ProfileError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.stateCard}>
      <SymbolView
        name={{ ios: 'person.crop.circle.badge.exclamationmark', android: 'person_alert', web: 'person_alert' }}
        size={42}
        tintColor={colors.gold}
      />
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
              <SymbolView
                name={{ ios: 'xmark', android: 'close', web: 'close' }}
                size={20}
                tintColor={colors.text}
              />
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
    return new Intl.NumberFormat('ar-IQ').format(value);
  } catch {
    return String(value);
  }
}

function formatMemberSince(value: unknown) {
  const date = readTimestampDate(value);

  if (!date) {
    return 'حديثاً';
  }

  try {
    return new Intl.DateTimeFormat('ar-IQ', { month: 'long', year: 'numeric' }).format(date);
  } catch {
    return String(date.getFullYear());
  }
}

function readTimestampDate(value: unknown): Date | undefined {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate() as Date;
  }

  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return new Date(value.toMillis() as number);
  }

  return undefined;
}

const styles = StyleSheet.create({
  coupleEffectHero: { bottom: 0, left: 0, opacity: 0.86, position: 'absolute', right: 0, top: 0, zIndex: 1 },
  profileSkin: { bottom: 0, left: 0, opacity: 0.55, position: 'absolute', right: 0, top: 0 },
  nameplate: { height: 44, left: -12, position: 'absolute', right: -12, top: -8 },
  cosmeticBadge: { height: 24, width: 24, zIndex: 2 },
  page: { alignSelf: 'center', maxWidth: 720, minHeight: '100%', width: '100%' },
  hero: { borderBottomColor: 'rgba(232,190,97,0.48)', borderBottomWidth: 1, minHeight: 286, overflow: 'hidden', paddingBottom: spacing.xxl, paddingHorizontal: spacing.lg },
  heroHaloLarge: { borderColor: 'rgba(246,217,145,0.13)', borderRadius: 180, borderWidth: 1, height: 360, position: 'absolute', right: -140, top: -180, width: 360 },
  heroHaloSmall: { backgroundColor: 'rgba(232,190,97,0.06)', borderRadius: 90, height: 180, left: -80, position: 'absolute', top: 100, width: 180 },
  header: { alignItems: 'center', flexDirection: 'row-reverse', justifyContent: 'space-between', minHeight: 64 },
  headerTitleWrap: { alignItems: 'center' },
  headerEyebrow: { color: colors.gold, fontSize: 11, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  headerTitle: { color: colors.text, fontSize: 20, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  roundAction: { alignItems: 'center', backgroundColor: 'rgba(8,3,3,0.72)', borderColor: 'rgba(232,190,97,0.52)', borderRadius: radius.full, borderWidth: 1, height: 46, justifyContent: 'center', width: 46 },
  actionPlaceholder: { height: 46, width: 46 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.97 }] },
  identity: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.xl, justifyContent: 'center', marginTop: spacing.xl },
  avatarFrame: { borderRadius: radius.full, shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.5, shadowRadius: 20 },
  statusAvatarFrame: { bottom: -8, left: -8, position: 'absolute', right: -8, top: -8 },
  avatarBorder: { borderRadius: radius.full, flex: 1, padding: 3 },
  avatarInner: { alignItems: 'center', backgroundColor: '#160607', borderRadius: radius.full, flex: 1, justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { height: '100%', resizeMode: 'cover', width: '100%' },
  avatarLabel: { color: colors.goldSoft, fontSize: 42, fontWeight: typography.weights.black },
  identityCopy: { alignItems: 'flex-end', flexShrink: 1, gap: spacing.md },
  familyChip: {
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  familyChipText: {
    fontSize: 13,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  nameRow: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.sm, maxWidth: 430 },
  flag: { borderRadius: 3, height: 22, resizeMode: 'cover', width: 32 },
  displayName: { color: '#FFF4D5', flexShrink: 1, fontSize: 28, fontWeight: typography.weights.black, textAlign: 'right', writingDirection: 'rtl' },
  identityIds: { alignItems: 'flex-end', gap: spacing.xs },
  publicIdPill: { alignItems: 'center', backgroundColor: 'rgba(5,2,2,0.65)', borderColor: 'rgba(232,190,97,0.34)', borderRadius: radius.full, borderWidth: 1, flexDirection: 'row-reverse', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 7 },
  publicIdText: { color: colors.goldSoft, fontSize: 14, fontWeight: typography.weights.bold },
  specialIdPill: { alignItems: 'center', borderRadius: radius.full, flexDirection: 'row-reverse', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: 7 },
  specialIdText: { color: '#351007', fontSize: 13, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  content: { gap: spacing.md, padding: spacing.lg },
  statsPanel: { alignItems: 'stretch', backgroundColor: '#100607', borderColor: 'rgba(232,190,97,0.36)', borderRadius: radius.xl, borderWidth: 1, flexDirection: 'row-reverse', minHeight: 94, paddingVertical: spacing.md },
  statPressable: { flex: 1 },
  friendAction: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: colors.gold, borderRadius: radius.full, flexDirection: 'row-reverse', gap: spacing.sm, justifyContent: 'center', minHeight: 50, paddingHorizontal: spacing.xl },
  friendActionText: { color: '#2A090C', fontSize: 15, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  chatAction: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: '#E8BE61', borderColor: '#FFF0BE', borderRadius: radius.full, borderWidth: 1, flexDirection: 'row-reverse', gap: spacing.sm, justifyContent: 'center', minHeight: 50, paddingHorizontal: spacing.xl },
  chatActionText: { color: '#2A090C', fontSize: 15, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  giftAction: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: '#72121A', borderColor: colors.gold, borderRadius: radius.full, borderWidth: 1, flexDirection: 'row-reverse', gap: spacing.sm, justifyContent: 'center', minHeight: 50, paddingHorizontal: spacing.xl },
  giftActionText: { color: '#FFF0BE', fontSize: 15, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  coupleAction: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: '#3A090E', borderColor: '#D89B3C', borderRadius: radius.full, borderWidth: 1, flexDirection: 'row-reverse', gap: spacing.sm, justifyContent: 'center', minHeight: 50, paddingHorizontal: spacing.xl },
  coupleActionText: { color: '#FFE8A0', fontSize: 15, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  stat: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xs },
  statValue: { color: colors.goldSoft, fontSize: 24, fontWeight: typography.weights.black },
  statLabel: { color: colors.textMuted, fontSize: 11, fontWeight: typography.weights.semibold, marginTop: 2, textAlign: 'center', writingDirection: 'rtl' },
  statDivider: { alignSelf: 'center', backgroundColor: 'rgba(232,190,97,0.2)', height: 48, width: 1 },
  profileCard: { backgroundColor: 'rgba(18,7,8,0.94)', borderColor: 'rgba(232,190,97,0.28)', borderRadius: radius.xl, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  sectionHeading: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.sm },
  sectionTitle: { color: colors.goldSoft, fontSize: 18, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  bio: { color: colors.text, fontSize: typography.sizes.body, lineHeight: 24, textAlign: 'right', writingDirection: 'rtl' },
  emptyBio: { color: colors.textSubtle },
  detailsGrid: { flexDirection: 'row-reverse', gap: spacing.md },
  detailCard: { alignItems: 'center', borderColor: 'rgba(232,190,97,0.24)', borderRadius: radius.lg, borderWidth: 1, flex: 1, minHeight: 118, padding: spacing.md },
  detailIcon: { alignItems: 'center', backgroundColor: 'rgba(232,190,97,0.12)', borderRadius: radius.full, height: 40, justifyContent: 'center', marginBottom: spacing.sm, width: 40 },
  detailLabel: { color: colors.textSubtle, fontSize: 11, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  detailValue: { color: colors.text, fontSize: 14, fontWeight: typography.weights.black, marginTop: 3, textAlign: 'center', writingDirection: 'rtl' },
  actionsCard: { backgroundColor: '#0E0607', borderColor: 'rgba(232,190,97,0.24)', borderRadius: radius.xl, borderWidth: 1, overflow: 'hidden' },
  profileAction: { alignItems: 'center', borderBottomColor: 'rgba(232,190,97,0.12)', borderBottomWidth: 1, flexDirection: 'row-reverse', gap: spacing.md, minHeight: 66, paddingHorizontal: spacing.md },
  actionIcon: { alignItems: 'center', backgroundColor: 'rgba(123,20,30,0.58)', borderColor: 'rgba(232,190,97,0.24)', borderRadius: radius.md, borderWidth: 1, height: 40, justifyContent: 'center', width: 40 },
  profileActionLabel: { color: colors.text, flex: 1, fontSize: 15, fontWeight: typography.weights.bold, textAlign: 'right', writingDirection: 'rtl' },
  stateCard: { alignItems: 'center', backgroundColor: '#100607', borderColor: 'rgba(232,190,97,0.3)', borderRadius: radius.xl, borderWidth: 1, gap: spacing.md, justifyContent: 'center', minHeight: 240, padding: spacing.xl },
  stateTitle: { color: colors.text, fontSize: 18, fontWeight: typography.weights.black, textAlign: 'center', writingDirection: 'rtl' },
  stateBody: { color: colors.textMuted, fontSize: 14, textAlign: 'center', writingDirection: 'rtl' },
  retryButton: { backgroundColor: colors.gold, borderRadius: radius.full, minHeight: 44, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  retryText: { color: '#2A090C', fontWeight: typography.weights.black, textAlign: 'center', writingDirection: 'rtl' },
  modalBackdrop: { backgroundColor: 'rgba(0,0,0,0.78)', flex: 1, justifyContent: 'flex-end' },
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
