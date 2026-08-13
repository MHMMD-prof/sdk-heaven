import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '../components/ScreenContainer';
import { requestSpecialIdPurchase, requestWalletStore } from '../social/requestSocialCommand';
import type { WalletRechargeReceipt, WalletStoreResult } from '../social/types';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'WalletStore'>;

export function WalletStoreScreen({ navigation }: Props) {
  const [data, setData] = useState<WalletStoreResult>();
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setErrorMessage('');
    const response = await requestWalletStore();
    if (response.ok) setData(response.result);
    else setErrorMessage(response.error.messageAr);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const purchase = async (specialId: string) => {
    setPurchasing(specialId);
    const response = await requestSpecialIdPurchase(specialId);
    setPurchasing('');
    if (!response.ok) {
      Alert.alert('تعذر إتمام الشراء', response.error.messageAr);
      return;
    }
    Alert.alert('تم الشراء', `أصبح المعرّف المميز ${response.result.specialId} مرتبطاً بحسابك.`);
    await load();
  };

  return (
    <ScreenContainer decorativeGlows={false} variant="ruby">
      <View style={styles.page}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="رجوع" onPress={navigation.goBack} style={styles.roundButton}>
            <SymbolView name={{ ios: 'chevron.right', android: 'arrow_forward', web: 'arrow_forward' }} size={22} tintColor={colors.goldSoft} />
          </Pressable>
          <View style={styles.headingCopy}><Text style={styles.eyebrow}>المتجر الملكي</Text><Text style={styles.title}>المحفظة والمعرّفات</Text></View>
          <Pressable accessibilityLabel="تحديث" onPress={() => void load()} style={styles.roundButton}>
            <SymbolView name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }} size={21} tintColor={colors.goldSoft} />
          </Pressable>
        </View>

        <LinearGradient colors={['#7A111B', '#2A080C', '#090404']} style={styles.walletCard}>
          <View style={styles.walletIcon}><SymbolView name={{ ios: 'wallet.bifold.fill', android: 'account_balance_wallet', web: 'account_balance_wallet' }} size={30} tintColor="#391008" /></View>
          <View style={styles.walletCopy}><Text style={styles.walletLabel}>رصيد العملات</Text><Text style={styles.balance}>{formatCoins(data?.wallet.balances.coins || 0)}</Text></View>
          <Text style={styles.coin}>●</Text>
          <View style={styles.walletCopy}><Text style={styles.walletLabel}>رصيد الألماس</Text><Text style={styles.balance}>{formatCoins(data?.wallet.balances.diamonds || 0)}</Text></View>
          <Text style={styles.diamond}>◆</Text>
        </LinearGradient>

        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('StatusCenter', { initialTab: 'aristocracy' })}
          style={styles.statusCenterLink}
        >
          <SymbolView name={{ ios: 'crown.fill', android: 'workspace_premium', web: 'workspace_premium' }} size={25} tintColor={colors.gold} />
          <View style={styles.statusCenterCopy}>
            <Text style={styles.statusCenterTitle}>{I18nManager.isRTL ? 'مركز الحالة' : 'Status Center'}</Text>
            <Text style={styles.statusCenterHint}>{I18nManager.isRTL ? 'VIP وSVIP والرتب الأرستقراطية' : 'VIP, SVIP, and Aristocracy ranks'}</Text>
          </View>
          <SymbolView name={{ ios: I18nManager.isRTL ? 'chevron.left' : 'chevron.right', android: I18nManager.isRTL ? 'arrow_back' : 'arrow_forward', web: I18nManager.isRTL ? 'arrow_back' : 'arrow_forward' }} size={18} tintColor={colors.textMuted} />
        </Pressable>

        {data?.ownedSpecialId ? (
          <View style={styles.ownedCard}>
            <SymbolView name={{ ios: 'sparkles', android: 'diamond', web: 'diamond' }} size={24} tintColor={colors.gold} />
            <View style={styles.ownedCopy}><Text style={styles.ownedLabel}>معرّفك المميز</Text><Text selectable style={styles.ownedId}>{data.ownedSpecialId}</Text></View>
          </View>
        ) : null}

        {!loading && !errorMessage ? <View style={styles.rechargeCard}><View style={styles.rechargeHeading}><Text style={styles.rechargeCount}>{formatCoins(data?.recentRecharges?.length || 0)}</Text><Text style={styles.sectionTitle}>آخر عمليات الشحن المستلمة</Text></View>{(data?.recentRecharges || []).length ? data?.recentRecharges.map((receipt) => <RechargeReceipt key={receipt.transferId} receipt={receipt} />) : <Text style={styles.rechargeEmpty}>لا توجد عمليات شحن مستلمة بعد.</Text>}</View> : null}

        <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>معرّفات متاحة</Text><Text style={styles.sectionHint}>شراء دائم • معرّف واحد للحساب</Text></View>
        {loading ? <View style={styles.state}><ActivityIndicator color={colors.gold} size="large" /></View> : null}
        {!loading && errorMessage ? (
          <View style={styles.state}><Text style={styles.stateTitle}>تعذر فتح المتجر</Text><Text style={styles.stateBody}>{errorMessage}</Text><Pressable onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>إعادة المحاولة</Text></Pressable></View>
        ) : null}
        {!loading && !errorMessage && data?.items.length === 0 ? (
          <View style={styles.state}><SymbolView name={{ ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' }} size={34} tintColor={colors.gold} /><Text style={styles.stateTitle}>لا توجد معرّفات متاحة الآن</Text></View>
        ) : null}
        {!loading && !errorMessage ? (
          <View style={styles.grid}>
            {data?.items.map((item) => {
              const disabled = Boolean(data.ownedSpecialId) || purchasing === item.specialId || (data.wallet.balances.coins < item.price);
              return (
                <View key={item.specialId} style={styles.itemCard}>
                  <View style={styles.gem}><SymbolView name={{ ios: 'diamond.fill', android: 'diamond', web: 'diamond' }} size={26} tintColor={colors.goldSoft} /></View>
                  <Text selectable style={styles.itemId}>{item.specialId}</Text>
                  <Text style={styles.itemLabel}>معرّف مميز</Text>
                  <Pressable
                    disabled={disabled}
                    onPress={() => Alert.alert('تأكيد الشراء', `شراء المعرّف ${item.specialId} مقابل ${formatCoins(item.price)} عملة؟`, [
                      { style: 'cancel', text: 'تراجع' },
                      { text: 'شراء', onPress: () => void purchase(item.specialId) },
                    ])}
                    style={[styles.buyButton, disabled && styles.disabled]}
                  >
                    {purchasing === item.specialId ? <ActivityIndicator color="#2A090C" /> : <Text style={styles.buyText}>{formatCoins(item.price)} ●</Text>}
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    </ScreenContainer>
  );
}

function formatCoins(value: number) { try { return new Intl.NumberFormat('ar-IQ').format(value); } catch { return String(value); } }
function RechargeReceipt({ receipt }: { receipt: WalletRechargeReceipt }) { return <View style={styles.rechargeRow}><View><Text style={styles.rechargeAmount}>{formatCoins(receipt.amount)} {receipt.currency === 'diamonds' ? '◆' : '●'}</Text><Text style={styles.rechargeDate}>{formatDate(receipt.createdAt)}</Text></View><View style={styles.rechargeAgent}><Text style={styles.rechargeLabel}>من الوكيل</Text><Text selectable style={styles.rechargeId}>{receipt.representativePublicId}</Text></View></View>; }
function formatDate(value: string) { const date = new Date(value); if (Number.isNaN(date.getTime())) return ''; try { return new Intl.DateTimeFormat('ar-IQ', { dateStyle: 'short', timeStyle: 'short' }).format(date); } catch { return value; } }

const styles = StyleSheet.create({
  page: { alignSelf: 'center', gap: spacing.lg, maxWidth: 720, width: '100%' },
  header: { alignItems: 'center', flexDirection: 'row-reverse', justifyContent: 'space-between', minHeight: 58 },
  roundButton: { alignItems: 'center', backgroundColor: '#17090A', borderColor: 'rgba(232,190,97,0.42)', borderRadius: radius.full, borderWidth: 1, height: 46, justifyContent: 'center', width: 46 },
  headingCopy: { alignItems: 'center' }, eyebrow: { color: colors.gold, fontSize: 11, fontWeight: typography.weights.bold }, title: { color: colors.text, fontSize: 21, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  walletCard: { alignItems: 'center', borderColor: 'rgba(232,190,97,0.55)', borderRadius: radius.xl, borderWidth: 1, flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.sm, minHeight: 116, padding: spacing.lg },
  walletIcon: { alignItems: 'center', backgroundColor: colors.gold, borderRadius: radius.lg, height: 58, justifyContent: 'center', width: 58 },
  walletCopy: { alignItems: 'flex-end', flex: 1, minWidth: 105, paddingHorizontal: spacing.sm }, walletLabel: { color: colors.textMuted, fontWeight: typography.weights.bold, writingDirection: 'rtl' }, balance: { color: '#FFF0BE', fontSize: 25, fontWeight: typography.weights.black }, coin: { color: colors.gold, fontSize: 25 },
  diamond: { color: '#A8E8FF', fontSize: 23 },
  statusCenterLink: { alignItems: 'center', backgroundColor: '#13090A', borderColor: 'rgba(232,190,97,.3)', borderRadius: radius.xl, borderWidth: 1, flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row', gap: spacing.md, minHeight: 76, padding: spacing.lg }, statusCenterCopy: { alignItems: I18nManager.isRTL ? 'flex-end' : 'flex-start', flex: 1 }, statusCenterTitle: { color: colors.text, fontSize: 17, fontWeight: typography.weights.black, writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr' }, statusCenterHint: { color: colors.textMuted, fontSize: 12, writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr' },
  ownedCard: { alignItems: 'center', backgroundColor: '#17090A', borderColor: colors.gold, borderRadius: radius.xl, borderWidth: 1, flexDirection: 'row-reverse', gap: spacing.md, padding: spacing.lg }, ownedCopy: { alignItems: 'flex-end', flex: 1 }, ownedLabel: { color: colors.textMuted, writingDirection: 'rtl' }, ownedId: { color: colors.goldSoft, fontSize: 25, fontWeight: typography.weights.black },
  sectionHeading: { alignItems: 'flex-end', gap: 3 }, sectionTitle: { color: colors.text, fontSize: 19, fontWeight: typography.weights.black, writingDirection: 'rtl' }, sectionHint: { color: colors.textSubtle, fontSize: 12, writingDirection: 'rtl' },
  rechargeCard: { backgroundColor: '#130708', borderColor: 'rgba(232,190,97,.25)', borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg }, rechargeHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingBottom: spacing.sm }, rechargeCount: { color: colors.gold, fontWeight: typography.weights.black }, rechargeEmpty: { color: colors.textMuted, paddingVertical: spacing.lg, textAlign: 'center', writingDirection: 'rtl' }, rechargeRow: { alignItems: 'center', borderTopColor: 'rgba(232,190,97,.14)', borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 70, paddingVertical: spacing.sm }, rechargeAmount: { color: colors.goldSoft, fontSize: 16, fontWeight: typography.weights.black }, rechargeDate: { color: colors.textSubtle, fontSize: 11 }, rechargeAgent: { alignItems: 'flex-end' }, rechargeLabel: { color: colors.textMuted, fontSize: 11, writingDirection: 'rtl' }, rechargeId: { color: colors.text, fontSize: 17, fontWeight: typography.weights.bold },
  grid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: spacing.md }, itemCard: { alignItems: 'center', backgroundColor: '#130708', borderColor: 'rgba(232,190,97,0.28)', borderRadius: radius.xl, borderWidth: 1, gap: 5, minHeight: 190, padding: spacing.md, width: '47%' }, gem: { alignItems: 'center', backgroundColor: 'rgba(232,190,97,0.12)', borderRadius: radius.full, height: 48, justifyContent: 'center', width: 48 }, itemId: { color: colors.goldSoft, fontSize: 27, fontWeight: typography.weights.black }, itemLabel: { color: colors.textMuted, fontSize: 12, writingDirection: 'rtl' }, buyButton: { alignItems: 'center', backgroundColor: colors.gold, borderRadius: radius.full, justifyContent: 'center', marginTop: spacing.sm, minHeight: 40, paddingHorizontal: spacing.lg, width: '100%' }, buyText: { color: '#2A090C', fontWeight: typography.weights.black }, disabled: { opacity: 0.42 },
  state: { alignItems: 'center', backgroundColor: '#110607', borderColor: 'rgba(232,190,97,0.25)', borderRadius: radius.xl, borderWidth: 1, gap: spacing.md, justifyContent: 'center', minHeight: 220, padding: spacing.xl }, stateTitle: { color: colors.text, fontSize: 17, fontWeight: typography.weights.black, textAlign: 'center', writingDirection: 'rtl' }, stateBody: { color: colors.textMuted, textAlign: 'center', writingDirection: 'rtl' }, retry: { backgroundColor: colors.gold, borderRadius: radius.full, paddingHorizontal: spacing.xl, paddingVertical: spacing.md }, retryText: { color: '#2A090C', fontWeight: typography.weights.black },
});
