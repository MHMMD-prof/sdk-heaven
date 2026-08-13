import { I18nManager, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ChatIcon } from './ChatIcon';
import { chatColors, chatMetrics } from './chatTheme';

export function ChatSearchField({ accessibilityLabel, clearAccessibilityLabel = 'Clear search', onChangeText, onClear, placeholder, value }: {
  accessibilityLabel: string;
  clearAccessibilityLabel?: string;
  onChangeText: (value: string) => void;
  onClear?: () => void;
  placeholder: string;
  value: string;
}) {
  return (
    <View style={styles.root}>
      <ChatIcon color={chatColors.gold} name="search" size={19} />
      <TextInput
        accessibilityLabel={accessibilityLabel}
        maxFontSizeMultiplier={2}
        maxLength={64}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={chatColors.textTertiary}
        returnKeyType="search"
        style={styles.input}
        value={value}
      />
      {value && onClear ? (
        <Pressable accessibilityLabel={clearAccessibilityLabel} accessibilityRole="button" onPress={onClear} style={styles.clear}>
          <ChatIcon color={chatColors.textSecondary} name="close" size={17} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  clear: { alignItems: 'center', height: chatMetrics.controlMinHeight, justifyContent: 'center', width: chatMetrics.controlMinHeight },
  input: {
    color: chatColors.textPrimary,
    flex: 1,
    fontSize: 15,
    minHeight: chatMetrics.controlMinHeight,
    paddingVertical: 0,
    textAlign: I18nManager.isRTL ? 'right' : 'left',
    writingDirection: I18nManager.isRTL ? 'rtl' : 'ltr',
  },
  root: {
    alignItems: 'center',
    backgroundColor: chatColors.surface,
    borderColor: chatColors.divider,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row',
    minHeight: chatMetrics.controlMinHeight,
    paddingHorizontal: 12,
  },
});
