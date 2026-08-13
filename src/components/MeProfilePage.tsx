import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  AccessibilityInfo,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenContainer } from './ScreenContainer';
import { RepresentativeBadge } from './RepresentativeBadge';
import { getRoomCountry, roomCountries } from '../data/roomCountries';
import { prepareAvatarSource, uploadAuthorizedAvatar } from '../social/avatarUpload';
import {
  requestAvatarFinalize,
  requestAvatarRemove,
  requestAvatarUpload,
  requestProfilePresentationUpdate,
} from '../social/requestSocialCommand';
import type {
  EconomyLoadState,
  ProfileGender,
  PublicProfileLoadStatus,
  PublicUserProfile,
} from '../social/types';
import { colors, radius, spacing, typography } from '../theme';
import type { RoomCountryCode } from '../types/voice';
import type { PayrollProgress } from '../payroll/requestPayrollProgress';
import { AvatarFrameLayer } from './AvatarPresentation';
import { useCosmeticsFeatureFlags, type CosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import type { AvatarFrameProjection } from '../cosmetics/avatarFrameProjection';
import { EquipmentCosmeticAsset } from './EquipmentCosmeticAsset';
import { CoupleEffectPresentation } from './CoupleEffectPresentation';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

type MeProfilePageProps = {
  avatarUploadsEnabled?: boolean;
  economy: EconomyLoadState;
  bottomNavigation?: ReactNode;
  fallbackAvatarLabel?: string;
  fallbackDisplayName?: string;
  loadError?: string;
  onOpenCouples?: () => void;
  onOpenDiscovery?: () => void;
  onOpenFamilies?: () => void;
  onOpenFollowing?: () => void;
  onOpenFollowers?: () => void;
  onOpenFriends?: () => void;
  onOpenBlockedUsers?: () => void;
  onOpenGifts?: () => void;
  onOpenLeaderboards?: () => void;
  onOpenMyItems: () => void;
  onOpenNotifications?: () => void;
  onOpenRepresentativeTransfer?: () => void;
  onOpenSettings: () => void;
  onOpenStore: () => void;
  onOpenWallet?: () => void;
  onRetry: () => void;
  onRefresh: () => void;
  profile?: PublicUserProfile;
  payrollProgress?: PayrollProgress | null;
  payrollError?: string;
  payrollLoading?: boolean;
  status: PublicProfileLoadStatus;
  refreshing: boolean;
  representativeError?: string;
};

type ActionItem = {
  icon: SymbolName;
  label: string;
  onPress?: () => void;
};

export function MeProfilePage({
  avatarUploadsEnabled = false,
  bottomNavigation,
  economy,
  fallbackAvatarLabel = '؟',
  fallbackDisplayName = 'الملف الشخصي',
  loadError = '',
  onOpenBlockedUsers,
  onOpenCouples,
  onOpenDiscovery,
  onOpenFamilies,
  onOpenFollowing,
  onOpenFollowers,
  onOpenFriends,
  onOpenGifts,
  onOpenLeaderboards,
  onOpenMyItems,
  onOpenNotifications,
  onOpenRepresentativeTransfer,
  onOpenSettings,
  onOpenStore,
  onOpenWallet,
  onRetry,
  onRefresh,
  profile,
  payrollProgress,
  payrollError = '',
  payrollLoading = false,
  status,
  refreshing,
  representativeError = '',
}: MeProfilePageProps) {
  const cosmeticsFlags = useCosmeticsFeatureFlags();
  const { width } = useWindowDimensions();
  const compact = width < 390;
  const [editorVisible, setEditorVisible] = useState(false);
  const [salaryVisible, setSalaryVisible] = useState(false);
  const country = getRoomCountry(profile?.countryCode);

  const quickActions = useMemo<ActionItem[]>(() => [
    ...(onOpenWallet ? [{
      icon: { ios: 'wallet.bifold.fill', android: 'account_balance_wallet', web: 'account_balance_wallet' } as SymbolName,
      label: 'المحفظة',
      onPress: onOpenWallet,
    }] : []),
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
    ...(onOpenCouples ? [{
      icon: { ios: 'heart.fill', android: 'favorite', web: 'favorite' } as SymbolName,
      label: 'الارتباط والطلبات',
      onPress: onOpenCouples,
    }] : onOpenNotifications ? [{
      icon: { ios: 'bell.fill', android: 'notifications', web: 'notifications' } as SymbolName,
      label: 'الإشعارات',
      onPress: onOpenNotifications,
    }] : []),
    ...(onOpenFamilies ? [{
      icon: { ios: 'shield.lefthalf.filled', android: 'groups', web: 'groups' } as SymbolName,
      label: 'العائلات',
      onPress: onOpenFamilies,
    }] : []),
    ...(onOpenFriends ? [{
      icon: { ios: 'person.2.fill', android: 'group', web: 'group' } as SymbolName,
      label: 'الأصدقاء',
      onPress: onOpenFriends,
    }] : []),
    ...(onOpenFollowing ? [{
      icon: { ios: 'person.line.dotted.person.fill', android: 'group', web: 'group' } as SymbolName,
      label: 'المتابعة',
      onPress: onOpenFollowing,
    }] : []),
    ...(onOpenGifts ? [{
      icon: { ios: 'gift.fill', android: 'redeem', web: 'redeem' } as SymbolName,
      label: 'الهدايا',
      onPress: onOpenGifts,
    }] : []),
    ...(onOpenLeaderboards ? [{
      icon: { ios: 'trophy.fill', android: 'emoji_events', web: 'emoji_events' } as SymbolName,
      label: 'المتصدرون',
      onPress: onOpenLeaderboards,
    }] : []),
  ], [
    onOpenCouples,
    onOpenFamilies,
    onOpenFollowing,
    onOpenFriends,
    onOpenGifts,
    onOpenLeaderboards,
    onOpenMyItems,
    onOpenNotifications,
    onOpenStore,
    onOpenWallet,
  ]);

  const secondaryActions = useMemo<Array<ActionItem & { onPress: () => void }>>(() => [
    ...(onOpenNotifications ? [{
      icon: { ios: 'bell.fill', android: 'notifications', web: 'notifications' } as SymbolName,
      label: 'الإشعارات',
      onPress: onOpenNotifications,
    }] : []),
    ...(onOpenDiscovery ? [{
      icon: { ios: 'person.2.fill', android: 'person_search', web: 'person_search' } as SymbolName,
      label: 'اكتشاف المستخدمين',
      onPress: onOpenDiscovery,
    }] : []),
    ...(onOpenBlockedUsers ? [{
      icon: { ios: 'hand.raised.fill', android: 'block', web: 'block' } as SymbolName,
      label: 'المحظورون',
      onPress: onOpenBlockedUsers,
    }] : []),
  ], [onOpenBlockedUsers, onOpenCouples, onOpenDiscovery, onOpenNotifications]);

  return (
    <ScreenContainer
      bottomInset={Boolean(bottomNavigation)}
      decorativeGlows={false}
      fixedBottom={bottomNavigation}
      horizontalPadding={0}
      onRefresh={onRefresh}
      refreshing={refreshing}
      topPadding={0}
      variant="ruby"
    >
      <View style={styles.page}>
        <View style={styles.header}>
          <HeaderAction
            accessibilityLabel="الإشعارات"
            disabled={!onOpenNotifications}
            icon={{ ios: 'bell.fill', android: 'notifications', web: 'notifications' }}
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
                  <EquipmentCosmeticAsset
                    category="profile-skin"
                    enabled={cosmeticsFlags.profileSkins}
                    flags={cosmeticsFlags}
                    projection={profile.equippedCosmetics?.profileSkin}
                    style={styles.profileSkin}
                  />
                  <CoupleEffectPresentation
                    flags={cosmeticsFlags}
                    projection={profile.coupleEffect}
                    style={styles.coupleEffectHero}
                    surface="profile"
                  />
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
                        <EquipmentCosmeticAsset category="nameplate" enabled={cosmeticsFlags.nameplates} flags={cosmeticsFlags} projection={profile.equippedCosmetics?.nameplate} style={styles.nameplate} />
                        {country ? <Image accessibilityLabel={country.label} source={country.flag} style={styles.flag} /> : null}
                        <Text
                          ellipsizeMode="tail"
                          maxFontSizeMultiplier={1.4}
                          numberOfLines={2}
                          style={[styles.displayName, compact && styles.displayNameCompact]}
                        >
                          {profile.displayName || fallbackDisplayName}
                        </Text>
                        <EquipmentCosmeticAsset category="cosmetic-badge" enabled={cosmeticsFlags.cosmeticBadges} flags={cosmeticsFlags} projection={profile.equippedCosmetics?.cosmeticBadge} style={styles.cosmeticBadge} />
                      </View>
                      <RepresentativeBadge
                        active={profile.representativeBadgeActive}
                        variant="full"
                      />
                      {profile.vipTier ? (
                        <View style={[styles.vipChip, { borderColor: profile.vipTier.accentColor }]}>
                          <Text style={[styles.vipChipText, { color: profile.vipTier.accentColor }]}>
                            VIP {profile.vipTier.nameAr}
                          </Text>
                        </View>
                      ) : null}
                      {profile.family ? (
                        <View style={[styles.vipChip, { borderColor: profile.family.badgeColor }]}>
                          <Text style={[styles.vipChipText, { color: profile.family.badgeColor }]}>
                            عائلة {profile.family.nameAr}
                          </Text>
                        </View>
                      ) : null}
                      {profile.bio ? <Text numberOfLines={3} style={styles.heroBio}>{profile.bio}</Text> : null}
                      <CopyId label="ID" value={profile.publicId} />
                      {profile.specialId ? <CopyId label="المعرّف المميز" special value={profile.specialId} /> : null}
                      <WalletBalanceState economy={economy} onRetry={onRetry} />
                    </View>
                  </View>

                  <View style={styles.statsPanel}>
                    <View style={styles.statsNotch} />
                    <Pressable disabled={!onOpenFollowers} onPress={onOpenFollowers} style={styles.statPressable}>
                      <ProfileStat icon={{ ios: 'person.3.fill', android: 'groups', web: 'groups' }} label="المتابعون" value={profile.followerCount} />
                    </Pressable>
                    <View style={styles.statDivider} />
                    <Pressable disabled={!onOpenFollowing} onPress={onOpenFollowing} style={styles.statPressable}>
                      <ProfileStat icon={{ ios: 'person.crop.circle.badge.plus', android: 'person_add', web: 'person_add' }} label="يتابع" value={profile.followingCount} />
                    </Pressable>
                    <View style={styles.statDivider} />
                    <Pressable disabled={!onOpenFriends} onPress={onOpenFriends} style={styles.statPressable}>
                      <ProfileStat icon={{ ios: 'person.2.fill', android: 'group', web: 'group' }} label="الأصدقاء" value={profile.friendCount} />
                    </Pressable>
                    <View style={styles.statDivider} />
                    <ProfileStat icon={{ ios: 'heart.fill', android: 'favorite', web: 'favorite' }} label="نقاط الهدايا" value={profile.giftScore} />
                  </View>
                </LinearGradient>
              </LinearGradient>
              <Pressable
                accessibilityHint="يفتح محرر الملف والصورة"
                accessibilityLabel="تعديل الصورة الشخصية"
                accessibilityRole="button"
                onPress={() => setEditorVisible(true)}
                style={[styles.avatarOverlay, compact && styles.avatarOverlayCompact]}
              >
                <Avatar
                  avatarLabel={fallbackAvatarLabel}
                  avatarUrl={profile.avatarModerationStatus === 'clear' ? profile.avatarUrl : ''}
                  compact={compact}
                  flags={cosmeticsFlags}
                  frame={profile.equippedAvatarFrame}
                />
              </Pressable>
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

            {onOpenRepresentativeTransfer || payrollProgress ? (
              <View style={styles.settingsCard}>
                {onOpenRepresentativeTransfer ? (
                  <SettingsRow
                    icon={{ ios: 'arrow.left.arrow.right.circle.fill', android: 'currency_exchange', web: 'currency_exchange' } as SymbolName}
                    label="إعادة شحن الوكيل"
                    last={!payrollProgress}
                    onPress={onOpenRepresentativeTransfer}
                  />
                ) : null}
                {payrollProgress ? (
                  <SettingsRow
                    icon={{ ios: 'banknote.fill', android: 'payments', web: 'payments' } as SymbolName}
                    label="الراتب"
                    last
                    onPress={() => setSalaryVisible(true)}
                  />
                ) : null}
              </View>
            ) : null}
            {payrollLoading ? <InlineServiceState loading message="جارٍ تحميل بيانات الراتب" onRetry={onRetry} /> : null}
            {payrollError ? <InlineServiceState message={payrollError} onRetry={onRetry} /> : null}
            {representativeError ? <InlineServiceState message={representativeError} onRetry={onRetry} /> : null}

            <View style={styles.settingsCard}>
              <SettingsRow
                icon={{ ios: 'pencil', android: 'manage_accounts', web: 'manage_accounts' }}
                label="تعديل الملف"
                onPress={() => setEditorVisible(true)}
              />
              <SettingsRow
                icon={{ ios: 'gearshape.fill', android: 'settings', web: 'settings' }}
                label="الإعدادات"
                last
                onPress={onOpenSettings}
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
          avatarLabel={fallbackAvatarLabel}
          avatarUploadsEnabled={avatarUploadsEnabled}
          onClose={() => setEditorVisible(false)}
          profile={profile}
          visible={editorVisible}
        />
      ) : null}

      {payrollProgress ? (
        <SalaryProgressModal
          onClose={() => setSalaryVisible(false)}
          payroll={payrollProgress}
          visible={salaryVisible}
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

function Avatar({ avatarLabel, avatarUrl, compact, flags, frame }: {
  avatarLabel: string;
  avatarUrl: string;
  compact: boolean;
  flags: CosmeticsFeatureFlags;
  frame?: AvatarFrameProjection;
}) {
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
      <AvatarFrameLayer flags={flags} frame={frame} />
    </View>
  );
}

function WalletBalanceState({ economy, onRetry }: { economy: EconomyLoadState; onRetry: () => void }) {
  if (economy.status === 'disabled') return null;
  if (economy.status === 'loading') {
    return <View accessibilityLabel="جار تحميل الرصيد" style={[styles.balanceRow, styles.balanceLoading]}><ActivityIndicator color={colors.gold} /></View>;
  }
  if (economy.status === 'error') {
    return (
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.balanceError}>
        <Text style={styles.balanceErrorText}>تعذر تحميل الرصيد · إعادة المحاولة</Text>
      </Pressable>
    );
  }
  return (
    <View>
      <View style={styles.balanceRow}>
        <BalancePill icon={{ ios: 'diamond.fill', android: 'diamond', web: 'diamond' }} tint="#91DFFF" value={economy.balances.diamonds} />
        <BalancePill icon={{ ios: 'circle.hexagongrid.fill', android: 'paid', web: 'paid' }} tint="#F3C75C" value={economy.balances.coins} />
      </View>
      {economy.stale ? <Text style={styles.staleBalance}>آخر رصيد موثّق · جار التحديث</Text> : null}
      {economy.message ? <Text style={styles.staleBalance}>{economy.message}</Text> : null}
    </View>
  );
}

function CopyId({ label, special = false, value }: { label: string; special?: boolean; value: string }) {
  return (
    <Pressable
      accessibilityHint="ينسخ المعرّف"
      accessibilityLabel={`${label} ${value}`}
      accessibilityRole="button"
      onPress={() => void Clipboard.setStringAsync(value)}
      style={styles.copyId}
    >
      <SymbolView name={{ ios: 'doc.on.doc', android: 'content_copy', web: 'content_copy' }} size={14} tintColor="#DDB761" />
      <Text selectable style={special ? styles.specialId : styles.publicId}>{label}: {value}</Text>
    </Pressable>
  );
}

function BalancePill({ icon, tint, value }: {
  icon: SymbolName;
  tint: string;
  value: number;
}) {
  return (
    <LinearGradient colors={['rgba(35,9,11,0.94)', 'rgba(8,3,3,0.9)']} style={styles.balancePill}>
      <SymbolView name={icon} size={20} tintColor={tint} />
      <Text maxFontSizeMultiplier={1.4} style={styles.balanceValue}>{formatNumber(value)}</Text>
    </LinearGradient>
  );
}

function SalaryProgressModal({ onClose, payroll, visible }: {
  onClose: () => void;
  payroll: PayrollProgress;
  visible: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const completeDays = payroll.progress.daily.filter((day) => day.met).length;
  const requiredDays = payroll.progress.daily.length;
  const progressRatio = requiredDays > 0 ? completeDays / requiredDays : 0;
  const currencyLabel = payroll.progress.currency === 'diamonds' ? 'ماس' : 'كوينز';
  const status = payrollStatusLabel(payroll.progress.result);
  const settlementLive = payroll.settlement?.mode === 'live' || payroll.payoutEnabled === true;
  const settlementAt = payroll.settlement?.nextSettlementEstimateAtMillis
    ?? payroll.cycle.endAtMillis;
  const maxCardHeight = Math.max(320, height - insets.top - insets.bottom - spacing.xxl * 2);
  const cardWidth = Math.min(420, width - spacing.lg * 2);

  return (
    <Modal animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose} transparent visible={visible}>
      <View
        style={[
          styles.salaryOverlay,
          {
            paddingBottom: Math.max(insets.bottom, spacing.lg),
            paddingTop: Math.max(insets.top, spacing.lg),
          },
        ]}
      >
        <Pressable accessibilityLabel="إغلاق" onPress={onClose} style={StyleSheet.absoluteFill} />
        <LinearGradient
          colors={['#F2D68B', '#8E5A1D', '#E6BD63', '#6B3D13']}
          end={{ x: 0.12, y: 1 }}
          start={{ x: 0.88, y: 0 }}
          style={[styles.salaryFrame, { maxHeight: maxCardHeight, width: cardWidth }]}
        >
          <LinearGradient
            colors={['#6E1520', '#2C0A0F', '#120506']}
            end={{ x: 0.08, y: 1 }}
            start={{ x: 0.92, y: 0 }}
            style={styles.salaryCard}
          >
            <ScrollView contentContainerStyle={styles.salaryScrollContent} showsVerticalScrollIndicator={false}>
            <View pointerEvents="none" style={styles.salaryGlow} />
            <View pointerEvents="none" style={styles.salarySheen} />

            <View style={styles.salaryHeader}>
              <Pressable
                accessibilityLabel="إغلاق"
                accessibilityRole="button"
                hitSlop={8}
                onPress={onClose}
                style={({ pressed }) => [styles.salaryClose, pressed && styles.pressed]}
              >
                <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={18} tintColor="#F4E2B3" />
              </Pressable>
              <View style={styles.salaryHeaderCopy}>
                <Text style={styles.salaryEyebrow}>الراتب الأسبوعي</Text>
                <Text numberOfLines={1} style={styles.salaryTitle}>{payroll.plan.name.ar}</Text>
              </View>
            </View>

            <LinearGradient
              colors={['rgba(242,214,139,0.18)', 'rgba(18,5,6,0.55)']}
              end={{ x: 0, y: 1 }}
              start={{ x: 1, y: 0 }}
              style={styles.salaryHero}
            >
              <View style={styles.salaryHeroCopy}>
                <Text style={styles.salaryHeroLabel}>المبلغ المتوقع</Text>
                <View style={styles.salaryHeroAmountRow}>
                  <Text style={styles.salaryHeroAmount}>{formatNumber(payroll.progress.amount)}</Text>
                  <Text style={styles.salaryHeroUnit}>{currencyLabel}</Text>
                </View>
              </View>
              <View style={styles.salaryStatusPill}>
                <View style={[styles.salaryStatusDot, payroll.progress.qualified && styles.salaryStatusDotOk]} />
                <Text style={styles.salaryStatusText}>{status}</Text>
              </View>
            </LinearGradient>

            <View style={styles.salaryProgressBlock}>
              <View style={styles.salaryProgressMeta}>
                <Text style={styles.salaryProgressLabel}>تقدم الأسبوع</Text>
                <Text style={styles.salaryProgressCount}>{completeDays}/{requiredDays} أيام</Text>
              </View>
              <View style={styles.salaryProgressTrack}>
                <LinearGradient
                  colors={['#F2D68B', '#C48A2E']}
                  end={{ x: 0, y: 0.5 }}
                  start={{ x: 1, y: 0.5 }}
                  style={[styles.salaryProgressFill, {
                    minWidth: progressRatio > 0 ? 10 : 0,
                    width: `${Math.max(0, Math.min(1, progressRatio)) * 100}%`,
                  }]}
                />
              </View>
              <View style={styles.salaryProgressMeta}>
                <Text style={styles.salaryProgressLabel}>
                  {settlementLive ? 'التسوية المتوقعة' : 'تقدير نهاية الدورة (تقرير فقط)'}
                </Text>
                <Text style={styles.salaryProgressCount}>{formatSettlementInstant(settlementAt)}</Text>
              </View>
            </View>

            <View style={styles.salaryDays}>
              {payroll.progress.daily.map((day) => {
                const ratio = day.requiredMinutes > 0
                  ? Math.min(1, day.qualifiedMinutes / day.requiredMinutes)
                  : 0;
                const fillHeight = Math.max(4, Math.round((day.met ? 1 : ratio) * 36));
                return (
                  <View key={day.dayId} style={[styles.salaryDay, day.met && styles.salaryDayMet]}>
                    <Text style={[styles.salaryDayLabel, day.met && styles.salaryDayLabelMet]}>
                      {weekdayLabel(day.weekday)}
                    </Text>
                    <View style={styles.salaryDayTrack}>
                      <View style={[styles.salaryDayFill, { height: fillHeight }, day.met && styles.salaryDayFillMet]} />
                    </View>
                    <Text style={styles.salaryDayMinutes}>{day.qualifiedMinutes}</Text>
                    <Text style={styles.salaryDayRequired}>/{day.requiredMinutes}</Text>
                  </View>
                );
              })}
            </View>

            <View style={styles.salaryNote}>
              <SymbolView
                name={{ ios: 'info.circle.fill', android: 'info', web: 'info' }}
                size={16}
                tintColor="#DDB761"
              />
              <Text style={styles.salaryNoteText}>
                {settlementLive
                  ? 'بعد نهاية الدورة يُصرف المؤهلون تلقائياً ما لم يُحجز الدفع من الإدارة. يتوقف احتساب الدقائق بعد خمس دقائق كتم متواصل.'
                  : 'الصرف متوقف حالياً؛ الأرقام للتقدم فقط. يتوقف احتساب الدقائق بعد خمس دقائق كتم متواصل داخل الغرفة.'}
              </Text>
            </View>
            </ScrollView>
          </LinearGradient>
        </LinearGradient>
      </View>
    </Modal>
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
    <View accessibilityLabel="جارٍ تجهيز ملفك الشخصي" style={styles.skeletonCard}>
      <View style={styles.skeletonAvatar} />
      <View style={styles.skeletonCopy}>
        <View style={[styles.skeletonLine, { width: '58%' }]} />
        <View style={[styles.skeletonLine, { width: '82%' }]} />
        <View style={[styles.skeletonLine, { width: '44%' }]} />
      </View>
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

function InlineServiceState({ loading = false, message, onRetry }: { loading?: boolean; message: string; onRetry: () => void }) {
  return (
    <Pressable accessibilityRole={loading ? undefined : 'button'} disabled={loading} onPress={onRetry} style={styles.inlineServiceState}>
      {loading ? <ActivityIndicator color={colors.gold} /> : <SymbolView name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }} size={18} tintColor={colors.gold} />}
      <Text style={styles.inlineServiceText}>{message}{loading ? '' : ' · إعادة المحاولة'}</Text>
    </Pressable>
  );
}

function ProfileEditor({ avatarLabel: initialAvatarLabel, avatarUploadsEnabled, onClose, profile, visible }: {
  avatarLabel: string;
  avatarUploadsEnabled: boolean;
  onClose: () => void;
  profile: PublicUserProfile;
  visible: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const editorInsets = useSafeAreaInsets();
  const { height: editorScreenHeight } = useWindowDimensions();
  const [bio, setBio] = useState(profile.bio);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [avatarLabel, setAvatarLabel] = useState(initialAvatarLabel);
  const countryRailRef = useRef<ScrollView>(null);
  const [countryCode, setCountryCode] = useState<RoomCountryCode>(profile.countryCode);
  const [errorMessage, setErrorMessage] = useState('');
  const [gender, setGender] = useState<ProfileGender | undefined>(profile.gender);
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (visible) {
      setBio(profile.bio);
      setDisplayName(profile.displayName);
      setAvatarLabel(initialAvatarLabel);
      setCountryCode(profile.countryCode);
      setGender(profile.gender);
      setErrorMessage('');
      setSuccessMessage('');
    }
  }, [initialAvatarLabel, profile.bio, profile.countryCode, profile.displayName, profile.gender, visible]);

  const remaining = useMemo(() => 160 - bio.length, [bio.length]);
  const save = async () => {
    setSaving(true);
    setErrorMessage('');
    try {
      const result = await requestProfilePresentationUpdate({ avatarLabel, bio, countryCode, displayName, gender });
      if (!result.ok) throw new Error(result.error.messageAr);
      setSuccessMessage('تم حفظ معلومات الملف الشخصي.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'تعذر حفظ الملف الشخصي.');
    } finally {
      setSaving(false);
    }
  };

  const pickAvatar = async (camera = false) => {
    setAvatarBusy(true);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      const permission = camera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error(camera ? 'يلزم السماح باستخدام الكاميرا.' : 'يلزم السماح بالوصول إلى الصور.');
      const picked = await (camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync)({ allowsEditing: true, aspect: [1, 1], mediaTypes: ['images'], quality: 1 });
      if (picked.canceled || !picked.assets[0]) return;
      await submitAvatar(picked.assets[0]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'تعذر رفع الصورة.');
    } finally {
      setAvatarBusy(false);
    }
  };

  async function submitAvatar(asset: ImagePicker.ImagePickerAsset) {
      const source = await prepareAvatarSource(asset.uri, asset.mimeType, asset.fileSize);
      const authorization = await requestAvatarUpload({ contentType: source.contentType, sha256: source.sha256, sizeBytes: source.sizeBytes });
      if (!authorization.ok) throw new Error(authorization.error.messageAr);
      await uploadAuthorizedAvatar(authorization.result, source);
      const finalized = await requestAvatarFinalize(authorization.result.uploadId);
      if (!finalized.ok) throw new Error(finalized.error.messageAr);
      setSuccessMessage(finalized.result.status === 'approved'
        ? 'تم اعتماد الصورة الجديدة.'
        : finalized.result.status === 'pending'
          ? 'الصورة قيد المراجعة. ستبقى صورتك الحالية ظاهرة.'
          : 'رُفضت الصورة وفق إرشادات المجتمع.');
  }

  useEffect(() => {
    if (!visible || !avatarUploadsEnabled) return;
    let active = true;
    void ImagePicker.getPendingResultAsync().then(async (result) => {
      if (!active || !result || 'code' in result || result.canceled || !result.assets[0]) return;
      setAvatarBusy(true);
      try { await submitAvatar(result.assets[0]); }
      catch (error) { if (active) setErrorMessage(error instanceof Error ? error.message : 'تعذر استعادة رفع الصورة.'); }
      finally { if (active) setAvatarBusy(false); }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [avatarUploadsEnabled, visible]);

  const removeAvatar = async () => {
    setAvatarBusy(true);
    setErrorMessage('');
    try {
      const result = await requestAvatarRemove();
      if (!result.ok) throw new Error(result.error.messageAr);
      setSuccessMessage('تم حذف الصورة.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'تعذر حذف الصورة.');
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <Modal animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.editor, { maxHeight: editorScreenHeight - editorInsets.top - editorInsets.bottom - spacing.md }]}>
          <ScrollView contentContainerStyle={styles.editorContent} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.editorHeader}>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={20} tintColor={colors.text} />
            </Pressable>
            <View style={styles.editorHeadingCopy}>
              <Text style={styles.editorTitle}>تعديل الملف العام</Text>
              <Text style={styles.editorSubtitle}>المعلومات التي يراها المستخدمون</Text>
            </View>
          </View>

          <Text style={styles.fieldLabel}>اسم العرض</Text>
          <TextInput maxLength={32} onChangeText={setDisplayName} style={styles.singleInput} textAlign="right" value={displayName} />
          <Text style={styles.fieldLabel}>رمز الصورة الاحتياطي</Text>
          <TextInput maxLength={2} onChangeText={setAvatarLabel} style={styles.singleInput} textAlign="right" value={avatarLabel} />
          {avatarUploadsEnabled ? (
            <View style={styles.avatarActions}>
              <Pressable disabled={avatarBusy} onPress={() => void pickAvatar()} style={styles.avatarActionButton}>
                {avatarBusy ? <ActivityIndicator color={colors.gold} /> : <Text style={styles.avatarActionText}>اختيار صورة</Text>}
              </Pressable>
              <Pressable disabled={avatarBusy} onPress={() => void pickAvatar(true)} style={styles.avatarActionButton}>
                <Text style={styles.avatarActionText}>الكاميرا</Text>
              </Pressable>
              {profile.avatarUrl ? (
                <Pressable disabled={avatarBusy} onPress={() => void removeAvatar()} style={styles.avatarActionButton}>
                  <Text style={styles.avatarActionText}>حذف الصورة</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

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

          {errorMessage ? <Text accessibilityLiveRegion="polite" style={styles.editorError}>{errorMessage}</Text> : null}
          {successMessage ? <Text accessibilityLiveRegion="polite" style={styles.editorSuccess}>{successMessage}</Text> : null}
          <Pressable
            disabled={saving}
            onPress={() => void save()}
            style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, saving && styles.disabled]}
          >
            {saving ? <ActivityIndicator color="#27080B" /> : <Text style={styles.saveText}>حفظ التغييرات</Text>}
          </Pressable>
          </ScrollView>
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

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) setReduced(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { active = false; subscription.remove(); };
  }, []);
  return reduced;
}

function formatSettlementInstant(millis: number) {
  try {
    return new Intl.DateTimeFormat('ar-IQ', {
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      timeZone: 'Asia/Baghdad',
      weekday: 'short',
    }).format(new Date(millis));
  } catch {
    return new Date(millis).toISOString();
  }
}

function payrollStatusLabel(result: string) {
  return ({
    eligible: 'مؤهل مبدئياً',
    paid: 'تم الدفع',
    'missed-day': 'يوم مفقود',
    'insufficient-time': 'وقت غير كافٍ',
    suspended: 'موقوف',
    'profile-ineligible': 'الملف غير مؤهل',
    'device-conflict': 'مراجعة الجهاز مطلوبة',
    held: 'الدفع محجوز للمراجعة',
    failed: 'تعذرت التسوية',
  } as Record<string, string>)[result] || 'قيد التقييم';
}

function weekdayLabel(weekday: number) {
  return ({
    1: 'إثن',
    2: 'ثلا',
    3: 'أرب',
    4: 'خمي',
    5: 'جمع',
    6: 'سبت',
    7: 'أحد',
  } as Record<number, string>)[weekday] || String(weekday);
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
  coupleEffectHero: { height: 140, left: 0, opacity: 0.86, position: 'absolute', right: 0, top: 0, zIndex: 1 },
  profileSkin: { bottom: 0, left: 0, opacity: 0.55, position: 'absolute', right: 0, top: 0 },
  nameplate: { height: 44, left: -12, position: 'absolute', right: -12, top: -8 },
  cosmeticBadge: { height: 24, width: 24, zIndex: 2 },
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
  heroBio: { color: colors.textMuted, fontSize: 13, lineHeight: 19, maxWidth: '100%', textAlign: 'right', writingDirection: 'rtl' },
  copyId: { alignItems: 'center', flexDirection: 'row-reverse', gap: 6, minHeight: 32 },
  vipChip: {
    alignSelf: 'flex-end',
    borderRadius: radius.full,
    borderWidth: 1,
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  vipChipText: {
    fontSize: 11,
    fontWeight: typography.weights.bold,
  },
  specialId: { color: '#F7D982', fontSize: 12, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  balanceRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'flex-start', marginTop: spacing.xs },
  balanceLoading: { alignItems: 'center', minHeight: 35, minWidth: 78 },
  balanceError: { borderColor: 'rgba(255,134,144,0.38)', borderRadius: radius.md, borderWidth: 1, marginTop: spacing.xs, minHeight: 44, paddingHorizontal: spacing.sm, justifyContent: 'center' },
  balanceErrorText: { color: '#FFB0B7', fontSize: 11, fontWeight: typography.weights.bold, textAlign: 'right', writingDirection: 'rtl' },
  staleBalance: { color: colors.textMuted, fontSize: 10, marginTop: 4, textAlign: 'right', writingDirection: 'rtl' },
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
  statPressable: { flex: 1 },
  statIconShell: { alignItems: 'center', backgroundColor: 'rgba(103,27,32,0.34)', borderColor: 'rgba(226,183,91,0.22)', borderRadius: radius.full, borderWidth: 1, height: 29, justifyContent: 'center', marginBottom: 1, width: 29 },
  statValue: { color: '#FFF1CC', fontSize: 16, fontWeight: typography.weights.black },
  statLabel: { color: '#C8BCA8', fontSize: 10, fontWeight: typography.weights.semibold, textAlign: 'center', writingDirection: 'rtl' },
  statDivider: { alignSelf: 'center', backgroundColor: 'rgba(226,183,91,0.18)', height: 54, width: 1 },
  salaryOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(3, 1, 2, 0.86)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  salaryFrame: {
    borderRadius: 28,
    elevation: 18,
    padding: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.55,
    shadowRadius: 28,
  },
  salaryCard: {
    borderRadius: 26.5,
    overflow: 'hidden',
  },
  salaryScrollContent: { gap: spacing.md, paddingBottom: spacing.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  salaryGlow: {
    backgroundColor: 'rgba(204,45,58,0.18)',
    borderRadius: 120,
    height: 180,
    position: 'absolute',
    right: -48,
    top: -72,
    width: 180,
  },
  salarySheen: {
    backgroundColor: 'rgba(242,214,139,0.08)',
    height: 90,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  salaryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    zIndex: 1,
  },
  salaryClose: {
    alignItems: 'center',
    backgroundColor: 'rgba(18,5,6,0.72)',
    borderColor: 'rgba(226,183,91,0.34)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  salaryHeaderCopy: {
    alignItems: 'flex-end',
    flex: 1,
    gap: 2,
  },
  salaryEyebrow: {
    color: '#DDB761',
    fontSize: 12,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  salaryTitle: {
    color: '#FFF4D7',
    fontSize: 22,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  salaryHero: {
    alignItems: 'center',
    borderColor: 'rgba(226,183,91,0.34)',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    zIndex: 1,
  },
  salaryHeroCopy: {
    alignItems: 'flex-end',
    flex: 1,
    gap: 4,
  },
  salaryHeroLabel: {
    color: '#E4C879',
    fontSize: 12,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  salaryHeroAmountRow: {
    alignItems: 'flex-end',
    flexDirection: 'row-reverse',
    gap: 6,
  },
  salaryHeroAmount: {
    color: '#FFF1CC',
    fontSize: 34,
    fontWeight: typography.weights.black,
    lineHeight: 38,
  },
  salaryHeroUnit: {
    color: '#DDB761',
    fontSize: 13,
    fontWeight: typography.weights.black,
    marginBottom: 4,
    writingDirection: 'rtl',
  },
  salaryStatusPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(8,3,3,0.62)',
    borderColor: 'rgba(226,183,91,0.28)',
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: 6,
    maxWidth: 126,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  salaryStatusDot: {
    backgroundColor: '#C8BCA8',
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  salaryStatusDotOk: {
    backgroundColor: '#5ED285',
  },
  salaryStatusText: {
    color: '#F4E2B3',
    flexShrink: 1,
    fontSize: 11,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  salaryProgressBlock: {
    gap: spacing.sm,
    zIndex: 1,
  },
  salaryProgressMeta: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
  },
  salaryProgressLabel: {
    color: '#DDB761',
    fontSize: 13,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  salaryProgressCount: {
    color: '#F8E8C1',
    fontSize: 12,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  salaryProgressTrack: {
    backgroundColor: 'rgba(0,0,0,0.38)',
    borderColor: 'rgba(226,183,91,0.22)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 10,
    overflow: 'hidden',
  },
  salaryProgressFill: {
    borderRadius: radius.full,
    height: '100%',
  },
  salaryDays: {
    flexDirection: 'row-reverse',
    gap: 6,
    justifyContent: 'space-between',
    zIndex: 1,
  },
  salaryDay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderColor: 'rgba(226,183,91,0.18)',
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    minHeight: 104,
    paddingHorizontal: 2,
    paddingVertical: 8,
  },
  salaryDayMet: {
    backgroundColor: 'rgba(33,116,69,0.22)',
    borderColor: 'rgba(94,210,133,0.55)',
  },
  salaryDayLabel: {
    color: '#E4C879',
    fontSize: 11,
    fontWeight: typography.weights.black,
  },
  salaryDayLabelMet: {
    color: '#B8F0C8',
  },
  salaryDayTrack: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: radius.full,
    height: 36,
    justifyContent: 'flex-end',
    marginVertical: 2,
    overflow: 'hidden',
    width: 8,
  },
  salaryDayFill: {
    backgroundColor: 'rgba(226,183,91,0.72)',
    borderRadius: radius.full,
    width: '100%',
  },
  salaryDayFillMet: {
    backgroundColor: '#5ED285',
  },
  salaryDayMinutes: {
    color: '#FFF1CC',
    fontSize: 11,
    fontWeight: typography.weights.black,
  },
  salaryDayRequired: {
    color: '#A89A86',
    fontSize: 9,
    marginTop: -2,
  },
  salaryNote: {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(8,3,3,0.42)',
    borderColor: 'rgba(226,183,91,0.2)',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    zIndex: 1,
  },
  salaryNoteText: {
    color: '#C8BCA8',
    flex: 1,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
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
  skeletonCard: { alignItems: 'center', backgroundColor: '#100607', borderColor: 'rgba(232,190,97,0.3)', borderRadius: radius.xl, borderWidth: 1, flexDirection: 'row-reverse', gap: spacing.lg, minHeight: 210, padding: spacing.xl },
  skeletonAvatar: { backgroundColor: 'rgba(232,190,97,0.12)', borderRadius: radius.full, height: 96, width: 96 },
  skeletonCopy: { flex: 1, gap: spacing.md },
  skeletonLine: { alignSelf: 'flex-end', backgroundColor: 'rgba(232,190,97,0.12)', borderRadius: radius.full, height: 16 },
  inlineServiceState: { alignItems: 'center', backgroundColor: '#100607', borderColor: 'rgba(232,190,97,0.3)', borderRadius: radius.lg, borderWidth: 1, flexDirection: 'row-reverse', gap: spacing.sm, justifyContent: 'center', minHeight: 52, paddingHorizontal: spacing.md },
  inlineServiceText: { color: colors.textMuted, flexShrink: 1, fontSize: 13, textAlign: 'right', writingDirection: 'rtl' },
  stateTitle: { color: colors.text, fontSize: 18, fontWeight: typography.weights.black, textAlign: 'center', writingDirection: 'rtl' },
  retryButton: { backgroundColor: colors.gold, borderRadius: radius.full, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  retryText: { color: '#2A090C', fontWeight: typography.weights.black, writingDirection: 'rtl' },
  pressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
  modalBackdrop: { backgroundColor: 'rgba(0,0,0,0.82)', flex: 1, justifyContent: 'flex-end' },
  editor: { alignSelf: 'center', backgroundColor: '#100607', borderColor: 'rgba(232,190,97,0.42)', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, maxHeight: '92%', maxWidth: 720, width: '100%' },
  editorContent: { gap: spacing.md, paddingBottom: spacing.xxl, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
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
  editorSuccess: { color: '#91E0AD', fontSize: 13, textAlign: 'right', writingDirection: 'rtl' },
  singleInput: { backgroundColor: '#090405', borderColor: 'rgba(232,190,97,0.26)', borderRadius: radius.lg, borderWidth: 1, color: colors.text, fontSize: 16, minHeight: 48, paddingHorizontal: spacing.md, writingDirection: 'rtl' },
  avatarActions: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.sm },
  avatarActionButton: { alignItems: 'center', borderColor: 'rgba(232,190,97,0.42)', borderRadius: radius.full, borderWidth: 1, flexGrow: 1, justifyContent: 'center', minHeight: 48, minWidth: 108 },
  avatarActionText: { color: colors.goldSoft, fontSize: 13, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  saveButton: { alignItems: 'center', backgroundColor: colors.gold, borderRadius: radius.full, justifyContent: 'center', minHeight: 52 },
  saveText: { color: '#27080B', fontSize: 15, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  disabled: { opacity: 0.55 },
});
