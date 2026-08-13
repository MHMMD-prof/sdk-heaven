import * as Haptics from 'expo-haptics';

export function triggerChatSelectionFeedback(enabled = true) {
  if (!enabled) return;
  void Haptics.selectionAsync().catch(() => undefined);
}

export function triggerChatSuccessFeedback(enabled = true) {
  if (!enabled) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

export function triggerChatWarningFeedback(enabled = true) {
  if (!enabled) return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
}
