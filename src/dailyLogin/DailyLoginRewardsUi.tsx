import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { radius, spacing, typography } from '../theme';
import { requestStoreCatalog } from '../social/requestSocialCommand';
import { resolveStoreArtwork } from '../store/storeArtwork';
import type { DailyLoginRewardBundle } from './dailyLoginContract';
import type { DailyLoginRewardsController } from './useDailyLoginRewards';

export function DailyLoginHomeCard({ controller }: { controller: DailyLoginRewardsController }) {
  const { isLoading, status } = controller;
  if (!status || !status.presentationVisible || status.calendar.length !== 7) return null;
  const position = status?.streakPosition || 1;
  return (
    <Pressable
      accessibilityHint="يفتح جدول مكافآت الدخول للأيام السبعة"
      accessibilityLabel={status?.claimable ? 'مكافأة الدخول اليومية جاهزة للاستلام' : 'عرض مكافآت الدخول اليومية'}
      accessibilityRole="button"
      onPress={controller.open}
      style={({ pressed }) => [styles.homeCardShell, pressed && styles.pressed]}
    >
      <LinearGradient colors={['#130607', '#4A0C14', '#11080A']} end={{ x: 0, y: 1 }} start={{ x: 1, y: 0 }} style={styles.homeCard}>
        <View pointerEvents="none" style={styles.homeOrnament} />
        <View style={styles.homeCopy}>
          <Text style={styles.homeKicker}>{status?.claimable ? 'جاهزة الآن' : 'سلسلتك اليومية'}</Text>
          <Text style={styles.homeTitle}>هدية الحضور اليومي</Text>
          <Text style={styles.homeBody}>
            {isLoading ? 'جارٍ تحميل جوائزك…' : status?.alreadyClaimed ? 'تم استلام جائزة اليوم · عد غداً للجائزة التالية' : `اليوم ${position} من 7 · افتح الهدية قبل منتصف الليل`}
          </Text>
        </View>
        <View style={[styles.dayMedallion, status?.claimable && styles.dayMedallionReady]}>
          {isLoading ? <ActivityIndicator color="#F7D67C" /> : (
            <>
              <Text style={styles.dayMedallionSmall}>اليوم</Text>
              <Text style={styles.dayMedallionNumber}>{position}</Text>
            </>
          )}
        </View>
      </LinearGradient>
    </Pressable>
  );
}

export function DailyLoginRewardSheet({ controller }: { controller: DailyLoginRewardsController }) {
  const { claimResult, errorCode, errorMessage, isClaiming, isVisible, status } = controller;
  const [itemArtwork, setItemArtwork] = useState<Record<string, string>>({});
  const [reduceMotion, setReduceMotion] = useState(false);
  const currentPosition = claimResult?.streakPosition || status?.streakPosition || 1;
  const calendar = status?.calendar || [];
  const resetCountdown = useResetCountdown(status?.nextResetAtMillis);
  const itemIds = calendar.flatMap((entry) => entry.reward.items.map((item) => item.itemId)).join('|');
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!itemIds) {
      setItemArtwork({});
      return;
    }
    let active = true;
    void requestStoreCatalog()
      .then((catalog) => {
        if (!active || !catalog.ok) return;
        setItemArtwork(Object.fromEntries(
          catalog.result.items
            .filter((item) => itemIds.split('|').includes(item.itemId) && item.thumbnailUrl)
            .map((item) => [item.itemId, item.thumbnailUrl]),
        ));
      })
      .catch(() => {
        if (active) setItemArtwork({});
      });
    return () => {
      active = false;
    };
  }, [itemIds]);
  return (
    <Modal
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={controller.close}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={isVisible}
    >
      <View accessibilityViewIsModal style={styles.modalBackdrop}>
        <Pressable accessibilityLabel="إغلاق مكافآت الدخول اليومي" onPress={controller.close} style={StyleSheet.absoluteFill} />
        <LinearGradient colors={['#2B090D', '#100708', '#050404']} style={styles.sheet}>
          <View pointerEvents="none" style={styles.sheetGlow} />
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Pressable accessibilityLabel="إغلاق" hitSlop={12} onPress={controller.close} style={styles.closeButton}>
              <Text style={styles.closeLabel}>×</Text>
            </Pressable>
            <View style={styles.sheetHeading}>
              <Text style={styles.sheetKicker}>سلسلة 7 أيام</Text>
              <Text style={styles.sheetTitle}>مكافأة الدخول اليومي</Text>
              <Text style={styles.sheetSubtitle}>ادخل كل يوم لتتقدم، وإذا فاتك يوم تبدأ السلسلة من اليوم الأول.</Text>
            </View>
            <View style={styles.giftSeal}><Text style={styles.giftSealText}>✦</Text></View>
          </View>

          <ScrollView contentContainerStyle={styles.calendar} horizontal showsHorizontalScrollIndicator={false}>
            {calendar.map((entry) => {
              const isCurrent = entry.day === currentPosition;
              const isPast = entry.day < currentPosition || (isCurrent && Boolean(claimResult || status?.alreadyClaimed));
              return (
                <View
                  accessibilityLabel={`اليوم ${entry.day}: ${rewardAccessibility(entry.reward)}`}
                  key={entry.day}
                  style={[styles.rewardDay, isCurrent && styles.rewardDayCurrent, isPast && styles.rewardDayClaimed]}
                >
                  <Text style={styles.rewardDayLabel}>اليوم {entry.day}</Text>
                  <View style={styles.rewardGem}>
                    {entry.reward.items[0] && itemArtwork[entry.reward.items[0].itemId] ? (
                      <Image
                        accessibilityIgnoresInvertColors
                        source={resolveStoreArtwork(itemArtwork[entry.reward.items[0].itemId])}
                        style={styles.rewardArtwork}
                      />
                    ) : (
                      <Text style={styles.rewardGemText}>{isPast ? '✓' : entry.day === 7 ? '★' : '◆'}</Text>
                    )}
                  </View>
                  <Text numberOfLines={3} style={styles.rewardValue}>{rewardLabel(entry.reward)}</Text>
                </View>
              );
            })}
          </ScrollView>

          {claimResult ? (
            <View accessibilityLiveRegion="polite" style={styles.successPanel}>
              <Text style={styles.successTitle}>تمت إضافة هدية اليوم</Text>
              <Text style={styles.successReward}>{rewardLabel(claimResult.reward)}</Text>
              <Text style={styles.balanceText}>
                الرصيد الآن: {claimResult.balances.coins.toLocaleString('ar-IQ')} Coins · {claimResult.balances.diamonds.toLocaleString('ar-IQ')} Diamonds
              </Text>
            </View>
          ) : null}

          {errorMessage ? (
            <View accessibilityLiveRegion="polite" style={styles.errorPanel}>
              <Text style={styles.errorTitle}>{errorTitle(errorCode)}</Text>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: isClaiming, disabled: !status?.claimable || isClaiming || Boolean(claimResult) }}
            disabled={!status?.claimable || isClaiming || Boolean(claimResult)}
            onPress={() => void controller.claim()}
            style={({ pressed }) => [
              styles.claimButton,
              (!status?.claimable || isClaiming || claimResult) && styles.claimButtonDisabled,
              pressed && styles.pressed,
            ]}
          >
            <LinearGradient colors={['#E8BB61', '#9B5B16']} style={styles.claimButtonGradient}>
              {isClaiming ? <ActivityIndicator color="#240A0C" /> : (
                <Text style={styles.claimButtonText}>
                  {claimResult ? 'تم الاستلام' : status?.alreadyClaimed ? 'عد غداً للجائزة التالية' : status?.claimable ? 'استلام هدية اليوم' : statusReason(status?.reason)}
                </Text>
              )}
            </LinearGradient>
          </Pressable>
          <Text style={styles.resetText}>يتجدد اليوم بعد {resetCountdown} · بتوقيت بغداد</Text>
        </LinearGradient>
      </View>
    </Modal>
  );
}

function rewardLabel(reward: DailyLoginRewardBundle) {
  return [
    reward.coins ? `${reward.coins.toLocaleString('ar-IQ')} Coins` : '',
    reward.diamonds ? `${reward.diamonds.toLocaleString('ar-IQ')} Diamonds` : '',
    reward.items.length ? `${reward.items.length.toLocaleString('ar-IQ')} عنصر` : '',
  ].filter(Boolean).join('\n') || 'هدية';
}

function rewardAccessibility(reward: DailyLoginRewardBundle) {
  return rewardLabel(reward).replace(/\n/g, '، ');
}

function errorTitle(code: string) {
  if (code === 'RATE_LIMITED') return 'محاولات كثيرة';
  if (code === 'CLIENT_INCOMPATIBLE') return 'حدّث التطبيق';
  if (code === 'CLAIMS_PAUSED' || code === 'EMERGENCY_DISABLED') return 'المكافآت متوقفة مؤقتاً';
  return 'تعذر استلام الهدية';
}

function statusReason(reason?: string) {
  if (reason === 'CLAIMS_PAUSED') return 'الاستلام متوقف مؤقتاً';
  if (reason === 'CLIENT_INCOMPATIBLE') return 'يتطلب تحديث التطبيق';
  if (reason === 'ALREADY_CLAIMED') return 'تم استلام هدية اليوم';
  return 'غير متاحة الآن';
}

function useResetCountdown(resetAtMillis?: number) {
  const [nowMillis, setNowMillis] = useState(Date.now());
  useEffect(() => {
    if (!resetAtMillis) return undefined;
    const timer = setInterval(() => setNowMillis(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [resetAtMillis]);
  if (!resetAtMillis) return '—';
  const remainingMinutes = Math.max(0, Math.ceil((resetAtMillis - nowMillis) / 60_000));
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  return `${hours.toLocaleString('ar-IQ')}س ${minutes.toLocaleString('ar-IQ')}د`;
}

const styles = StyleSheet.create({
  homeCardShell: {
    marginBottom: spacing.md,
    marginHorizontal: 10,
  },
  homeCard: {
    alignItems: 'center',
    borderColor: 'rgba(226,176,83,0.56)',
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    minHeight: 105,
    overflow: 'hidden',
    padding: spacing.md,
  },
  homeOrnament: {
    borderColor: 'rgba(222,166,72,0.18)',
    borderRadius: 80,
    borderWidth: 18,
    height: 150,
    left: -45,
    position: 'absolute',
    top: -64,
    transform: [{ rotate: '18deg' }],
    width: 150,
  },
  homeCopy: { flex: 1 },
  homeKicker: {
    color: '#E9B950',
    fontSize: 10,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  homeTitle: {
    color: '#FFF0CD',
    fontSize: 18,
    fontWeight: typography.weights.black,
    marginTop: 2,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  homeBody: {
    color: '#C9B49F',
    fontSize: 10,
    lineHeight: 16,
    marginTop: 4,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  dayMedallion: {
    alignItems: 'center',
    backgroundColor: '#2A1114',
    borderColor: '#B37A2E',
    borderRadius: radius.full,
    borderWidth: 2,
    height: 66,
    justifyContent: 'center',
    marginLeft: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    width: 66,
  },
  dayMedallionReady: {
    backgroundColor: '#771320',
    borderColor: '#F1CA74',
  },
  dayMedallionSmall: { color: '#D9BE8D', fontSize: 8, writingDirection: 'rtl' },
  dayMedallionNumber: { color: '#FFE4A1', fontSize: 24, fontWeight: typography.weights.black },
  modalBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.78)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderColor: 'rgba(226,176,83,0.52)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    maxHeight: '88%',
    overflow: 'hidden',
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  sheetGlow: {
    backgroundColor: 'rgba(135,21,34,0.34)',
    borderRadius: 130,
    height: 260,
    position: 'absolute',
    right: -90,
    top: -120,
    width: 260,
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: 'rgba(238,200,128,0.42)',
    borderRadius: radius.full,
    height: 4,
    marginBottom: spacing.md,
    width: 42,
  },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  sheetHeading: { flex: 1 },
  sheetKicker: { color: '#D89C42', fontSize: 10, fontWeight: typography.weights.black, textAlign: 'right', writingDirection: 'rtl' },
  sheetTitle: { color: '#FFF0CD', fontSize: 24, fontWeight: typography.weights.black, textAlign: 'right', writingDirection: 'rtl' },
  sheetSubtitle: { color: '#BDAA99', fontSize: 10, lineHeight: 17, marginTop: 4, textAlign: 'right', writingDirection: 'rtl' },
  giftSeal: {
    alignItems: 'center',
    backgroundColor: '#74121E',
    borderColor: '#E7B85F',
    borderRadius: radius.full,
    borderWidth: 2,
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  giftSealText: { color: '#FBE0A3', fontSize: 27 },
  closeButton: {
    alignItems: 'center',
    borderColor: 'rgba(221,175,92,0.28)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  closeLabel: { color: '#E7CC9E', fontSize: 23, lineHeight: 26 },
  calendar: { gap: 8, paddingVertical: spacing.lg },
  rewardDay: {
    alignItems: 'center',
    backgroundColor: 'rgba(26,12,14,0.9)',
    borderColor: 'rgba(211,157,69,0.25)',
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 138,
    padding: 9,
    width: 92,
  },
  rewardDayCurrent: {
    backgroundColor: '#5D1019',
    borderColor: '#E9BA61',
    borderWidth: 2,
  },
  rewardDayClaimed: { opacity: 0.7 },
  rewardDayLabel: { color: '#D7BA86', fontSize: 9, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  rewardGem: {
    alignItems: 'center',
    backgroundColor: '#851826',
    borderColor: '#D9A44F',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    marginVertical: 10,
    width: 42,
  },
  rewardGemText: { color: '#FFE19A', fontSize: 18, fontWeight: typography.weights.black },
  rewardArtwork: { borderRadius: radius.full, height: 38, width: 38 },
  rewardValue: { color: '#F2DDC0', fontSize: 8, lineHeight: 13, textAlign: 'center' },
  successPanel: {
    backgroundColor: 'rgba(67,97,34,0.2)',
    borderColor: 'rgba(187,220,92,0.38)',
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  successTitle: { color: '#D8EE9C', fontSize: 15, fontWeight: typography.weights.black, textAlign: 'center', writingDirection: 'rtl' },
  successReward: { color: '#FFF0C3', fontSize: 13, lineHeight: 20, marginTop: 4, textAlign: 'center' },
  balanceText: { color: '#BFB49E', fontSize: 9, marginTop: 7, textAlign: 'center', writingDirection: 'rtl' },
  errorPanel: {
    backgroundColor: 'rgba(137,23,35,0.2)',
    borderColor: 'rgba(224,74,88,0.38)',
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  errorTitle: { color: '#F3A2A9', fontSize: 13, fontWeight: typography.weights.black, textAlign: 'right', writingDirection: 'rtl' },
  errorText: { color: '#CBB1B3', fontSize: 9, marginTop: 3, textAlign: 'right', writingDirection: 'rtl' },
  claimButton: { borderRadius: radius.full, overflow: 'hidden' },
  claimButtonDisabled: { opacity: 0.48 },
  claimButtonGradient: { alignItems: 'center', justifyContent: 'center', minHeight: 52, paddingHorizontal: spacing.lg },
  claimButtonText: { color: '#28090C', fontSize: 15, fontWeight: typography.weights.black, textAlign: 'center', writingDirection: 'rtl' },
  resetText: { color: '#8F8177', fontSize: 8, marginTop: 9, textAlign: 'center', writingDirection: 'rtl' },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
});
