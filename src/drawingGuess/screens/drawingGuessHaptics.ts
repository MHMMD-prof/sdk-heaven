export type DrawingGuessHapticKind = 'selection' | 'success' | 'warning' | 'error';

type HapticsImporter = () => Promise<{
  selectionAsync: () => Promise<void>;
  notificationAsync: (type?: never) => Promise<void>;
}>;

const hapticByKind = {
  success: 'success',
  warning: 'warning',
  error: 'error',
} as const;

export const triggerDrawingGuessHaptic = async (
  kind: DrawingGuessHapticKind,
  hapticsImporter: HapticsImporter = () => import('expo-haptics'),
) => {
  try {
    const hapticsModule = await hapticsImporter();

    if (kind === 'selection') {
      await hapticsModule.selectionAsync();
      return;
    }

    await hapticsModule.notificationAsync(hapticByKind[kind] as never);
  } catch {
    // Haptics are best-effort; gameplay must never depend on device feedback.
  }
};
