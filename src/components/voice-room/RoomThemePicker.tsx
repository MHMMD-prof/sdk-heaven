import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';
import { activeVoiceProviderConfig } from '../../voice/activeVoiceProviderConfig';
import type {
  RoomThemeInventory,
  RoomThemeInventoryEntry,
} from '../../voice/requestRoomThemeCommand';
import { requestRoomThemeCommand } from '../../voice/requestRoomThemeCommand';
import { DEFAULT_ROOM_THEME_ID } from '../../voice/roomThemeContract';
import { ensureDefaultRoomThemeInventory } from '../../voice/roomThemeInventory';
import { resolveRoomThemeAssetSource } from '../../voice/roomThemeRuntime';

export function RoomThemePicker({
  currentThemeId,
  enabled,
  purchasesEnabled,
  roomId,
  visible,
}: {
  currentThemeId: string;
  enabled: boolean;
  purchasesEnabled: boolean;
  roomId: string;
  visible: boolean;
}) {
  const [inventory, setInventory] = useState<RoomThemeInventory>(() => (
    ensureDefaultRoomThemeInventory({
      equippedThemeId: currentThemeId || DEFAULT_ROOM_THEME_ID,
      inventory: [],
      roomId,
    })
  ));
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [pendingThemeId, setPendingThemeId] = useState('');
  const [confirmThemeId, setConfirmThemeId] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setErrorMessage('');
    try {
      const result = await requestRoomThemeCommand({
        action: 'get-room-theme-inventory',
        roomId,
      }, activeVoiceProviderConfig.liveKit);
      if ('inventory' in result) setInventory(result);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'تعذر تحميل سمات الغرفة.');
    } finally {
      setLoading(false);
    }
  }, [enabled, roomId]);

  useEffect(() => {
    if (visible) void load();
  }, [load, visible]);

  const apply = useCallback(async (entry: RoomThemeInventoryEntry, currency?: 'coins' | 'diamonds') => {
    const themeId = entry.manifest?.themeId ?? entry.themeId ?? DEFAULT_ROOM_THEME_ID;
    setPendingThemeId(themeId);
    setErrorMessage('');
    setSuccessMessage('');
    try {
      await requestRoomThemeCommand(
        entry.state === 'locked'
          ? { action: 'purchase-room-theme', applyTheme: true, currency, roomId, themeId }
          : { action: 'equip-room-theme', roomId, themeId },
        activeVoiceProviderConfig.liveKit,
      );
      setConfirmThemeId('');
      setSuccessMessage(entry.state === 'locked' ? 'تم شراء السمة وتطبيقها على الغرفة.' : 'تم تطبيق السمة على الغرفة.');
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'تعذر تطبيق سمة الغرفة.');
    } finally {
      setPendingThemeId('');
    }
  }, [load, roomId]);

  if (!enabled) {
    return (
      <View style={styles.disabledCard}>
        <SymbolView name={{ ios: 'paintpalette.fill', android: 'palette', web: 'palette' }} size={20} tintColor="#9B8268" />
        <View style={styles.disabledCopy}>
          <Text style={styles.disabledTitle}>سمات الغرف غير متاحة</Text>
          <Text style={styles.helper}>أوقف فريق التطبيق هذه الميزة مؤقتاً.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.heading}>
        <View style={styles.titleRow}>
          <View style={styles.titleDiamond} />
          <Text style={styles.title}>سمات الغرفة</Text>
        </View>
        <Text style={styles.helper}>السمة ملك للغرفة وتبقى معها عند نقل الملكية.</Text>
      </View>
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.gold} size="small" />
          <Text style={styles.loadingText}>جارٍ تحديث السمات…</Text>
        </View>
      ) : null}
      {inventory.inventory.map((entry) => {
        const themeId = entry.manifest?.themeId ?? entry.themeId ?? DEFAULT_ROOM_THEME_ID;
        const selected = currentThemeId === themeId || inventory.equippedThemeId === themeId;
        const pending = pendingThemeId === themeId;
        const confirming = confirmThemeId === themeId;
        const preview = entry.manifest?.assets.stage ?? entry.manifest?.assets.background;
        const catalogPreview = entry.catalog?.previewAssetUrl;
        return (
          <View key={themeId} style={[styles.card, selected && styles.cardSelected]}>
            <View style={styles.previewShell}>
              {preview || catalogPreview ? (
                <Image
                  accessibilityLabel={`معاينة ${themeName(themeId)}`}
                  cachePolicy="memory-disk"
                  contentFit="cover"
                  source={preview ? resolveRoomThemeAssetSource(preview.uri) : { uri: catalogPreview }}
                  style={styles.preview}
                />
              ) : <View style={styles.previewFallback} />}
              <LinearGradient colors={['transparent', 'rgba(7,2,3,0.88)']} style={styles.previewShade} />
              <View style={[styles.stateBadge, selected && styles.stateBadgeSelected]}>
                {selected ? <SymbolView name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }} size={13} tintColor={colors.goldSoft} /> : null}
                <Text style={styles.stateBadgeText}>{stateLabel(entry.state, selected, purchasesEnabled)}</Text>
              </View>
              <View style={styles.previewTitleShell}>
                <Text style={styles.cardTitle}>{entry.catalog?.name.ar || themeName(themeId)}</Text>
                <Text style={styles.previewSubtitle}>{themeDescription(themeId)}</Text>
              </View>
            </View>
            <View style={styles.cardFooter}>
              <ThemeAction
                disabled={pending || selected || entry.state === 'expired' || (entry.state === 'locked' && !purchasesEnabled)}
                label={pending ? 'جارٍ التطبيق…' : selected ? 'السمة الحالية' : entry.state === 'locked' ? 'شراء السمة' : entry.state === 'expired' ? 'انتهت الصلاحية' : 'تطبيق السمة'}
                locked={entry.state === 'locked'}
                onPress={() => {
                  if (entry.state === 'locked') setConfirmThemeId(confirming ? '' : themeId);
                  else void apply(entry);
                }}
              />
              {themeId === DEFAULT_ROOM_THEME_ID ? <Text style={styles.permanentLabel}>مجانية دائماً</Text> : null}
            </View>
            {confirming ? (
              <View style={styles.confirmation}>
                <View style={styles.confirmHeader}>
                  <SymbolView name={{ ios: 'lock.open.fill', android: 'lock_open', web: 'lock_open' }} size={18} tintColor={colors.goldSoft} />
                  <View style={styles.confirmCopy}>
                    <Text style={styles.confirmTitle}>تأكيد شراء السمة</Text>
                    <Text style={styles.confirmNote}>سيتم خصم السعر من محفظتك ثم تطبيق السمة فوراً.</Text>
                  </View>
                </View>
                <View style={styles.currencyRow}>
                  {entry.catalog?.prices.coins ? (
                    <CurrencyButton
                      disabled={pending}
                      label={`${entry.catalog.prices.coins.toLocaleString()} كوين`}
                      onPress={() => void apply(entry, 'coins')}
                    />
                  ) : null}
                  {entry.catalog?.prices.diamonds ? (
                    <CurrencyButton
                      diamond
                      disabled={pending}
                      label={`${entry.catalog.prices.diamonds.toLocaleString()} ماسة`}
                      onPress={() => void apply(entry, 'diamonds')}
                    />
                  ) : null}
                </View>
                <Pressable accessibilityRole="button" onPress={() => setConfirmThemeId('')} style={styles.cancelButton}>
                  <Text style={styles.cancelText}>إلغاء</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}
      {!purchasesEnabled ? <Text style={styles.notice}>شراء السمات متوقف مؤقتاً؛ السمات المجانية والمملوكة ما زالت متاحة.</Text> : null}
      {successMessage ? <Text style={styles.success}>{successMessage}</Text> : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
    </View>
  );
}

function ThemeAction({ disabled, label, locked, onPress }: { disabled: boolean; label: string; locked: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.actionShell, disabled && styles.disabled, pressed && styles.pressed]}>
      <LinearGradient colors={locked ? ['#9C2639', '#5D101A'] : ['#D7AC55', '#996018']} style={styles.action}>
        <SymbolView name={locked ? { ios: 'lock.fill', android: 'lock', web: 'lock' } : { ios: 'checkmark', android: 'check', web: 'check' }} size={16} tintColor={locked ? '#FFF0D0' : '#301406'} />
        <Text style={[styles.actionText, locked && styles.actionTextLocked]}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

function CurrencyButton({ diamond = false, disabled, label, onPress }: { diamond?: boolean; disabled: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.currencyButton, disabled && styles.disabled, pressed && styles.pressed]}>
      <SymbolView name={diamond ? { ios: 'diamond.fill', android: 'diamond', web: 'diamond' } : { ios: 'circle.fill', android: 'paid', web: 'paid' }} size={16} tintColor={diamond ? '#7FE7FF' : colors.goldSoft} />
      <Text style={styles.currencyText}>{label}</Text>
    </Pressable>
  );
}

function themeName(themeId: string) {
  if (themeId === 'majlis-default') return 'المجلس الافتراضي';
  if (themeId === 'royal-theater') return 'المسرح الملكي';
  if (themeId === 'ruby-constellation') return 'كوكبة الياقوت';
  return themeId;
}

function themeDescription(themeId: string) {
  if (themeId === 'majlis-default') return 'مجلس عربي فاخر بتوزيع حدوة الحصان';
  if (themeId === 'royal-theater') return 'صفوف مسرحية ملكية بالياقوت والذهب';
  if (themeId === 'ruby-constellation') return 'توزيع مرن بإضاءة ياقوتية عصرية';
  return 'سمة بصرية للغرفة';
}

function stateLabel(state: RoomThemeInventoryEntry['state'], selected: boolean, purchasesEnabled: boolean) {
  if (selected) return 'الحالية';
  if (state === 'free') return 'مجانية';
  if (state === 'owned') return 'مملوكة';
  if (state === 'expired') return 'منتهية';
  return purchasesEnabled ? 'مقفلة' : 'غير متاحة';
}

const styles = StyleSheet.create({
  root: { gap: spacing.md },
  heading: { alignItems: 'flex-end', gap: 3, paddingHorizontal: spacing.xs },
  titleRow: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.sm },
  titleDiamond: { backgroundColor: colors.gold, height: 9, transform: [{ rotate: '45deg' }], width: 9 },
  title: { color: colors.goldSoft, fontSize: typography.sizes.title, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  helper: { color: '#A99483', fontSize: 10, lineHeight: 16, textAlign: 'right', writingDirection: 'rtl' },
  loadingRow: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.sm, justifyContent: 'center', minHeight: 32 },
  loadingText: { color: '#B99E7C', fontSize: 10, writingDirection: 'rtl' },
  card: { backgroundColor: 'rgba(14,5,6,0.96)', borderColor: 'rgba(210,157,59,0.34)', borderRadius: 21, borderWidth: 1, overflow: 'hidden' },
  cardSelected: { borderColor: colors.gold, borderWidth: 2, shadowColor: colors.gold, shadowOpacity: 0.18, shadowRadius: 12 },
  previewShell: { height: 178, position: 'relative' },
  preview: { ...StyleSheet.absoluteFill },
  previewFallback: { ...StyleSheet.absoluteFill, backgroundColor: '#170708' },
  previewShade: { ...StyleSheet.absoluteFill },
  stateBadge: { alignItems: 'center', backgroundColor: 'rgba(8,3,4,0.82)', borderColor: 'rgba(232,190,97,0.38)', borderRadius: radius.full, borderWidth: 1, flexDirection: 'row-reverse', gap: 4, left: spacing.sm, paddingHorizontal: 10, paddingVertical: 6, position: 'absolute', top: spacing.sm },
  stateBadgeSelected: { backgroundColor: 'rgba(105,18,29,0.92)', borderColor: colors.gold },
  stateBadgeText: { color: colors.goldSoft, fontSize: 9, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  previewTitleShell: { bottom: spacing.md, left: spacing.md, position: 'absolute', right: spacing.md },
  cardTitle: { color: '#FFF0D0', fontSize: 18, fontWeight: typography.weights.black, textAlign: 'right', textShadowColor: '#000', textShadowOffset: { height: 1, width: 0 }, textShadowRadius: 6, writingDirection: 'rtl' },
  previewSubtitle: { color: '#D2BB91', fontSize: 10, marginTop: 2, textAlign: 'right', textShadowColor: '#000', textShadowOffset: { height: 1, width: 0 }, textShadowRadius: 4, writingDirection: 'rtl' },
  cardFooter: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.sm, justifyContent: 'space-between', padding: spacing.md },
  actionShell: { borderRadius: radius.full, minWidth: 132, overflow: 'hidden' },
  action: { alignItems: 'center', flexDirection: 'row-reverse', gap: 6, justifyContent: 'center', minHeight: 44, paddingHorizontal: spacing.md },
  actionText: { color: '#301406', fontSize: 11, fontWeight: typography.weights.black, writingDirection: 'rtl' },
  actionTextLocked: { color: '#FFF0D0' },
  permanentLabel: { color: '#9F886A', fontSize: 9, writingDirection: 'rtl' },
  confirmation: { backgroundColor: 'rgba(91,14,24,0.22)', borderTopColor: 'rgba(232,190,97,0.26)', borderTopWidth: 1, gap: spacing.sm, padding: spacing.md },
  confirmHeader: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.sm },
  confirmCopy: { flex: 1 },
  confirmTitle: { color: colors.goldSoft, fontSize: 12, fontWeight: typography.weights.black, textAlign: 'right', writingDirection: 'rtl' },
  confirmNote: { color: '#A99483', fontSize: 9, lineHeight: 14, marginTop: 2, textAlign: 'right', writingDirection: 'rtl' },
  currencyRow: { flexDirection: 'row-reverse', gap: spacing.sm },
  currencyButton: { alignItems: 'center', backgroundColor: 'rgba(6,3,3,0.72)', borderColor: colors.borderGold, borderRadius: 12, borderWidth: 1, flex: 1, flexDirection: 'row-reverse', gap: 6, justifyContent: 'center', minHeight: 44, paddingHorizontal: spacing.sm },
  currencyText: { color: '#F5DEAA', fontSize: 10, fontWeight: typography.weights.bold, writingDirection: 'rtl' },
  cancelButton: { alignItems: 'center', minHeight: 38, justifyContent: 'center' },
  cancelText: { color: '#BDA48C', fontSize: 10, fontWeight: typography.weights.bold },
  notice: { color: '#C3A780', fontSize: 10, lineHeight: 16, textAlign: 'right', writingDirection: 'rtl' },
  success: { backgroundColor: 'rgba(43,203,136,0.08)', borderRadius: 10, color: '#81E5B7', fontSize: 10, padding: spacing.sm, textAlign: 'right', writingDirection: 'rtl' },
  error: { backgroundColor: 'rgba(184,41,75,0.10)', borderRadius: 10, color: '#FFB3C1', fontSize: 10, padding: spacing.sm, textAlign: 'right', writingDirection: 'rtl' },
  disabledCard: { alignItems: 'center', backgroundColor: 'rgba(15,6,7,0.88)', borderColor: 'rgba(232,190,97,0.24)', borderRadius: 16, borderWidth: 1, flexDirection: 'row-reverse', gap: spacing.sm, minHeight: 70, padding: spacing.md },
  disabledCopy: { flex: 1 },
  disabledTitle: { color: '#CBB181', fontSize: 12, fontWeight: typography.weights.black, textAlign: 'right', writingDirection: 'rtl' },
  disabled: { opacity: 0.44 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
});
