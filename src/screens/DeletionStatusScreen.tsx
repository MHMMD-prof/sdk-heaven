import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { GlassCard } from '../components/GlassCard';
import { LuxuryButton } from '../components/LuxuryButton';
import { LuxuryInput } from '../components/LuxuryInput';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, spacing, typography } from '../theme';

export function DeletionStatusScreen() {
  const { cancelAccountDeletion, deletionStatus, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const purgeDate = deletionStatus?.purgeAfterMillis
    ? new Date(deletionStatus.purgeAfterMillis).toLocaleDateString('ar')
    : '';

  const cancel = async () => {
    setBusy(true);
    setMessage('');
    try {
      await cancelAccountDeletion(password);
      setMessage('تم استرجاع الحساب بنجاح.');
    } catch {
      setMessage('تعذر استرجاع الحساب. تحقق من كلمة المرور وحاول مجدداً.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenContainer variant="ruby">
      <View style={styles.center}>
        <Text accessibilityRole="header" style={styles.title}>الحساب بانتظار الحذف</Text>
        <GlassCard style={styles.card}>
          <Text style={styles.body}>
            تم إيقاف الحساب وإخفاء ملفك العام. يمكنك استرجاعه قبل {purgeDate || 'موعد الحذف النهائي'}.
          </Text>
          {deletionStatus?.canCancel !== false ? (
            <>
              <LuxuryInput
                label="كلمة المرور للتأكيد"
                onChangeText={setPassword}
                secureTextEntry
                value={password}
              />
              <LuxuryButton disabled={!password} loading={busy} onPress={() => void cancel()} title="استرجاع الحساب" />
            </>
          ) : null}
          <LuxuryButton onPress={() => void signOut()} title="تسجيل الخروج" />
          {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
        </GlassCard>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', gap: spacing.lg },
  card: { gap: spacing.md },
  title: { color: colors.gold, fontSize: typography.sizes.title, fontWeight: typography.weights.black, textAlign: 'center' },
  body: { color: colors.text, fontSize: typography.sizes.body, lineHeight: 24, textAlign: 'right', writingDirection: 'rtl' },
  message: { color: colors.goldSoft, textAlign: 'center', writingDirection: 'rtl' },
});
