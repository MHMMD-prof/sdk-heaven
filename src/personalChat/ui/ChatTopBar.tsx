import type { ReactNode, Ref } from 'react';
import { I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';

import { ChatIcon, type ChatIconName } from './ChatIcon';
import { chatColors, chatMetrics, chatTypography } from './chatTheme';

export function ChatTopBar({
  actionLabel,
  actionIcon = 'compose',
  actionDisabled = false,
  actionRef,
  count = 0,
  leading,
  onAction,
  subtitle,
  title,
}: {
  actionIcon?: ChatIconName;
  actionDisabled?: boolean;
  actionLabel?: string;
  actionRef?: Ref<View>;
  count?: number;
  leading?: ReactNode;
  onAction?: () => void;
  subtitle?: string;
  title: string;
}) {
  return (
    <View style={styles.root}>
      <View style={styles.royalRail} />
      {leading}
      <View style={styles.copy}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={2} numberOfLines={1} style={styles.title}>{title}</Text>
        {subtitle ? <Text maxFontSizeMultiplier={2} numberOfLines={1} style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {count > 0 ? <View accessibilityLabel={`${count}`} style={styles.count}><Text style={styles.countText}>{count > 99 ? '99+' : count}</Text></View> : null}
      {onAction && actionLabel ? (
        <Pressable
          accessibilityLabel={actionLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled: actionDisabled }}
          disabled={actionDisabled}
          onPress={onAction}
          ref={actionRef}
          style={({ pressed }) => [styles.action, actionDisabled && styles.disabled, pressed && styles.pressed]}
        >
          <ChatIcon color={chatColors.goldForeground} name={actionIcon} size={20} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    backgroundColor: chatColors.gold,
    borderRadius: 22,
    height: chatMetrics.controlMinHeight,
    justifyContent: 'center',
    width: chatMetrics.controlMinHeight,
  },
  copy: { flex: 1 },
  count: {
    alignItems: 'center',
    backgroundColor: chatColors.royalRed,
    borderColor: 'rgba(224,185,103,0.45)',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 26,
    minWidth: 26,
    paddingHorizontal: 7,
  },
  countText: { color: chatColors.textPrimary, fontSize: 12, fontWeight: '700' },
  disabled: { opacity: 0.38 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.97 }] },
  root: {
    alignItems: 'center',
    backgroundColor: chatColors.canvasRaised,
    borderBottomColor: chatColors.divider,
    borderBottomWidth: 1,
    flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
    gap: 8,
    minHeight: chatMetrics.topBarContentHeight,
    paddingHorizontal: 12,
    position: 'relative',
  },
  royalRail: {
    alignSelf: 'center',
    backgroundColor: chatColors.gold,
    bottom: -1,
    height: 2,
    opacity: 0.72,
    position: 'absolute',
    width: '42%',
  },
  subtitle: { color: chatColors.textSecondary, fontSize: 12, textAlign: I18nManager.isRTL ? 'right' : 'left' },
  title: { ...chatTypography.title, color: chatColors.textPrimary, textAlign: I18nManager.isRTL ? 'right' : 'left' },
});
