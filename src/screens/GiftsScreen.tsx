import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ScreenContainer } from '../components/ScreenContainer';
import { RepresentativeBadge } from '../components/RepresentativeBadge';
import { requestGiftCenter, requestSendGift } from '../social/requestSocialCommand';
import type { GiftCatalogItem, GiftCenterResult, GiftEventSummary, GiftIconKey } from '../social/types';
import { useRepresentativeBadgeProjection } from '../social/useRepresentativeBadgeProjection';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { AvatarPresentation } from '../components/AvatarPresentation';
import { useCosmeticsFeatureFlags } from '../cosmetics/featureFlags';

type Props = NativeStackScreenProps<RootStackParamList, 'Gifts'>;
type SymbolName = ComponentProps<typeof SymbolView>['name'];

export function GiftsScreen({ navigation, route }: Props) {
  const targetUid = route.params?.targetUid;
  const [data, setData] = useState<GiftCenterResult>();
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState('');
  const badgeUids = useMemo(() => [
    ...(data?.recipient ? [data.recipient.uid] : []),
    ...(data?.received || []).map((event) => event.senderUid),
    ...(data?.sent || []).map((event) => event.recipientUid),
  ], [data]);
  const activeBadges = useRepresentativeBadgeProjection(badgeUids);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    const response = await requestGiftCenter(targetUid);
    if (response.ok) setData(response.result);
    else setErrorMessage(response.error.messageAr);
    setLoading(false);
  }, [targetUid]);

  useEffect(() => { void load(); }, [load]);

  const send = async (item: GiftCatalogItem) => {
    if (!targetUid) return;
    setSending(item.giftId);
    const response = await requestSendGift(item.giftId, targetUid, message);
    setSending('');
    if (!response.ok) {
      Alert.alert('تعذر إرسال الهدية', response.error.messageAr);
      return;
    }
    setMessage('');
    Alert.alert('وصلت هديتك', `تم إرسال ${item.nameAr} بنجاح.`);
    await load();
  };

  return (
    <ScreenContainer decorativeGlows={false} variant="ruby">
      <View style={styles.page}>
        <View style={styles.header}>
          <RoundButton accessibilityLabel="رجوع" icon={{ ios: 'chevron.right', android: 'arrow_forward', web: 'arrow_forward' }} onPress={navigation.goBack} />
          <View style={styles.headingCopy}>
            <Text style={styles.eyebrow}>ديوان الهدايا</Text>
            <Text style={styles.title}>{targetUid ? 'اختر هدية مميزة' : 'سجل هداياي'}</Text>
          </View>
          <RoundButton accessibilityLabel="تحديث" icon={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }} onPress={() => void load()} />
        </View>

        <LinearGradient colors={['#7C111D', '#30080D', '#080303']} style={styles.walletCard}>
          <View style={styles.walletIcon}>
            <SymbolView name={{ ios: 'wallet.bifold.fill', android: 'account_balance_wallet', web: 'account_balance_wallet' }} size={27} tintColor="#3A0C0B" />
          </View>
          <View style={styles.walletCopy}>
            <Text style={styles.walletLabel}>الرصيد المتاح</Text>
            <Text style={styles.walletBalance}>{formatNumber(data?.wallet.balances.coins || 0)} عملة</Text>
          </View>
        </LinearGradient>

        {loading ? <StateCard><ActivityIndicator color={colors.gold} size="large" /></StateCard> : null}
        {!loading && errorMessage ? (
          <StateCard>
            <Text style={styles.stateTitle}>تعذر فتح ديوان الهدايا</Text>
            <Text style={styles.stateBody}>{errorMessage}</Text>
            <Pressable onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>إعادة المحاولة</Text></Pressable>
          </StateCard>
        ) : null}

        {!loading && !errorMessage && targetUid && data?.recipient ? (
          <>
            <View style={styles.recipientCard}>
              <View style={styles.recipientAvatar}><Text style={styles.recipientAvatarText}>{[...data.recipient.displayName][0] || '؟'}</Text></View>
              <View style={styles.recipientCopy}>
                <Text style={styles.recipientLabel}>إهداء إلى</Text>
                <View style={styles.recipientNameRow}>
                  <Text style={styles.recipientName}>{data.recipient.displayName}</Text>
                  <RepresentativeBadge active={activeBadges[data.recipient.uid]} />
                </View>
              </View>
              <SymbolView name={{ ios: 'gift.fill', android: 'redeem', web: 'redeem' }} size={28} tintColor={colors.gold} />
            </View>
            <TextInput
              maxLength={80}
              onChangeText={setMessage}
              placeholder="رسالة قصيرة مع الهدية (اختياري)"
              placeholderTextColor={colors.textSubtle}
              style={styles.messageInput}
              textAlign="right"
              value={message}
            />
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionTitle}>الهدايا المتاحة</Text>
              <Text style={styles.sectionHint}>تُخصم من رصيد العملات عند الإرسال</Text>
            </View>
            {data.catalog.length === 0 ? (
              <StateCard><Text style={styles.stateTitle}>لا توجد هدايا متاحة الآن</Text></StateCard>
            ) : (
              <View style={styles.grid}>
                {data.catalog.map((item) => (
                  <GiftCard
                    balance={data.wallet.balances.coins}
                    item={item}
                    key={item.giftId}
                    onSend={() => Alert.alert('تأكيد الإهداء', `إرسال ${item.nameAr} مقابل ${formatNumber(item.price)} عملة؟`, [
                      { style: 'cancel', text: 'تراجع' },
                      { text: 'إرسال', onPress: () => void send(item) },
                    ])}
                    sending={sending === item.giftId}
                  />
                ))}
              </View>
            )}
          </>
        ) : null}

        {!loading && !errorMessage ? (
          <>
            <GiftHistory activeBadges={activeBadges} events={data?.received || []} incoming title="هدايا مستلمة" />
            <GiftHistory activeBadges={activeBadges} events={data?.sent || []} title="هدايا مرسلة" />
          </>
        ) : null}
      </View>
    </ScreenContainer>
  );
}

function GiftCard({ balance, item, onSend, sending }: {
  balance: number;
  item: GiftCatalogItem;
  onSend: () => void;
  sending: boolean;
}) {
  const disabled = sending || balance < item.price;
  return (
    <View style={styles.giftCard}>
      <LinearGradient colors={['#641019', '#2B080C']} style={styles.giftIcon}>
        <SymbolView name={giftSymbol(item.iconKey)} size={35} tintColor="#FFE09A" />
      </LinearGradient>
      <Text style={styles.giftName}>{item.nameAr}</Text>
      <Text style={styles.giftScore}>+{formatNumber(item.scoreValue)} نقطة هدايا</Text>
      <Pressable disabled={disabled} onPress={onSend} style={[styles.sendButton, disabled && styles.disabled]}>
        {sending ? <ActivityIndicator color="#2A090C" /> : <Text style={styles.sendText}>{formatNumber(item.price)} عملة</Text>}
      </Pressable>
    </View>
  );
}

function GiftHistory({
  activeBadges,
  events,
  incoming = false,
  title,
}: {
  activeBadges: Record<string, boolean>;
  events: GiftEventSummary[];
  incoming?: boolean;
  title: string;
}) {
  const cosmeticsFlags = useCosmeticsFeatureFlags();
  return (
    <View style={styles.historySection}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {events.length === 0 ? <Text style={styles.emptyHistory}>لا توجد هدايا في هذا السجل بعد.</Text> : null}
      {events.map((event) => (
        <View key={event.eventId} style={styles.historyRow}>
          <AvatarPresentation
            flags={cosmeticsFlags}
            frame={incoming ? event.senderAvatarFrame : event.recipientAvatarFrame}
            label={incoming ? event.senderDisplayName : event.recipientDisplayName}
            size={38}
          />
          <View style={styles.historyIcon}><SymbolView name={giftSymbol(event.iconKey)} size={23} tintColor={colors.goldSoft} /></View>
          <View style={styles.historyCopy}>
            <Text style={styles.historyName}>{event.nameAr}</Text>
            <View style={styles.historyIdentity}>
              <Text style={styles.historyMeta}>{incoming ? `من ${event.senderDisplayName}` : `إلى ${event.recipientDisplayName}`}</Text>
              <RepresentativeBadge active={activeBadges[incoming ? event.senderUid : event.recipientUid]} />
            </View>
            {event.message ? <Text numberOfLines={2} style={styles.historyMessage}>{event.message}</Text> : null}
          </View>
          <Text style={styles.historyScore}>+{formatNumber(event.scoreValue)}</Text>
        </View>
      ))}
    </View>
  );
}

function RoundButton({ accessibilityLabel, icon, onPress }: { accessibilityLabel: string; icon: SymbolName; onPress: () => void }) {
  return <Pressable accessibilityLabel={accessibilityLabel} onPress={onPress} style={styles.roundButton}><SymbolView name={icon} size={21} tintColor={colors.goldSoft} /></Pressable>;
}

function StateCard({ children }: { children: React.ReactNode }) { return <View style={styles.state}>{children}</View>; }

function giftSymbol(icon: GiftIconKey): SymbolName {
  if (icon === 'rose') return { ios: 'camera.macro', android: 'local_florist', web: 'local_florist' };
  if (icon === 'crown') return { ios: 'crown.fill', android: 'workspace_premium', web: 'workspace_premium' };
  if (icon === 'diamond') return { ios: 'diamond.fill', android: 'diamond', web: 'diamond' };
  if (icon === 'heart') return { ios: 'heart.fill', android: 'favorite', web: 'favorite' };
  return { ios: 'star.fill', android: 'star', web: 'star' };
}

function formatNumber(value: number) { try { return new Intl.NumberFormat('ar-IQ').format(value); } catch { return String(value); } }

const styles = StyleSheet.create({
  page: { alignSelf: 'center', gap: spacing.lg, maxWidth: 720, width: '100%' },
  header: { alignItems: 'center', flexDirection: 'row-reverse', justifyContent: 'space-between', minHeight: 58 },
  headingCopy: { alignItems: 'center' },
  eyebrow: { color: colors.gold, fontSize: 11, fontWeight: typography.weights.bold },
  title: { color: colors.text, fontSize: 21, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  roundButton: { alignItems: 'center', backgroundColor: '#17090A', borderColor: 'rgba(232,190,97,0.42)', borderRadius: radius.full, borderWidth: 1, height: 46, justifyContent: 'center', width: 46 },
  walletCard: { alignItems: 'center', borderColor: 'rgba(232,190,97,0.5)', borderRadius: radius.xl, borderWidth: 1, flexDirection: 'row-reverse', minHeight: 100, padding: spacing.lg },
  walletIcon: { alignItems: 'center', backgroundColor: colors.gold, borderRadius: radius.lg, height: 54, justifyContent: 'center', width: 54 },
  walletCopy: { alignItems: 'flex-end', flex: 1, paddingHorizontal: spacing.md },
  walletLabel: { color: colors.textMuted, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  walletBalance: { color: '#FFF0BE', fontSize: 26, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  recipientCard: { alignItems: 'center', backgroundColor: '#150708', borderColor: 'rgba(232,190,97,0.38)', borderRadius: radius.xl, borderWidth: 1, flexDirection: 'row-reverse', gap: spacing.md, padding: spacing.lg },
  recipientAvatar: { alignItems: 'center', backgroundColor: '#72121A', borderColor: colors.gold, borderRadius: radius.full, borderWidth: 1, height: 52, justifyContent: 'center', width: 52 },
  recipientAvatarText: { color: colors.goldSoft, fontSize: 21, fontWeight: typography.weights.black },
  recipientCopy: { alignItems: 'flex-end', flex: 1 },
  recipientNameRow: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.sm },
  recipientLabel: { color: colors.textMuted, fontSize: 12, writingDirection: 'rtl' },
  recipientName: { color: colors.text, fontSize: 19, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  messageInput: { backgroundColor: '#100607', borderColor: 'rgba(232,190,97,0.35)', borderRadius: radius.lg, borderWidth: 1, color: colors.text, minHeight: 50, paddingHorizontal: spacing.lg, writingDirection: 'rtl' },
  sectionHeading: { alignItems: 'flex-end', gap: 3 },
  sectionTitle: { color: colors.text, fontSize: 19, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  sectionHint: { color: colors.textSubtle, fontSize: 12, writingDirection: 'rtl' },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.md },
  giftCard: { alignItems: 'center', backgroundColor: '#130708', borderColor: 'rgba(232,190,97,0.28)', borderRadius: radius.xl, borderWidth: 1, gap: 6, minHeight: 205, padding: spacing.md, width: '47%' },
  giftIcon: { alignItems: 'center', borderColor: 'rgba(255,224,154,0.3)', borderRadius: radius.full, borderWidth: 1, height: 66, justifyContent: 'center', width: 66 },
  giftName: { color: colors.goldSoft, fontSize: 17, fontWeight: typography.weights.black, textAlign: 'center', writingDirection: 'rtl' },
  giftScore: { color: colors.textMuted, fontSize: 11, writingDirection: 'rtl' },
  sendButton: { alignItems: 'center', backgroundColor: colors.gold, borderRadius: radius.full, justifyContent: 'center', marginTop: spacing.xs, minHeight: 40, paddingHorizontal: spacing.lg, width: '100%' },
  sendText: { color: '#2A090C', fontWeight: typography.weights.black, writingDirection: 'rtl' },
  historySection: { backgroundColor: '#100607', borderColor: 'rgba(232,190,97,0.28)', borderRadius: radius.xl, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  historyRow: { alignItems: 'center', borderTopColor: 'rgba(232,190,97,0.16)', borderTopWidth: 1, flexDirection: 'row-reverse', gap: spacing.md, paddingTop: spacing.md },
  historyIcon: { alignItems: 'center', backgroundColor: '#2A080C', borderRadius: radius.full, height: 44, justifyContent: 'center', width: 44 },
  historyCopy: { alignItems: 'flex-end', flex: 1 },
  historyIdentity: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.sm },
  historyName: { color: colors.text, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  historyMeta: { color: colors.textMuted, fontSize: 12, writingDirection: 'rtl' },
  historyMessage: { color: colors.textSubtle, fontSize: 12, textAlign: 'right', writingDirection: 'rtl' },
  historyScore: { color: colors.gold, fontWeight: typography.weights.black },
  emptyHistory: { color: colors.textMuted, textAlign: 'right', writingDirection: 'rtl' },
  state: { alignItems: 'center', backgroundColor: '#110607', borderColor: 'rgba(232,190,97,0.25)', borderRadius: radius.xl, borderWidth: 1, gap: spacing.md, justifyContent: 'center', minHeight: 160, padding: spacing.xl },
  stateTitle: { color: colors.text, fontSize: 17, fontWeight: typography.weights.black, textAlign: 'center', writingDirection: 'rtl' },
  stateBody: { color: colors.textMuted, textAlign: 'center', writingDirection: 'rtl' },
  retry: { backgroundColor: colors.gold, borderRadius: radius.full, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  retryText: { color: '#2A090C', fontWeight: typography.weights.black },
  disabled: { opacity: 0.42 },
});
