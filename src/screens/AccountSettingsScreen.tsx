import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { validateAccountDeletionRequest } from '../auth/accountLifecycle';
import { useAuth } from '../auth/AuthProvider';
import { validateProfileInput } from '../auth/profile';
import { GlassCard } from '../components/GlassCard';
import { LuxuryButton } from '../components/LuxuryButton';
import { LuxuryInput } from '../components/LuxuryInput';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types/navigation';

type AccountSettingsScreenProps = NativeStackScreenProps<RootStackParamList, 'AccountSettings'>;

export function AccountSettingsScreen({ navigation }: AccountSettingsScreenProps) {
  const { profile, requestAccountDeletion, saveProfile, sendPasswordResetForCurrentUser, signOut, user } = useAuth();
  const [avatarLabel, setAvatarLabel] = useState(profile?.avatarLabel ?? deriveAvatarLabel(user?.email));
  const [deletionReason, setDeletionReason] = useState('');
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [message, setMessage] = useState('');
  const [isDeletionRequested, setIsDeletionRequested] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSendingReset, setIsSendingReset] = useState(false);
  const [isRequestingDeletion, setIsRequestingDeletion] = useState(false);

  const profileValidation = useMemo(
    () => validateProfileInput({ avatarLabel, displayName }),
    [avatarLabel, displayName],
  );
  const deletionValidation = useMemo(
    () => validateAccountDeletionRequest({ reason: deletionReason }),
    [deletionReason],
  );

  const saveProfileChanges = async () => {
    if (!profileValidation.ok) {
      setMessage(profileValidation.message);
      return;
    }

    setIsSavingProfile(true);
    setMessage('');

    try {
      await saveProfile(profileValidation.value);
      setMessage('تم تحديث الملف الشخصي.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر تحديث الملف الشخصي.');
    } finally {
      setIsSavingProfile(false);
    }
  };

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
      await requestAccountDeletion(deletionValidation.value);
      setIsDeletionRequested(true);
      setMessage('تم إرسال طلب حذف الحساب. لن يتم حذف الحساب فورا حتى تتم مراجعته.');
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
        <Text style={styles.sectionTitle}>الملف الشخصي</Text>
        <LuxuryInput
          autoCapitalize="words"
          label="اسم العرض"
          onChangeText={setDisplayName}
          value={displayName}
        />
        <LuxuryInput
          label="رمز الصورة"
          maxLength={2}
          onChangeText={setAvatarLabel}
          value={avatarLabel}
        />
        <LuxuryButton
          disabled={!profileValidation.ok}
          loading={isSavingProfile}
          onPress={() => {
            void saveProfileChanges();
          }}
          title="حفظ التغييرات"
        />
      </GlassCard>

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
          يرسل هذا طلبا للمراجعة ولا يحذف الحساب فورا. قد نحتاج إلى تأكيد هويتك قبل الإجراء النهائي.
        </Text>
        <LuxuryInput
          label="سبب اختياري"
          multiline
          onChangeText={setDeletionReason}
          placeholder="اكتب السبب إن رغبت"
          value={deletionReason}
        />
        <LuxuryButton
          disabled={isDeletionRequested || !deletionValidation.ok}
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

function deriveAvatarLabel(email?: string | null) {
  const source = email?.trim() || 'أ';
  return [...source][0] ?? 'أ';
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
