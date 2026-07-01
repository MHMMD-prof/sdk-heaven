import { LinearGradient } from 'expo-linear-gradient';
import { PropsWithChildren, ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '../theme';

type ScreenContainerProps = PropsWithChildren<{
  bottomInset?: boolean;
  fixedBottom?: ReactNode;
  horizontalPadding?: number;
  topPadding?: number;
  scroll?: boolean;
  scrollEnabled?: boolean;
}>;

export function ScreenContainer({
  bottomInset = false,
  children,
  fixedBottom,
  horizontalPadding = spacing.lg,
  scroll = true,
  scrollEnabled = true,
  topPadding,
}: ScreenContainerProps) {
  const insets = useSafeAreaInsets();

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
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />
      {children}
    </View>
  );

  return (
    <LinearGradient
      colors={[colors.backgroundDeep, colors.background, '#150A25', colors.backgroundDeep]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={styles.gradient}
    >
      <View style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboard}
        >
          {scroll ? (
            <ScrollView
              contentContainerStyle={styles.scrollContent}
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
              { paddingBottom: Math.max(insets.bottom, spacing.sm) },
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
    paddingHorizontal: spacing.lg,
    position: 'absolute',
    right: 0,
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
});
