import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { radius, spacing, typography } from '../theme';
import { requestStoreCatalog } from '../social/requestSocialCommand';
import { resolveStoreArtwork } from '../store/storeArtwork';
import type { DailyLoginCalendarDay, DailyLoginRewardBundle } from './dailyLoginContract';
import type { DailyLoginRewardsController } from './useDailyLoginRewards';

const SHEET_SIDE_INSET = 16;
const SHEET_INNER_PAD = 16;
const GRID_GAP = 8;
const CARD_HEIGHT = 138;
const FINALE_HEIGHT = 112;

export function DailyLoginHomeCard({ controller }: { controller: DailyLoginRewardsController }) {
  const { isLoading, status } = controller;
  if (!status || !status.presentationVisible || status.calendar.length !== 7) return null;
  const position = status.streakPosition || 1;
  return (
    <Pressable
      accessibilityHint="يفتح جدول مكافآت الدخول للأيام السبعة"
      accessibilityLabel={status.claimable ? 'مكافأة الدخول اليومية جاهزة للاستلام' : 'عرض مكافآت الدخول اليومية'}
      accessibilityRole="button"
      onPress={controller.open}
      style={({ pressed }) => [styles.homeCardShell, pressed && styles.pressed]}
    >
      <LinearGradient colors={['#080304', '#4A0C14', '#170507']} end={{ x: 0, y: 1 }} start={{ x: 1, y: 0 }} style={styles.homeCard}>
        <View pointerEvents="none" style={styles.homeOrnament} />
        <View pointerEvents="none" style={styles.homeGoldLine} />
        <View style={styles.homeCopy}>
          <View style={styles.homeKickerRow}>
            <Text style={styles.homeKicker}>{status.claimable ? 'جاهزة الآن' : 'سلسلتك اليومية'}</Text>
            <SymbolView
              name={{ ios: 'crown.fill', android: 'workspace_premium', web: 'workspace_premium' }}
              size={13}
              tintColor="#F4D58A"
            />
          </View>
          <Text style={styles.homeTitle}>هدية الحضور اليومي</Text>
          <Text style={styles.homeBody}>
            {isLoading
              ? 'جارٍ تحميل جوائزك…'
              : status.alreadyClaimed
                ? 'تم استلام جائزة اليوم · عد غداً للجائزة التالية'
                : `اليوم ${position} من 7 · افتح الهدية قبل منتصف الليل`}
          </Text>
        </View>
        <View style={[styles.dayMedallion, status.claimable && styles.dayMedallionReady]}>
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
  const { width: windowWidth } = useWindowDimensions();
  const [itemArtwork, setItemArtwork] = useState<Record<string, string>>({});
  const [reduceMotion, setReduceMotion] = useState(false);

  const currentPosition = claimResult?.streakPosition || status?.streakPosition || 1;
  const calendar = status?.calendar || [];
  const resetCountdown = useResetCountdown(status?.nextResetAtMillis);
  const claimedThrough = claimResult
    ? claimResult.streakPosition
    : status?.alreadyClaimed
      ? currentPosition
      : Math.max(0, currentPosition - 1);

  const sheetWidth = Math.min(windowWidth - SHEET_SIDE_INSET * 2, 420);
  const contentWidth = sheetWidth - SHEET_INNER_PAD * 2;
  const cardWidth = Math.floor((contentWidth - GRID_GAP * 2) / 3);

  const itemIdsKey = useMemo(
    () => calendar.flatMap((entry) => entry.reward.items.map((item) => item.itemId)).join('|'),
    [calendar],
  );
  const orderedCalendar = useMemo(
    () => [...calendar].sort((left, right) => left.day - right.day),
    [calendar],
  );
  const earlyDays = orderedCalendar.filter((entry) => entry.day >= 1 && entry.day <= 6);
  const finaleDay = orderedCalendar.find((entry) => entry.day === 7);
  const earlyRows = useMemo(() => {
    const rows: DailyLoginCalendarDay[][] = [];
    for (let index = 0; index < earlyDays.length; index += 3) {
      rows.push(earlyDays.slice(index, index + 3));
    }
    return rows;
  }, [earlyDays]);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!itemIdsKey) {
      setItemArtwork({});
      return;
    }
    const wanted = new Set(itemIdsKey.split('|').filter(Boolean));
    let active = true;
    void requestStoreCatalog()
      .then((catalog) => {
        if (!active || !catalog.ok) return;
        setItemArtwork(Object.fromEntries(
          catalog.result.items
            .filter((item) => wanted.has(item.itemId) && item.thumbnailUrl)
            .map((item) => [item.itemId, item.thumbnailUrl]),
        ));
      })
      .catch(() => {
        if (active) setItemArtwork({});
      });
    return () => {
      active = false;
    };
  }, [itemIdsKey]);

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
        <View style={[styles.sheetShell, { width: sheetWidth }]}>
          <LinearGradient
            colors={['#3E0910', '#170506', '#080303']}
            end={{ x: 0.5, y: 1 }}
            start={{ x: 0.5, y: 0 }}
            style={styles.sheet}
          >
            <View pointerEvents="none" style={styles.goldRim} />
            <View pointerEvents="none" style={styles.topGlow} />
            <View pointerEvents="none" style={styles.bottomGlow} />
            <View pointerEvents="none" style={styles.cornerTL} />
            <View pointerEvents="none" style={styles.cornerTR} />
            <View pointerEvents="none" style={styles.cornerBL} />
            <View pointerEvents="none" style={styles.cornerBR} />

            <Pressable accessibilityLabel="إغلاق" hitSlop={10} onPress={controller.close} style={styles.closeButton}>
              <Text style={styles.closeLabel}>×</Text>
            </Pressable>

            <View style={styles.header}>
              <View style={styles.crownSeal}>
                <LinearGradient colors={['#FFF3BA', '#D49A2C', '#7D4308']} style={styles.crownSealFill}>
                  <View pointerEvents="none" style={styles.crownGem} />
                  <SymbolView
                    name={{ ios: 'crown.fill', android: 'workspace_premium', web: 'workspace_premium' }}
                    size={30}
                    tintColor="#4B0910"
                  />
                </LinearGradient>
              </View>
              <Text style={styles.headerEyebrow}>ديوان المكافآت الملكية</Text>
              <Text style={styles.sheetTitle}>هدايا الحضور اليومية</Text>
              <Text style={styles.headerSubtitle}>داوم على الحضور وافتح كنز اليوم السابع</Text>
              <View pointerEvents="none" style={styles.headerFlourish}>
                <View style={styles.flourishLine} />
                <View style={styles.flourishDiamond} />
                <View style={styles.flourishLine} />
              </View>
            </View>

            <View accessibilityLabel={`تقدم الحضور ${claimedThrough} من 7`} style={styles.streakRail}>
              <View pointerEvents="none" style={styles.streakLine} />
              {orderedCalendar.map((entry) => {
                const reached = entry.day <= claimedThrough;
                const active = entry.day === currentPosition && !status?.alreadyClaimed && !claimResult;
                return (
                  <View
                    key={`streak-${entry.day}`}
                    style={[styles.streakNode, reached && styles.streakNodeReached, active && styles.streakNodeActive]}
                  >
                    {reached ? (
                      <Text style={styles.streakCheck}>✓</Text>
                    ) : (
                      <Text style={[styles.streakNumber, active && styles.streakNumberActive]}>{entry.day.toLocaleString('ar-IQ')}</Text>
                    )}
                  </View>
                );
              })}
            </View>

            <ScrollView
              bounces={false}
              contentContainerStyle={styles.calendarScroll}
              showsVerticalScrollIndicator={false}
              style={styles.calendarViewport}
            >
              {earlyRows.map((row, rowIndex) => (
                <View key={`row-${rowIndex}`} style={[styles.dayRow, { gap: GRID_GAP }]}>
                  {row.map((entry) => (
                    <DayCard
                      cardWidth={cardWidth}
                      claimed={entry.day <= claimedThrough}
                      current={entry.day === currentPosition && !claimResult && !status?.alreadyClaimed}
                      entry={entry}
                      itemArtwork={itemArtwork}
                      key={entry.day}
                      wide={false}
                    />
                  ))}
                  {row.length < 3
                    ? Array.from({ length: 3 - row.length }).map((_, filler) => (
                      <View key={`pad-${rowIndex}-${filler}`} style={{ height: CARD_HEIGHT, width: cardWidth }} />
                    ))
                    : null}
                </View>
              ))}

              {finaleDay ? (
                <DayCard
                  cardWidth={contentWidth}
                  claimed={finaleDay.day <= claimedThrough}
                  current={finaleDay.day === currentPosition && !claimResult && !status?.alreadyClaimed}
                  entry={finaleDay}
                  itemArtwork={itemArtwork}
                  wide
                />
              ) : null}

              <Text style={styles.progressText}>
                {claimResult || status?.alreadyClaimed ? (
                  <>
                    تم تسجيل الدخول{' '}
                    <Text style={styles.progressAccent}>
                      {(claimResult?.streakPosition || currentPosition).toLocaleString('ar-IQ')}{' '}
                      {(claimResult?.streakPosition || currentPosition) === 1 ? 'يوم' : 'أيام'}
                    </Text>
                  </>
                ) : (
                  `اليوم ${currentPosition.toLocaleString('ar-IQ')} من 7 · يتجدد بعد ${resetCountdown}`
                )}
              </Text>

              {claimResult ? (
                <View accessibilityLiveRegion="polite" style={styles.successPanel}>
                  <Text style={styles.successTitle}>تمت إضافة هدية اليوم</Text>
                  <Text style={styles.successReward}>{rewardLabel(claimResult.reward)}</Text>
                </View>
              ) : null}

              {errorMessage ? (
                <View accessibilityLiveRegion="polite" style={styles.errorPanel}>
                  <Text style={styles.errorTitle}>{errorTitle(errorCode)}</Text>
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              ) : null}
            </ScrollView>

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
              <LinearGradient colors={['#FFF1B6', '#DDA83D', '#9C5E12']} style={styles.claimButtonGradient}>
                {isClaiming ? <ActivityIndicator color="#240A0C" /> : (
                  <View style={styles.claimButtonContent}>
                    <SymbolView
                      name={{ ios: claimResult ? 'checkmark.seal.fill' : 'gift.fill', android: claimResult ? 'verified' : 'redeem', web: claimResult ? 'verified' : 'redeem' }}
                      size={20}
                      tintColor="#3B090D"
                    />
                    <Text style={styles.claimButtonText}>
                      {claimResult
                        ? 'تم الاستلام'
                        : status?.alreadyClaimed
                          ? 'عد غداً للجائزة التالية'
                          : status?.claimable
                            ? 'استلام هدية اليوم'
                            : statusReason(status?.reason)}
                    </Text>
                  </View>
                )}
              </LinearGradient>
            </Pressable>
            <Text style={styles.resetText}>يتجدد بعد {resetCountdown} · بتوقيت بغداد</Text>
          </LinearGradient>
        </View>
      </View>
    </Modal>
  );
}

function DayCard({
  cardWidth,
  claimed,
  current,
  entry,
  itemArtwork,
  wide,
}: {
  cardWidth: number;
  claimed: boolean;
  current: boolean;
  entry: DailyLoginCalendarDay;
  itemArtwork: Record<string, string>;
  wide: boolean;
}) {
  const parts = rewardParts(entry.reward);
  const visibleParts = wide ? parts.slice(0, 3) : parts.slice(0, 1);
  const amount = wide ? null : compactAmount(entry.reward);

  return (
    <LinearGradient
      accessibilityLabel={`اليوم ${entry.day}: ${rewardAccessibility(entry.reward)}${claimed ? '، تم الاستلام' : ''}`}
      colors={
        current
          ? ['#741522', '#35090E', '#160507']
          : claimed
            ? ['#2C160D', '#160807', '#0D0505']
            : ['#30090E', '#170507', '#0C0404']
      }
      end={{ x: 0.5, y: 1 }}
      start={{ x: 0.5, y: 0 }}
      style={[
        styles.dayCard,
        {
          height: wide ? FINALE_HEIGHT : CARD_HEIGHT,
          width: cardWidth,
        },
        current && styles.dayCardCurrent,
        claimed && !current && styles.dayCardClaimed,
      ]}
    >
      <View style={[styles.dayHeader, current && styles.dayHeaderCurrent]}>
        {wide ? (
          <SymbolView
            name={{ ios: 'crown.fill', android: 'workspace_premium', web: 'workspace_premium' }}
            size={13}
            tintColor="#FFE7A3"
          />
        ) : null}
        <Text style={styles.dayCardLabel}>
          {wide ? `اليوم ${entry.day.toLocaleString('ar-IQ')} · الكنز الملكي` : `اليوم ${entry.day.toLocaleString('ar-IQ')}`}
        </Text>
        {current ? <View style={styles.currentSpark} /> : null}
      </View>

      <View style={[styles.rewardStage, wide && styles.rewardStageWide]}>
        {visibleParts.length ? visibleParts.map((part, index) => (
          <View key={`${entry.day}-${part.key}`} style={[styles.rewardSlot, wide && styles.rewardSlotWide]}>
            {index > 0 ? <Text style={styles.rewardPlus}>+</Text> : null}
            <View style={styles.rewardColumn}>
              <View style={[styles.rewardIconWell, wide && styles.rewardIconWellWide]}>
                <RewardVisual artworkUrl={part.itemId ? itemArtwork[part.itemId] : undefined} part={part} />
                {claimed ? (
                  <View style={styles.claimedBadge}>
                    <Text style={styles.claimedCheck}>✓</Text>
                  </View>
                ) : null}
              </View>
              {wide && part.amountLabel ? (
                <View style={styles.amountPlaque}>
                  <Text numberOfLines={1} style={styles.amountText}>{part.amountLabel}</Text>
                </View>
              ) : null}
            </View>
          </View>
        )) : (
          <View style={styles.rewardIconWell}>
            <SymbolView
              name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }}
              size={22}
              tintColor="#F4D58A"
            />
          </View>
        )}
      </View>

      {!wide ? (
        <View style={styles.amountPlaque}>
          <Text numberOfLines={1} style={styles.amountText}>{amount || '—'}</Text>
        </View>
      ) : null}
    </LinearGradient>
  );
}

function RewardVisual({
  artworkUrl,
  part,
}: {
  artworkUrl?: string;
  part: RewardPart;
}) {
  if (part.kind === 'item' && artworkUrl) {
    return (
      <Image
        accessibilityIgnoresInvertColors
        source={resolveStoreArtwork(artworkUrl)}
        style={styles.rewardArtwork}
      />
    );
  }
  return (
    <SymbolView
      name={
        part.kind === 'coins'
          ? { ios: 'bitcoinsign.circle.fill', android: 'monetization_on', web: 'monetization_on' }
          : part.kind === 'diamonds'
            ? { ios: 'diamond.fill', android: 'diamond', web: 'diamond' }
            : { ios: 'gift.fill', android: 'redeem', web: 'redeem' }
      }
      size={24}
      tintColor={part.kind === 'diamonds' ? '#FF8AA0' : '#F4D58A'}
    />
  );
}

type RewardPart = {
  amountLabel?: string;
  itemId?: string;
  key: string;
  kind: 'coins' | 'diamonds' | 'item';
};

function rewardParts(reward: DailyLoginRewardBundle): RewardPart[] {
  const parts: RewardPart[] = [];
  if (reward.coins > 0) {
    parts.push({
      amountLabel: reward.coins.toLocaleString('ar-IQ'),
      key: 'coins',
      kind: 'coins',
    });
  }
  if (reward.diamonds > 0) {
    parts.push({
      amountLabel: reward.diamonds.toLocaleString('ar-IQ'),
      key: 'diamonds',
      kind: 'diamonds',
    });
  }
  reward.items.forEach((item, index) => {
    parts.push({
      amountLabel: reward.items.length === 1 && !reward.coins && !reward.diamonds ? 'عنصر' : undefined,
      itemId: item.itemId,
      key: `item-${item.itemId}-${index}`,
      kind: 'item',
    });
  });
  return parts;
}

function compactAmount(reward: DailyLoginRewardBundle) {
  if (reward.coins > 0 && !reward.diamonds && !reward.items.length) {
    return reward.coins.toLocaleString('ar-IQ');
  }
  if (reward.diamonds > 0 && !reward.coins && !reward.items.length) {
    return reward.diamonds.toLocaleString('ar-IQ');
  }
  if (reward.items.length && !reward.coins && !reward.diamonds) {
    return reward.items.length > 1
      ? `${reward.items.length.toLocaleString('ar-IQ')} عناصر`
      : 'عنصر';
  }
  const chunks = [
    reward.coins ? reward.coins.toLocaleString('ar-IQ') : '',
    reward.diamonds ? reward.diamonds.toLocaleString('ar-IQ') : '',
    reward.items.length ? `${reward.items.length.toLocaleString('ar-IQ')}ع` : '',
  ].filter(Boolean);
  return chunks.join('+') || '—';
}

function rewardLabel(reward: DailyLoginRewardBundle) {
  return [
    reward.coins ? `${reward.coins.toLocaleString('ar-IQ')} عملة` : '',
    reward.diamonds ? `${reward.diamonds.toLocaleString('ar-IQ')} ألماس` : '',
    reward.items.length
      ? reward.items.length === 1
        ? 'عنصر واحد'
        : `${reward.items.length.toLocaleString('ar-IQ')} عناصر`
      : '',
  ].filter(Boolean).join(' · ') || 'هدية';
}

function rewardAccessibility(reward: DailyLoginRewardBundle) {
  return rewardLabel(reward);
}

function errorTitle(code: string) {
  if (code === 'RATE_LIMITED') return 'محاولات كثيرة';
  if (code === 'CLIENT_INCOMPATIBLE') return 'حدّث التطبيق';
  if (code === 'CLAIMS_PAUSED' || code === 'EMERGENCY_DISABLED') return 'المكافآت متوقفة مؤقتاً';
  if (code === 'CLAIM_CONFLICT' || code === 'CLAIM_STATE_CONFLICT') return 'المكافأة قيد المراجعة';
  return 'تعذر استلام الهدية';
}

function statusReason(reason?: string) {
  if (reason === 'CLAIMS_PAUSED') return 'الاستلام متوقف مؤقتاً';
  if (reason === 'CLIENT_INCOMPATIBLE') return 'يتطلب تحديث التطبيق';
  if (reason === 'ALREADY_CLAIMED') return 'تم استلام هدية اليوم';
  if (reason === 'CLAIM_CONFLICT' || reason === 'CLAIM_STATE_CONFLICT') return 'المكافأة قيد المراجعة';
  if (reason === 'ITEM_REWARDS_DISABLED') return 'هدية اليوم غير متاحة';
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
    shadowColor: '#D6A84F',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 5,
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
  homeGoldLine: {
    backgroundColor: 'rgba(244,213,138,0.38)',
    bottom: 5,
    height: 1,
    left: 18,
    position: 'absolute',
    right: 18,
  },
  homeCopy: { flex: 1 },
  homeKickerRow: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: 5,
  },
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
    width: 66,
  },
  dayMedallionReady: {
    backgroundColor: '#771320',
    borderColor: '#F1CA74',
  },
  dayMedallionSmall: { color: '#D9BE8D', fontSize: 8, writingDirection: 'rtl' },
  dayMedallionNumber: { color: '#FFE4A1', fontSize: 24, fontWeight: typography.weights.black },

  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.84)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: SHEET_SIDE_INSET,
    paddingVertical: 24,
  },
  sheetShell: {
    maxHeight: '90%',
    shadowColor: '#E2B053',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.34,
    shadowRadius: 30,
    elevation: 18,
  },
  sheet: {
    borderColor: '#EBC66F',
    borderRadius: 24,
    borderWidth: 2,
    overflow: 'hidden',
    paddingBottom: 14,
    paddingHorizontal: SHEET_INNER_PAD,
    paddingTop: 14,
  },
  goldRim: {
    borderColor: 'rgba(244, 213, 138, 0.28)',
    borderRadius: 19,
    borderWidth: 1,
    bottom: 5,
    left: 5,
    position: 'absolute',
    right: 5,
    top: 5,
  },
  topGlow: {
    backgroundColor: 'rgba(130,20,34,0.32)',
    borderRadius: 160,
    height: 210,
    left: '14%',
    position: 'absolute',
    top: -135,
    width: '72%',
  },
  bottomGlow: {
    backgroundColor: 'rgba(120,73,16,0.12)',
    borderRadius: 130,
    bottom: -125,
    height: 180,
    left: '18%',
    position: 'absolute',
    width: '64%',
  },
  cornerTL: corner(true, true),
  cornerTR: corner(true, false),
  cornerBL: corner(false, true),
  cornerBR: corner(false, false),
  closeButton: {
    alignItems: 'center',
    backgroundColor: '#5A1018',
    borderColor: '#E8BE61',
    borderRadius: radius.full,
    borderWidth: 1.5,
    height: 32,
    justifyContent: 'center',
    left: 10,
    position: 'absolute',
    top: 10,
    width: 32,
    zIndex: 5,
  },
  closeLabel: {
    color: '#F4D58A',
    fontSize: 20,
    fontWeight: typography.weights.black,
    lineHeight: 22,
    marginTop: -1,
  },
  header: {
    alignItems: 'center',
    marginBottom: 8,
    marginTop: 4,
  },
  crownSeal: {
    borderColor: '#FFF1B5',
    borderRadius: radius.full,
    borderWidth: 2.5,
    elevation: 8,
    height: 60,
    marginBottom: 7,
    overflow: 'hidden',
    shadowColor: '#F4D58A',
    shadowOpacity: 0.55,
    shadowRadius: 14,
    width: 60,
    zIndex: 2,
  },
  crownSealFill: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  crownGem: {
    backgroundColor: '#9B1727',
    borderColor: '#FFF0C5',
    borderRadius: 4,
    borderWidth: 1,
    height: 7,
    position: 'absolute',
    top: 9,
    transform: [{ rotate: '45deg' }],
    width: 7,
    zIndex: 2,
  },
  headerEyebrow: {
    color: '#DDB55A',
    fontSize: 10,
    fontWeight: typography.weights.black,
    letterSpacing: 0.6,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  sheetTitle: {
    color: '#FFF2CC',
    fontSize: 23,
    fontWeight: typography.weights.black,
    marginTop: 1,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  headerSubtitle: {
    color: '#BCA68D',
    fontSize: 10,
    marginTop: 3,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  headerFlourish: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    marginTop: 9,
    width: '62%',
  },
  flourishLine: {
    backgroundColor: 'rgba(232,190,97,0.45)',
    flex: 1,
    height: 1,
  },
  flourishDiamond: {
    backgroundColor: '#D9A741',
    height: 7,
    transform: [{ rotate: '45deg' }],
    width: 7,
  },
  streakRail: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 5,
    position: 'relative',
  },
  streakLine: {
    backgroundColor: 'rgba(214,168,79,0.34)',
    height: 2,
    left: 16,
    position: 'absolute',
    right: 16,
  },
  streakNode: {
    alignItems: 'center',
    backgroundColor: '#160709',
    borderColor: '#74532D',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 27,
    justifyContent: 'center',
    width: 27,
  },
  streakNodeReached: {
    backgroundColor: '#704515',
    borderColor: '#F1CF79',
  },
  streakNodeActive: {
    backgroundColor: '#8C1725',
    borderColor: '#FFF0B5',
    borderWidth: 2,
    elevation: 5,
    shadowColor: '#F4D58A',
    shadowOpacity: 0.6,
    shadowRadius: 7,
    transform: [{ scale: 1.14 }],
  },
  streakCheck: {
    color: '#FFF2C5',
    fontSize: 12,
    fontWeight: typography.weights.black,
  },
  streakNumber: {
    color: '#9C846A',
    fontSize: 9,
    fontWeight: typography.weights.bold,
  },
  streakNumberActive: { color: '#FFF2C5' },
  calendarViewport: {
    flexGrow: 0,
    maxHeight: 430,
  },
  calendarScroll: {
    gap: GRID_GAP,
    paddingBottom: 4,
  },
  dayRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'flex-start',
  },
  dayCard: {
    borderColor: 'rgba(232, 190, 97, 0.45)',
    borderRadius: 14,
    borderWidth: 1.5,
    overflow: 'hidden',
    paddingBottom: 8,
  },
  dayCardCurrent: {
    borderColor: '#F4D58A',
    borderWidth: 2,
    elevation: 5,
    shadowColor: '#E8BE61',
    shadowOpacity: 0.28,
    shadowRadius: 8,
  },
  dayCardClaimed: {
    opacity: 0.78,
  },
  dayHeader: {
    alignItems: 'center',
    backgroundColor: 'rgba(110,21,32,0.74)',
    borderBottomColor: 'rgba(232, 190, 97, 0.35)',
    borderBottomWidth: 1,
    flexDirection: 'row-reverse',
    gap: 5,
    justifyContent: 'center',
    paddingVertical: 5,
  },
  dayHeaderCurrent: {
    backgroundColor: '#8E1C2A',
  },
  dayCardLabel: {
    color: '#FFE7B0',
    fontSize: 11,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  currentSpark: {
    backgroundColor: '#FFF0B5',
    borderRadius: radius.full,
    height: 5,
    shadowColor: '#F4D58A',
    shadowOpacity: 0.8,
    shadowRadius: 4,
    width: 5,
  },
  rewardStage: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  rewardStageWide: {
    flexDirection: 'row-reverse',
    gap: 6,
    justifyContent: 'center',
  },
  rewardSlot: {
    alignItems: 'center',
  },
  rewardSlotWide: {
    flexDirection: 'row-reverse',
    gap: 6,
  },
  rewardColumn: {
    alignItems: 'center',
    gap: 5,
  },
  rewardPlus: {
    color: '#F4D58A',
    fontSize: 18,
    fontWeight: typography.weights.black,
    marginTop: 10,
  },
  rewardIconWell: {
    alignItems: 'center',
    backgroundColor: 'rgba(8,3,4,0.68)',
    borderColor: 'rgba(232, 190, 97, 0.4)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 52,
    justifyContent: 'center',
    position: 'relative',
    width: 52,
  },
  rewardIconWellWide: {
    height: 56,
    width: 56,
  },
  rewardArtwork: {
    borderRadius: 8,
    height: 40,
    width: 40,
  },
  claimedBadge: {
    alignItems: 'center',
    backgroundColor: '#22C55E',
    borderColor: '#FFFFFF',
    borderRadius: radius.full,
    borderWidth: 1.5,
    bottom: -3,
    elevation: 3,
    height: 20,
    justifyContent: 'center',
    position: 'absolute',
    right: -3,
    width: 20,
  },
  claimedCheck: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: typography.weights.black,
    lineHeight: 13,
  },
  amountPlaque: {
    alignSelf: 'center',
    backgroundColor: '#120508',
    borderColor: '#D6A84F',
    borderRadius: 7,
    borderWidth: 1,
    minWidth: 52,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  amountText: {
    color: '#FFF4DE',
    fontSize: 11,
    fontWeight: typography.weights.black,
    textAlign: 'center',
  },
  progressText: {
    color: '#E8D4B0',
    fontSize: 13,
    fontWeight: typography.weights.bold,
    marginTop: 6,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  progressAccent: {
    color: '#FF6B7A',
    fontWeight: typography.weights.black,
  },
  successPanel: {
    backgroundColor: 'rgba(46, 125, 50, 0.22)',
    borderColor: 'rgba(167, 220, 110, 0.4)',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  successTitle: {
    color: '#D8EE9C',
    fontSize: 14,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  successReward: {
    color: '#FFF0C3',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  errorPanel: {
    backgroundColor: 'rgba(137,23,35,0.24)',
    borderColor: 'rgba(224,74,88,0.4)',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  errorTitle: {
    color: '#F3A2A9',
    fontSize: 13,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  errorText: {
    color: '#CBB1B3',
    fontSize: 10,
    marginTop: 3,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  claimButton: {
    borderRadius: radius.full,
    marginTop: 10,
    overflow: 'hidden',
    shadowColor: '#E8BE61',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 7,
  },
  claimButtonDisabled: { opacity: 0.5 },
  claimButtonGradient: {
    alignItems: 'center',
    borderColor: '#FFF0CD',
    borderRadius: radius.full,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: spacing.lg,
  },
  claimButtonContent: {
    alignItems: 'center',
    flexDirection: 'row-reverse',
    gap: 8,
    justifyContent: 'center',
  },
  claimButtonText: {
    color: '#28090C',
    fontSize: 15,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  resetText: {
    color: '#9A8778',
    fontSize: 9,
    marginTop: 8,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
});

function corner(top: boolean, left: boolean) {
  return {
    borderColor: '#F4D58A',
    borderTopWidth: top ? 3 : 0,
    borderBottomWidth: top ? 0 : 3,
    borderLeftWidth: left ? 3 : 0,
    borderRightWidth: left ? 0 : 3,
    height: 18,
    position: 'absolute' as const,
    width: 18,
    ...(top ? { top: 8 } : { bottom: 8 }),
    ...(left ? { left: 8 } : { right: 8 }),
  };
}
