import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '../theme';

type Props = {
  active?: boolean;
  style?: StyleProp<ViewStyle>;
  variant?: 'compact' | 'full';
};

export function RepresentativeBadge({
  active = false,
  style,
  variant = 'compact',
}: Props) {
  const [informationVisible, setInformationVisible] = useState(false);
  const insets = useSafeAreaInsets();

  if (!active) return null;

  const compact = variant === 'compact';
  return (
    <>
      <Pressable
        accessibilityHint="يفتح معلومات الشارة"
        accessibilityLabel="وكيل معتمد"
        accessibilityRole="button"
        hitSlop={compact ? 7 : 3}
        onPress={(event) => {
          event.stopPropagation();
          setInformationVisible(true);
        }}
        style={({ pressed }) => [
          compact ? styles.compact : styles.full,
          style,
          pressed && styles.pressed,
        ]}
      >
        <SymbolView
          name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }}
          size={compact ? 15 : 17}
          tintColor={compact ? '#2B080B' : '#FFE8A0'}
        />
        {!compact ? <Text style={styles.fullText}>وكيل معتمد</Text> : null}
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setInformationVisible(false)}
        transparent
        visible={informationVisible}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel="إغلاق معلومات الشارة"
            onPress={() => setInformationVisible(false)}
            style={styles.backdrop}
          />
          <LinearGradient
            colors={['#3A0A0E', '#160607', '#050202']}
            style={[
              styles.sheet,
              { paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.lg },
            ]}
          >
            <View style={styles.sheetHeader}>
              <Pressable
                accessibilityLabel="إغلاق"
                accessibilityRole="button"
                onPress={() => setInformationVisible(false)}
                style={styles.close}
              >
                <SymbolView
                  name={{ ios: 'xmark', android: 'close', web: 'close' }}
                  size={19}
                  tintColor={colors.goldSoft}
                />
              </Pressable>
              <Text style={styles.sheetTitle}>شارة وكيل معتمد</Text>
            </View>
            <View style={styles.seal}>
              <SymbolView
                name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }}
                size={42}
                tintColor="#2B080B"
              />
            </View>
            <Text style={styles.description}>
              تؤكد هذه الشارة أن إدارة المنصة منحت الحساب صفة وكيل نشطة. تصدرها الإدارة
              وتُزال تلقائياً عند إيقاف الصلاحية.
            </Text>
            <View style={styles.notice}>
              <SymbolView
                name={{ ios: 'lock.shield.fill', android: 'gpp_good', web: 'gpp_good' }}
                size={20}
                tintColor={colors.gold}
              />
              <Text style={styles.noticeText}>
                لا تكشف الشارة رصيد الحساب أو حدود التحويل أو العملات المسموح بها.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setInformationVisible(false)}
              style={styles.done}
            >
              <Text style={styles.doneText}>فهمت</Text>
            </Pressable>
          </LinearGradient>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  compact: {
    alignItems: 'center',
    backgroundColor: colors.gold,
    borderColor: '#FFF0B8',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 21,
    justifyContent: 'center',
    width: 21,
  },
  full: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    backgroundColor: 'rgba(102,19,27,0.9)',
    borderColor: 'rgba(255,224,154,0.72)',
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: 6,
    minHeight: 31,
    paddingHorizontal: spacing.md,
  },
  fullText: {
    color: '#FFF0BE',
    fontSize: 12,
    fontWeight: typography.weights.black,
    writingDirection: 'rtl',
  },
  pressed: {
    opacity: 0.72,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.74)',
    inset: 0,
    position: 'absolute',
  },
  sheet: {
    alignItems: 'center',
    borderColor: 'rgba(232,190,97,0.52)',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderWidth: 1,
    gap: spacing.lg,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  sheetHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    width: '100%',
  },
  close: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: 'rgba(232,190,97,0.24)',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  sheetTitle: {
    color: colors.goldSoft,
    flex: 1,
    fontSize: 21,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  seal: {
    alignItems: 'center',
    backgroundColor: colors.gold,
    borderColor: '#FFF0B8',
    borderRadius: radius.full,
    borderWidth: 2,
    height: 78,
    justifyContent: 'center',
    width: 78,
  },
  description: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 25,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  notice: {
    alignItems: 'center',
    backgroundColor: 'rgba(232,190,97,0.08)',
    borderColor: 'rgba(232,190,97,0.25)',
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    gap: spacing.md,
    padding: spacing.md,
    width: '100%',
  },
  noticeText: {
    color: colors.textMuted,
    flex: 1,
    lineHeight: 21,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  done: {
    alignItems: 'center',
    backgroundColor: colors.gold,
    borderRadius: radius.full,
    justifyContent: 'center',
    minHeight: 48,
    width: '100%',
  },
  doneText: {
    color: '#2B080B',
    fontWeight: typography.weights.black,
  },
});
