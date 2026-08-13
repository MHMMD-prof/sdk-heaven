import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { chatColors, chatMetrics } from './chatTheme';

export type ChatMessageAction = {
  danger?: boolean;
  disabled?: boolean;
  id: 'copy' | 'reply' | 'report' | 'retry' | 'unsend';
  label: string;
  onPress: () => void;
};

export function ChatMessageActionSheet({
  actions,
  cancelLabel,
  onClose,
  open,
  title,
}: {
  actions: ChatMessageAction[];
  cancelLabel: string;
  onClose: () => void;
  open: boolean;
  title: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={open}>
      <View accessibilityViewIsModal style={styles.stage}>
        <Pressable accessibilityLabel={cancelLabel} onPress={onClose} style={styles.scrim} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.handle} />
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          {actions.map((action) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: action.disabled }}
              disabled={action.disabled}
              key={action.id}
              onPress={() => {
                onClose();
                action.onPress();
              }}
              style={({ pressed }) => [styles.action, action.disabled && styles.disabled, pressed && styles.pressed]}
            >
              <Text style={[styles.actionText, action.danger && styles.danger]}>{action.label}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
            <Text style={styles.cancelText}>{cancelLabel}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  action: { borderBottomColor: chatColors.divider, borderBottomWidth: 1, justifyContent: 'center', minHeight: 52, paddingHorizontal: 20 },
  actionText: { color: chatColors.textPrimary, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  cancel: { alignItems: 'center', borderColor: chatColors.divider, borderRadius: 14, borderWidth: 1, justifyContent: 'center', marginHorizontal: 16, marginTop: 12, minHeight: chatMetrics.controlMinHeight },
  cancelText: { color: chatColors.goldBright, fontSize: 15, fontWeight: '700' },
  danger: { color: chatColors.danger },
  disabled: { opacity: 0.35 },
  handle: { alignSelf: 'center', backgroundColor: chatColors.gold, borderRadius: 2, height: 3, marginBottom: 10, opacity: 0.72, width: 42 },
  pressed: { backgroundColor: chatColors.surfacePressed },
  scrim: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  sheet: { backgroundColor: chatColors.canvasRaised, borderColor: chatColors.divider, borderTopLeftRadius: chatMetrics.sheetTopRadius, borderTopRightRadius: chatMetrics.sheetTopRadius, borderWidth: 1, overflow: 'hidden', paddingTop: 10 },
  stage: { backgroundColor: chatColors.scrim, flex: 1, justifyContent: 'flex-end' },
  title: { color: chatColors.goldBright, fontSize: 14, fontWeight: '800', paddingBottom: 10, paddingHorizontal: 20, textAlign: 'center' },
});
