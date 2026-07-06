import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getAuthErrorMessage } from '../auth/authErrors';
import { useAuth } from '../auth/AuthProvider';
import { GlassCard } from '../components/GlassCard';
import { LuxuryButton } from '../components/LuxuryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';

type VerificationAction = 'refresh' | 'resend' | 'sign-out';

export function EmailVerificationScreen() {
  const { refreshUser, sendVerificationEmail, signOut, user } = useAuth();
  const [activeAction, setActiveAction] = useState<VerificationAction | null>(null);
  const [message, setMessage] = useState('أرسلنا رابط التحقق إلى بريدك الإلكتروني.');
  const [errorMessage, setErrorMessage] = useState('');

  const runAction = async (action: VerificationAction) => {
    setActiveAction(action);
    setErrorMessage('');

    try {
      if (action === 'refresh') {
        await refreshUser();
        setMessage('تم التحقق من الحالة. افتح رابط البريد ثم اضغط تحديث.');
      } else if (action === 'resend') {
        await sendVerificationEmail();
        setMessage('تم إرسال رابط تحقق جديد.');
      } else {
        await signOut();
      }
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error));
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <ScreenContainer>
      <View style={styles.hero}>
        <View style={styles.mailMark}>
          <Text style={styles.mailIcon}>@</Text>
        </View>
        <Text style={styles.title}>تحقق من بريدك</Text>
        <Text style={styles.subtitle}>
          يجب تأكيد البريد الإلكتروني قبل الدخول إلى سكاي رويال.
        </Text>
      </View>

      <GlassCard style={styles.card}>
        <Text style={styles.email}>{user?.email ?? 'حسابك الحالي'}</Text>
        <Text style={styles.message}>{message}</Text>
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        <LuxuryButton
          loading={activeAction === 'refresh'}
          onPress={() => {
            void runAction('refresh');
          }}
          title="تحديث الحالة"
        />
        <View style={styles.linkRow}>
          <Pressable
            disabled={activeAction !== null}
            onPress={() => {
              void runAction('resend');
            }}
          >
            <Text style={styles.link}>إعادة إرسال الرابط</Text>
          </Pressable>
          <Pressable
            disabled={activeAction !== null}
            onPress={() => {
              void runAction('sign-out');
            }}
          >
            <Text style={styles.link}>تسجيل الخروج</Text>
          </Pressable>
        </View>
      </GlassCard>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 330,
    paddingTop: spacing.xxl,
  },
  mailMark: {
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
  mailIcon: {
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
  email: {
    color: colors.goldSoft,
    fontSize: typography.sizes.bodyLarge,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
  },
  message: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    lineHeight: 23,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  error: {
    color: colors.ruby,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  linkRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  link: {
    color: colors.gold,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    writingDirection: 'rtl',
  },
});
