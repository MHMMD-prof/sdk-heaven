import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { PublicUserProfile } from '../../social/types';
import { colors, radius, spacing, typography } from '../../theme';
import { activeVoiceProviderConfig } from '../../voice/activeVoiceProviderConfig';
import { requestRoomTargetRosterUpdate, requestRoomTargetUserSearch } from '../../voice/requestRoomTargetCommand';
import type { RoomTargetPublicMemberV1 } from '../../voice/roomTargetContract';
import type { RoomThemeManifest } from '../../voice/roomThemeContract';
import { resolveRoomTargetRailSummary } from '../../voice/roomIncentivePresentationModel';
import type { RoomTargetData } from '../../voice/useRoomTargetData';
import { RoomSheet } from './VoiceRoomSheets';
import { AvatarPresentation } from '../AvatarPresentation';
import type { CosmeticsFeatureFlags } from '../../cosmetics/featureFlags';
import type { AvatarFrameProjection } from '../../cosmetics/avatarFrameProjection';

export function RoomTargetButton({
  data,
  manifest,
  onPress,
}: {
  data: RoomTargetData;
  manifest: RoomThemeManifest;
  onPress: () => void;
}) {
  if (!data.renderingEnabled) return null;
  const summary = resolveRoomTargetRailSummary(data);
  return (
    <Pressable
      accessibilityHint="يعرض الهدف الأسبوعي وقائمة المشاركين المؤهلين"
      accessibilityLabel={`هدف الغرفة، ${summary.progressPercent} بالمئة، العائد المتوقع ${summary.projectedReturn}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.launcher, pressed && styles.pressed]}
    >
      <LinearGradient
        colors={[manifest.colors.rubyBright, manifest.colors.ruby, manifest.colors.panel]}
        style={[styles.launcherCore, { borderColor: manifest.colors.goldSoft, shadowColor: manifest.colors.rubyBright }]}
      >
        <SymbolView
          name={{ ios: 'scope', android: 'track_changes', web: 'track_changes' }}
          size={18}
          tintColor={manifest.colors.goldSoft}
        />
        <Text style={[styles.launcherPercent, { color: manifest.colors.text }]}>{summary.progressPercent}٪</Text>
      </LinearGradient>
      <View style={styles.launcherCopy}>
        <Text style={[styles.launcherLabel, { color: manifest.colors.goldSoft }]}>العائد</Text>
        <Text numberOfLines={1} style={[styles.launcherReturn, { color: manifest.colors.text }]}>{summary.projectedReturnLabel}</Text>
        <View style={[styles.miniTrack, { backgroundColor: `${manifest.colors.panelRaised}F2` }]}>
          <View style={[styles.miniFill, { backgroundColor: manifest.colors.gold, width: `${Math.max(3, summary.progress * 100)}%` }]} />
        </View>
      </View>
    </Pressable>
  );
}

export function RoomTargetSheet({
  cosmeticsFlags,
  data,
  isOwner,
  ownerUid,
  payoutsEnabled,
  roomId,
  visible,
  onClose,
}: {
  cosmeticsFlags: CosmeticsFeatureFlags;
  data: RoomTargetData;
  isOwner: boolean;
  ownerUid: string;
  payoutsEnabled: boolean;
  roomId: string;
  visible: boolean;
  onClose: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicUserProfile[]>([]);
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const selectedProfiles = useMemo(() => {
    const identities = new Map<string, PublicUserProfile | RoomTargetPublicMemberV1>();
    data.nextRoster?.roster.forEach((entry) => identities.set(entry.uid, entry as RoomTargetPublicMemberV1));
    results.forEach((entry) => identities.set(entry.uid, entry));
    return selectedUids.map((uid) => identities.get(uid)).filter(Boolean);
  }, [data.nextRoster?.roster, results, selectedUids]);

  useEffect(() => {
    if (!visible) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    setSelectedUids(data.nextRoster?.roster.filter((entry) => entry.role === 'selected').map((entry) => entry.uid) || []);
    setEditing(false);
    setMessage('');
    setQuery('');
    setResults([]);
  }, [data.nextRoster, visible]);

  const search = async () => {
    const normalized = query.trim();
    if ([...normalized].length < 2 && !/^[0-9]{7,}$/.test(normalized)) {
      setMessage('اكتب حرفين على الأقل أو رقم المستخدم.');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const users = await requestRoomTargetUserSearch(roomId, normalized, activeVoiceProviderConfig.liveKit);
      setResults(users.filter((profile) => (
        profile.uid !== ownerUid
        && profile.moderationStatus === 'active'
      )));
    } catch (error) {
      setResults([]);
      setMessage(error instanceof Error ? error.message : 'تعذر البحث عن المستخدمين.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      await requestRoomTargetRosterUpdate(roomId, selectedUids, activeVoiceProviderConfig.liveKit);
      setMessage('تم حفظ قائمة الأسبوع القادم.');
      setEditing(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر حفظ القائمة.');
    } finally {
      setBusy(false);
    }
  };

  const cycle = data.cycle;
  const progress = resolveProgress(data);
  const payoutCurrency = cycle?.conversion.payoutCurrency === 'diamonds' ? 'ماسة' : 'عملة';
  return (
    <RoomSheet onClose={onClose} title="هدف الغرفة" visible={visible}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <LinearGradient colors={['#3B080D', '#170406', '#050202']} style={styles.hero}>
          <View style={styles.heroGlow} />
          <SymbolView name={{ ios: 'scope', android: 'track_changes', web: 'track_changes' }} size={46} tintColor="#F1C271" />
          <View style={styles.heroCopy}>
            <Text style={styles.eyebrow}>هدف أسبوعي مقفل</Text>
            <Text style={styles.heroTitle}>{stateLabel(cycle?.state)}</Text>
            <Text style={styles.countdown}>
              {cycle ? `ينتهي خلال ${formatCountdown(cycle.endAtMillis - now)}` : 'سيبدأ مع الدورة الأسبوعية القادمة'}
            </Text>
          </View>
        </LinearGradient>

        <View accessibilityLiveRegion="polite" style={styles.progressCard}>
          <View style={styles.progressHeading}>
            <Text style={styles.progressPercent}>{Math.round(progress * 100)}٪</Text>
            <Text style={styles.progressValue}>
              {(cycle?.supportPoints || 0).toLocaleString('ar-IQ')} / {(cycle?.targetSupportPoints || 0).toLocaleString('ar-IQ')}
            </Text>
          </View>
          <View style={styles.track}>
            <LinearGradient
              colors={['#B7192C', '#E4A74D', '#FFE09A']}
              end={{ x: 1, y: 0 }}
              start={{ x: 0, y: 0 }}
              style={[styles.fill, { width: `${Math.max(1.5, progress * 100)}%` }]}
            />
          </View>
          <Text style={styles.rule}>
            تُحتسب فقط هدايا مالك الغرفة والأشخاص الموجودين في القائمة المقفلة. الهدايا العادية من غيرهم لا تدخل في هذا الهدف.
          </Text>
          {!payoutsEnabled ? (
            <Text style={styles.testNotice}>العرض قيد التتبع؛ صرف عوائد الهدف متوقف حالياً.</Text>
          ) : (
            <Text style={styles.liveNotice}>صرف العوائد مفعّل عند اكتمال الهدف ومراجعة الإدارة عند الحاجة.</Text>
          )}
        </View>

        <View style={styles.sectionHeading}>
          <Text style={styles.sectionTitle}>قائمة هذا الأسبوع</Text>
          <Text style={styles.sectionNote}>لا يمكن تغييرها بعد بداية الأسبوع</Text>
        </View>
        {cycle?.roster.length ? cycle.roster.map((member) => (
          <TargetMemberRow cosmeticsFlags={cosmeticsFlags} currency={payoutCurrency} key={member.uid} member={member} />
        )) : (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>لا توجد قائمة نشطة بعد</Text>
            <Text style={styles.emptyCopy}>يُقفل اختيار المالك مع بداية الأسبوع التالي.</Text>
          </View>
        )}

        {isOwner ? (
          <View style={styles.ownerCard}>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>استقطاب المضيفين · الأسبوع القادم</Text>
              <Text style={styles.sectionNote}>
                {data.nextRoster
                  ? `${data.nextRoster.roster.length - 1} من ${data.nextRoster.maxSelectedUsers} مختارين`
                  : 'المالك موجود تلقائياً'}
              </Text>
            </View>
            <Text style={styles.recruitHint}>
              ابحث بالاسم أو رقم المستخدم وأضِف المضيفين إلى قائمة الأسبوع القادم قبل قفل الدورة.
            </Text>
            {selectedProfiles.length ? (
              <View style={styles.selectedWrap}>
                {selectedProfiles.map((profile) => profile ? (
                  <Pressable
                    accessibilityLabel={`إزالة ${profile.displayName}`}
                    key={profile.uid}
                    onPress={() => setSelectedUids((current) => current.filter((uid) => uid !== profile.uid))}
                    style={styles.selectedChip}
                  >
                    <Text numberOfLines={1} style={styles.selectedText}>{profile.displayName}</Text>
                    <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={12} tintColor="#F5C777" />
                  </Pressable>
                ) : null)}
              </View>
            ) : null}
            {editing ? (
              <>
                <View style={styles.searchRow}>
                  <Pressable accessibilityRole="button" disabled={busy} onPress={() => void search()} style={styles.searchButton}>
                    {busy ? <ActivityIndicator color="#FFF1D4" size="small" /> : <Text style={styles.searchButtonText}>بحث</Text>}
                  </Pressable>
                  <TextInput
                    accessibilityLabel="البحث عن مستخدم بالاسم أو الرقم"
                    onChangeText={setQuery}
                    onSubmitEditing={() => void search()}
                    placeholder="الاسم أو رقم المستخدم"
                    placeholderTextColor={colors.textSubtle}
                    returnKeyType="search"
                    style={styles.input}
                    value={query}
                  />
                </View>
                {results.map((profile) => {
                  const selected = selectedUids.includes(profile.uid);
                  const atLimit = selectedUids.length >= (data.nextRoster?.maxSelectedUsers || 20);
                  return (
                    <Pressable
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected, disabled: !selected && atLimit }}
                      disabled={!selected && atLimit}
                      key={profile.uid}
                      onPress={() => setSelectedUids((current) => (
                        selected ? current.filter((uid) => uid !== profile.uid) : [...current, profile.uid]
                      ))}
                      style={[styles.searchResult, !selected && atLimit && styles.disabled]}
                    >
                      <SymbolView
                        name={selected
                          ? { ios: 'checkmark.circle.fill', android: 'check_circle', web: 'check_circle' }
                          : { ios: 'circle', android: 'radio_button_unchecked', web: 'radio_button_unchecked' }}
                        size={20}
                        tintColor={selected ? '#E4AE56' : colors.textSubtle}
                      />
                      <View style={styles.resultCopy}>
                        <Text numberOfLines={1} style={styles.resultName}>{profile.displayName}</Text>
                        <Text style={styles.resultId}>ID {profile.publicId}</Text>
                      </View>
                      <ProfileAvatar avatarUrl={profile.avatarUrl} cosmeticsFlags={cosmeticsFlags} frame={profile.equippedAvatarFrame} label={profile.displayName.slice(0, 1)} />
                    </Pressable>
                  );
                })}
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => void save()} style={styles.primaryButton}>
                  {busy ? <ActivityIndicator color="#FFF1D4" /> : <Text style={styles.primaryButtonText}>حفظ قائمة الأسبوع القادم</Text>}
                </Pressable>
              </>
            ) : (
              <Pressable accessibilityRole="button" onPress={() => setEditing(true)} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>تعديل القائمة القادمة</Text>
              </Pressable>
            )}
            {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
          </View>
        ) : null}
        {data.error ? <Text style={styles.error}>تعذر تحديث بيانات الهدف الآن. سنحاول تلقائياً.</Text> : null}
      </ScrollView>
    </RoomSheet>
  );
}

function TargetMemberRow({ cosmeticsFlags, currency, member }: { cosmeticsFlags: CosmeticsFeatureFlags; currency: string; member: RoomTargetPublicMemberV1 }) {
  return (
    <View style={styles.memberRow}>
      <View style={styles.memberNumbers}>
        <Text style={styles.returnValue}>{(member.finalReturn ?? member.estimatedReturn).toLocaleString('ar-IQ')} {currency}</Text>
        <Text style={styles.spendValue}>{member.eligibleSpendCoins.toLocaleString('ar-IQ')} إنفاق مؤهل</Text>
        <Text style={styles.spendValue}>{member.supportPoints.toLocaleString('ar-IQ')} نقطة دعم</Text>
      </View>
      <View style={styles.memberCopy}>
        <Text numberOfLines={1} style={styles.memberName}>{member.displayName}</Text>
        <Text style={styles.memberRole}>{member.role === 'owner' ? 'مالك الغرفة' : 'عضو مختار'}</Text>
      </View>
      <ProfileAvatar avatarUrl={member.avatarUrl} cosmeticsFlags={cosmeticsFlags} frame={member.avatarFrame} label={member.avatarLabel || member.displayName.slice(0, 1)} />
    </View>
  );
}

function ProfileAvatar({ avatarUrl, cosmeticsFlags, frame, label }: { avatarUrl: string; cosmeticsFlags: CosmeticsFeatureFlags; frame?: AvatarFrameProjection; label: string }) {
  return <AvatarPresentation avatarUrl={avatarUrl} flags={cosmeticsFlags} frame={frame} label={label} size={42} />;
}

function resolveProgress(data: RoomTargetData) {
  const current = data.cycle?.supportPoints || 0;
  const target = data.cycle?.targetSupportPoints || 1;
  return Math.min(1, Math.max(0, current / target));
}

function stateLabel(state?: string) {
  return ({
    active: 'قيد التقدم',
    held: 'قيد المراجعة',
    missed: 'لم يكتمل',
    ready: 'مؤهل للصرف',
    settled: 'تمت التسوية',
    settling: 'جاري التسوية',
    unlocked: 'تم تحقيق الهدف',
  } as Record<string, string>)[state || ''] || 'بانتظار بداية الأسبوع';
}

function formatCountdown(milliseconds: number) {
  const safe = Math.max(0, milliseconds);
  const days = Math.floor(safe / 86_400_000);
  const hours = Math.floor((safe % 86_400_000) / 3_600_000);
  const minutes = Math.floor((safe % 3_600_000) / 60_000);
  return days > 0 ? `${days} يوم و${hours} ساعة` : `${hours}:${String(minutes).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  launcher: { alignItems: 'center', gap: 2, minHeight: 82, shadowColor: '#E73348', shadowOpacity: 0.25, shadowRadius: 10, width: 58 },
  launcherCore: { alignItems: 'center', backgroundColor: 'rgba(10,3,5,0.96)', borderRadius: radius.full, borderWidth: 1.5, height: 47, justifyContent: 'center', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 8, width: 47 },
  launcherPercent: { bottom: 3, fontSize: 8, fontWeight: typography.weights.black, position: 'absolute' },
  launcherCopy: { alignItems: 'center', gap: 1, width: 56 },
  launcherLabel: { fontSize: 7, fontWeight: typography.weights.black, textAlign: 'center' },
  launcherReturn: { fontSize: 8, fontWeight: typography.weights.black, maxWidth: 54, textAlign: 'center' },
  miniTrack: { backgroundColor: '#301419', borderRadius: radius.full, height: 3, overflow: 'hidden', width: 34 },
  miniFill: { backgroundColor: '#F1B75D', borderRadius: radius.full, height: '100%' },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  hero: { alignItems: 'center', borderColor: colors.borderGold, borderRadius: radius.xl, borderWidth: 1, flexDirection: 'row', gap: spacing.md, minHeight: 120, overflow: 'hidden', padding: spacing.lg },
  heroGlow: { backgroundColor: 'rgba(207,31,52,0.18)', borderRadius: 100, height: 155, left: -35, position: 'absolute', top: -45, width: 155 },
  heroCopy: { alignItems: 'flex-end', flex: 1, gap: 5 },
  eyebrow: { color: '#E7B768', fontSize: 10, fontWeight: typography.weights.bold },
  heroTitle: { color: '#FFF1D4', fontSize: 23, fontWeight: typography.weights.black },
  countdown: { color: colors.textMuted, fontSize: 11 },
  progressCard: { backgroundColor: 'rgba(31,12,15,0.9)', borderColor: 'rgba(210,148,64,0.35)', borderRadius: radius.lg, borderWidth: 1, gap: 10, padding: spacing.md },
  progressHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  progressPercent: { color: '#F3BF69', fontSize: 14, fontWeight: typography.weights.black },
  progressValue: { color: colors.text, fontSize: 14, fontWeight: typography.weights.black },
  track: { backgroundColor: '#2B1115', borderRadius: radius.full, height: 11, overflow: 'hidden' },
  fill: { borderRadius: radius.full, height: '100%' },
  rule: { color: colors.textMuted, fontSize: 11, lineHeight: 18, textAlign: 'right' },
  testNotice: { color: '#F0C57E', fontSize: 11, lineHeight: 17, textAlign: 'right' },
  liveNotice: { color: '#9AD7A8', fontSize: 11, lineHeight: 17, textAlign: 'right' },
  recruitHint: { color: colors.textMuted, fontSize: 11, lineHeight: 17, textAlign: 'right' },
  sectionHeading: { alignItems: 'flex-end', gap: 2 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: typography.weights.black },
  sectionNote: { color: colors.textSubtle, fontSize: 10 },
  memberRow: { alignItems: 'center', backgroundColor: '#11080A', borderColor: 'rgba(201,145,67,0.28)', borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', gap: 9, padding: 10 },
  memberNumbers: { alignItems: 'flex-start', maxWidth: 120 },
  returnValue: { color: '#E4B467', fontSize: 10, fontWeight: typography.weights.bold },
  spendValue: { color: colors.textSubtle, fontSize: 9 },
  memberCopy: { alignItems: 'flex-end', flex: 1 },
  memberName: { color: colors.text, fontSize: 12, fontWeight: typography.weights.bold },
  memberRole: { color: colors.textSubtle, fontSize: 9 },
  avatar: { borderColor: '#BC8242', borderRadius: radius.full, borderWidth: 1, height: 42, width: 42 },
  avatarFallback: { alignItems: 'center', backgroundColor: '#5A1620', justifyContent: 'center' },
  avatarText: { color: '#FFE4AC', fontSize: 15, fontWeight: typography.weights.black },
  empty: { alignItems: 'center', backgroundColor: '#11080A', borderRadius: radius.lg, gap: 6, padding: spacing.lg },
  emptyTitle: { color: colors.text, fontSize: 13, fontWeight: typography.weights.black },
  emptyCopy: { color: colors.textMuted, fontSize: 10, textAlign: 'center' },
  ownerCard: { backgroundColor: 'rgba(42,12,16,0.84)', borderColor: colors.borderGold, borderRadius: radius.lg, borderWidth: 1, gap: 10, padding: spacing.md },
  selectedWrap: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  selectedChip: { alignItems: 'center', backgroundColor: '#3C1116', borderColor: '#8C5729', borderRadius: radius.full, borderWidth: 1, flexDirection: 'row', gap: 5, maxWidth: 145, paddingHorizontal: 9, paddingVertical: 6 },
  selectedText: { color: '#FFE4B0', flexShrink: 1, fontSize: 10 },
  searchRow: { flexDirection: 'row', gap: 7 },
  input: { backgroundColor: '#0D0607', borderColor: '#62401F', borderRadius: radius.md, borderWidth: 1, color: colors.text, flex: 1, minHeight: 44, paddingHorizontal: 12, textAlign: 'right' },
  searchButton: { alignItems: 'center', backgroundColor: '#7E1421', borderRadius: radius.md, justifyContent: 'center', minWidth: 64, paddingHorizontal: 12 },
  searchButtonText: { color: '#FFF1D4', fontSize: 11, fontWeight: typography.weights.black },
  searchResult: { alignItems: 'center', backgroundColor: '#100708', borderRadius: radius.md, flexDirection: 'row', gap: 9, padding: 9 },
  resultCopy: { alignItems: 'flex-end', flex: 1 },
  resultName: { color: colors.text, fontSize: 11, fontWeight: typography.weights.bold },
  resultId: { color: colors.textSubtle, fontSize: 9 },
  disabled: { opacity: 0.45 },
  primaryButton: { alignItems: 'center', backgroundColor: '#8B1723', borderColor: '#E4B45F', borderRadius: radius.md, borderWidth: 1, minHeight: 44, justifyContent: 'center' },
  primaryButtonText: { color: '#FFF1D4', fontSize: 12, fontWeight: typography.weights.black },
  secondaryButton: { alignItems: 'center', borderColor: '#9C6B35', borderRadius: radius.md, borderWidth: 1, minHeight: 42, justifyContent: 'center' },
  secondaryButtonText: { color: '#F0C57E', fontSize: 11, fontWeight: typography.weights.bold },
  message: { color: '#E8BE7A', fontSize: 10, textAlign: 'center' },
  error: { color: '#FFB6C2', fontSize: 10, textAlign: 'center' },
});
