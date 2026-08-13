import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, I18nManager, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { ScreenContainer } from '../components/ScreenContainer';
import {
  requestAristocracyPurchase,
  requestAristocracyQuote,
  requestStatusCenter,
  requestStatusVisibility,
  type StatusErrorCode,
} from '../status/requestStatusCommand';
import type { AristocracyQuote, AristocracyRank, StatusBenefit, StatusCenter, VipTier } from '../status/statusCenter';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'StatusCenter'>;
type Tab = 'vip' | 'aristocracy';
const ar = I18nManager.isRTL;
const t = (arabic: string, english: string) => ar ? arabic : english;

export function StatusCenterScreen({ navigation, route }: Props) {
  const [tab, setTab] = useState<Tab>(route.params?.initialTab || 'vip');
  const [data, setData] = useState<StatusCenter>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorState, setErrorState] = useState<{ code: StatusErrorCode; message: string }>();
  const [quote, setQuote] = useState<AristocracyQuote>();
  const [quoteRank, setQuoteRank] = useState<AristocracyRank>();
  const [quoting, setQuoting] = useState('');
  const [purchasing, setPurchasing] = useState(false);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [success, setSuccess] = useState('');

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    const response = await requestStatusCenter();
    if (response.ok) {
      setData(response.result);
      setErrorState(undefined);
    } else {
      setErrorState({ code: response.error.code, message: ar ? response.error.messageAr : response.error.messageEn });
    }
    setLoading(false);
    setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const beginQuote = async (rank: AristocracyRank) => {
    if (!data?.catalogs.aristocracy) return;
    setSuccess(''); setErrorState(undefined); setQuoting(rank.id);
    const response = await requestAristocracyQuote(data.catalogs.aristocracy.catalogVersion, rank.id);
    setQuoting('');
    if (!response.ok) {
      setErrorState({ code: response.error.code, message: ar ? response.error.messageAr : response.error.messageEn });
      if (['CATALOG_CHANGED', 'CATALOG_UNAVAILABLE'].includes(response.error.code)) void load(true);
      return;
    }
    setQuote(response.result); setQuoteRank(rank);
  };
  const purchase = async () => {
    if (!quote) return;
    setPurchasing(true); setErrorState(undefined);
    const response = await requestAristocracyPurchase(quote.quoteId);
    setPurchasing(false);
    if (!response.ok) {
      if (!['OFFLINE', 'INTERNAL', 'RATE_LIMITED'].includes(response.error.code)) {
        setQuote(undefined); setQuoteRank(undefined);
      }
      setErrorState({ code: response.error.code, message: ar ? response.error.messageAr : response.error.messageEn });
      if (['QUOTE_EXPIRED', 'QUOTE_STALE', 'QUOTE_USED', 'CATALOG_CHANGED'].includes(response.error.code)) void load(true);
      return;
    }
    setQuote(undefined); setQuoteRank(undefined);
    setSuccess(t('تمت العملية بنجاح. لا يوجد تجديد تلقائي.', 'Purchase complete. There is no automatic renewal.'));
    await load(true);
  };
  const changeVisibility = async (publicDisplay: boolean) => {
    if (!data || visibilitySaving) return;
    const previous = data.visibility;
    setData({ ...data, visibility: publicDisplay ? 'public' : 'hidden' });
    setVisibilitySaving(true); setErrorState(undefined);
    const response = await requestStatusVisibility(publicDisplay);
    setVisibilitySaving(false);
    if (!response.ok) {
      setData((current) => current ? { ...current, visibility: previous } : current);
      setErrorState({ code: response.error.code, message: ar ? response.error.messageAr : response.error.messageEn });
      return;
    }
    setSuccess(t('تم حفظ الخصوصية، وقد يستغرق تحديث ظهورها لحظات.', 'Privacy saved. Public surfaces may take a moment to update.'));
  };

  return (
    <ScreenContainer decorativeGlows={false} onRefresh={() => void load(true)} refreshing={refreshing} variant="ruby">
      <View style={styles.page}>
        <Header onBack={navigation.goBack} onRefresh={() => void load(true)} />
        <View accessibilityRole="tablist" style={styles.tabs}>
          <TabButton active={tab === 'vip'} label="VIP / SVIP" onPress={() => setTab('vip')} />
          <TabButton active={tab === 'aristocracy'} label={t('الأرستقراطية', 'Aristocracy')} onPress={() => setTab('aristocracy')} />
        </View>

        {loading && !data ? <LoadingState /> : null}
        {errorState && !data ? <ErrorState code={errorState.code} message={errorState.message} onRetry={() => void load()} /> : null}
        {errorState && data ? <InlineNotice danger message={`${errorState.message} ${t('البيانات المعروضة قديمة حتى ينجح التحديث.', 'The displayed data may be stale until refresh succeeds.')}`} /> : null}
        {success ? <InlineNotice message={success} /> : null}
        {data ? (
          <>
            {tab === 'vip' ? <VipPanel data={data} /> : <AristocracyPanel data={data} onQuote={(rank) => void beginQuote(rank)} quoting={quoting} />}
            <VisibilityCard data={data} disabled={visibilitySaving} onChange={(value) => void changeVisibility(value)} />
          </>
        ) : null}
      </View>
      <QuoteSheet busy={purchasing} onCancel={() => { setQuote(undefined); setQuoteRank(undefined); }} onConfirm={() => void purchase()} quote={quote} rank={quoteRank} />
    </ScreenContainer>
  );
}

function Header({ onBack, onRefresh }: { onBack: () => void; onRefresh: () => void }) {
  return <View style={styles.header}><Pressable accessibilityLabel={t('رجوع', 'Back')} hitSlop={8} onPress={onBack} style={styles.roundButton}><SymbolView name={{ ios: ar ? 'chevron.right' : 'chevron.left', android: ar ? 'arrow_forward' : 'arrow_back', web: ar ? 'arrow_forward' : 'arrow_back' }} size={22} tintColor={colors.goldSoft} /></Pressable><View style={styles.headerCopy}><Text style={styles.eyebrow}>{t('عضويتك ومكانتك', 'YOUR MEMBERSHIP & RANK')}</Text><Text style={styles.title}>{t('مركز الحالة', 'Status Center')}</Text></View><Pressable accessibilityLabel={t('تحديث', 'Refresh')} hitSlop={8} onPress={onRefresh} style={styles.roundButton}><SymbolView name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }} size={21} tintColor={colors.goldSoft} /></Pressable></View>;
}
function TabButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.tab, active && styles.tabActive]}><Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text></Pressable>;
}
function VipPanel({ data }: { data: StatusCenter }) {
  const tiers = data.catalogs.vip?.tiers || [];
  const currentOrder = data.vip?.order || 0;
  const next = tiers.find((tier) => tier.minPoints > (data.vip?.points || 0));
  const current = tiers.find((tier) => tier.order === currentOrder);
  const previousMinimum = current?.minPoints || 0;
  const progress = next ? Math.max(0, Math.min(1, ((data.vip?.points || 0) - previousMinimum) / (next.minPoints - previousMinimum))) : 1;
  return <View style={styles.section}>
    <LinearGradient colors={['#063C30', '#071A16', '#090606']} style={styles.hero}>
      <Text style={styles.heroKicker}>{current ? `${current.band.toUpperCase()} ${current.level}` : t('لم يبدأ بعد', 'Not started')}</Text>
      <Text style={styles.heroValue}>{coins(data.vip?.points || 0)}</Text><Text style={styles.heroLabel}>{t('نقطة شحن مؤهلة صافية', 'net eligible recharge points')}</Text>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} /></View>
      <Text style={styles.heroHint}>{next ? t(`${coins(Math.max(0, next.minPoints - (data.vip?.points || 0)))} نقطة إلى ${next.name.ar}`, `${coins(Math.max(0, next.minPoints - (data.vip?.points || 0)))} points to ${next.name.en}`) : t('وصلت إلى أعلى مستوى منشور.', 'You reached the highest published level.')}</Text>
    </LinearGradient>
    {data.vip?.state !== 'active' ? <StateBanner state={data.vip?.state || 'review'} /> : null}
    <SectionTitle hint={t('المستوى الحالي مكتمل، والمستويات السابقة محفوظة.', 'Current and completed levels stay visibly distinct.')} title={t('طريق VIP وSVIP', 'VIP & SVIP road')} />
    <View style={styles.road}>{tiers.map((tier) => <TierRow current={tier.order === currentOrder} key={tier.id} points={data.vip?.points || 0} tier={tier} />)}</View>
    <InfoCard title={t('كيف تُحتسب النقاط؟', 'How points are earned')} lines={[t('تُحتسب فقط العملات المستلمة من شحن وكيل معتمد.', 'Only coins received from an authorized representative count.'), t('إنفاق العملات لا يُنقص نقاط VIP أو SVIP.', 'Spending coins does not reduce VIP or SVIP points.'), t('عكس عملية شحن يخفض النقاط المرتبطة بها.', 'A recharge reversal removes its linked points.')]} />
    {!data.flags.vipProgression ? <InlineNotice danger message={t('التقدم متوقف مؤقتاً. نقاطك الحالية وسجلك محفوظان.', 'Progression is temporarily paused. Your current points and history remain saved.')} /> : null}
    <SectionTitle title={t('سجل النقاط', 'Points history')} />
    <HistoryList empty={t('لا توجد عمليات شحن مؤهلة بعد.', 'No eligible recharge events yet.')} items={data.history.vip.map((item) => ({ id: item.eventId, amount: `${item.pointDelta > 0 ? '+' : ''}${coins(item.pointDelta)}`, date: dateTime(item.occurredAtMillis), label: vipHistoryLabel(item.kind) }))} />
  </View>;
}
function TierRow({ current, points, tier }: { current: boolean; points: number; tier: VipTier }) {
  const complete = points >= tier.minPoints;
  return <View accessibilityLabel={`${tier.band.toUpperCase()} ${tier.level}, ${current ? t('الحالي', 'current') : complete ? t('مكتمل', 'completed') : t('مقفل', 'locked')}`} style={[styles.roadRow, current && styles.roadCurrent]}><View style={[styles.roadMarker, { borderColor: tier.accentColor }, complete && { backgroundColor: tier.accentColor }]}><Text style={styles.roadMarkerText}>{complete ? '✓' : tier.order}</Text></View><View style={styles.roadCopy}><Text style={styles.roadTitle}>{ar ? tier.name.ar : tier.name.en}</Text><Text style={styles.roadPoints}>{coins(tier.minPoints)} {t('نقطة', 'points')}</Text></View>{current ? <Text style={styles.currentPill}>{t('الحالي', 'CURRENT')}</Text> : null}</View>;
}
function AristocracyPanel({ data, onQuote, quoting }: { data: StatusCenter; onQuote: (rank: AristocracyRank) => void; quoting: string }) {
  const current = data.aristocracy;
  const currentRank = data.catalogs.aristocracy?.ranks.find((rank) => rank.id === current?.rankId);
  return <View style={styles.section}>
    <LinearGradient colors={['#172957', '#101529', '#090606']} style={styles.hero}>
      <Text style={styles.heroKicker}>{currentRank ? (ar ? currentRank.name.ar : currentRank.name.en) : t('لا توجد رتبة حالية', 'No current rank')}</Text>
      <Text style={styles.nobleTitle}>{t('رتبة مدتها محددة بالعملات', 'A fixed-duration coin rank')}</Text>
      <Text style={styles.heroHint}>{current ? `${t('تنتهي في', 'Expires')} ${dateTime(current.expiresAtMillis)}` : t('اختر رتبة من المقارنة أدناه.', 'Choose a rank from the comparison below.')}</Text>
      <View style={styles.noRenew}><Text style={styles.noRenewText}>{t('لا يوجد تجديد تلقائي', 'No automatic renewal')}</Text></View>
    </LinearGradient>
    {current && current.state !== 'active' ? <StateBanner state={current.state} /> : null}
    <SectionTitle hint={t('الشراء والتجديد والترقية تتم من رصيد العملات فقط.', 'Purchase, renewal, and upgrades use wallet coins only.')} title={t('مقارنة الرتب', 'Compare ranks')} />
    {(data.catalogs.aristocracy?.ranks || []).map((rank) => <RankCard action={rankAction(current, rank)} current={current?.rankId === rank.id} disabled={!data.flags.aristocracyShop || quoting.length > 0 || (current?.state === 'active' && rank.order < current.rankOrder)} key={rank.id} loading={quoting === rank.id} onPress={() => onQuote(rank)} rank={rank} />)}
    {!data.flags.aristocracyShop ? <InlineNotice danger message={t('شراء الرتب متوقف مؤقتاً. رتبتك الحالية وتاريخها لم يتغيرا.', 'Rank purchases are temporarily paused. Your current rank and history are unchanged.')} /> : null}
    <SectionTitle title={t('سجل الأرستقراطية', 'Aristocracy history')} />
    <HistoryList empty={t('لا توجد عمليات رتبة بعد.', 'No rank transactions yet.')} items={data.history.aristocracy.map((item) => ({ id: item.transactionId, amount: item.amountCoins ? `${coins(item.amountCoins)} ●` : '', date: dateTime(item.createdAtMillis), label: nobleHistoryLabel(item.kind) }))} />
  </View>;
}
function RankCard({ action, current, disabled, loading, onPress, rank }: { action: string; current: boolean; disabled: boolean; loading: boolean; onPress: () => void; rank: AristocracyRank }) {
  return <View style={[styles.rankCard, current && { borderColor: rank.accentColor }]}><View style={styles.rankTop}><View style={[styles.rankCrown, { backgroundColor: `${rank.accentColor}24` }]}><Text style={[styles.rankCrownText, { color: rank.accentColor }]}>♛</Text></View><View style={styles.rankCopy}><Text style={styles.rankName}>{ar ? rank.name.ar : rank.name.en}</Text><Text style={styles.rankDuration}>{rank.durationDays} {t('يوماً • شراء يدوي', 'days • manual purchase')}</Text><Text style={styles.rankPrice}>{t('السعر المنشور', 'Published price')}: {coins(rank.priceCoins)} ●</Text></View>{current ? <Text style={styles.currentPill}>{t('الحالي', 'CURRENT')}</Text> : null}</View><Benefits benefits={rank.benefits} /><Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.primaryButton, disabled && styles.disabled]}>{loading ? <ActivityIndicator color="#2A090C" /> : <Text style={styles.primaryButtonText}>{action}</Text>}</Pressable></View>;
}
function Benefits({ benefits }: { benefits: StatusBenefit[] }) { return <View style={styles.benefits}>{benefits.length ? benefits.map((benefit) => <View key={benefit} style={styles.benefit}><Text style={styles.check}>✓</Text><Text style={styles.benefitText}>{benefitLabel(benefit)}</Text></View>) : <Text style={styles.muted}>{t('لا توجد مزايا منشورة لهذه الرتبة.', 'No published benefits for this rank.')}</Text>}</View>; }
function VisibilityCard({ data, disabled, onChange }: { data: StatusCenter; disabled: boolean; onChange: (value: boolean) => void }) { const visible = data.visibility === 'public'; return <View style={styles.visibilityCard}><View style={styles.visibilityCopy}><Text style={styles.visibilityTitle}>{t('إظهار حالتي للآخرين', 'Show my status publicly')}</Text><Text style={styles.visibilityHint}>{visible ? t('ستظهر شاراتك في الملف والغرف والمحادثات.', 'Your badges may appear on profiles, rooms, and chats.') : t('تبقى العضويات والمزايا فعالة، لكن الشارات العامة مخفية.', 'Membership and benefits remain active while public badges are hidden.')}</Text></View><Switch accessibilityLabel={t('إظهار شارات الحالة', 'Show status badges')} disabled={disabled} onValueChange={onChange} trackColor={{ false: '#463F49', true: '#23765B' }} thumbColor={visible ? colors.goldSoft : '#CDC6CE'} value={visible} /></View>; }
function QuoteSheet({ busy, onCancel, onConfirm, quote, rank }: { busy: boolean; onCancel: () => void; onConfirm: () => void; quote?: AristocracyQuote; rank?: AristocracyRank }) {
  return <Modal animationType="slide" onRequestClose={onCancel} transparent visible={Boolean(quote && rank)}><View style={styles.modalShade}><View accessibilityViewIsModal style={styles.sheet}><View style={styles.sheetHandle} /><ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}><Text style={styles.sheetTitle}>{t('تأكيد العملية', 'Confirm purchase')}</Text><Text style={styles.sheetRank}>{rank ? ar ? rank.name.ar : rank.name.en : ''}</Text>{quote ? <><QuoteRow label={t('نوع العملية', 'Operation')} value={operationLabel(quote.operation)} /><QuoteRow label={t('السعر النهائي', 'Final price')} value={`${coins(quote.amountCoins)} ●`} /><QuoteRow label={t('الرصيد قبل', 'Balance before')} value={coins(quote.balanceBefore)} /><QuoteRow label={t('الرصيد بعد', 'Balance after')} value={coins(quote.balanceAfter)} /><QuoteRow label={t('الانتهاء المتوقع', 'Expected expiry')} value={dateTime(quote.resultingExpiryMillis)} /></> : null}<Text style={styles.warning}>{t('ستُخصم العملات مرة واحدة بعد التأكيد. لا يوجد تجديد تلقائي، ولا تُستخدم اشتراكات Apple أو Google.', 'Coins are charged once after confirmation. There is no automatic renewal and no Apple or Google subscription.')}</Text><View style={styles.sheetActions}><Pressable disabled={busy} onPress={onCancel} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>{t('إلغاء', 'Cancel')}</Text></Pressable><Pressable disabled={busy} onPress={onConfirm} style={styles.primaryButton}>{busy ? <ActivityIndicator color="#2A090C" /> : <Text style={styles.primaryButtonText}>{t('تأكيد الدفع بالعملات', 'Pay with coins')}</Text>}</Pressable></View></ScrollView></View></View></Modal>;
}
function QuoteRow({ label, value }: { label: string; value: string }) { return <View style={styles.quoteRow}><Text style={styles.quoteValue}>{value}</Text><Text style={styles.quoteLabel}>{label}</Text></View>; }
function SectionTitle({ hint, title }: { hint?: string; title: string }) { return <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{title}</Text>{hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}</View>; }
function InfoCard({ lines, title }: { lines: string[]; title: string }) { return <View style={styles.infoCard}><Text style={styles.infoTitle}>{title}</Text>{lines.map((line) => <View key={line} style={styles.infoLine}><Text style={styles.check}>✓</Text><Text style={styles.infoText}>{line}</Text></View>)}</View>; }
function HistoryList({ empty, items }: { empty: string; items: { amount: string; date: string; id: string; label: string }[] }) { return <View style={styles.history}>{items.length ? items.map((item) => <View key={item.id} style={styles.historyRow}><View><Text style={styles.historyAmount}>{item.amount}</Text><Text style={styles.historyDate}>{item.date}</Text></View><Text style={styles.historyLabel}>{item.label}</Text></View>) : <Text style={styles.empty}>{empty}</Text>}</View>; }
function InlineNotice({ danger, message }: { danger?: boolean; message: string }) { return <View accessibilityRole="alert" style={[styles.notice, danger && styles.noticeDanger]}><Text style={styles.noticeText}>{message}</Text></View>; }
function LoadingState() { return <View accessibilityLabel={t('جاري تحميل مركز الحالة', 'Loading Status Center')} style={styles.state}><ActivityIndicator color={colors.gold} size="large" /><Text style={styles.stateTitle}>{t('جاري تحميل عضويتك…', 'Loading your membership…')}</Text></View>; }
function ErrorState({ code, message, onRetry }: { code: StatusErrorCode; message: string; onRetry: () => void }) { return <View accessibilityRole="alert" style={styles.state}><Text style={styles.stateTitle}>{code === 'OFFLINE' ? t('أنت غير متصل', 'You are offline') : t('تعذر فتح مركز الحالة', 'Status Center unavailable')}</Text><Text style={styles.stateBody}>{message}</Text><Pressable onPress={onRetry} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{t('إعادة المحاولة', 'Try again')}</Text></Pressable></View>; }
function StateBanner({ state }: { state: string }) { const copy = state === 'frozen' ? t('الحالة مجمدة مؤقتاً. لا يمكن الشراء أو التقدم حتى رفع التجميد.', 'Status is temporarily frozen. Purchases or progression are unavailable until restored.') : state === 'expired' ? t('انتهت الرتبة. يمكنك شراء مدة جديدة يدوياً.', 'This rank expired. You can manually buy a new duration.') : t('الحالة قيد المراجعة. تُعرض بياناتك من دون السماح بتغييرات جديدة.', 'Status is under review. Existing data remains visible, but changes are paused.'); return <InlineNotice danger message={copy} />; }
function rankAction(current: StatusCenter['aristocracy'], rank: AristocracyRank) { if (current?.state === 'active' && rank.order < current.rankOrder) return t('متاح بعد انتهاء رتبتك', 'Available after expiry'); if (current?.state === 'active' && rank.order === current.rankOrder) return t('تجديد يدوي', 'Renew manually'); if (current?.state === 'active' && rank.order > current.rankOrder) return t('عرض سعر الترقية', 'Get upgrade quote'); return t('عرض السعر', 'Get quote'); }
function operationLabel(value: AristocracyQuote['operation']) { return value === 'renewal' ? t('تجديد', 'Renewal') : value === 'upgrade' ? t('ترقية', 'Upgrade') : t('شراء', 'Purchase'); }
function vipHistoryLabel(value: string) { return value === 'representative-recharge' ? t('شحن من وكيل معتمد', 'Authorized representative recharge') : value === 'representative-reversal' ? t('عكس عملية شحن', 'Recharge reversal') : t('تصحيح إداري مدقق', 'Audited admin correction'); }
function nobleHistoryLabel(value: string) { const labels: Record<string, [string, string]> = { purchase: ['شراء رتبة', 'Rank purchase'], renewal: ['تجديد يدوي', 'Manual renewal'], upgrade: ['ترقية رتبة', 'Rank upgrade'], 'complimentary-grant': ['منحة إدارية', 'Admin grant'], 'admin-revoke': ['إلغاء إداري', 'Admin revocation'], freeze: ['تجميد', 'Freeze'], unfreeze: ['رفع التجميد', 'Unfreeze'], expiry: ['انتهاء الرتبة', 'Rank expiry'] }; return t(...(labels[value] || [value, value])); }
function benefitLabel(value: string) { const labels: Record<string, [string, string]> = { 'profile-badge': ['شارة الملف الشخصي', 'Profile badge'], 'avatar-frame': ['إطار الصورة', 'Avatar frame'], nameplate: ['لوحة الاسم', 'Nameplate'], 'chat-bubble': ['فقاعة محادثة', 'Chat bubble'], 'room-entry-effect': ['تأثير دخول الغرفة', 'Room entry effect'], 'gated-cosmetics': ['مظاهر حصرية', 'Exclusive cosmetics'] }; return t(...(labels[value] || [value, value])); }
function coins(value: number) { try { return new Intl.NumberFormat(ar ? 'ar-IQ' : 'en').format(value); } catch { return String(value); } }
function dateTime(value: number) { try { return new Intl.DateTimeFormat(ar ? 'ar-IQ' : 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); } catch { return new Date(value).toISOString(); } }

const direction = ar ? 'row-reverse' as const : 'row' as const;
const align = ar ? 'right' as const : 'left' as const;
const styles = StyleSheet.create({
  page: { alignSelf: 'center', gap: spacing.lg, maxWidth: 760, width: '100%' }, header: { alignItems: 'center', flexDirection: direction, justifyContent: 'space-between', minHeight: 58 }, headerCopy: { alignItems: 'center', flex: 1 }, eyebrow: { color: colors.gold, fontSize: 10, fontWeight: '800', letterSpacing: ar ? 0 : 1.4 }, title: { color: colors.text, fontSize: 24, fontWeight: typography.weights.black }, roundButton: { alignItems: 'center', backgroundColor: '#17090A', borderColor: 'rgba(232,190,97,0.42)', borderRadius: radius.full, borderWidth: 1, height: 46, justifyContent: 'center', width: 46 },
  tabs: { backgroundColor: '#100809', borderRadius: radius.full, flexDirection: direction, gap: 4, padding: 4 }, tab: { alignItems: 'center', borderRadius: radius.full, flex: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: spacing.md }, tabActive: { backgroundColor: colors.gold }, tabText: { color: colors.textMuted, fontWeight: '800' }, tabTextActive: { color: '#2A090C' }, section: { gap: spacing.lg },
  hero: { borderColor: 'rgba(232,190,97,.35)', borderRadius: radius.xl, borderWidth: 1, gap: 5, minHeight: 190, overflow: 'hidden', padding: spacing.xl }, heroKicker: { color: colors.goldSoft, fontSize: 22, fontWeight: '900', textAlign: align }, heroValue: { color: '#FFFFFF', fontSize: 34, fontWeight: '900', textAlign: align }, heroLabel: { color: colors.textMuted, fontSize: 12, textAlign: align }, heroHint: { color: colors.textMuted, fontSize: 12, marginTop: 4, textAlign: align }, nobleTitle: { color: '#FFFFFF', fontSize: 19, fontWeight: '800', textAlign: align }, progressTrack: { backgroundColor: 'rgba(255,255,255,.12)', borderRadius: radius.full, height: 9, marginTop: spacing.md, overflow: 'hidden' }, progressFill: { backgroundColor: '#40D39A', borderRadius: radius.full, height: '100%' }, noRenew: { alignSelf: ar ? 'flex-end' : 'flex-start', backgroundColor: 'rgba(232,190,97,.13)', borderColor: 'rgba(232,190,97,.4)', borderRadius: radius.full, borderWidth: 1, marginTop: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 6 }, noRenewText: { color: colors.goldSoft, fontSize: 12, fontWeight: '800' },
  sectionHeading: { gap: 4 }, sectionTitle: { color: colors.text, fontSize: 20, fontWeight: '900', textAlign: align }, sectionHint: { color: colors.textMuted, fontSize: 12, lineHeight: 19, textAlign: align }, road: { backgroundColor: '#11090A', borderRadius: radius.xl, overflow: 'hidden', paddingHorizontal: spacing.md }, roadRow: { alignItems: 'center', borderBottomColor: 'rgba(232,190,97,.12)', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: direction, gap: spacing.md, minHeight: 74, paddingVertical: spacing.md }, roadCurrent: { backgroundColor: 'rgba(232,190,97,.07)' }, roadMarker: { alignItems: 'center', borderRadius: radius.full, borderWidth: 2, height: 36, justifyContent: 'center', width: 36 }, roadMarkerText: { color: colors.text, fontSize: 12, fontWeight: '900' }, roadCopy: { alignItems: ar ? 'flex-end' : 'flex-start', flex: 1 }, roadTitle: { color: colors.text, fontSize: 16, fontWeight: '800' }, roadPoints: { color: colors.textMuted, fontSize: 12 }, currentPill: { backgroundColor: colors.gold, borderRadius: radius.full, color: '#2A090C', fontSize: 9, fontWeight: '900', overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 5 },
  infoCard: { backgroundColor: '#11100B', borderColor: 'rgba(232,190,97,.25)', borderRadius: radius.xl, borderWidth: 1, gap: spacing.sm, padding: spacing.lg }, infoTitle: { color: colors.goldSoft, fontSize: 17, fontWeight: '900', textAlign: align }, infoLine: { alignItems: 'flex-start', flexDirection: direction, gap: spacing.sm }, check: { color: colors.emerald, fontWeight: '900' }, infoText: { color: colors.textMuted, flex: 1, lineHeight: 20, textAlign: align },
  rankCard: { backgroundColor: '#10101A', borderColor: 'rgba(232,190,97,.22)', borderRadius: radius.xl, borderWidth: 1, gap: spacing.md, padding: spacing.lg }, rankTop: { alignItems: 'center', flexDirection: direction, gap: spacing.md }, rankCrown: { alignItems: 'center', borderRadius: radius.lg, height: 48, justifyContent: 'center', width: 48 }, rankCrownText: { fontSize: 27 }, rankCopy: { alignItems: ar ? 'flex-end' : 'flex-start', flex: 1 }, rankName: { color: colors.text, fontSize: 19, fontWeight: '900' }, rankDuration: { color: colors.textMuted, fontSize: 12 }, rankPrice: { color: colors.goldSoft, fontSize: 12, fontWeight: '800', marginTop: 3 }, benefits: { gap: 7 }, benefit: { alignItems: 'center', flexDirection: direction, gap: spacing.sm }, benefitText: { color: colors.textMuted, flex: 1, textAlign: align }, muted: { color: colors.textSubtle, textAlign: align },
  primaryButton: { alignItems: 'center', backgroundColor: colors.gold, borderRadius: radius.full, justifyContent: 'center', minHeight: 46, paddingHorizontal: spacing.lg }, primaryButtonText: { color: '#2A090C', fontWeight: '900', textAlign: 'center' }, secondaryButton: { alignItems: 'center', borderColor: 'rgba(232,190,97,.5)', borderRadius: radius.full, borderWidth: 1, justifyContent: 'center', minHeight: 46, paddingHorizontal: spacing.lg }, secondaryButtonText: { color: colors.goldSoft, fontWeight: '800' }, disabled: { opacity: .42 },
  history: { backgroundColor: '#11090A', borderRadius: radius.xl, overflow: 'hidden', paddingHorizontal: spacing.lg }, historyRow: { alignItems: 'center', borderBottomColor: 'rgba(232,190,97,.12)', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: direction, justifyContent: 'space-between', minHeight: 68, paddingVertical: spacing.sm }, historyLabel: { color: colors.text, flex: 1, fontWeight: '700', textAlign: align }, historyAmount: { color: colors.goldSoft, fontWeight: '900', textAlign: ar ? 'left' : 'right' }, historyDate: { color: colors.textSubtle, fontSize: 10 }, empty: { color: colors.textMuted, padding: spacing.xl, textAlign: 'center' },
  visibilityCard: { alignItems: 'center', backgroundColor: '#11090A', borderColor: 'rgba(232,190,97,.24)', borderRadius: radius.xl, borderWidth: 1, flexDirection: direction, gap: spacing.md, padding: spacing.lg }, visibilityCopy: { flex: 1 }, visibilityTitle: { color: colors.text, fontSize: 16, fontWeight: '900', textAlign: align }, visibilityHint: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 4, textAlign: align },
  notice: { backgroundColor: 'rgba(43,203,136,.1)', borderColor: 'rgba(43,203,136,.35)', borderRadius: radius.lg, borderWidth: 1, padding: spacing.md }, noticeDanger: { backgroundColor: 'rgba(184,41,75,.11)', borderColor: 'rgba(184,41,75,.45)' }, noticeText: { color: colors.text, lineHeight: 20, textAlign: align }, state: { alignItems: 'center', backgroundColor: '#110607', borderColor: 'rgba(232,190,97,.25)', borderRadius: radius.xl, borderWidth: 1, gap: spacing.md, justifyContent: 'center', minHeight: 250, padding: spacing.xl }, stateTitle: { color: colors.text, fontSize: 18, fontWeight: '900', textAlign: 'center' }, stateBody: { color: colors.textMuted, lineHeight: 21, textAlign: 'center' },
  modalShade: { backgroundColor: 'rgba(0,0,0,.74)', flex: 1, justifyContent: 'flex-end' }, sheet: { backgroundColor: '#120A0B', borderColor: 'rgba(232,190,97,.35)', borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, maxHeight: '90%', padding: spacing.xl }, sheetContent: { gap: spacing.md, paddingBottom: spacing.sm }, sheetHandle: { alignSelf: 'center', backgroundColor: '#6A5C5F', borderRadius: radius.full, height: 4, marginBottom: spacing.md, width: 48 }, sheetTitle: { color: colors.text, fontSize: 21, fontWeight: '900', textAlign: 'center' }, sheetRank: { color: colors.goldSoft, fontSize: 18, fontWeight: '900', textAlign: 'center' }, quoteRow: { alignItems: 'center', borderBottomColor: 'rgba(232,190,97,.12)', borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: direction, justifyContent: 'space-between', minHeight: 42 }, quoteLabel: { color: colors.textMuted }, quoteValue: { color: colors.text, fontWeight: '800' }, warning: { backgroundColor: 'rgba(232,190,97,.08)', borderRadius: radius.md, color: colors.goldSoft, lineHeight: 20, padding: spacing.md, textAlign: align }, sheetActions: { flexDirection: direction, gap: spacing.sm },
});
