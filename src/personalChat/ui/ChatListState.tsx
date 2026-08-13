import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ChatIcon, type ChatIconName } from './ChatIcon';
import { chatColors, chatMetrics, chatTypography } from './chatTheme';

export function ChatListState({ actionLabel, body, icon = 'message', loading = false, onAction, title }: {
  actionLabel?: string;
  body?: string;
  icon?: ChatIconName;
  loading?: boolean;
  onAction?: () => void;
  title?: string;
}) {
  return (
    <View style={styles.root}>
      {loading ? <ActivityIndicator color={chatColors.gold} size="large" /> : <View style={styles.icon}><ChatIcon color={chatColors.gold} name={icon} size={28} /></View>}
      {title ? <Text accessibilityRole="header" maxFontSizeMultiplier={2} style={styles.title}>{title}</Text> : null}
      {body ? <Text maxFontSizeMultiplier={2} style={styles.body}>{body}</Text> : null}
      {actionLabel && onAction ? <Pressable accessibilityRole="button" onPress={onAction} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><Text style={styles.actionText}>{actionLabel}</Text></Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: 'center', backgroundColor: chatColors.gold, borderRadius: 18, justifyContent: 'center', marginTop: 8, minHeight: chatMetrics.controlMinHeight, paddingHorizontal: 18 },
  actionText: { color: chatColors.goldForeground, fontWeight: '800' },
  body: { color: chatColors.textSecondary, maxWidth: 320, textAlign: 'center' },
  icon: { alignItems: 'center', backgroundColor: chatColors.royalRedSoft, borderColor: 'rgba(224,185,103,0.42)', borderRadius: 22, borderWidth: 1, height: 64, justifyContent: 'center', width: 64 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
  root: { alignItems: 'center', gap: 10, justifyContent: 'center', padding: 24 },
  title: { ...chatTypography.title, color: chatColors.textPrimary, textAlign: 'center' },
});
