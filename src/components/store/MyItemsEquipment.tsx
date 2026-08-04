import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { CustomerStoreCatalogItem, MyStoreItem } from '../../social/types';
import type { StoreCategory } from '../../store/contracts';
import { orderEquipmentItems } from '../../store/equipmentLibrary';
import { resolveStoreArtwork } from '../../store/storeArtwork';
import { colors, radius, spacing, typography } from '../../theme';
import { AvatarFrameLayer } from '../AvatarPresentation';
import type { CosmeticsFeatureFlags } from '../../cosmetics/featureFlags';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

const categoryOptions: Array<{
  category: StoreCategory;
  icon: SymbolName;
  label: string;
}> = [
  { category: 'avatar-frames', icon: { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' }, label: 'إطارات الصورة' },
  { category: 'profile-skins', icon: { ios: 'person.text.rectangle.fill', android: 'badge', web: 'badge' }, label: 'خلفيات الملف' },
  { category: 'chat-bubbles', icon: { ios: 'bubble.left.and.bubble.right.fill', android: 'chat_bubble', web: 'chat_bubble' }, label: 'فقاعات الدردشة' },
  { category: 'nameplates', icon: { ios: 'rectangle.and.pencil.and.ellipsis', android: 'label', web: 'label' }, label: 'لوحات الاسم' },
  { category: 'cosmetic-badges', icon: { ios: 'seal.fill', android: 'verified', web: 'verified' }, label: 'الشارات التجميلية' },
  { category: 'seat-effects', icon: { ios: 'mic.circle.fill', android: 'mic', web: 'mic' }, label: 'تأثيرات المقعد' },
  { category: 'chat-themes', icon: { ios: 'paintpalette.fill', android: 'palette', web: 'palette' }, label: 'ثيمات الدردشة' },
  { category: 'cars', icon: { ios: 'car.fill', android: 'directions_car', web: 'directions_car' }, label: 'السيارات' },
  { category: 'game-items', icon: { ios: 'gamecontroller.fill', android: 'sports_esports', web: 'sports_esports' }, label: 'عناصر اللعبة' },
  { category: 'custom-ids', icon: { ios: 'number.circle.fill', android: 'tag', web: 'tag' }, label: 'المعرّف المخصص' },
];

export function getEquipmentCategoryLabel(category: StoreCategory) {
  return categoryOptions.find((entry) => entry.category === category)?.label || 'عناصري';
}

export function MyItemsEquipment({
  avatarLabel = '؟',
  busy,
  catalogItems,
  cosmeticsFlags,
  compact,
  onEquip,
  onOpenCategory,
  owned,
  selectedCategory,
}: {
  avatarLabel: string;
  busy: string;
  catalogItems: CustomerStoreCatalogItem[];
  cosmeticsFlags: CosmeticsFeatureFlags;
  compact: boolean;
  onEquip: (row: MyStoreItem) => void;
  onOpenCategory: (category: StoreCategory) => void;
  owned: MyStoreItem[];
  selectedCategory?: StoreCategory;
}) {
  if (selectedCategory) {
    return (
      <CategoryInventory
        busy={busy}
        compact={compact}
        onEquip={onEquip}
        owned={owned.filter((row) => row.ownership.category === selectedCategory)}
      />
    );
  }

  const activeOwned = owned.filter((row) => row.ownership.state === 'active');
  const equipped = activeOwned.filter((row) => row.ownership.equipped);
  const temporary = activeOwned.filter((row) => row.ownership.duration.kind === 'timed');
  const equippedAvatar = equipped.find((row) => row.ownership.category === 'avatar-frames');

  return (
    <View style={styles.content}>
      <View style={styles.loadoutTitleBlock}>
        <Text style={styles.loadoutTitle}>تجهيز اللاعب</Text>
        <Text style={styles.loadoutHint}>اضغط على إحدى الخانات لعرض عناصرها وتغيير التجهيز</Text>
        <View style={styles.summaryRow}>
          <Summary value={activeOwned.length} label="مملوك" />
          <View style={styles.summaryDivider} />
          <Summary value={equipped.length} label="مجهّز" />
          <View style={styles.summaryDivider} />
          <Summary value={temporary.length} label="مؤقت" />
        </View>
      </View>

      <LinearGradient
        colors={['#170709', '#090405', '#030202']}
        locations={[0, 0.56, 1]}
        style={[styles.equipmentBoard, compact && styles.equipmentBoardCompact]}
      >
        <View pointerEvents="none" style={styles.boardHaloOuter} />
        <View pointerEvents="none" style={styles.boardHaloInner} />
        <View pointerEvents="none" style={[styles.connector, styles.connectorTopLeft]} />
        <View pointerEvents="none" style={[styles.connector, styles.connectorTopRight]} />
        <View pointerEvents="none" style={[styles.connector, styles.connectorMiddleLeft]} />
        <View pointerEvents="none" style={[styles.connector, styles.connectorMiddleRight]} />
        <View pointerEvents="none" style={[styles.connector, styles.connectorBottom]} />

        <PlayerMannequin
          avatarArtwork={equippedAvatar?.catalog?.previewAssetUrl || equippedAvatar?.catalog?.thumbnailUrl}
          avatarFrame={equippedAvatar ? {
            assetUrl: equippedAvatar.catalog?.previewAssetUrl || equippedAvatar.catalog?.thumbnailUrl || '',
            itemId: equippedAvatar.ownership.itemId,
            ...((equippedAvatar.catalog?.cosmeticAsset || equippedAvatar.ownership.cosmeticAsset)
              ? { canonicalAsset: equippedAvatar.catalog?.cosmeticAsset || equippedAvatar.ownership.cosmeticAsset }
              : {}),
          } : undefined}
          avatarLabel={avatarLabel}
          cosmeticsFlags={cosmeticsFlags}
        />

        {categoryOptions.map((option, index) => {
          const rows = owned.filter((row) => row.ownership.category === option.category);
          const current = rows.find((row) => row.ownership.equipped && row.ownership.state === 'active');
          const preview = current || rows.find((row) => row.ownership.state === 'active');
          const catalogFallback = catalogItems.find((item) => item.category === option.category);
          return (
            <EquipmentSlot
              current={current}
              icon={option.icon}
              key={option.category}
              label={option.label}
              onPress={() => onOpenCategory(option.category)}
              ownedCount={rows.length}
              preview={preview}
              previewFallback={rows.length ? catalogFallback : undefined}
              style={slotPositions[index]}
            />
          );
        })}
      </LinearGradient>
    </View>
  );
}

const slotPositions: StyleProp<ViewStyle>[] = [
  { right: 14, top: 22 }, { left: 14, top: 22 },
  { right: 14, top: 150 }, { left: 14, top: 150 },
  { right: 14, top: 278 }, { left: 14, top: 278 },
  { right: 14, top: 406 }, { left: 14, top: 406 },
  { right: 14, top: 534 }, { left: 14, top: 534 },
];

function PlayerMannequin({ avatarArtwork, avatarFrame, avatarLabel, cosmeticsFlags }: { avatarArtwork?: string; avatarFrame?: import('../../cosmetics/avatarFrameProjection').AvatarFrameProjection; avatarLabel: string; cosmeticsFlags: CosmeticsFeatureFlags }) {
  const initial = typeof avatarLabel === 'string' ? ([...avatarLabel.trim()][0] || '؟') : '؟';

  return (
    <View pointerEvents="none" style={styles.playerMannequin}>
      <View style={styles.playerHeadFrame}>
        <LinearGradient colors={['#4A0C13', '#190608', '#080303']} style={styles.playerHead}>
          {avatarArtwork ? (
            <Image source={resolveStoreArtwork(avatarArtwork)} style={styles.playerPortrait} />
          ) : (
            <Text style={styles.playerInitial}>{initial}</Text>
          )}
        </LinearGradient>
        <AvatarFrameLayer flags={cosmeticsFlags} frame={avatarFrame} />
        <View style={styles.previewJewel} />
      </View>
      <LinearGradient colors={['#6E121C', '#28080C', '#090304']} style={styles.playerTorso}>
        <View style={styles.torsoGoldLine} />
        <SymbolView name={{ ios: 'person.fill', android: 'person', web: 'person' }} size={70} tintColor="rgba(238,202,122,.28)" />
      </LinearGradient>
      <View style={styles.playerPlate}>
        <Text style={styles.playerPlateText}>اللاعب</Text>
      </View>
    </View>
  );
}

function EquipmentSlot({
  current,
  icon,
  label,
  onPress,
  ownedCount,
  preview,
  previewFallback,
  style,
}: {
  current?: MyStoreItem;
  icon: SymbolName;
  label: string;
  onPress: () => void;
  ownedCount: number;
  preview?: MyStoreItem;
  previewFallback?: CustomerStoreCatalogItem;
  style: StyleProp<ViewStyle>;
}) {
  const catalog = preview?.catalog || previewFallback;
  return (
    <View style={[styles.slotWrapper, style]}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.slotButton,
          current && styles.slotButtonEquipped,
          !preview && styles.slotButtonEmpty,
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.slotInnerBorder}>
          {catalog ? (
            <Image source={resolveStoreArtwork(catalog.thumbnailUrl)} style={styles.slotArtwork} />
          ) : (
            <SymbolView name={icon} size={35} tintColor="#B88A44" />
          )}
        </View>
        {current ? <View style={styles.slotEquippedMark}><Text style={styles.slotEquippedText}>✓</Text></View> : null}
        <View style={styles.slotCount}><Text style={styles.slotCountText}>{formatNumber(ownedCount)}</Text></View>
      </Pressable>
      <Text numberOfLines={2} style={styles.slotLabel}>{label}</Text>
    </View>
  );
}

function CategoryInventory({
  busy,
  compact,
  onEquip,
  owned,
}: {
  busy: string;
  compact: boolean;
  onEquip: (row: MyStoreItem) => void;
  owned: MyStoreItem[];
}) {
  const ordered = orderEquipmentItems(owned);
  const equipped = ordered.find((row) => row.ownership.equipped && row.ownership.state === 'active');
  const collection = equipped
    ? ordered.filter((row) => row.ownership.ownershipId !== equipped.ownership.ownershipId)
    : ordered;

  return (
    <View style={styles.content}>
      <CurrentEquipment compact={compact} row={equipped} />
      <View style={styles.inventoryHeading}>
        <View>
          <Text style={styles.sectionTitle}>{equipped ? 'العناصر الأخرى' : 'مجموعتي'}</Text>
          <Text style={styles.inventoryHint}>{equipped ? 'اختر عنصراً آخر لاستبدال المجهّز' : 'اختر عنصراً لتجهيزه'}</Text>
        </View>
        <View style={styles.inventoryCount}><Text style={styles.inventoryCountText}>{formatNumber(ordered.length)}</Text></View>
      </View>
      {!collection.length ? (
        <View style={styles.emptyState}>
          <SymbolView name={{ ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' }} size={42} tintColor="#A77B3A" />
          <Text style={styles.emptyTitle}>{equipped ? 'لا توجد عناصر أخرى' : 'لا تملك عناصر من هذا النوع'}</Text>
          <Text style={styles.emptyBody}>{equipped ? 'العنصر المجهّز هو العنصر الوحيد في هذه الخانة.' : 'يمكنك العودة إلى المتجر لإضافة عناصر جديدة إلى مجموعتك.'}</Text>
        </View>
      ) : (
        <View style={styles.inventoryGrid}>
          {collection.map((row) => (
            <InventoryTile
              busy={busy === `equip:${row.ownership.itemId}`}
              compact={compact}
              key={row.ownership.ownershipId}
              onEquip={() => onEquip(row)}
              row={row}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function CurrentEquipment({ compact, row }: { compact: boolean; row?: MyStoreItem }) {
  if (!row) {
    return (
      <View style={[styles.currentPanel, compact && styles.currentPanelCompact, styles.currentPanelEmpty]}>
        <SymbolView name={{ ios: 'square.dashed', android: 'select_all', web: 'select_all' }} size={44} tintColor="#9A7640" />
        <View style={styles.currentEmptyCopy}>
          <Text style={styles.currentEyebrow}>المجهّز حالياً</Text>
          <Text style={styles.currentName}>لا يوجد عنصر مجهّز</Text>
          <Text style={styles.currentDescription}>اختر عنصراً من مجموعتك لتجهيزه.</Text>
        </View>
      </View>
    );
  }

  const catalog = row.catalog;
  return (
    <View style={[styles.currentPanel, compact && styles.currentPanelCompact]}>
      <View style={[styles.currentArtworkShell, compact && styles.currentArtworkShellCompact]}>
        {catalog ? (
          <Image source={resolveStoreArtwork(catalog.previewAssetUrl)} style={styles.currentArtwork} />
        ) : (
          <SymbolView name={{ ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' }} size={46} tintColor="#C3974E" />
        )}
        <View style={styles.previewJewel} />
      </View>
      <View style={styles.currentCopy}>
        <View style={styles.currentBadge}><Text style={styles.currentBadgeText}>المجهّز حالياً</Text></View>
        <Text numberOfLines={1} style={styles.currentName}>{catalog?.name.ar || row.ownership.itemId}</Text>
        <Text numberOfLines={2} style={styles.currentDescription}>{catalog?.description.ar || 'عنصر مجهّز من مجموعتك.'}</Text>
        <Text style={styles.currentDuration}>{expiryLabel(row)}</Text>
      </View>
    </View>
  );
}

function InventoryTile({
  busy,
  compact,
  onEquip,
  row,
}: {
  busy: boolean;
  compact: boolean;
  onEquip: () => void;
  row: MyStoreItem;
}) {
  const active = row.ownership.state === 'active';
  const equipped = row.ownership.equipped && active;
  const catalog = row.catalog;
  return (
    <View style={[
      styles.inventoryTile,
      compact && styles.inventoryTileCompact,
      equipped && styles.inventoryTileEquipped,
      !active && styles.inventoryTileExpired,
    ]}>
      <View style={styles.tileArtworkShell}>
        {catalog ? (
          <Image source={resolveStoreArtwork(catalog.thumbnailUrl)} style={styles.tileArtwork} />
        ) : (
          <SymbolView name={{ ios: 'shippingbox.fill', android: 'inventory_2', web: 'inventory_2' }} size={38} tintColor="#A77B3A" />
        )}
        {equipped ? <View style={styles.tileCheck}><Text style={styles.tileCheckText}>✓</Text></View> : null}
      </View>
      <Text numberOfLines={1} style={styles.tileName}>{catalog?.name.ar || row.ownership.itemId}</Text>
      <Text numberOfLines={1} style={[styles.tileStatus, !active && styles.tileStatusExpired]}>{expiryLabel(row)}</Text>
      <Pressable
        disabled={!active || equipped || busy}
        onPress={onEquip}
        style={[styles.tileAction, (equipped || !active || busy) && styles.tileActionDisabled]}
      >
        {busy ? (
          <ActivityIndicator color="#2A090C" size="small" />
        ) : (
          <Text style={[styles.tileActionText, !active && styles.tileActionTextExpired]}>
            {equipped ? 'مجهّز' : active ? 'تجهيز' : 'منتهي'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.summaryItem}>
      <Text style={styles.summaryValue}>{formatNumber(value)}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function expiryLabel(row: MyStoreItem) {
  if (row.ownership.state === 'expired') return 'منتهي';
  if (row.ownership.duration.kind === 'permanent') return 'دائم';
  const value = row.ownership.expiresAt;
  if (!value || typeof value !== 'object') return 'مؤقت';
  const candidate = value as { _seconds?: number; seconds?: number; toDate?: () => Date };
  const date = typeof candidate.toDate === 'function'
    ? candidate.toDate()
    : new Date(Number(candidate.seconds ?? candidate._seconds) * 1000);
  return Number.isNaN(date.getTime()) ? 'مؤقت' : `ينتهي ${new Intl.DateTimeFormat('ar-IQ').format(date)}`;
}

function formatNumber(value: number) {
  try { return new Intl.NumberFormat('en-US').format(value); } catch { return String(value); }
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  loadoutTitleBlock: { alignItems: 'center', gap: 7, paddingHorizontal: 6, paddingVertical: 4 },
  previewJewel: { backgroundColor: '#9D1422', borderColor: '#F0C96B', borderRadius: 7, borderWidth: 1, bottom: -1, height: 13, position: 'absolute', width: 13 },
  loadoutTitle: { color: '#FFF0C9', fontSize: 25, fontWeight: typography.weights.black, textAlign: 'center' },
  loadoutHint: { color: '#A99378', fontSize: 11, lineHeight: 17, textAlign: 'center' },
  summaryRow: { alignItems: 'center', backgroundColor: '#0C0506', borderColor: 'rgba(216,168,78,.24)', borderRadius: radius.full, borderWidth: 1, flexDirection: 'row-reverse', justifyContent: 'space-around', marginTop: 5, minHeight: 48, paddingHorizontal: 14, width: '100%' },
  summaryItem: { alignItems: 'center', minWidth: 44 },
  summaryValue: { color: '#F6D487', fontSize: 17, fontWeight: typography.weights.black },
  summaryLabel: { color: '#927E67', fontSize: 9 },
  summaryDivider: { backgroundColor: 'rgba(216,168,78,.23)', height: 27, width: 1 },
  sectionHeading: { alignItems: 'flex-end', gap: 6, marginTop: 2 },
  sectionTitle: { color: '#F7D98D', fontSize: 22, fontWeight: typography.weights.black, textAlign: 'right' },
  sectionRule: { backgroundColor: '#9C7029', height: 1, width: 90 },
  equipmentBoard: { backgroundColor: '#090405', borderColor: 'rgba(216,168,78,.5)', borderRadius: 24, borderWidth: 1, height: 670, overflow: 'hidden', position: 'relative' },
  equipmentBoardCompact: { height: 670 },
  boardHaloOuter: { borderColor: 'rgba(216,168,78,.13)', borderRadius: 127, borderWidth: 1, height: 254, left: '50%', marginLeft: -127, position: 'absolute', top: 64, width: 254 },
  boardHaloInner: { borderColor: 'rgba(141,27,39,.3)', borderRadius: 102, borderWidth: 1, height: 204, left: '50%', marginLeft: -102, position: 'absolute', top: 89, width: 204 },
  connector: { backgroundColor: 'rgba(216,168,78,.28)', height: 1, position: 'absolute', width: 74 },
  connectorTopLeft: { left: 82, top: 111, transform: [{ rotate: '27deg' }] },
  connectorTopRight: { right: 82, top: 111, transform: [{ rotate: '-27deg' }] },
  connectorMiddleLeft: { left: 84, top: 220 },
  connectorMiddleRight: { right: 84, top: 220 },
  connectorBottom: { height: 47, left: '50%', marginLeft: -0.5, top: 326, width: 1 },
  playerMannequin: { alignItems: 'center', left: '50%', marginLeft: -74, position: 'absolute', top: 63, width: 148 },
  playerHeadFrame: { alignItems: 'center', backgroundColor: '#160607', borderColor: '#E1B65B', borderRadius: 37, borderWidth: 2, height: 74, justifyContent: 'center', width: 74, zIndex: 2 },
  playerHead: { alignItems: 'center', borderRadius: 32, height: 64, justifyContent: 'center', overflow: 'hidden', width: 64 },
  playerPortrait: { height: '100%', resizeMode: 'cover', width: '100%' },
  playerInitial: { color: '#FFE5A8', fontSize: 31, fontWeight: typography.weights.black },
  playerTorso: { alignItems: 'center', borderColor: 'rgba(216,168,78,.58)', borderRadius: 56, borderTopLeftRadius: 42, borderTopRightRadius: 42, borderWidth: 1, height: 174, justifyContent: 'center', marginTop: -5, overflow: 'hidden', width: 128 },
  torsoGoldLine: { borderColor: 'rgba(234,197,112,.45)', borderRadius: 48, borderWidth: 1, bottom: 9, left: 9, position: 'absolute', right: 9, top: 9 },
  playerPlate: { backgroundColor: '#2C0A0E', borderColor: '#A97A35', borderRadius: radius.full, borderWidth: 1, marginTop: -13, paddingHorizontal: 18, paddingVertical: 6, zIndex: 3 },
  playerPlateText: { color: '#EBCB83', fontSize: 10, fontWeight: typography.weights.black },
  slotWrapper: { alignItems: 'center', position: 'absolute', width: 100, zIndex: 5 },
  slotButton: { alignItems: 'center', backgroundColor: '#130708', borderColor: '#8E672E', borderRadius: 15, borderWidth: 1, height: 78, justifyContent: 'center', padding: 4, position: 'relative', width: 78 },
  slotButtonEquipped: { backgroundColor: '#3A0A0F', borderColor: '#EDC464', borderWidth: 2, shadowColor: '#A91D2B', shadowOffset: { height: 0, width: 0 }, shadowOpacity: 0.5, shadowRadius: 8 },
  slotButtonEmpty: { borderColor: '#5C4931', borderStyle: 'dashed' },
  slotInnerBorder: { alignItems: 'center', backgroundColor: '#0A0405', borderColor: 'rgba(216,168,78,.2)', borderRadius: 11, borderWidth: 1, height: '100%', justifyContent: 'center', overflow: 'hidden', width: '100%' },
  slotArtwork: { height: '100%', resizeMode: 'cover', width: '100%' },
  slotEquippedMark: { alignItems: 'center', backgroundColor: '#8C1522', borderColor: '#F4CD6F', borderRadius: 11, borderWidth: 1, height: 22, justifyContent: 'center', position: 'absolute', right: -7, top: -7, width: 22 },
  slotEquippedText: { color: '#FFE8A4', fontSize: 11, fontWeight: typography.weights.black },
  slotCount: { alignItems: 'center', backgroundColor: '#090405', borderColor: '#8B662F', borderRadius: 9, borderWidth: 1, bottom: -6, height: 19, justifyContent: 'center', left: -6, minWidth: 19, paddingHorizontal: 4, position: 'absolute' },
  slotCountText: { color: '#E7C579', fontSize: 8, fontWeight: typography.weights.black },
  slotLabel: { color: '#E7CEA0', fontSize: 10, fontWeight: typography.weights.bold, lineHeight: 14, marginTop: 8, maxWidth: 100, minHeight: 28, textAlign: 'center' },
  pressed: { opacity: 0.84, transform: [{ scale: 0.99 }] },
  currentPanel: { alignItems: 'center', backgroundColor: '#130708', borderColor: '#B98937', borderRadius: 22, borderWidth: 1, flexDirection: 'row-reverse', gap: spacing.lg, minHeight: 220, overflow: 'hidden', padding: spacing.lg },
  currentPanelCompact: { gap: 12, minHeight: 178, padding: 13 },
  currentPanelEmpty: { justifyContent: 'center', minHeight: 150 },
  currentArtworkShell: { alignItems: 'center', backgroundColor: '#240B0E', borderColor: '#E0B65D', borderRadius: 76, borderWidth: 2, height: 152, justifyContent: 'center', overflow: 'hidden', width: 152 },
  currentArtworkShellCompact: { borderRadius: 59, height: 118, width: 118 },
  currentArtwork: { height: '100%', resizeMode: 'cover', width: '100%' },
  currentCopy: { alignItems: 'flex-end', flex: 1, gap: 8 },
  currentEmptyCopy: { alignItems: 'flex-end', gap: 5 },
  currentEyebrow: { color: '#C69B4E', fontSize: 11, fontWeight: typography.weights.bold },
  currentBadge: { backgroundColor: '#6E111B', borderColor: 'rgba(229,184,90,.55)', borderRadius: radius.full, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 5 },
  currentBadgeText: { color: '#FFE0A0', fontSize: 10, fontWeight: typography.weights.black },
  currentName: { color: '#FFF0CC', fontSize: 23, fontWeight: typography.weights.black, textAlign: 'right' },
  currentDescription: { color: '#A99378', fontSize: 11, lineHeight: 18, textAlign: 'right', writingDirection: 'rtl' },
  currentDuration: { color: '#91B66C', fontSize: 11, fontWeight: typography.weights.bold },
  inventoryHeading: { alignItems: 'center', flexDirection: 'row-reverse', justifyContent: 'space-between', marginTop: 4 },
  inventoryHint: { color: colors.textMuted, fontSize: 10, marginTop: 3, textAlign: 'right' },
  inventoryCount: { alignItems: 'center', borderColor: 'rgba(216,168,78,.45)', borderRadius: radius.full, borderWidth: 1, height: 38, justifyContent: 'center', width: 48 },
  inventoryCountText: { color: '#F1CE7D', fontSize: 16, fontWeight: typography.weights.black },
  inventoryGrid: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 11 },
  inventoryTile: { alignItems: 'center', backgroundColor: '#0B0506', borderColor: 'rgba(216,168,78,.42)', borderRadius: 16, borderWidth: 1, gap: 5, height: 216, justifyContent: 'center', overflow: 'hidden', padding: 9, width: '48%' },
  inventoryTileCompact: { height: 204, width: '47.8%' },
  inventoryTileEquipped: { backgroundColor: '#360A0F', borderColor: '#E0B04F', borderWidth: 2 },
  inventoryTileExpired: { opacity: 0.5 },
  tileArtworkShell: { alignItems: 'center', backgroundColor: '#18090B', borderColor: 'rgba(216,168,78,.35)', borderRadius: 45, borderWidth: 1, height: 90, justifyContent: 'center', overflow: 'hidden', position: 'relative', width: 90 },
  tileArtwork: { height: '100%', resizeMode: 'cover', width: '100%' },
  tileCheck: { alignItems: 'center', backgroundColor: '#7B121E', borderColor: '#F2C763', borderRadius: 13, borderWidth: 1, height: 26, justifyContent: 'center', position: 'absolute', right: 3, top: 3, width: 26 },
  tileCheckText: { color: '#FFE8A8', fontWeight: typography.weights.black },
  tileName: { color: '#FFF0CA', fontSize: 13, fontWeight: typography.weights.black, textAlign: 'center' },
  tileStatus: { color: '#8EB66C', fontSize: 10, minHeight: 14, textAlign: 'center' },
  tileStatusExpired: { color: '#A4938D' },
  tileAction: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: '#D7A64A', borderRadius: radius.md, justifyContent: 'center', minHeight: 34 },
  tileActionDisabled: { backgroundColor: '#3B2B2E', borderColor: 'rgba(216,168,78,.28)', borderWidth: 1 },
  tileActionText: { color: '#2A090C', fontSize: 12, fontWeight: typography.weights.black },
  tileActionTextExpired: { color: '#A89786' },
  emptyState: { alignItems: 'center', backgroundColor: '#0F0607', borderColor: 'rgba(216,168,78,.34)', borderRadius: 20, borderWidth: 1, gap: 9, minHeight: 190, justifyContent: 'center', padding: spacing.xl },
  emptyTitle: { color: '#F6DCA5', fontSize: 17, fontWeight: typography.weights.black, textAlign: 'center' },
  emptyBody: { color: colors.textMuted, fontSize: 11, lineHeight: 18, maxWidth: 300, textAlign: 'center' },
});
