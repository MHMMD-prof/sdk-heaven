import { I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';

import { ChatIcon } from './ChatIcon';
import { chatColors, chatMetrics } from './chatTheme';

export function ChatRequestSummary({ count, label, onPress, reviewLabel }: {
  count: number;
  label: string;
  onPress: () => void;
  reviewLabel: string;
}) {
  if (count <= 0) return null;
  return (
    <Pressable
      accessibilityLabel={`${label}, ${count}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.root, pressed && styles.pressed]}
    >
      <View style={styles.icon}><ChatIcon color={chatColors.gold} name="message" size={21} /></View>
      <View style={styles.copy}>
        <Text maxFontSizeMultiplier={2} numberOfLines={1} style={styles.label}>{label}</Text>
        <Text maxFontSizeMultiplier={2} numberOfLines={1} style={styles.review}>{reviewLabel}</Text>
      </View>
      <View style={styles.count}><Text style={styles.countText}>{count > 99 ? '99+' : count}</Text></View>
      <ChatIcon color={chatColors.gold} name="chevron" size={17} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  copy: { flex: 1, minWidth: 0 },
  count: { alignItems: 'center', backgroundColor: chatColors.royalRedBright, borderRadius: 13, justifyContent: 'center', minHeight: 26, minWidth: 26, paddingHorizontal: 7 },
  countText: { color: chatColors.textPrimary, fontSize: 12, fontWeight: '800' },
  icon: { alignItems: 'center', backgroundColor: chatColors.surface, borderColor: chatColors.divider, borderRadius: 19, borderWidth: 1, height: 38, justifyContent: 'center', width: 38 },
  label: { color: chatColors.textPrimary, fontSize: 15, fontWeight: '800', textAlign: I18nManager.isRTL ? 'right' : 'left' },
  pressed: { backgroundColor: chatColors.surfacePressed, transform: [{ scale: 0.99 }] },
  review: { color: chatColors.textSecondary, fontSize: 12, marginTop: 2, textAlign: I18nManager.isRTL ? 'right' : 'left' },
  root: { alignItems: 'center', backgroundColor: chatColors.royalRedSoft, borderColor: 'rgba(224,185,103,0.34)', borderRadius: 14, borderWidth: 1, flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row', gap: 10, marginHorizontal: chatMetrics.gutter, marginVertical: 8, minHeight: 66, paddingHorizontal: 12, paddingVertical: 10 },
});
