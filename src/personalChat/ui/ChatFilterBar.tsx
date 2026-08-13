import { I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ChatInboxFilter } from './buildInboxSections';
import { chatColors } from './chatTheme';

export function ChatFilterBar({ labels, onChange, value }: {
  labels: Record<ChatInboxFilter, string>;
  onChange: (value: ChatInboxFilter) => void;
  value: ChatInboxFilter;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.root}>
      {(['all', 'unread', 'requests'] as const).map((filter) => {
        const selected = filter === value;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={filter}
            onPress={() => onChange(filter)}
            style={({ pressed }) => [styles.item, selected && styles.selected, pressed && styles.pressed]}
          >
            <Text maxFontSizeMultiplier={2} numberOfLines={1} style={[styles.label, selected && styles.selectedLabel]}>{labels[filter]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  item: { alignItems: 'center', borderRadius: 18, flex: 1, minHeight: 36, justifyContent: 'center', paddingHorizontal: 6 },
  label: { color: chatColors.textSecondary, fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.78 },
  root: { flexDirection: I18nManager.isRTL ? 'row-reverse' : 'row', gap: 8 },
  selected: { backgroundColor: chatColors.royalRed, borderColor: 'rgba(245,217,147,0.55)', borderWidth: 1 },
  selectedLabel: { color: chatColors.textPrimary },
});
