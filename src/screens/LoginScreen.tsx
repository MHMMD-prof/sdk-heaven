import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '../components/GlassCard';
import { LuxuryButton } from '../components/LuxuryButton';
import { LuxuryInput } from '../components/LuxuryInput';
import { ScreenContainer } from '../components/ScreenContainer';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types/navigation';

type LoginScreenProps = NativeStackScreenProps<RootStackParamList, 'Login'>;

export function LoginScreen({ navigation }: LoginScreenProps) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleMockLogin = () => {
    // Future wave: replace this mock transition with backend auth/session logic.
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      navigation.replace('Main');
    }, 450);
  };

  return (
    <ScreenContainer>
      <View style={styles.hero}>
        <View style={styles.logoMark}>
          <Text style={styles.logoSymbol}>♕</Text>
        </View>
        <Text style={styles.brand}>سكاي رويال</Text>
        <Text style={styles.headline}>ادخل إلى عالم فاخر من اللعب الاجتماعي</Text>
        <Text style={styles.subtitle}>
          تجربة عربية راقية للألعاب والمجموعات الصوتية والفعاليات القادمة. هذا تسجيل دخول
          تجريبي فقط.
        </Text>
      </View>

      <GlassCard style={styles.formCard}>
        <LuxuryInput
          autoCapitalize="none"
          keyboardType="email-address"
          label="رقم الجوال أو البريد الإلكتروني"
          onChangeText={setIdentifier}
          placeholder="مثال: name@example.com"
          value={identifier}
        />
        <LuxuryInput
          label="كلمة المرور"
          onChangeText={setPassword}
          placeholder="أدخل كلمة المرور"
          secureTextEntry
          value={password}
        />
        <LuxuryButton
          loading={isSubmitting}
          onPress={handleMockLogin}
          style={styles.loginButton}
          title="تسجيل الدخول"
        />
        <View style={styles.secondaryRow}>
          <Pressable>
            <Text style={styles.link}>إنشاء حساب</Text>
          </Pressable>
          <Pressable>
            <Text style={styles.link}>نسيت كلمة المرور؟</Text>
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
  loginButton: {
    marginTop: spacing.sm,
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
