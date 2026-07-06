import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { LuxuryButton } from '../components/LuxuryButton';
import { colors, radius, spacing, typography } from '../theme';
import { BattleshipConfirmDialogState } from './BattleshipReleasePolish';
import { labels } from './constants';

type BattleshipConfirmDialogProps = {
  dialog?: BattleshipConfirmDialogState;
  onCancel: () => void;
};

export function BattleshipConfirmDialog({ dialog, onCancel }: BattleshipConfirmDialogProps) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={Boolean(dialog)}
    >
      <View style={styles.scrim} testID="battleship-confirm-dialog">
        <View
          accessibilityRole="alert"
          accessible
          style={styles.dialog}
        >
          <Text style={styles.title}>{dialog?.title}</Text>
          <Text style={styles.message}>{dialog?.message}</Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityHint={labels.confirmCancelHint}
              accessibilityLabel={labels.cancel}
              accessibilityRole="button"
              onPress={onCancel}
              style={styles.cancelButton}
              testID="battleship-confirm-cancel"
            >
              <Text style={styles.cancelText}>{labels.cancel}</Text>
            </Pressable>
            <LuxuryButton
              accessibilityHint={labels.confirmProceedHint}
              onPress={dialog?.onConfirm ?? onCancel}
              title={dialog?.confirmLabel ?? labels.confirmContinue}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  dialog: {
    backgroundColor: colors.background,
    borderColor: colors.borderGold,
    borderRadius: radius.xl,
    borderWidth: 1,
    gap: spacing.md,
    maxWidth: 420,
    padding: spacing.xl,
    width: '100%',
  },
  title: {
    color: colors.goldSoft,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  message: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    lineHeight: 22,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  actions: {
    gap: spacing.sm,
  },
  cancelButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.xl,
  },
  cancelText: {
    color: colors.text,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
