import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';
import type { RewardBundleV1 } from '../../voice/weeklyIncentiveContract';
import type { RoomRocketData } from '../../voice/useRoomRocketData';
import type { RoomSupportLeaderboardEntryV1 } from '../../voice/roomSupportLeaderboardContract';
import type { RoomThemeManifest } from '../../voice/roomThemeContract';
import { resolveRoomRocketRailSummary } from '../../voice/roomIncentivePresentationModel';
import { RoomSheet } from './VoiceRoomSheets';
import { AvatarPresentation } from '../AvatarPresentation';
import type { CosmeticsFeatureFlags } from '../../cosmetics/featureFlags';

export function RoomRocketButton({
  cosmeticsFlags,
  data,
  manifest,
  onPress,
}: {
  cosmeticsFlags: CosmeticsFeatureFlags;
  data: RoomRocketData;
  manifest: RoomThemeManifest;
  onPress: () => void;
}) {
  if (!data.renderingEnabled) return null;
  const summary = resolveRoomRocketRailSummary(data);
  const rankingsOnly = !data.campaignAvailable;
  const unlocked = data.cycle?.state !== 'active' && Boolean(data.cycle);
  return (
    <Pressable
      accessibilityHint={rankingsOnly ? 'يعرض ترتيب داعمي الغرفة اليومي والأسبوعي' : 'يعرض هدف الصاروخ وترتيب داعمي الغرفة'}
      accessibilityLabel={rankingsOnly ? `أفضل الداعمين، ${summary.supporters.length} في المراكز الثلاثة الأولى` : `صاروخ الغرفة، ${summary.progressPercent} بالمئة، ${summary.supporters.length} من أفضل الداعمين`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.launcher, pressed && styles.pressed]}
    >
      <LinearGradient
        colors={[manifest.colors.rubyBright, manifest.colors.ruby, manifest.colors.panel]}
        style={[styles.launcherCore, { borderColor: manifest.colors.goldSoft, shadowColor: manifest.colors.rubyBright }]}
      >
        <Text style={styles.launcherIcon}>{unlocked && !rankingsOnly ? '✨' : '🚀'}</Text>
        <Text style={[styles.launcherPercent, { color: manifest.colors.text }]}>
          {rankingsOnly ? 'TOP 3' : `${summary.progressPercent}٪`}
        </Text>
      </LinearGradient>
      <MiniSupporterStack cosmeticsFlags={cosmeticsFlags} entries={summary.supporters} manifest={manifest} />
      <View style={styles.launcherCopy}>
        <Text style={[styles.launcherLabel, { color: manifest.colors.goldSoft }]}>
          {rankingsOnly ? 'الصاروخ · TOP 3' : 'دعم الأسبوع'}
        </Text>
        {!rankingsOnly ? (
          <View style={[styles.miniTrack, { backgroundColor: `${manifest.colors.panelRaised}F2` }]}>
            <View style={[styles.miniFill, { backgroundColor: manifest.colors.gold, width: `${Math.max(3, summary.progress * 100)}%` }]} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function MiniSupporterStack({
  cosmeticsFlags,
  entries,
  manifest,
}: {
  cosmeticsFlags: CosmeticsFeatureFlags;
  entries: RoomSupportLeaderboardEntryV1[];
  manifest: RoomThemeManifest;
}) {
  if (!entries.length) {
    return <Text style={[styles.miniEmpty, { color: manifest.colors.textMuted }]}>TOP 3</Text>;
  }
  return (
    <View accessibilityLabel="أفضل ثلاثة داعمين هذا الأسبوع" style={styles.miniSupporters}>
      {entries.map((entry, index) => (
        <View key={entry.uid} style={[styles.miniAvatarShell, index > 0 && styles.miniAvatarOverlap, { borderColor: manifest.colors.gold }]}>
          <AvatarPresentation
            avatarUrl={entry.avatarUrl}
            flags={cosmeticsFlags}
            frame={entry.avatarFrame}
            label={entry.avatarLabel || entry.displayName}
            size={19}
            viewerMode="reduced"
          />
          <Text style={[styles.miniRank, { backgroundColor: manifest.colors.rubyBright, color: manifest.colors.text }]}>{entry.rank}</Text>
        </View>
      ))}
    </View>
  );
}

export function RoomRocketSheet({
  cosmeticsFlags,
  data,
  initialFocus = 'rocket',
  payoutsEnabled,
  visible,
  onClose,
}: {
  cosmeticsFlags: CosmeticsFeatureFlags;
  data: RoomRocketData;
  initialFocus?: 'rocket' | 'supporters';
  payoutsEnabled: boolean;
  visible: boolean;
  onClose: () => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const leaderboardOffset = useRef(0);
  const [tab, setTab] = useState<'today' | 'week'>('week');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!visible) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    if (initialFocus === 'supporters') setTab('week');
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        animated: false,
        y: initialFocus === 'supporters' ? leaderboardOffset.current : 0,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [initialFocus, visible]);
  const leaderboard = tab === 'today' ? data.today : data.week;
  const progress = resolveProgress(data);
  const rewards = useMemo(
    () => data.template?.rewards || {},
    [data.template?.rewards],
  );
  const endAtMillis = data.cycle?.endAtMillis || nextBaghdadWeekMillis(now);
  const state = data.cycle?.state || 'active';
  const unlocked = state !== 'active' && state !== 'missed';
  const rankingsOnly = !data.campaignAvailable;

  return (
    <RoomSheet onClose={onClose} title={rankingsOnly ? 'الصاروخ وأفضل الداعمين' : 'صاروخ الغرفة'} visible={visible}>
      <ScrollView contentContainerStyle={styles.content} ref={scrollRef} showsVerticalScrollIndicator={false}>
        <LinearGradient colors={['#3A070C', '#130306', '#050203']} style={styles.hero}>
          <View style={styles.heroHalo} />
          <Text accessibilityLabel="صاروخ" style={styles.heroRocket}>🚀</Text>
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>{rankingsOnly ? 'الترتيب المباشر للغرفة' : 'هدف أسبوعي عالمي'}</Text>
            <Text style={styles.heroTitle}>{rankingsOnly ? 'أفضل الداعمين' : data.cycle?.appearance.name.ar || data.template?.appearance.name.ar || 'صاروخ الغرفة'}</Text>
            <Text style={styles.countdown}>{rankingsOnly ? 'ترتيب يومي وأسبوعي' : `ينتهي خلال ${formatCountdown(endAtMillis - now)}`}</Text>
          </View>
        </LinearGradient>

        {rankingsOnly ? (
          <View accessibilityLiveRegion="polite" style={styles.progressCard}>
            <Text style={styles.progressHint}>ترتيب أفضل الداعمين فعّال الآن. ستظهر حملة الصاروخ والجوائز هنا تلقائياً بعد نشر رسوماتها المعتمدة من لوحة التحكم.</Text>
            <Text style={styles.testNotice}>صرف الجوائز متوقف؛ لا يتم عرض هدف أو تقدم وهمي.</Text>
          </View>
        ) : <View accessibilityLiveRegion="polite" style={styles.progressCard}>
          <View style={styles.progressHeading}>
            <View style={[styles.statePill, unlocked && styles.statePillUnlocked]}>
              <Text style={styles.stateText}>{stateLabel(state)}</Text>
            </View>
            <Text style={styles.progressValue}>
              {(data.cycle?.supportPoints || 0).toLocaleString('ar-IQ')} / {(data.cycle?.targetSupportPoints || data.template?.targetSupportPoints || 0).toLocaleString('ar-IQ')}
            </Text>
          </View>
          <View style={styles.track}>
            <LinearGradient
              colors={['#FF384D', '#D89B38', '#FFE19A']}
              end={{ x: 1, y: 0 }}
              start={{ x: 0, y: 0 }}
              style={[styles.fill, { width: `${Math.max(1.5, progress * 100)}%` }]}
            />
          </View>
          <Text style={styles.progressHint}>
            {unlocked ? 'تم فتح المكافآت لهذا الأسبوع.' : 'الهدايا المؤهلة في هذه الغرفة تزيد الوقود.'}
          </Text>
          {!payoutsEnabled ? <Text style={styles.testNotice}>العرض قيد الاختبار؛ صرف الجوائز متوقف حالياً.</Text> : null}
        </View>}

        {!rankingsOnly ? <><View style={styles.rewardsHeader}>
          <Text style={styles.sectionTitle}>الجوائز الدقيقة</Text>
          <Text style={styles.sectionNote}>تُحسم المراتب بعد إغلاق الأسبوع</Text>
        </View>
        <View style={styles.rewardRow}>
          {Array.from({ length: data.cycle?.enabledRankCount || data.template?.enabledRankCount || 1 }, (_, index) => {
            const rank = index + 1;
            return <RewardCard bundle={rewards[String(rank) as '1' | '2' | '3']} key={rank} rank={rank} />;
          })}
        </View></> : null}

        <View
          accessibilityRole="tablist"
          onLayout={(event) => {
            leaderboardOffset.current = Math.max(0, event.nativeEvent.layout.y - spacing.sm);
            if (visible && initialFocus === 'supporters') {
              scrollRef.current?.scrollTo({ animated: false, y: leaderboardOffset.current });
            }
          }}
          style={styles.tabs}
        >
          <Tab active={tab === 'week'} label="هذا الأسبوع" onPress={() => setTab('week')} />
          <Tab active={tab === 'today'} label="اليوم" onPress={() => setTab('today')} />
        </View>

        <Podium cosmeticsFlags={cosmeticsFlags} entries={leaderboard?.entries.slice(0, 3) || []} />
        {(leaderboard?.entries || []).slice(3).map((entry) => (
          <SupporterRow cosmeticsFlags={cosmeticsFlags} entry={entry} key={entry.uid} />
        ))}
        {!leaderboard?.entries.length ? (
          <View style={styles.empty}>
            <SymbolView name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} size={24} tintColor={colors.goldSoft} />
            <Text style={styles.emptyTitle}>المقاعد الأولى بانتظار الداعمين</Text>
            <Text style={styles.emptyCopy}>سيظهر الترتيب مباشرة بعد أول هدية مؤهلة في هذه الفترة.</Text>
          </View>
        ) : null}
        {data.error ? <Text style={styles.error}>تعذر تحديث بعض بيانات الصاروخ. سنحاول مجدداً تلقائياً.</Text> : null}
      </ScrollView>
    </RoomSheet>
  );
}

function Podium({ cosmeticsFlags, entries }: { cosmeticsFlags: CosmeticsFeatureFlags; entries: RoomSupportLeaderboardEntryV1[] }) {
  if (!entries.length) return null;
  const ordered = [entries[1], entries[0], entries[2]].filter(Boolean);
  return (
    <View accessibilityLabel="أفضل ثلاثة داعمين" style={styles.podium}>
      {ordered.map((entry) => (
        <View key={entry.uid} style={[styles.podiumItem, entry.rank === 1 && styles.podiumFirst]}>
          <Avatar cosmeticsFlags={cosmeticsFlags} entry={entry} large={entry.rank === 1} />
          <Text numberOfLines={1} style={styles.podiumName}>{entry.displayName}</Text>
          <Text style={styles.podiumPoints}>{entry.supportPoints.toLocaleString('ar-IQ')}</Text>
          <View style={[styles.rankMedal, entry.rank === 1 && styles.rankMedalFirst]}>
            <Text style={styles.rankText}>{entry.rank}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function SupporterRow({ cosmeticsFlags, entry }: { cosmeticsFlags: CosmeticsFeatureFlags; entry: RoomSupportLeaderboardEntryV1 }) {
  return (
    <View style={styles.supporterRow}>
      <Text style={styles.rowPoints}>{entry.supportPoints.toLocaleString('ar-IQ')}</Text>
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={styles.rowName}>{entry.displayName}</Text>
        <Text style={styles.rowMeta}>نقطة دعم</Text>
      </View>
      <Avatar cosmeticsFlags={cosmeticsFlags} entry={entry} />
      <Text style={styles.rowRank}>#{entry.rank}</Text>
    </View>
  );
}

function Avatar({ cosmeticsFlags, entry, large = false }: { cosmeticsFlags: CosmeticsFeatureFlags; entry: RoomSupportLeaderboardEntryV1; large?: boolean }) {
  return <AvatarPresentation avatarUrl={entry.avatarUrl} flags={cosmeticsFlags} frame={entry.avatarFrame} label={entry.avatarLabel || entry.displayName} size={large ? 54 : 42} />;
}

function RewardCard({ bundle, rank }: { bundle?: RewardBundleV1; rank: number }) {
  return (
    <LinearGradient colors={rank === 1 ? ['#6D121D', '#21070B'] : ['#251517', '#0D0708']} style={styles.rewardCard}>
      <Text style={styles.rewardRank}>المركز {rank}</Text>
      <Text style={styles.rewardAmount}>{bundle ? rewardLabel(bundle) : '—'}</Text>
    </LinearGradient>
  );
}

function Tab({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.tab, active && styles.tabActive]}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

function resolveProgress(data: RoomRocketData) {
  const current = data.cycle?.supportPoints || 0;
  const target = data.cycle?.targetSupportPoints || data.template?.targetSupportPoints || 1;
  return Math.min(1, Math.max(0, current / target));
}

function rewardLabel(bundle: RewardBundleV1) {
  return [
    bundle.coins ? `${bundle.coins.toLocaleString('ar-IQ')} عملة` : '',
    bundle.diamonds ? `${bundle.diamonds.toLocaleString('ar-IQ')} ماسة` : '',
    bundle.items.length ? `${bundle.items.length.toLocaleString('ar-IQ')} عنصر` : '',
  ].filter(Boolean).join(' + ');
}

function stateLabel(state: string) {
  return ({
    active: 'قيد التعبئة',
    held: 'قيد المراجعة',
    missed: 'لم يكتمل',
    ready: 'مفتوح',
    settled: 'تم الصرف',
    settling: 'جارٍ الصرف',
    unlocked: 'تم الفتح',
  } as Record<string, string>)[state] || 'قيد التعبئة';
}

function formatCountdown(milliseconds: number) {
  const safe = Math.max(0, milliseconds);
  const days = Math.floor(safe / 86_400_000);
  const hours = Math.floor((safe % 86_400_000) / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  return days > 0 ? `${days} يوم و${hours} ساعة` : `${hours}:${String(minutes).padStart(2, '0')}`;
}

function nextBaghdadWeekMillis(nowMillis: number) {
  const now = new Date(nowMillis);
  const days = (8 - now.getUTCDay()) % 7 || 7;
  return nowMillis + days * 86_400_000;
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  launcher: {
    alignItems: 'center',
    gap: 2,
    minHeight: 91,
    width: 58,
    shadowColor: '#E73348',
    shadowOpacity: 0.32,
    shadowRadius: 12,
  },
  launcherCore: {
    alignItems: 'center',
    backgroundColor: 'rgba(10,3,5,0.96)',
    borderColor: colors.goldSoft,
    borderRadius: radius.full,
    borderWidth: 1.5,
    height: 47,
    justifyContent: 'center',
    shadowColor: '#E73348',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.34,
    shadowRadius: 9,
    width: 47,
  },
  launcherIcon: { fontSize: 18, marginTop: -3 },
  launcherPercent: { bottom: 3, fontSize: 8, fontWeight: typography.weights.black, position: 'absolute' },
  launcherCopy: { alignItems: 'center', gap: 2, width: 56 },
  launcherLabel: { fontSize: 7, fontWeight: typography.weights.black, textAlign: 'center' },
  miniTrack: { backgroundColor: '#301419', borderRadius: radius.full, height: 3, overflow: 'hidden', width: 34 },
  miniFill: { backgroundColor: '#F1B75D', borderRadius: radius.full, height: '100%' },
  miniSupporters: { alignItems: 'center', flexDirection: 'row', justifyContent: 'center', minHeight: 23, paddingLeft: 8 },
  miniAvatarShell: { backgroundColor: '#19080B', borderRadius: radius.full, borderWidth: 1, height: 21, width: 21 },
  miniAvatarOverlap: { marginLeft: -7 },
  miniRank: { borderRadius: radius.full, bottom: -2, fontSize: 5, fontWeight: typography.weights.black, height: 9, lineHeight: 9, position: 'absolute', right: -2, textAlign: 'center', width: 9 },
  miniEmpty: { fontSize: 7, fontWeight: typography.weights.black, minHeight: 20, paddingTop: 5 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  hero: { borderColor: colors.borderGold, borderRadius: radius.xl, borderWidth: 1, minHeight: 130, overflow: 'hidden', padding: spacing.lg },
  heroHalo: { backgroundColor: 'rgba(229,47,67,0.2)', borderRadius: 100, height: 150, position: 'absolute', right: -30, top: -45, width: 150 },
  heroRocket: { fontSize: 54, position: 'absolute', right: 26, top: 36, transform: [{ rotate: '-38deg' }] },
  heroCopy: { alignItems: 'flex-end', gap: 5, maxWidth: '70%' },
  eyebrow: { color: '#E7B768', fontSize: 10, fontWeight: typography.weights.bold },
  heroTitle: { color: '#FFF1D4', fontSize: 24, fontWeight: typography.weights.black, textAlign: 'right' },
  countdown: { color: colors.textMuted, fontSize: 11 },
  progressCard: { backgroundColor: 'rgba(31,12,15,0.9)', borderColor: 'rgba(210,148,64,0.35)', borderRadius: radius.lg, borderWidth: 1, gap: 9, padding: spacing.md },
  progressHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  progressValue: { color: colors.text, fontSize: 14, fontWeight: typography.weights.black },
  statePill: { backgroundColor: '#4A151A', borderRadius: radius.full, paddingHorizontal: 9, paddingVertical: 5 },
  statePillUnlocked: { backgroundColor: '#654713' },
  stateText: { color: '#FFE1A3', fontSize: 9, fontWeight: typography.weights.bold },
  track: { backgroundColor: '#2B1115', borderRadius: radius.full, height: 11, overflow: 'hidden' },
  fill: { borderRadius: radius.full, height: '100%' },
  progressHint: { color: colors.textMuted, fontSize: 11, textAlign: 'right' },
  testNotice: { color: '#FFBECA', fontSize: 10, textAlign: 'right' },
  rewardsHeader: { alignItems: 'flex-end', gap: 2 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: typography.weights.black },
  sectionNote: { color: colors.textSubtle, fontSize: 10 },
  rewardRow: { flexDirection: 'row-reverse', gap: 7 },
  rewardCard: { borderColor: 'rgba(223,168,84,0.35)', borderRadius: radius.md, borderWidth: 1, flex: 1, gap: 4, minHeight: 72, padding: 10 },
  rewardRank: { color: '#E8BE7A', fontSize: 9, fontWeight: typography.weights.bold, textAlign: 'right' },
  rewardAmount: { color: colors.text, fontSize: 11, fontWeight: typography.weights.black, lineHeight: 17, textAlign: 'right' },
  tabs: { backgroundColor: '#120709', borderRadius: radius.full, flexDirection: 'row-reverse', padding: 4 },
  tab: { alignItems: 'center', borderRadius: radius.full, flex: 1, paddingVertical: 9 },
  tabActive: { backgroundColor: '#771420' },
  tabText: { color: colors.textMuted, fontSize: 11, fontWeight: typography.weights.bold },
  tabTextActive: { color: '#FFE6B6' },
  podium: { alignItems: 'flex-end', flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 170, paddingTop: spacing.md },
  podiumItem: { alignItems: 'center', backgroundColor: '#160A0C', borderColor: '#724D28', borderRadius: radius.lg, borderWidth: 1, flex: 1, gap: 5, minHeight: 124, padding: 9 },
  podiumFirst: { borderColor: '#E5B867', minHeight: 154, paddingTop: 14 },
  avatar: { borderColor: '#BC8242', borderRadius: radius.full, borderWidth: 2, height: 48, width: 48 },
  avatarLarge: { height: 62, width: 62 },
  avatarFallback: { alignItems: 'center', backgroundColor: '#5A1620', justifyContent: 'center' },
  avatarText: { color: '#FFE4AC', fontSize: 18, fontWeight: typography.weights.black },
  podiumName: { color: colors.text, fontSize: 10, fontWeight: typography.weights.bold, maxWidth: '100%' },
  podiumPoints: { color: '#E4B467', fontSize: 10 },
  rankMedal: { alignItems: 'center', backgroundColor: '#5E3D21', borderRadius: radius.full, height: 22, justifyContent: 'center', width: 22 },
  rankMedalFirst: { backgroundColor: '#A11E2C' },
  rankText: { color: '#FFF1D0', fontSize: 10, fontWeight: typography.weights.black },
  supporterRow: { alignItems: 'center', backgroundColor: '#11080A', borderColor: 'rgba(201,145,67,0.25)', borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', gap: 9, padding: 10 },
  rowRank: { color: '#DCAE64', fontSize: 12, fontWeight: typography.weights.black, width: 26 },
  rowCopy: { alignItems: 'flex-end', flex: 1 },
  rowName: { color: colors.text, fontSize: 12, fontWeight: typography.weights.bold },
  rowMeta: { color: colors.textSubtle, fontSize: 9 },
  rowPoints: { color: '#E4B467', fontSize: 11, fontWeight: typography.weights.bold },
  empty: { alignItems: 'center', backgroundColor: '#11080A', borderRadius: radius.lg, gap: 7, padding: spacing.xl },
  emptyTitle: { color: colors.text, fontSize: 14, fontWeight: typography.weights.black },
  emptyCopy: { color: colors.textMuted, fontSize: 11, lineHeight: 18, textAlign: 'center' },
  error: { color: '#FFB6C2', fontSize: 10, textAlign: 'center' },
});
