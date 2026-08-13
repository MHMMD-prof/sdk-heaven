import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { ScreenContainer } from '../components/ScreenContainer';
import { getEquipmentCategoryLabel, MyItemsEquipment } from '../components/store/MyItemsEquipment';
import {
  requestMyStoreItems,
  requestStoreCatalog,
  requestStoreEquip,
} from '../social/requestSocialCommand';
import type { CustomerStoreCatalogItem, MyStoreItem } from '../social/types';
import type { StoreCategory } from '../store/contracts';
import { colors, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';
import { useCosmeticsFeatureFlags } from '../cosmetics/featureFlags';
import { CustomCosmeticsPanel } from '../components/CustomCosmeticsPanel';

type Props = NativeStackScreenProps<RootStackParamList, 'MyItems'>;
type SymbolName = ComponentProps<typeof SymbolView>['name'];

export function MyItemsScreen({ navigation }: Props) {
  const cosmeticsFlags = useCosmeticsFeatureFlags();
  const { profile } = useAuth();
  const { width } = useWindowDimensions();
  const compact = width < 390;
  const [catalogItems, setCatalogItems] = useState<CustomerStoreCatalogItem[]>([]);
  const [owned, setOwned] = useState<MyStoreItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<StoreCategory>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [catalog, inventory] = await Promise.all([requestStoreCatalog(), requestMyStoreItems()]);

      if (!catalog.ok) throw new Error(catalog.error.messageAr);
      if (!inventory.ok) throw new Error(inventory.error.messageAr);
      setCatalogItems(catalog.result.items);
      setOwned(inventory.result.items);
    } catch (loadError) {
      setCatalogItems([]);
      setOwned([]);
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل عناصرك. تحقق من الاتصال وحاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  useEffect(() => {
    if (!selectedCategory) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelectedCategory(undefined);
      return true;
    });
    return () => subscription.remove();
  }, [selectedCategory]);

  async function equip(row: MyStoreItem) {
    setBusy(`equip:${row.ownership.itemId}`);
    try {
      const response = await requestStoreEquip(row.ownership.itemId);
      if (!response.ok) {
        Alert.alert('تعذر التجهيز', response.error.messageAr);
        return;
      }
      await load();
    } catch {
      Alert.alert('تعذر التجهيز', 'تعذر الاتصال بالخدمة. حاول مرة أخرى.');
    } finally {
      setBusy('');
    }
  }

  const goBack = selectedCategory
    ? () => setSelectedCategory(undefined)
    : navigation.goBack;

  return (
    <ScreenContainer decorativeGlows={false} horizontalPadding={0} topPadding={8} variant="ruby">
      <View style={styles.page}>
        <View style={styles.header}>
          <RoundButton
            label="رجوع"
            name={{ ios: 'chevron.right', android: 'arrow_forward', web: 'arrow_forward' }}
            onPress={goBack}
          />
          <View style={styles.heading}>
            <Text style={styles.eyebrow}>SDK HEAVEN</Text>
            <Text numberOfLines={1} style={[styles.title, compact && styles.titleCompact]}>
              {selectedCategory ? getEquipmentCategoryLabel(selectedCategory) : 'عناصري'}
            </Text>
          </View>
          <RoundButton
            label="تحديث"
            name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }}
            onPress={() => void load()}
          />
        </View>

        {loading ? (
          <State>
            <ActivityIndicator color={colors.gold} size="large" />
            <Text style={styles.stateBody}>جارٍ تجهيز عناصرك…</Text>
          </State>
        ) : null}

        {!loading && error ? (
          <State>
            <Text style={styles.stateTitle}>تعذر فتح عناصري</Text>
            <Text style={styles.stateBody}>{error}</Text>
            <Pressable onPress={() => void load()} style={styles.retry}>
              <Text style={styles.retryText}>إعادة المحاولة</Text>
            </Pressable>
          </State>
        ) : null}

        {!loading && !error ? (
          <>
            <MyItemsEquipment
              avatarLabel={profile?.avatarLabel || '؟'}
              busy={busy}
              catalogItems={catalogItems}
              compact={compact}
              cosmeticsFlags={cosmeticsFlags}
              onEquip={(row) => void equip(row)}
              onOpenCategory={setSelectedCategory}
              owned={owned}
              selectedCategory={selectedCategory}
            />
            {!selectedCategory ? <CustomCosmeticsPanel /> : null}
          </>
        ) : null}
      </View>
    </ScreenContainer>
  );
}

function RoundButton({ label, name, onPress }: { label: string; name: SymbolName; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.roundButton, pressed && styles.pressed]}
    >
      <SymbolView name={name} size={21} tintColor={colors.goldSoft} />
    </Pressable>
  );
}

function State({ children }: { children: ReactNode }) {
  return <View style={styles.state}>{children}</View>;
}

const styles = StyleSheet.create({
  page: { gap: spacing.md, paddingBottom: 44, paddingHorizontal: spacing.md },
  header: { alignItems: 'center', flexDirection: 'row-reverse', justifyContent: 'space-between', minHeight: 62 },
  heading: { alignItems: 'center', flex: 1, paddingHorizontal: 8 },
  eyebrow: { color: '#9F7C45', fontSize: 8, fontWeight: typography.weights.black, letterSpacing: 3 },
  title: { color: '#FFF0C8', fontSize: 25, fontWeight: typography.weights.black, marginTop: 2, textAlign: 'center' },
  titleCompact: { fontSize: 22 },
  roundButton: { alignItems: 'center', backgroundColor: '#0D0707', borderColor: '#8E672F', borderRadius: 24, borderWidth: 1, height: 48, justifyContent: 'center', width: 48 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  state: { alignItems: 'center', backgroundColor: '#100708', borderColor: 'rgba(216,168,78,.3)', borderRadius: 20, borderWidth: 1, gap: 10, justifyContent: 'center', minHeight: 210, padding: spacing.xl },
  stateTitle: { color: '#FFF0CC', fontSize: 18, fontWeight: typography.weights.black, textAlign: 'center' },
  stateBody: { color: colors.textMuted, fontSize: 12, lineHeight: 19, textAlign: 'center' },
  retry: { backgroundColor: colors.gold, borderRadius: 12, marginTop: 6, paddingHorizontal: 18, paddingVertical: 10 },
  retryText: { color: '#2B090C', fontSize: 12, fontWeight: typography.weights.black },
});
