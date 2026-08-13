import { I18nManager, Pressable, StyleSheet, Text, View } from 'react-native';

import { chatColors, chatMetrics } from './chatTheme';

const ar = I18nManager.isRTL;

export function ChatRequestDecisionCard({
  acceptLabel,
  blockLabel,
  body,
  busy,
  onAccept,
  onBlock,
  onReject,
  onReport,
  rejectLabel,
  reportLabel,
  title,
}: {
  acceptLabel: string;
  blockLabel: string;
  body: string;
  busy: boolean;
  onAccept: () => void;
  onBlock: () => void;
  onReject: () => void;
  onReport: () => void;
  rejectLabel: string;
  reportLabel: string;
  title: string;
}) {
  return (
    <View accessibilityRole="summary" style={styles.card}>
      <View style={styles.rail} />
      <View style={styles.copy}>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
      </View>
      <Pressable accessibilityRole="button" disabled={busy} onPress={onAccept} style={({ pressed }) => [styles.accept, busy && styles.disabled, pressed && styles.pressed]}>
        <Text style={styles.acceptText}>{acceptLabel}</Text>
      </Pressable>
      <View style={styles.secondary}>
        <SecondaryAction disabled={busy} label={rejectLabel} onPress={onReject} />
        <SecondaryAction disabled={busy} label={reportLabel} onPress={onReport} />
        <SecondaryAction danger disabled={busy} label={blockLabel} onPress={onBlock} />
      </View>
    </View>
  );
}

function SecondaryAction({ danger, disabled, label, onPress }: { danger?: boolean; disabled: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.secondaryAction, disabled && styles.disabled, pressed && styles.pressed]}><Text style={[styles.secondaryText, danger && styles.danger]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  accept: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: chatColors.gold, borderRadius: 15, justifyContent: 'center', minHeight: chatMetrics.controlMinHeight, paddingHorizontal: 18 },
  acceptText: { color: chatColors.goldForeground, fontSize: 14, fontWeight: '900' },
  body: { color: chatColors.textSecondary, fontSize: 12, lineHeight: 18, textAlign: ar ? 'right' : 'left' },
  card: { alignItems: 'stretch', alignSelf: 'center', backgroundColor: chatColors.surface, borderBottomColor: chatColors.divider, borderBottomWidth: 1, gap: 9, maxWidth: 760, paddingHorizontal: 12, paddingVertical: 10, position: 'relative', width: '100%' },
  copy: { flex: 1, gap: 2 },
  danger: { color: chatColors.danger },
  disabled: { opacity: 0.38 },
  pressed: { opacity: 0.76 },
  rail: { backgroundColor: chatColors.royalRedBright, bottom: 10, position: 'absolute', start: 0, top: 10, width: 3 },
  secondary: { alignItems: 'center', flexDirection: ar ? 'row-reverse' : 'row', gap: 3, justifyContent: 'space-around' },
  secondaryAction: { alignItems: 'center', flex: 1, justifyContent: 'center', minHeight: chatMetrics.controlMinHeight, paddingHorizontal: 7 },
  secondaryText: { color: chatColors.textSecondary, fontSize: 11, fontWeight: '700' },
  title: { color: chatColors.textPrimary, fontSize: 14, fontWeight: '900', textAlign: ar ? 'right' : 'left' },
});
