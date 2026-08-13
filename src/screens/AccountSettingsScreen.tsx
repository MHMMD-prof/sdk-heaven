import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { validateAccountDeletionRequest } from '../auth/accountLifecycle';
import { useAuth } from '../auth/AuthProvider';
import { GlassCard } from '../components/GlassCard';
import { LuxuryButton } from '../components/LuxuryButton';
import { LuxuryInput } from '../components/LuxuryInput';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types/navigation';

type AccountSettingsScreenProps = NativeStackScreenProps<RootStackParamList, 'AccountSettings'>;

export function AccountSettingsScreen({ navigation }: AccountSettingsScreenProps) {
  const { requestAccountDeletion, sendPasswordResetForCurrentUser, signOut, user } = useAuth();
  const [deletionReason, setDeletionReason] = useState('');
  const [deletionPassword, setDeletionPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isDeletionRequested, setIsDeletionRequested] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [isRequestingDeletion, setIsRequestingDeletion] = useState(false);

  const deletionValidation = useMemo(
    () => validateAccountDeletionRequest({ reason: deletionReason }),
    [deletionReason],
  );

  const sendReset = async () => {
    setIsSendingReset(true);
    setMessage('');

    try {
      await sendPasswordResetForCurrentUser();
      setMessage('تم إرسال رابط تغيير كلمة المرور إلى بريدك.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر إرسال رابط تغيير كلمة المرور.');
    } finally {
      setIsSendingReset(false);
    }
  };

  const requestDeletion = async () => {
    if (!deletionValidation.ok) {
      setMessage(deletionValidation.message);
      return;
    }

    setIsRequestingDeletion(true);
    setMessage('');

    try {
      await requestAccountDeletion(deletionValidation.value, deletionPassword);
      setIsDeletionRequested(true);
      setMessage('تم إيقاف الحساب. يمكنك استرجاعه خلال 30 يوماً قبل الحذف النهائي.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر إرسال طلب حذف الحساب.');
    } finally {
      setIsRequestingDeletion(false);
    }
  };

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Pressable onPress={navigation.goBack} style={styles.backButton}>
          <Text style={styles.backText}>رجوع</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>الحساب</Text>
          <Text style={styles.title}>إعدادات الحساب</Text>
        </View>
      </View>

      <GlassCard style={styles.card}>
        <Text style={styles.sectionTitle}>الأمان</Text>
        <Text style={styles.bodyText}>{user?.email ?? 'لا يوجد بريد مسجل'}</Text>
        <LuxuryButton
          loading={isSendingReset}
          onPress={() => {
            void sendReset();
          }}
          title="إرسال رابط تغيير كلمة المرور"
        />
        <LuxuryButton
          onPress={() => navigation.navigate('BlockedUsers')}
          title="المستخدمون المحظورون"
        />
      </GlassCard>

      <GlassCard style={styles.card}>
        <Text style={styles.sectionTitle}>القانون والمساعدة</Text>
        <LegalRow label="سياسة الخصوصية" url={process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL} />
        <LegalRow label="الشروط والأحكام" url={process.env.EXPO_PUBLIC_TERMS_URL} />
        <LegalRow label="إرشادات المجتمع" url={process.env.EXPO_PUBLIC_COMMUNITY_GUIDELINES_URL} />
        <LegalRow label="الدعم" url={process.env.EXPO_PUBLIC_SUPPORT_URL} />
      </GlassCard>

      {__DEV__ ? (
        <GlassCard style={styles.card}>
          <Text style={styles.sectionTitle}>Cosmetics Wave 0 Lab</Text>
          <Text style={styles.bodyText}>
            Development-only native renderer, caching, audio-mixing, and lifecycle checks.
          </Text>
          <LuxuryButton
            onPress={() => navigation.navigate('CosmeticsLab')}
            title="Open cosmetics lab"
          />
        </GlassCard>
      ) : null}

      <GlassCard style={[styles.card, styles.dangerCard]}>
        <Text style={styles.sectionTitle}>حذف الحساب</Text>
        <Text style={styles.bodyText}>
          سيُوقف الحساب ويُخفى ملفك العام فوراً. يمكنك استرجاع الحساب خلال 30 يوماً، ثم تُحذف البيانات المؤهلة وتُزال هويتك من السجلات التي يلزم الاحتفاظ بها.
        </Text>
        <LuxuryInput
          label="سبب اختياري"
          multiline
          onChangeText={setDeletionReason}
          placeholder="اكتب السبب إن رغبت"
          value={deletionReason}
        />
        <LuxuryInput
          label="كلمة المرور للتأكيد"
          onChangeText={setDeletionPassword}
          secureTextEntry
          value={deletionPassword}
        />
        <LuxuryButton
          disabled={isDeletionRequested || !deletionValidation.ok || !deletionPassword}
          loading={isRequestingDeletion}
          onPress={() => {
            void requestDeletion();
          }}
          title={isDeletionRequested ? 'تم إرسال الطلب' : 'طلب حذف الحساب'}
        />
      </GlassCard>

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <Text
        onPress={() => {
          void signOut();
        }}
        style={styles.signOut}
      >
        تسجيل الخروج
      </Text>
    </ScreenContainer>
  );
}

function LegalRow({ label, url }: { label: string; url?: string }) {
  if (!url) return null;
  return (
    <Pressable
      accessibilityHint="يفتح الرابط في المتصفح"
      accessibilityRole="link"
      onPress={() => void Linking.openURL(url)}
      style={styles.legalRow}
    >
      <Text style={styles.legalArrow}>‹</Text>
      <Text style={styles.legalLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  backText: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    lineHeight: 38,
    writingDirection: 'rtl',
  },
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    color: colors.gold,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.bold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  title: {
    color: colors.text,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  card: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  dangerCard: {
    borderColor: 'rgba(184, 41, 75, 0.42)',
  },
  legalRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  legalLabel: {
    color: colors.text,
    flex: 1,
    fontSize: typography.sizes.body,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  legalArrow: { color: colors.gold, fontSize: 28 },
  sectionTitle: {
    color: colors.goldSoft,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.black,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  bodyText: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    lineHeight: 22,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  message: {
    color: colors.gold,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    marginBottom: spacing.md,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  signOut: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    marginBottom: spacing.xl,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
