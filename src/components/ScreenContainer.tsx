import { LinearGradient } from 'expo-linear-gradient';
import { PropsWithChildren, ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, layers, spacing } from '../theme';

type ScreenContainerProps = PropsWithChildren<{
  backdrop?: ReactNode;
  bottomInset?: boolean;
  decorativeGlows?: boolean;
  fixedBottom?: ReactNode;
  horizontalPadding?: number;
  topPadding?: number;
  scroll?: boolean;
  scrollEnabled?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  variant?: 'default' | 'ruby';
}>;

export function ScreenContainer({
  backdrop,
  bottomInset = false,
  children,
  decorativeGlows = true,
  fixedBottom,
  horizontalPadding = spacing.lg,
  scroll = true,
  scrollEnabled = true,
  onRefresh,
  refreshing = false,
  topPadding,
  variant = 'default',
}: ScreenContainerProps) {
  const insets = useSafeAreaInsets();
  const isRuby = variant === 'ruby';

  const content = (
    <View
      style={[
        styles.content,
        {
          paddingTop: Math.max(insets.top, spacing.md) + spacing.sm,
          ...(topPadding !== undefined
            ? { paddingTop: Math.max(insets.top, spacing.xs) + topPadding }
            : null),
          paddingBottom: bottomInset
            ? 112 + Math.max(insets.bottom, spacing.sm)
            : spacing.lg,
          paddingHorizontal: horizontalPadding,
        },
      ]}
    >
      {decorativeGlows ? <View style={[styles.glowTop, isRuby && styles.rubyGlowTop]} /> : null}
      {decorativeGlows ? <View style={[styles.glowBottom, isRuby && styles.rubyGlowBottom]} /> : null}
      {children}
    </View>
  );

  return (
    <LinearGradient
      colors={
        isRuby
          ? ['#080405', '#0C0607', '#140A0B', '#080405']
          : [colors.backgroundDeep, colors.background, '#150A25', colors.backgroundDeep]
      }
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={styles.gradient}
    >
      <View style={styles.safeArea}>
        {backdrop ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {backdrop}
          </View>
        ) : null}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboard}
        >
          {scroll ? (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              keyboardShouldPersistTaps="handled"
              refreshControl={onRefresh ? (
                <RefreshControl
                  colors={[colors.gold]}
                  onRefresh={onRefresh}
                  refreshing={refreshing}
                  tintColor={colors.gold}
                />
              ) : undefined}
              scrollEnabled={scrollEnabled}
              showsVerticalScrollIndicator={false}
            >
              {content}
            </ScrollView>
          ) : (
            content
          )}
        </KeyboardAvoidingView>
        {fixedBottom ? (
          <View
            pointerEvents="box-none"
            style={[
              styles.fixedBottom,
              {
                backgroundColor: backdrop
                  ? 'transparent'
                  : isRuby
                    ? '#060202'
                    : 'transparent',
                paddingBottom: backdrop || !isRuby
                  ? Math.max(insets.bottom, spacing.sm)
                  : insets.bottom,
                paddingHorizontal: backdrop
                  ? spacing.md
                  : isRuby
                    ? 0
                    : spacing.lg,
              },
            ]}
          >
            {fixedBottom}
          </View>
        ) : null}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  keyboard: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
  },
  fixedBottom: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: layers.fixedDock,
  },
  glowTop: {
    position: 'absolute',
    top: -120,
    right: -120,
    width: 270,
    height: 270,
    borderRadius: 135,
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
  },
  glowBottom: {
    position: 'absolute',
    bottom: 10,
    left: -130,
    width: 230,
    height: 230,
    borderRadius: 115,
    backgroundColor: 'rgba(232, 190, 97, 0.10)',
  },
  rubyGlowTop: {
    backgroundColor: 'rgba(150, 18, 31, 0.22)',
  },
  rubyGlowBottom: {
    backgroundColor: 'rgba(216, 168, 78, 0.08)',
  },
});
