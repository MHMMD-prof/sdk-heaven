import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
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

import { ScreenContainer } from '../components/ScreenContainer';
import {
  requestCoupleEffects,
  requestMyStoreItems,
  requestPurchaseCoupleEffect,
  requestStoreCatalog,
  requestStoreGift,
  requestStorePurchase,
} from '../social/requestSocialCommand';
import type { CustomerStoreCatalogItem, CustomerStoreResult, MyStoreItem } from '../social/types';
import type { StoreCategory, StoreCurrency } from '../store/contracts';
import { resolveStoreArtwork } from '../store/storeArtwork';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { useVoiceRooms } from '../voice/useVoiceRooms';
import { activeVoiceProviderConfig } from '../voice/activeVoiceProviderConfig';
import { requestRoomThemeCommand } from '../voice/requestRoomThemeCommand';
import { useCosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import type { CoupleEffectsResult } from '../cosmetics/coupleEffects';

type Props = NativeStackScreenProps<RootStackParamList, 'Store'>;
type SymbolName = ComponentProps<typeof SymbolView>['name'];

const categories: Array<{
  key: StoreCategory;
  icon: SymbolName;
  label: string;
  subtitle: string;
}> = [
  { key: 'avatar-frames', icon: { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' }, label: 'إطارات الصورة', subtitle: 'حضور يميّز ملفك' },
  { key: 'profile-skins', icon: { ios: 'person.text.rectangle.fill', android: 'badge', web: 'badge' }, label: 'خلفيات الملف', subtitle: 'خلفية داخل ملفك فقط' },
  { key: 'chat-bubbles', icon: { ios: 'bubble.left.and.bubble.right.fill', android: 'chat_bubble', web: 'chat_bubble' }, label: 'فقاعات الدردشة', subtitle: 'مع بقاء النص واضحاً' },
  { key: 'nameplates', icon: { ios: 'rectangle.and.pencil.and.ellipsis', android: 'label', web: 'label' }, label: 'لوحات الاسم', subtitle: 'اسم مقروء ومميز' },
  { key: 'cosmetic-badges', icon: { ios: 'seal.fill', android: 'verified', web: 'verified' }, label: 'الشارات التجميلية', subtitle: 'منفصلة عن شارات الثقة' },
  { key: 'seat-effects', icon: { ios: 'mic.circle.fill', android: 'mic', web: 'mic' }, label: 'تأثيرات المقعد', subtitle: 'تحت حالات الميكروفون' },
  { key: 'couple-effects', icon: { ios: 'heart.circle.fill', android: 'favorite', web: 'favorite' }, label: 'تأثيرات الارتباط', subtitle: 'مظهر مشترك لشريكي الارتباط' },
  { key: 'chat-themes', icon: { ios: 'paintpalette.fill', android: 'palette', web: 'palette' }, label: 'سمات الغرف', subtitle: 'مظهر ومقاعد جديدة لغرفك' },
  { key: 'cars', icon: { ios: 'car.fill', android: 'directions_car', web: 'directions_car' }, label: 'السيارات', subtitle: 'مقتنيات تظهر بجانبك' },
  { key: 'game-items', icon: { ios: 'gamecontroller.fill', android: 'sports_esports', web: 'sports_esports' }, label: 'عناصر اللعبة', subtitle: 'غيّر مظهر وتجربة اللعب' },
  { key: 'custom-ids', icon: { ios: 'number.circle.fill', android: 'tag', web: 'tag' }, label: 'المعرّفات المميزة', subtitle: 'معرّفات رقمية فريدة' },
];

function getStoreCategory(category: StoreCategory) {
  return categories.find((entry) => entry.key === category);
}

export function StoreScreen({ navigation }: Props) {
  const cosmeticsFlags = useCosmeticsFeatureFlags();
  const { rooms } = useVoiceRooms();
  const { width } = useWindowDimensions();
  const compact = width < 390;
  const [selectedCategory, setSelectedCategory] = useState<StoreCategory>();
  const [store, setStore] = useState<CustomerStoreResult>();
  const [owned, setOwned] = useState<MyStoreItem[]>([]);
  const [coupleEffects, setCoupleEffects] = useState<CoupleEffectsResult>();
  const [selected, setSelected] = useState<CustomerStoreCatalogItem>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [catalog, inventory, pairInventory] = await Promise.all([
        requestStoreCatalog(),
        requestMyStoreItems(),
        cosmeticsFlags.coupleEffects ? requestCoupleEffects() : Promise.resolve(undefined),
      ]);
      if (!catalog.ok) {
        setStore(undefined);
        setOwned([]);
        setError(catalog.error.messageAr);
        return;
      }
      setStore(catalog.result);
      if (inventory.ok) setOwned(inventory.result.items);
      else setError(inventory.error.messageAr);
      setCoupleEffects(pairInventory?.ok ? pairInventory.result : undefined);
    } catch {
      setStore(undefined);
      setOwned([]);
      setError('تعذر الاتصال بالمتجر. تحقق من الاتصال وحاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }, [cosmeticsFlags.coupleEffects]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    if (!selectedCategory) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelectedCategory(undefined);
      return true;
    });
    return () => subscription.remove();
  }, [selectedCategory]);

  const ownedIds = useMemo(() => new Set([
    ...owned.map((row) => row.ownership.itemId),
    ...(coupleEffects?.items.map((row) => row.itemId) || []),
  ]), [coupleEffects?.items, owned]);
  const catalogItems = store?.items || [];
  const featuredItem = useMemo(() => {
    if (!catalogItems.length) return undefined;
    return catalogItems.find((item) => item.itemId === store?.featuredItemId) || catalogItems[0];
  }, [catalogItems, store?.featuredItemId]);
  const visibleItems = useMemo(
    () => selectedCategory ? catalogItems.filter((item) => item.category === selectedCategory) : [],
    [catalogItems, selectedCategory],
  );
  const visibleCategories = useMemo(
    () => categories.filter((entry) => entry.key !== 'couple-effects' || cosmeticsFlags.coupleEffects),
    [cosmeticsFlags.coupleEffects],
  );
  async function purchase(item: CustomerStoreCatalogItem, currency: StoreCurrency) {
    if (item.category === 'chat-themes') {
      const ownedRooms = rooms.filter((room) => room.status === 'active' && (room.ownerUid || room.hostId) === room.localMember?.id);
      if (!ownedRooms.length) {
        Alert.alert('يلزم اختيار غرفة', 'أنشئ غرفة نشطة أو افتح غرفتك أولاً، ثم اشترِ السمة لها.');
        return;
      }
      const purchaseForRoom = async (roomId: string) => {
        setBusy(`${item.itemId}:${currency}`);
        try {
          await requestRoomThemeCommand({
            action: 'purchase-room-theme',
            applyTheme: true,
            currency,
            roomId,
            themeId: item.itemId,
          }, activeVoiceProviderConfig.liveKit);
          setSelected(undefined);
          Alert.alert('تم شراء سمة الغرفة', `تمت إضافة ${item.name.ar} إلى الغرفة وتطبيقها.`);
          await load();
        } catch (error) {
          Alert.alert('تعذر إتمام الشراء', error instanceof Error ? error.message : 'تعذر شراء سمة الغرفة.');
        } finally {
          setBusy('');
        }
      };
      if (ownedRooms.length === 1) {
        await purchaseForRoom(ownedRooms[0].id);
        return;
      }
      Alert.alert(
        'اختر الغرفة',
        'ستصبح السمة ملكاً للغرفة المختارة.',
        [
          ...ownedRooms.slice(0, 2).map((room) => ({
            text: room.title,
            onPress: () => void purchaseForRoom(room.id),
          })),
          { style: 'cancel', text: 'إلغاء' },
        ],
      );
      return;
    }
    if (item.category === 'couple-effects') {
      setBusy(`${item.itemId}:${currency}`);
      const response = await requestPurchaseCoupleEffect(item.itemId, currency);
      setBusy('');
      if (!response.ok) { Alert.alert('تعذر إتمام الشراء', response.error.messageAr); return; }
      setSelected(undefined);
      Alert.alert('تم الشراء', `تمت إضافة ${item.name.ar} إلى مقتنيات الارتباط وتجهيزه لكما.`);
      await load();
      return;
    }
    setBusy(`${item.itemId}:${currency}`);
    const response = await requestStorePurchase(item.itemId, currency);
    setBusy('');
    if (!response.ok) { Alert.alert('تعذر إتمام الشراء', response.error.messageAr); return; }
    setSelected(undefined);
    Alert.alert('تم الشراء', `تمت إضافة ${item.name.ar} إلى عناصري وتجهيزه.`);
    await load();
  }

  async function gift(item: CustomerStoreCatalogItem, currency: StoreCurrency, recipientPublicId: string) {
    if (item.category === 'chat-themes' || item.category === 'couple-effects') {
      Alert.alert('الإهداء غير متاح', 'إهداء سمات الغرف غير مدعوم في الإصدار الأول.');
      return;
    }
    setBusy(`gift:${item.itemId}:${currency}`);
    const response = await requestStoreGift(item.itemId, currency, recipientPublicId);
    setBusy('');
    if (!response.ok) { Alert.alert('تعذر إرسال الهدية', response.error.messageAr); return; }
    setSelected(undefined);
    Alert.alert('تم إرسال الهدية', `وصلت ${item.name.ar} إلى الحساب ${recipientPublicId}.`);
    await load();
  }

  return (
    <ScreenContainer decorativeGlows={false} horizontalPadding={0} topPadding={8} variant="ruby">
      <View style={styles.page}>
        <View style={styles.header}>
          <RoundButton
            label="رجوع"
            name={{ ios: 'chevron.right', android: 'arrow_forward', web: 'arrow_forward' }}
            onPress={selectedCategory ? () => setSelectedCategory(undefined) : navigation.goBack}
          />
          <View style={styles.heading}>
            <Text style={styles.eyebrow}>SDK HEAVEN</Text>
            <Text numberOfLines={1} style={[styles.title, compact && styles.titleCompact]}>
              {selectedCategory ? getStoreCategory(selectedCategory)?.label : 'المتجر الملكي'}
            </Text>
          </View>
          <RoundButton
            label="تحديث"
            name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }}
            onPress={() => void load()}
          />
        </View>

        <View style={styles.balanceBar}>
          <Balance currency="coins" label="العملات" value={store?.wallet.balances.coins || 0} />
          <View style={styles.balanceDivider} />
          <Balance currency="diamonds" label="الألماس" value={store?.wallet.balances.diamonds || 0} />
        </View>

        {loading ? <State><ActivityIndicator color={colors.gold} size="large" /><Text style={styles.stateBody}>جارٍ تجهيز المتجر…</Text></State> : null}
        {!loading && error ? <State><Text style={styles.stateTitle}>تعذر فتح المتجر</Text><Text style={styles.stateBody}>{error}</Text><Pressable onPress={() => void load()} style={styles.retry}><Text style={styles.retryText}>إعادة المحاولة</Text></Pressable></State> : null}

        {!loading && !error ? (
          <View style={styles.storeContent}>
            {!selectedCategory ? (
              <>
                {featuredItem ? (
                  <FeaturedCard
                    compact={compact}
                    item={featuredItem}
                    owned={ownedIds.has(featuredItem.itemId)}
                    onPress={() => setSelected(featuredItem)}
                  />
                ) : null}

                <View style={styles.showroomHeading}>
                  <Text style={styles.showroomEyebrow}>اختر القسم</Text>
                  <Text style={styles.showroomTitle}>أقسام المتجر</Text>
                  <View style={styles.showroomRule} />
                </View>

                <View style={styles.showroomGrid}>
                  {visibleCategories.map((entry) => {
                    const items = catalogItems.filter((item) => item.category === entry.key);
                    const previewItem = items.find((item) => item.availability === 'available' && !item.soldOut) || items[0];
                    return (
                      <CategoryShowcaseCard
                        category={entry}
                        count={items.length}
                        item={previewItem}
                        key={entry.key}
                        onPress={() => setSelectedCategory(entry.key)}
                        wide={entry.key === 'custom-ids'}
                      />
                    );
                  })}
                </View>
              </>
            ) : (
              <>
                <View style={styles.sectionHeading}>
                  <View style={styles.sectionTitleWrap}>
                    <Text style={styles.sectionTitle}>{getStoreCategory(selectedCategory)?.label}</Text>
                    <Text style={styles.sectionSubtitle}>{getStoreCategory(selectedCategory)?.subtitle}</Text>
                    <View style={styles.titleRule} />
                  </View>
                  <View style={styles.sectionCountPill}>
                    <Text style={styles.sectionCount}>{formatNumber(visibleItems.length)}</Text>
                  </View>
                </View>

                {!visibleItems.length ? (
                  <State><Text style={styles.stateTitle}>لا توجد عناصر في هذا القسم</Text><Text style={styles.stateBody}>ستظهر العناصر هنا بعد إضافتها من لوحة الإدارة.</Text></State>
                ) : (
                  <View style={styles.itemList}>
                    {visibleItems.map((item) => (
                      <CatalogCard
                        compact={compact}
                        item={item}
                        key={item.itemId}
                        owned={ownedIds.has(item.itemId)}
                        onPress={() => setSelected(item)}
                      />
                    ))}
                  </View>
                )}
              </>
            )}
          </View>
        ) : null}

      </View>

      <PreviewModal
        busy={busy}
        item={selected}
        onClose={() => setSelected(undefined)}
        onGift={gift}
        onPurchase={purchase}
        owned={selected ? ownedIds.has(selected.itemId) : false}
        wallet={store}
      />
    </ScreenContainer>
  );
}

function CategoryShowcaseCard({ category, count, item, onPress, wide }: {
  category: (typeof categories)[number];
  count: number;
  item?: CustomerStoreCatalogItem;
  onPress: () => void;
  wide: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={`فتح قسم ${category.label}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.showcaseCard,
        wide && styles.showcaseCardWide,
        pressed && styles.pressed,
      ]}
    >
      <LinearGradient
        colors={wide ? ['#3C090F', '#170608', '#090304'] : ['#26080C', '#110506', '#070303']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.showcaseTopOrnament}>
        <View style={styles.showcaseOrnamentLine} />
        <View style={styles.showcaseJewel} />
        <View style={styles.showcaseOrnamentLine} />
      </View>
      <View style={styles.showcaseCountBadge}>
        <Text style={styles.showcaseCountText}>{formatNumber(count)}</Text>
      </View>

      <View style={[styles.showcaseVisual, wide && styles.showcaseVisualWide]}>
        <View style={[styles.showcaseArch, wide && styles.showcaseArchWide]}>
          {item ? (
            <Image source={resolveStoreArtwork(item.thumbnailUrl)} style={styles.showcaseArtwork} />
          ) : (
            <SymbolView name={category.icon} size={44} tintColor="#C69A4D" />
          )}
        </View>
        <View style={[styles.showcasePedestal, wide && styles.showcasePedestalWide]}>
          <LinearGradient colors={['#D8A84E', '#6F3C13', '#241007']} style={styles.showcasePedestalTop} />
          <LinearGradient colors={['#8A4618', '#321408']} style={styles.showcasePedestalBase} />
        </View>
      </View>

      <View style={[styles.showcaseCopy, wide && styles.showcaseCopyWide]}>
        <Text numberOfLines={1} style={[styles.showcaseLabel, wide && styles.showcaseLabelWide]}>{category.label}</Text>
        <Text numberOfLines={2} style={[styles.showcaseSubtitle, wide && styles.showcaseSubtitleWide]}>{category.subtitle}</Text>
        <View style={styles.showcaseOpenRow}>
          <Text style={styles.showcaseOpenText}>استعراض القسم</Text>
          <SymbolView name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }} size={17} tintColor="#E2B75E" />
        </View>
      </View>
    </Pressable>
  );
}

function FeaturedCard({ compact, item, onPress, owned }: {
  compact: boolean;
  item: CustomerStoreCatalogItem;
  onPress: () => void;
  owned: boolean;
}) {
  const unavailable = item.availability !== 'available' || item.soldOut || !item.purchasingEnabled;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.featuredCard, compact && styles.featuredCardCompact, pressed && styles.pressed]}>
      <Image source={resolveStoreArtwork(item.previewAssetUrl)} style={styles.featuredImage} />
      <LinearGradient
        colors={['rgba(8,3,4,0.08)', 'rgba(18,4,6,0.5)', 'rgba(13,3,4,0.97)']}
        locations={[0, 0.46, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.featuredContent}>
        <View style={styles.featuredEyebrowRow}>
          <View style={styles.featuredEyebrow}>
            <SymbolView name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }} size={15} tintColor="#FFE19A" />
            <Text style={styles.featuredEyebrowText}>العنصر المميّز</Text>
          </View>
          <StatusBadge item={item} owned={owned} />
        </View>
        <View style={styles.featuredCopy}>
          <Text numberOfLines={1} style={[styles.featuredName, compact && styles.featuredNameCompact]}>{item.name.ar}</Text>
          <Text numberOfLines={2} style={styles.featuredDescription}>{item.description.ar}</Text>
          <View style={styles.featuredMetaRow}>
            <Meta icon={{ ios: 'clock.fill', android: 'schedule', web: 'schedule' }} text={formatDuration(item)} />
            <Meta icon={{ ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' }} text={stockLabel(item)} />
          </View>
          <View style={styles.featuredFooter}>
            <View style={styles.priceRow}>
              {item.prices.coins ? <PricePill currency="coins" value={item.prices.coins} /> : null}
              {item.prices.diamonds ? <PricePill currency="diamonds" value={item.prices.diamonds} /> : null}
            </View>
            <View style={[styles.previewButton, unavailable && styles.previewButtonMuted]}>
              <SymbolView name={{ ios: 'eye.fill', android: 'visibility', web: 'visibility' }} size={17} tintColor="#FFE7B0" />
              <Text style={styles.previewButtonText}>معاينة</Text>
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function CatalogCard({ compact, item, onPress, owned }: {
  compact: boolean;
  item: CustomerStoreCatalogItem;
  onPress: () => void;
  owned: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.catalogCard, compact && styles.catalogCardCompact, pressed && styles.pressed]}>
      <View style={styles.catalogInfo}>
        <View style={styles.catalogTopRow}>
          <Text numberOfLines={1} style={[styles.cardName, compact && styles.cardNameCompact]}>{item.name.ar}</Text>
          <StatusBadge item={item} owned={owned} />
        </View>
        <Text numberOfLines={2} style={styles.cardDescription}>{item.description.ar}</Text>
        <View style={styles.cardMetaRow}>
          <Meta icon={{ ios: 'clock.fill', android: 'schedule', web: 'schedule' }} text={formatDuration(item)} />
          <Meta icon={{ ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' }} text={stockLabel(item)} />
        </View>
        <View style={styles.cardFooter}>
          <View style={styles.priceRow}>
            {item.prices.coins ? <PricePill compact currency="coins" value={item.prices.coins} /> : null}
            {item.prices.diamonds ? <PricePill compact currency="diamonds" value={item.prices.diamonds} /> : null}
          </View>
          <View style={styles.eyeButton}>
            <SymbolView name={{ ios: 'eye.fill', android: 'visibility', web: 'visibility' }} size={18} tintColor={colors.goldSoft} />
          </View>
        </View>
      </View>
      <Image source={resolveStoreArtwork(item.thumbnailUrl)} style={[styles.catalogImage, compact && styles.catalogImageCompact]} />
    </Pressable>
  );
}

function PreviewModal({ busy, item, onClose, onGift, onPurchase, owned, wallet }: {
  busy: string;
  item?: CustomerStoreCatalogItem;
  onClose: () => void;
  onGift: (item: CustomerStoreCatalogItem, currency: StoreCurrency, recipientPublicId: string) => void;
  onPurchase: (item: CustomerStoreCatalogItem, currency: StoreCurrency) => void;
  owned: boolean;
  wallet?: CustomerStoreResult;
}) {
  const [giftMode, setGiftMode] = useState(false);
  const [recipientPublicId, setRecipientPublicId] = useState('');
  useEffect(() => { setGiftMode(false); setRecipientPublicId(''); }, [item?.itemId]);
  if (!item) return null;

  const unavailable = item.availability !== 'available' || item.soldOut || !item.purchasingEnabled;
  const recipientValid = /^[0-9]{7}$/.test(recipientPublicId);
  const confirm = (currency: StoreCurrency, price: number) => Alert.alert(
    'تأكيد الشراء',
    `شراء ${item.name.ar} مقابل ${formatNumber(price)} ${currency === 'coins' ? 'عملة' : 'ألماسة'}؟`,
    [{ text: 'إلغاء', style: 'cancel' }, { text: 'شراء', onPress: () => onPurchase(item, currency) }],
  );
  const confirmGift = (currency: StoreCurrency, price: number) => Alert.alert(
    'تأكيد الإهداء',
    `إرسال ${item.name.ar} إلى الحساب ${recipientPublicId} مقابل ${formatNumber(price)} ${currency === 'coins' ? 'عملة' : 'ألماسة'}؟`,
    [{ text: 'إلغاء', style: 'cancel' }, { text: 'إرسال', onPress: () => onGift(item, currency, recipientPublicId) }],
  );

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
            <View style={styles.previewVisual}>
              <Image source={resolveStoreArtwork(item.previewAssetUrl)} style={styles.previewImage} />
              <LinearGradient colors={['transparent', 'rgba(14,3,5,0.95)']} style={StyleSheet.absoluteFill} />
              <Pressable accessibilityLabel="إغلاق" onPress={onClose} style={styles.modalClose}><Text style={styles.modalCloseText}>×</Text></Pressable>
            </View>
            <View style={styles.previewCopy}>
              <Text style={styles.previewName}>{item.name.ar}</Text>
              <Text style={styles.previewEnglish}>{item.name.en}</Text>
              <Text style={styles.previewDescription}>{item.description.ar}</Text>
              <View style={styles.previewMetaRow}>
                <Meta icon={{ ios: 'clock.fill', android: 'schedule', web: 'schedule' }} text={formatDuration(item)} />
                <Meta icon={{ ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' }} text={stockLabel(item)} />
              </View>

              {unavailable ? (
                <View style={styles.unavailable}><Text style={styles.unavailableText}>{item.soldOut ? 'نفدت الكمية' : 'غير متاح حاليًا'}</Text></View>
              ) : (
                <>
                  {owned ? (
                    <Text style={styles.ownedHint}>
                      {item.category === 'couple-effects'
                        ? 'هذا التأثير مملوك لعلاقة الارتباط الحالية.'
                        : 'تملك هذا العنصر؛ يمكنك شراء نسخة أخرى كهدية فقط.'}
                    </Text>
                  ) : (
                    <View style={styles.purchaseChoices}>
                      {item.prices.coins ? <PurchaseButton busy={busy === `${item.itemId}:coins`} currency="coins" disabled={Boolean(busy) || (wallet?.wallet.balances.coins || 0) < item.prices.coins} value={item.prices.coins} onPress={() => confirm('coins', item.prices.coins!)} /> : null}
                      {item.prices.diamonds ? <PurchaseButton busy={busy === `${item.itemId}:diamonds`} currency="diamonds" disabled={Boolean(busy) || (wallet?.wallet.balances.diamonds || 0) < item.prices.diamonds} value={item.prices.diamonds} onPress={() => confirm('diamonds', item.prices.diamonds!)} /> : null}
                    </View>
                  )}
                  {item.category !== 'couple-effects' ? (
                    <Pressable disabled={Boolean(busy)} onPress={() => setGiftMode((value) => !value)} style={styles.giftToggle}>
                      <SymbolView name={{ ios: 'gift.fill', android: 'redeem', web: 'redeem' }} size={19} tintColor="#FFE6A1" />
                      <Text style={styles.giftToggleText}>{giftMode ? 'إلغاء الإهداء' : 'إهداء لصديق'}</Text>
                    </Pressable>
                  ) : null}
                  {giftMode && item.category !== 'couple-effects' ? (
                    <View style={styles.giftForm}>
                      <TextInput
                        keyboardType="number-pad"
                        maxLength={7}
                        onChangeText={(value) => setRecipientPublicId(value.replace(/\D/g, ''))}
                        placeholder="معرّف الحساب العادي من 7 أرقام"
                        placeholderTextColor={colors.textSubtle}
                        style={styles.recipientInput}
                        textAlign="right"
                        value={recipientPublicId}
                      />
                      <View style={styles.purchaseChoices}>
                        {item.prices.coins ? <PurchaseButton busy={busy === `gift:${item.itemId}:coins`} currency="coins" disabled={Boolean(busy) || !recipientValid || (wallet?.wallet.balances.coins || 0) < item.prices.coins} value={item.prices.coins} onPress={() => confirmGift('coins', item.prices.coins!)} /> : null}
                        {item.prices.diamonds ? <PurchaseButton busy={busy === `gift:${item.itemId}:diamonds`} currency="diamonds" disabled={Boolean(busy) || !recipientValid || (wallet?.wallet.balances.diamonds || 0) < item.prices.diamonds} value={item.prices.diamonds} onPress={() => confirmGift('diamonds', item.prices.diamonds!)} /> : null}
                      </View>
                    </View>
                  ) : null}
                </>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function PurchaseButton({ busy, currency, disabled, onPress, value }: {
  busy: boolean;
  currency: StoreCurrency;
  disabled: boolean;
  onPress: () => void;
  value: number;
}) {
  return (
    <Pressable disabled={disabled || busy} onPress={onPress} style={[styles.purchaseButton, currency === 'diamonds' && styles.diamondButton, disabled && styles.disabled]}>
      {busy ? <ActivityIndicator color="#2A090C" /> : <><CurrencyIcon currency={currency} size={18} /><Text style={styles.purchaseText}>{formatNumber(value)}</Text></>}
    </Pressable>
  );
}

function Balance({ currency, label, value }: { currency: StoreCurrency; label: string; value: number }) {
  return (
    <View style={styles.balance}>
      <CurrencyIcon currency={currency} size={28} />
      <View>
        <Text style={styles.balanceValue}>{formatNumber(value)}</Text>
        <Text style={styles.balanceLabel}>{label}</Text>
      </View>
    </View>
  );
}

function CurrencyIcon({ currency, size }: { currency: StoreCurrency; size: number }) {
  return (
    <View style={[styles.currencyIcon, currency === 'diamonds' && styles.currencyIconDiamond, { height: size, width: size }]}>
      <Text style={[styles.currencyIconText, currency === 'diamonds' && styles.currencyIconDiamondText, { fontSize: size * 0.58 }]}>{currency === 'coins' ? '●' : '◆'}</Text>
    </View>
  );
}

function PricePill({ compact = false, currency, value }: { compact?: boolean; currency: StoreCurrency; value: number }) {
  return (
    <View style={[styles.pricePill, compact && styles.pricePillCompact, currency === 'diamonds' && styles.pricePillDiamond]}>
      <CurrencyIcon currency={currency} size={compact ? 17 : 20} />
      <Text style={[styles.priceText, currency === 'diamonds' && styles.diamondText]}>{formatNumber(value)}</Text>
    </View>
  );
}

function Meta({ icon, text }: { icon: SymbolName; text: string }) {
  return <View style={styles.meta}><SymbolView name={icon} size={14} tintColor={colors.gold} /><Text numberOfLines={1} style={styles.metaText}>{text}</Text></View>;
}

function StatusBadge({ item, owned }: { item: CustomerStoreCatalogItem; owned: boolean }) {
  const unavailable = item.availability !== 'available' || !item.purchasingEnabled;
  const label = owned ? 'مملوك' : item.soldOut ? 'نفدت الكمية' : unavailable ? 'غير متاح' : 'متاح';
  return <View style={[styles.statusBadge, (owned || item.soldOut || unavailable) && styles.statusBadgeMuted]}><Text style={styles.statusBadgeText}>{label}</Text></View>;
}

function RoundButton({ label, name, onPress }: { label: string; name: SymbolName; onPress: () => void }) {
  return <Pressable accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}><SymbolView name={name} size={21} tintColor={colors.goldSoft} /></Pressable>;
}

function State({ children }: { children: ReactNode }) { return <View style={styles.state}>{children}</View>; }

function formatDuration(item: CustomerStoreCatalogItem) {
  if (item.duration.kind === 'permanent') return 'دائم';
  const units = { days: 'يوم', weeks: 'أسبوع', months: 'شهر' };
  return `${formatNumber(item.duration.value)} ${units[item.duration.unit]}`;
}

function stockLabel(item: CustomerStoreCatalogItem) {
  return item.stock.kind === 'unlimited' ? 'مخزون متاح' : `متبقي ${formatNumber(item.stock.remaining)}`;
}

function formatNumber(value: number) {
  try { return new Intl.NumberFormat('en-US').format(value); } catch { return String(value); }
}

const styles = StyleSheet.create({
  page: { alignSelf: 'center', gap: 14, maxWidth: 760, paddingBottom: spacing.xl, paddingHorizontal: spacing.lg, width: '100%' },
  header: { alignItems: 'center', flexDirection: 'row-reverse', justifyContent: 'space-between', minHeight: 50 },
  heading: { alignItems: 'center', flex: 1, paddingHorizontal: 8 },
  eyebrow: { color: '#9D793D', fontSize: 9, fontWeight: typography.weights.bold, letterSpacing: 1.6 },
  title: { color: '#FFF0C8', fontSize: 24, fontWeight: typography.weights.black, marginTop: 1, textAlign: 'center' },
  titleCompact: { fontSize: 20 },
  roundButton: { alignItems: 'center', backgroundColor: '#0D0607', borderColor: 'rgba(216,168,78,.72)', borderRadius: radius.full, borderWidth: 1, height: 43, justifyContent: 'center', width: 43 },
  balanceBar: { alignItems: 'center', backgroundColor: '#0D0607', borderColor: 'rgba(216,168,78,.55)', borderRadius: 18, borderWidth: 1, flexDirection: 'row-reverse', justifyContent: 'space-around', minHeight: 68, paddingHorizontal: spacing.md },
  balance: { alignItems: 'center', flexDirection: 'row-reverse', gap: 9, minWidth: 112 },
  balanceDivider: { backgroundColor: 'rgba(216,168,78,.28)', height: 35, width: 1 },
  balanceValue: { color: '#FFF3D5', fontSize: 19, fontWeight: typography.weights.black, textAlign: 'right' },
  balanceLabel: { color: '#9D876D', fontSize: 10, marginTop: -2, textAlign: 'right' },
  currencyIcon: { alignItems: 'center', backgroundColor: '#8C5D09', borderColor: '#F1C664', borderRadius: radius.full, borderWidth: 1, justifyContent: 'center' },
  currencyIconDiamond: { backgroundColor: '#113744', borderColor: '#74D9FF', transform: [{ rotate: '45deg' }] },
  currencyIconText: { color: '#FFE29A', fontWeight: typography.weights.black, lineHeight: 15 },
  currencyIconDiamondText: { color: '#8EE4FF', transform: [{ rotate: '-45deg' }] },
  storeContent: { gap: spacing.lg },
  featuredCard: { backgroundColor: '#180709', borderColor: '#B98937', borderRadius: 22, borderWidth: 1, height: 220, overflow: 'hidden' },
  featuredCardCompact: { height: 210 },
  featuredImage: { height: '100%', resizeMode: 'cover', width: '100%' },
  featuredContent: { bottom: 0, justifyContent: 'space-between', left: 0, padding: spacing.md, position: 'absolute', right: 0, top: 0 },
  featuredEyebrowRow: { alignItems: 'center', flexDirection: 'row-reverse', justifyContent: 'space-between' },
  featuredEyebrow: { alignItems: 'center', backgroundColor: 'rgba(105,15,25,.88)', borderColor: 'rgba(229,184,90,.48)', borderRadius: radius.full, borderWidth: 1, flexDirection: 'row-reverse', gap: 6, paddingHorizontal: 12, paddingVertical: 7 },
  featuredEyebrowText: { color: '#FFE4A3', fontSize: 11, fontWeight: typography.weights.black },
  featuredCopy: { alignItems: 'flex-end', gap: 7 },
  featuredName: { color: '#FFF0CD', fontSize: 24, fontWeight: typography.weights.black, textAlign: 'right', width: '100%' },
  featuredNameCompact: { fontSize: 21 },
  featuredDescription: { color: '#D5C0A3', fontSize: 11, lineHeight: 17, maxWidth: '88%', textAlign: 'right', writingDirection: 'rtl' },
  featuredMetaRow: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.md, width: '100%' },
  featuredFooter: { alignItems: 'center', flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 3, width: '100%' },
  previewButton: { alignItems: 'center', backgroundColor: '#6B111B', borderColor: '#D8A84E', borderRadius: radius.full, borderWidth: 1, flexDirection: 'row-reverse', gap: 7, minHeight: 41, paddingHorizontal: 17 },
  previewButtonMuted: { backgroundColor: '#302327' },
  previewButtonText: { color: '#FFE9BA', fontSize: 12, fontWeight: typography.weights.black },
  showroomHeading: { alignItems: 'flex-end', gap: 3, marginTop: 2 },
  showroomEyebrow: { color: '#9F7E49', fontSize: 9, fontWeight: typography.weights.black, letterSpacing: 1.1 },
  showroomTitle: { color: '#FFE6A8', fontSize: 23, fontWeight: typography.weights.black, textAlign: 'right' },
  showroomRule: { backgroundColor: '#9C7029', height: 1, marginTop: 4, width: 104 },
  showroomGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 12 },
  showcaseCard: { alignItems: 'center', borderColor: 'rgba(216,168,78,.52)', borderRadius: 22, borderWidth: 1, height: 245, justifyContent: 'space-between', overflow: 'hidden', paddingBottom: 13, paddingHorizontal: 10, paddingTop: 20, position: 'relative', width: '48%' },
  showcaseCardWide: { flexDirection: 'row-reverse', height: 188, paddingBottom: 14, paddingHorizontal: 20, paddingTop: 16, width: '100%' },
  showcaseTopOrnament: { alignItems: 'center', flexDirection: 'row', gap: 4, left: '50%', marginLeft: -38, position: 'absolute', top: 9, width: 76 },
  showcaseOrnamentLine: { backgroundColor: 'rgba(216,168,78,.45)', height: 1, flex: 1 },
  showcaseJewel: { backgroundColor: '#9B1522', borderColor: '#F0C96B', borderWidth: 1, height: 8, transform: [{ rotate: '45deg' }], width: 8 },
  showcaseCountBadge: { alignItems: 'center', backgroundColor: 'rgba(6,2,3,.9)', borderColor: 'rgba(216,168,78,.42)', borderRadius: radius.full, borderWidth: 1, justifyContent: 'center', left: 9, minHeight: 24, minWidth: 31, paddingHorizontal: 7, position: 'absolute', top: 10, zIndex: 4 },
  showcaseCountText: { color: '#D9B76D', fontSize: 9, fontWeight: typography.weights.black },
  showcaseVisual: { alignItems: 'center', height: 137, justifyContent: 'flex-end', marginTop: 7, width: '100%' },
  showcaseVisualWide: { height: 145, marginTop: 6, width: '42%' },
  showcaseArch: { alignItems: 'center', backgroundColor: '#19080A', borderColor: 'rgba(216,168,78,.42)', borderRadius: 55, borderWidth: 1, height: 108, justifyContent: 'center', overflow: 'hidden', width: 108 },
  showcaseArchWide: { borderRadius: 60, height: 118, width: 118 },
  showcaseArtwork: { height: '100%', resizeMode: 'cover', width: '100%' },
  showcasePedestal: { alignItems: 'center', marginTop: -7, width: 120 },
  showcasePedestalWide: { width: 132 },
  showcasePedestalTop: { borderColor: '#E7BD60', borderRadius: radius.full, borderWidth: 1, height: 13, width: '100%' },
  showcasePedestalBase: { borderBottomLeftRadius: 12, borderBottomRightRadius: 12, height: 13, marginTop: -2, width: '78%' },
  showcaseCopy: { alignItems: 'center', gap: 3, width: '100%' },
  showcaseCopyWide: { alignItems: 'flex-end', flex: 1, paddingRight: 10, width: undefined },
  showcaseLabel: { color: '#FFF0C8', fontSize: 15, fontWeight: typography.weights.black, textAlign: 'center' },
  showcaseLabelWide: { fontSize: 20, textAlign: 'right' },
  showcaseSubtitle: { color: '#9F8971', fontSize: 9, lineHeight: 13, minHeight: 26, textAlign: 'center' },
  showcaseSubtitleWide: { fontSize: 10, minHeight: 18, textAlign: 'right' },
  showcaseOpenRow: { alignItems: 'center', flexDirection: 'row-reverse', gap: 3, marginTop: 2 },
  showcaseOpenText: { color: '#CFA758', fontSize: 9, fontWeight: typography.weights.bold },
  sectionHeading: { alignItems: 'center', flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 2 },
  sectionTitleWrap: { alignItems: 'flex-end', gap: 6 },
  sectionTitle: { color: '#F7D98D', fontSize: 21, fontWeight: typography.weights.black, textAlign: 'right' },
  sectionSubtitle: { color: '#9F8971', fontSize: 10, textAlign: 'right' },
  titleRule: { backgroundColor: '#9C7029', height: 1, width: 76 },
  sectionCountPill: { alignItems: 'center', borderColor: 'rgba(216,168,78,.42)', borderRadius: radius.full, borderWidth: 1, height: 38, justifyContent: 'center', minWidth: 46 },
  sectionCount: { color: '#D8B466', fontSize: 13, fontWeight: typography.weights.black },
  itemList: { gap: 12 },
  catalogCard: { backgroundColor: '#100607', borderColor: 'rgba(216,168,78,.42)', borderRadius: 19, borderWidth: 1, flexDirection: 'row-reverse', height: 184, maxHeight: 184, minHeight: 184, overflow: 'hidden' },
  catalogCardCompact: { height: 170, maxHeight: 170, minHeight: 170 },
  catalogInfo: { flex: 1, gap: 7, justifyContent: 'center', padding: spacing.md },
  catalogImage: { alignSelf: 'stretch', backgroundColor: '#210A0D', height: '100%', resizeMode: 'cover', width: '41%' },
  catalogImageCompact: { height: '100%', width: '39%' },
  catalogTopRow: { alignItems: 'center', flexDirection: 'row-reverse', gap: 7, justifyContent: 'space-between' },
  cardName: { color: '#FFF0D0', flex: 1, fontSize: 18, fontWeight: typography.weights.black, textAlign: 'right' },
  cardNameCompact: { fontSize: 16 },
  cardDescription: { color: '#B9A38A', fontSize: 11, lineHeight: 17, minHeight: 34, textAlign: 'right', writingDirection: 'rtl' },
  cardMetaRow: { alignItems: 'center', flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 10 },
  meta: { alignItems: 'center', flexDirection: 'row-reverse', gap: 5 },
  metaText: { color: '#C8A85F', fontSize: 10, fontWeight: typography.weights.bold },
  cardFooter: { alignItems: 'center', flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 2 },
  priceRow: { alignItems: 'center', flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 6 },
  pricePill: { alignItems: 'center', backgroundColor: 'rgba(76,39,7,.8)', borderColor: 'rgba(224,180,81,.45)', borderRadius: radius.full, borderWidth: 1, flexDirection: 'row-reverse', gap: 6, minHeight: 34, paddingHorizontal: 10 },
  pricePillCompact: { minHeight: 30, paddingHorizontal: 8 },
  pricePillDiamond: { backgroundColor: 'rgba(9,45,58,.72)', borderColor: 'rgba(110,211,246,.38)' },
  priceText: { color: '#FFE09A', fontSize: 12, fontWeight: typography.weights.black },
  diamondText: { color: '#8FE4FF' },
  eyeButton: { alignItems: 'center', borderColor: 'rgba(216,168,78,.4)', borderRadius: radius.full, borderWidth: 1, height: 34, justifyContent: 'center', width: 42 },
  statusBadge: { backgroundColor: 'rgba(21,91,49,.78)', borderColor: 'rgba(86,192,122,.36)', borderRadius: radius.full, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  statusBadgeMuted: { backgroundColor: 'rgba(67,48,51,.88)', borderColor: 'rgba(180,150,129,.2)' },
  statusBadgeText: { color: '#E7D1AF', fontSize: 8, fontWeight: typography.weights.black },
  state: { alignItems: 'center', backgroundColor: '#100607', borderColor: 'rgba(216,168,78,.38)', borderRadius: 20, borderWidth: 1, gap: spacing.md, justifyContent: 'center', minHeight: 170, padding: spacing.xl },
  stateTitle: { color: colors.text, fontSize: 17, fontWeight: typography.weights.black, textAlign: 'center' },
  stateBody: { color: colors.textMuted, textAlign: 'center' },
  retry: { backgroundColor: colors.gold, borderRadius: radius.full, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  retryText: { color: '#2A090C', fontWeight: typography.weights.black },
  modalBackdrop: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,.88)', flex: 1, justifyContent: 'center', padding: spacing.lg },
  modalCard: { backgroundColor: '#110607', borderColor: '#B48638', borderRadius: 24, borderWidth: 1, maxHeight: '90%', maxWidth: 520, overflow: 'hidden', width: '100%' },
  modalContent: { paddingBottom: spacing.lg },
  previewVisual: { height: 250 },
  previewImage: { height: '100%', resizeMode: 'cover', width: '100%' },
  modalClose: { alignItems: 'center', backgroundColor: 'rgba(10,3,4,.82)', borderColor: 'rgba(216,168,78,.55)', borderRadius: radius.full, borderWidth: 1, height: 38, justifyContent: 'center', position: 'absolute', right: 12, top: 12, width: 38 },
  modalCloseText: { color: colors.text, fontSize: 27, lineHeight: 29 },
  previewCopy: { alignItems: 'center', gap: 7, paddingHorizontal: spacing.lg },
  previewName: { color: colors.goldSoft, fontSize: 24, fontWeight: typography.weights.black, marginTop: -8, textAlign: 'center' },
  previewEnglish: { color: colors.textMuted, fontSize: 11 },
  previewDescription: { color: colors.text, lineHeight: 20, textAlign: 'center' },
  previewMetaRow: { flexDirection: 'row-reverse', gap: spacing.lg },
  purchaseChoices: { flexDirection: 'row-reverse', gap: spacing.md, paddingTop: spacing.sm, width: '100%' },
  purchaseButton: { alignItems: 'center', backgroundColor: colors.gold, borderRadius: radius.full, flex: 1, flexDirection: 'row-reverse', gap: 8, justifyContent: 'center', minHeight: 46 },
  diamondButton: { backgroundColor: '#79D7FF' },
  purchaseText: { color: '#25090B', fontWeight: typography.weights.black },
  unavailable: { backgroundColor: '#35272B', borderRadius: radius.full, marginTop: spacing.sm, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  unavailableText: { color: colors.textMuted, fontWeight: typography.weights.bold },
  ownedHint: { color: colors.textMuted, fontSize: 12, paddingHorizontal: spacing.lg, textAlign: 'center' },
  giftToggle: { alignItems: 'center', backgroundColor: '#641019', borderColor: colors.borderGold, borderRadius: radius.full, borderWidth: 1, flexDirection: 'row-reverse', gap: spacing.sm, marginTop: spacing.sm, minHeight: 42, justifyContent: 'center', paddingHorizontal: spacing.xl },
  giftToggleText: { color: '#FFE6A1', fontWeight: typography.weights.black },
  giftForm: { alignItems: 'stretch', gap: spacing.sm, width: '100%' },
  recipientInput: { alignSelf: 'center', backgroundColor: '#0C0405', borderColor: colors.borderGold, borderRadius: radius.lg, borderWidth: 1, color: colors.text, minHeight: 48, paddingHorizontal: spacing.lg, width: '100%', writingDirection: 'rtl' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.992 }] },
});
