import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { validateProfileInput } from '../auth/profile';
import { GlassCard } from '../components/GlassCard';
import { LuxuryButton } from '../components/LuxuryButton';
import { LuxuryInput } from '../components/LuxuryInput';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';

export function ProfileSetupScreen() {
  const { profile, saveProfile, signOut, user } = useAuth();
  const [avatarLabel, setAvatarLabel] = useState(profile?.avatarLabel ?? deriveAvatarLabel(user?.email));
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const validation = useMemo(
    () => validateProfileInput({ avatarLabel, displayName }),
    [avatarLabel, displayName],
  );

  const submitProfile = async () => {
    if (!validation.ok) {
      setErrorMessage(validation.message);
      return;
    }

    setErrorMessage('');
    setIsSaving(true);

    try {
      await saveProfile(validation.value);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'تعذر حفظ الملف الشخصي.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ScreenContainer>
      <View style={styles.hero}>
        <View style={styles.avatarPreview}>
          <Text style={styles.avatarPreviewText}>{avatarLabel.trim() || '?'}</Text>
        </View>
        <Text style={styles.title}>أكمل ملفك</Text>
        <Text style={styles.subtitle}>اختر اسما ورمزا يظهران في الألعاب والمجالس.</Text>
      </View>

      <GlassCard style={styles.card}>
        <LuxuryInput
          autoCapitalize="words"
          label="اسم العرض"
          onChangeText={setDisplayName}
          placeholder="مثال: سالم"
          value={displayName}
        />
        <LuxuryInput
          label="رمز الصورة"
          maxLength={2}
          onChangeText={setAvatarLabel}
          placeholder="مثال: س"
          value={avatarLabel}
        />
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
        <LuxuryButton
          disabled={!validation.ok}
          loading={isSaving}
          onPress={() => {
            void submitProfile();
          }}
          title="حفظ الملف"
        />
        <Text
          onPress={() => {
            void signOut();
          }}
          style={styles.signOut}
        >
          تسجيل الخروج
        </Text>
      </GlassCard>
    </ScreenContainer>
  );
}

function deriveAvatarLabel(email?: string | null) {
  const source = email?.trim() || 'أ';
  return [...source][0] ?? 'أ';
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 330,
    paddingTop: spacing.xxl,
  },
  avatarPreview: {
    alignItems: 'center',
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.borderGold,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 92,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    width: 92,
  },
  avatarPreviewText: {
    color: colors.goldSoft,
    fontSize: 42,
    fontWeight: typography.weights.black,
  },
  title: {
    color: colors.gold,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    lineHeight: 24,
    marginTop: spacing.md,
    maxWidth: 330,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  card: {
    gap: spacing.lg,
    marginBottom: spacing.xl,
  },
  error: {
    color: colors.ruby,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  signOut: {
    color: colors.gold,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
});
