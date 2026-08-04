import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../theme';
import { activeVoiceProviderConfig } from '../../voice/activeVoiceProviderConfig';
import {
  RoomThemeInventory,
  RoomThemeInventoryEntry,
  requestRoomThemeCommand,
} from '../../voice/requestRoomThemeCommand';
import { DEFAULT_ROOM_THEME_ID } from '../../voice/roomThemeContract';
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
  const [inventory, setInventory] = useState<RoomThemeInventory>();
  const [errorMessage, setErrorMessage] = useState('');
  const [pendingThemeId, setPendingThemeId] = useState('');

  const load = useCallback(async () => {
    if (!enabled) return;
    setErrorMessage('');
    try {
      const result = await requestRoomThemeCommand({
        action: 'get-room-theme-inventory',
        roomId,
      }, activeVoiceProviderConfig.liveKit);
      if ('inventory' in result) setInventory(result);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'تعذر تحميل سمات الغرفة.');
    }
  }, [enabled, roomId]);

  useEffect(() => {
    if (visible) void load();
  }, [load, visible]);

  const apply = useCallback(async (entry: RoomThemeInventoryEntry, currency?: 'coins' | 'diamonds') => {
    const themeId = entry.manifest?.themeId ?? entry.themeId ?? DEFAULT_ROOM_THEME_ID;
    setPendingThemeId(themeId);
    setErrorMessage('');
    try {
      await requestRoomThemeCommand(
        entry.state === 'locked'
          ? { action: 'purchase-room-theme', applyTheme: true, currency, roomId, themeId }
          : { action: 'equip-room-theme', roomId, themeId },
        activeVoiceProviderConfig.liveKit,
      );
      await load();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'تعذر تطبيق سمة الغرفة.');
    } finally {
      setPendingThemeId('');
    }
  }, [load, roomId]);

  if (!enabled) return <Text style={styles.helper}>سمات الغرف غير مفعلة حالياً.</Text>;
  if (!inventory) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.gold} />
        <Text style={styles.helper}>جارٍ تحميل سمات الغرفة…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.heading}>
        <Text style={styles.helper}>المشتريات محفوظة للغرفة وتنتقل مع ملكيتها.</Text>
        <Text style={styles.title}>سمات الغرفة</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.row}>
          {inventory.inventory.map((entry) => {
            const themeId = entry.manifest?.themeId ?? entry.themeId ?? DEFAULT_ROOM_THEME_ID;
            const selected = currentThemeId === themeId || inventory.equippedThemeId === themeId;
            const background = entry.manifest?.assets.background;
            const pending = pendingThemeId === themeId;
            return (
              <View key={themeId} style={[styles.card, selected && styles.cardSelected]}>
                {background ? (
                  <Image
                    accessibilityIgnoresInvertColors
                    resizeMode="cover"
                    source={resolveRoomThemeAssetSource(background.uri)}
                    style={styles.preview}
                  />
                ) : <View style={styles.previewFallback} />}
                <View style={styles.cardBody}>
                  <Text numberOfLines={1} style={styles.cardTitle}>
                    {entry.catalog?.name.ar || themeName(themeId)}
                  </Text>
                  <Text style={styles.state}>{stateLabel(entry.state, selected)}</Text>
                  {entry.state === 'locked' ? (
                    <View style={styles.purchaseRow}>
                      {entry.catalog?.prices.coins ? (
                        <MiniButton
                          disabled={!purchasesEnabled || pending}
                          label={`${entry.catalog.prices.coins} عملة`}
                          onPress={() => void apply(entry, 'coins')}
                        />
                      ) : null}
                      {entry.catalog?.prices.diamonds ? (
                        <MiniButton
                          disabled={!purchasesEnabled || pending}
                          label={`${entry.catalog.prices.diamonds} ماسة`}
                          onPress={() => void apply(entry, 'diamonds')}
                        />
                      ) : null}
                    </View>
                  ) : (
                    <MiniButton
                      disabled={selected || pending || entry.state === 'expired'}
                      label={pending ? 'جارٍ…' : selected ? 'مطبقة' : 'تطبيق'}
                      onPress={() => void apply(entry)}
                    />
                  )}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
      {!purchasesEnabled ? <Text style={styles.helper}>شراء السمات متوقف مؤقتاً؛ السمات المملوكة ما زالت متاحة.</Text> : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
    </View>
  );
}

function MiniButton({ disabled, label, onPress }: { disabled: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.button, disabled && styles.buttonDisabled]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function themeName(themeId: string) {
  if (themeId === 'majlis-default') return 'المجلس';
  if (themeId === 'royal-theater') return 'المسرح الملكي';
  if (themeId === 'ruby-constellation') return 'كوكبة الياقوت';
  return themeId;
}

function stateLabel(state: RoomThemeInventoryEntry['state'], selected: boolean) {
  if (selected) return 'السمة الحالية';
  if (state === 'free') return 'مجانية';
  if (state === 'owned') return 'مملوكة';
  if (state === 'expired') return 'منتهية';
  return 'مقفلة';
}

const styles = StyleSheet.create({
  root: { gap: spacing.sm },
  heading: { alignItems: 'flex-end', gap: 2 },
  title: { color: colors.text, fontSize: typography.sizes.body, fontWeight: typography.weights.black },
  helper: { color: colors.textMuted, fontSize: 11, textAlign: 'right', writingDirection: 'rtl' },
  loading: { alignItems: 'center', flexDirection: 'row-reverse', gap: spacing.sm },
  row: { flexDirection: 'row-reverse', gap: spacing.sm },
  card: {
    backgroundColor: 'rgba(19,10,11,0.94)',
    borderColor: 'rgba(214,168,79,0.34)',
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    width: 168,
  },
  cardSelected: { borderColor: colors.gold, borderWidth: 2 },
  preview: { height: 92, width: '100%' },
  previewFallback: { backgroundColor: '#120708', height: 92, width: '100%' },
  cardBody: { gap: 5, padding: spacing.sm },
  cardTitle: { color: colors.text, fontWeight: typography.weights.black, textAlign: 'right', writingDirection: 'rtl' },
  state: { color: colors.goldSoft, fontSize: 10, textAlign: 'right', writingDirection: 'rtl' },
  purchaseRow: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 5 },
  button: {
    alignItems: 'center',
    backgroundColor: colors.ruby,
    borderColor: colors.gold,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  buttonDisabled: { opacity: 0.46 },
  buttonText: { color: colors.goldSoft, fontSize: 10, fontWeight: typography.weights.black },
  error: { color: '#FFB4C2', fontSize: 11, textAlign: 'right', writingDirection: 'rtl' },
});
