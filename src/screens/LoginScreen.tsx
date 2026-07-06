import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getAuthErrorMessage } from '../auth/authErrors';
import { useAuth } from '../auth/AuthProvider';
import { GlassCard } from '../components/GlassCard';
import { LuxuryButton } from '../components/LuxuryButton';
import { LuxuryInput } from '../components/LuxuryInput';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types/navigation';

type LoginScreenProps = NativeStackScreenProps<RootStackParamList, 'Login'>;
type AuthMode = 'sign-in' | 'sign-up';
type AuthAction = AuthMode | 'reset-password';

export function LoginScreen({ navigation: _navigation }: LoginScreenProps) {
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [activeAction, setActiveAction] = useState<AuthAction | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const { sendPasswordReset, signIn, signUp } = useAuth();

  const email = identifier.trim();
  const isSignUp = mode === 'sign-up';
  const submitTitle = isSignUp ? 'إنشاء الحساب' : 'تسجيل الدخول';
  const introText = useMemo(
    () =>
      isSignUp
        ? 'أنشئ حسابك ثم أكد بريدك الإلكتروني قبل الدخول.'
        : 'سجل دخولك للمتابعة إلى سكاي رويال.',
    [isSignUp],
  );

  const setAuthMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setErrorMessage('');
    setSuccessMessage('');
  };

  const submitAuth = async () => {
    if (!email || !password) {
      setErrorMessage('أدخل البريد الإلكتروني وكلمة المرور.');
      return;
    }

    setErrorMessage('');
    setSuccessMessage('');
    setActiveAction(mode);

    try {
      if (isSignUp) {
        await signUp(email, password);
        setSuccessMessage('تم إنشاء الحساب. تحقق من بريدك الإلكتروني.');
      } else {
        await signIn(email, password);
      }
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error));
    } finally {
      setActiveAction(null);
    }
  };

  const resetPassword = async () => {
    if (!email) {
      setErrorMessage('أدخل بريدك الإلكتروني لإرسال رابط الاستعادة.');
      return;
    }

    setErrorMessage('');
    setSuccessMessage('');
    setActiveAction('reset-password');

    try {
      await sendPasswordReset(email);
      setSuccessMessage('تم إرسال رابط استعادة كلمة المرور.');
    } catch (error) {
      setErrorMessage(getAuthErrorMessage(error));
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <ScreenContainer>
      <View style={styles.hero}>
        <View style={styles.logoMark}>
          <Text style={styles.logoSymbol}>♕</Text>
        </View>
        <Text style={styles.brand}>سكاي رويال</Text>
        <Text style={styles.headline}>ادخل إلى عالم فاخر من اللعب الاجتماعي</Text>
        <Text style={styles.subtitle}>{introText}</Text>
      </View>

      <GlassCard style={styles.formCard}>
        <View style={styles.modeSwitch}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setAuthMode('sign-in')}
            style={[styles.modeOption, !isSignUp && styles.modeOptionActive]}
          >
            <Text style={[styles.modeText, !isSignUp && styles.modeTextActive]}>دخول</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setAuthMode('sign-up')}
            style={[styles.modeOption, isSignUp && styles.modeOptionActive]}
          >
            <Text style={[styles.modeText, isSignUp && styles.modeTextActive]}>حساب جديد</Text>
          </Pressable>
        </View>

        <LuxuryInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          label="البريد الإلكتروني"
          onChangeText={setIdentifier}
          placeholder="مثال: name@example.com"
          textContentType="username"
          value={identifier}
        />
        <LuxuryInput
          autoComplete={isSignUp ? 'new-password' : 'password'}
          label="كلمة المرور"
          onChangeText={setPassword}
          placeholder="أدخل كلمة المرور"
          secureTextEntry
          textContentType={isSignUp ? 'newPassword' : 'password'}
          value={password}
        />
        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
        {successMessage ? <Text style={styles.success}>{successMessage}</Text> : null}

        <LuxuryButton
          disabled={!email || !password}
          loading={activeAction === mode}
          onPress={() => {
            void submitAuth();
          }}
          style={styles.loginButton}
          title={submitTitle}
        />

        <View style={styles.secondaryRow}>
          <Pressable
            disabled={activeAction !== null}
            onPress={() => {
              void resetPassword();
            }}
          >
            <Text style={styles.link}>نسيت كلمة المرور؟</Text>
          </Pressable>
          <Pressable
            disabled={activeAction !== null}
            onPress={() => setAuthMode(isSignUp ? 'sign-in' : 'sign-up')}
          >
            <Text style={styles.link}>{isSignUp ? 'لديك حساب؟' : 'إنشاء حساب'}</Text>
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
  logoMark: {
    alignItems: 'center',
    backgroundColor: colors.surfaceStrong,
    borderColor: colors.borderGold,
    borderRadius: radius.full,
    borderWidth: 1,
    height: 92,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.24,
    shadowRadius: 24,
    width: 92,
  },
  logoSymbol: {
    color: colors.goldSoft,
    fontSize: 48,
  },
  brand: {
    color: colors.gold,
    fontSize: typography.sizes.title,
    fontWeight: typography.weights.black,
    letterSpacing: 0,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  headline: {
    color: colors.text,
    fontSize: typography.sizes.headline,
    fontWeight: typography.weights.black,
    lineHeight: 40,
    marginTop: spacing.md,
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
  formCard: {
    gap: spacing.lg,
    marginBottom: spacing.xl,
  },
  modeSwitch: {
    backgroundColor: colors.input,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    flexDirection: 'row',
    padding: spacing.xs,
  },
  modeOption: {
    alignItems: 'center',
    borderRadius: radius.full,
    flex: 1,
    justifyContent: 'center',
    minHeight: 40,
  },
  modeOptionActive: {
    backgroundColor: colors.gold,
  },
  modeText: {
    color: colors.textMuted,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
    writingDirection: 'rtl',
  },
  modeTextActive: {
    color: colors.backgroundDeep,
  },
  loginButton: {
    marginTop: spacing.sm,
  },
  error: {
    color: colors.ruby,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  success: {
    color: colors.emerald,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  secondaryRow: {
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
