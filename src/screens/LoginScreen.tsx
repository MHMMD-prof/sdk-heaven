import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView, SymbolViewProps } from 'expo-symbols';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  ImageSourcePropType,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getAuthErrorMessage } from '../auth/authErrors';
import { useAuth } from '../auth/AuthProvider';
import { radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types/navigation';

const velvetStageArtwork = require('../../assets/login/velvet-invitation/velvet-stage-v1.png') as ImageSourcePropType;
const royalCrestArtwork = require('../../assets/login/velvet-invitation/royal-crest-v1.png') as ImageSourcePropType;
const leatherCardArtwork = require('../../assets/login/velvet-invitation/leather-card-v1.png') as ImageSourcePropType;

const CARD_ASPECT_RATIO = 1122 / 1402;
const MAX_CARD_WIDTH = 480;
const MIN_CARD_WIDTH = 280;

type LoginScreenProps = NativeStackScreenProps<RootStackParamList, 'Login'>;
type AuthMode = 'sign-in' | 'sign-up';
type AuthAction = AuthMode | 'reset-password';

export function LoginScreen({ navigation: _navigation }: LoginScreenProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const passwordInputRef = useRef<TextInput>(null);
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [activeAction, setActiveAction] = useState<AuthAction | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const { sendPasswordReset, signIn, signUp } = useAuth();

  const email = identifier.trim();
  const isSignUp = mode === 'sign-up';
  const isBusy = activeAction !== null;
  const cardWidth = Math.min(Math.max(width - 24, MIN_CARD_WIDTH), MAX_CARD_WIDTH);
  const cardHeight = cardWidth / CARD_ASPECT_RATIO;
  const cardInsets = useMemo(
    () => ({
      paddingBottom: cardWidth * 0.17,
      paddingHorizontal: cardWidth * 0.135,
      paddingTop: cardWidth * 0.13,
    }),
    [cardWidth],
  );
  const submitTitle = isSignUp ? 'إنشاء الحساب' : 'تسجيل الدخول';
  const secondaryTitle = isSignUp ? 'لديك حساب؟ تسجيل الدخول' : 'إنشاء حساب جديد';

  const clearFeedback = () => {
    if (errorMessage) {
      setErrorMessage('');
    }
    if (successMessage) {
      setSuccessMessage('');
    }
  };

  const updateIdentifier = (value: string) => {
    setIdentifier(value);
    clearFeedback();
  };

  const updatePassword = (value: string) => {
    setPassword(value);
    clearFeedback();
  };

  const setAuthMode = (nextMode: AuthMode) => {
    if (isBusy || nextMode === mode) {
      return;
    }

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
        setSuccessMessage('تم إنشاء الحساب. أكمل ملفك الشخصي.');
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
    <View style={styles.screen}>
      <Image
        accessibilityElementsHidden
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        resizeMode="cover"
        source={velvetStageArtwork}
        style={styles.stageArtwork}
      />
      <LinearGradient
        colors={[
          'rgba(8,3,3,0)',
          'rgba(8,3,3,0.68)',
          '#080303',
          '#080303',
          'rgba(8,3,3,0.68)',
          'rgba(8,3,3,0)',
        ]}
        end={{ x: 1, y: 0.5 }}
        locations={[0, 0.16, 0.3, 0.7, 0.84, 1]}
        start={{ x: 0, y: 0.5 }}
        style={[StyleSheet.absoluteFill, styles.nonInteractive]}
      />
      <LinearGradient
        colors={['rgba(2,0,0,0.05)', 'rgba(7,1,1,0.03)', 'rgba(0,0,0,0.28)']}
        locations={[0, 0.62, 1]}
        style={[StyleSheet.absoluteFill, styles.nonInteractive]}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboard}
      >
        <ScrollView
          bounces={false}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom: Math.max(insets.bottom, spacing.md) + spacing.xl,
              paddingTop: Math.max(insets.top, spacing.sm) + spacing.sm,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.composition}>
            <View accessibilityRole="header" style={styles.hero}>
              <View style={styles.crestShell}>
                <Image
                  accessibilityElementsHidden
                  accessible={false}
                  importantForAccessibility="no-hide-descendants"
                  resizeMode="contain"
                  source={royalCrestArtwork}
                  style={styles.crestArtwork}
                />
                <Text style={styles.brand}>سكاي رويال</Text>
              </View>
              <Text style={styles.headline}>مجلسك الملكي بانتظارك</Text>
            </View>

            <ImageBackground
              imageStyle={styles.cardArtworkImage}
              resizeMode="stretch"
              source={leatherCardArtwork}
              style={[
                styles.cardArtwork,
                {
                  height: cardHeight,
                  width: cardWidth,
                },
              ]}
            >
              <View style={[styles.cardContent, cardInsets]}>
                <View accessibilityRole="tablist" style={styles.modeSwitch}>
                  <ModeTab
                    disabled={isBusy}
                    isActive={!isSignUp}
                    label="دخول"
                    onPress={() => setAuthMode('sign-in')}
                  />
                  <ModeTab
                    disabled={isBusy}
                    isActive={isSignUp}
                    label="حساب جديد"
                    onPress={() => setAuthMode('sign-up')}
                  />
                </View>

                <RoyalInput
                  accessibilityLabel="البريد الإلكتروني"
                  autoCapitalize="none"
                  autoComplete="email"
                  editable={!isBusy}
                  keyboardType="email-address"
                  onChangeText={updateIdentifier}
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                  placeholder="البريد الإلكتروني"
                  returnKeyType="next"
                  symbol={{
                    android: 'mail',
                    ios: 'envelope.fill',
                    web: 'mail',
                  }}
                  textContentType="username"
                  value={identifier}
                />
                <RoyalInput
                  accessibilityLabel="كلمة المرور"
                  autoComplete={isSignUp ? 'new-password' : 'password'}
                  editable={!isBusy}
                  inputRef={passwordInputRef}
                  onChangeText={updatePassword}
                  onSubmitEditing={() => {
                    if (email && password) {
                      void submitAuth();
                    }
                  }}
                  placeholder="كلمة المرور"
                  returnKeyType="done"
                  secureTextEntry
                  symbol={{
                    android: 'lock',
                    ios: 'lock.fill',
                    web: 'lock',
                  }}
                  textContentType={isSignUp ? 'newPassword' : 'password'}
                  value={password}
                />

                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ busy: activeAction === 'reset-password', disabled: isBusy }}
                  disabled={isBusy}
                  hitSlop={8}
                  onPress={() => {
                    void resetPassword();
                  }}
                  style={({ pressed }) => [styles.resetButton, pressed && styles.pressed]}
                >
                  {activeAction === 'reset-password' ? (
                    <ActivityIndicator color="#D7AF58" size="small" />
                  ) : (
                    <Text style={styles.resetText}>استعادة كلمة المرور</Text>
                  )}
                </Pressable>

                <View accessibilityLiveRegion="polite" style={styles.feedbackSlot}>
                  {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
                  {successMessage ? <Text style={styles.success}>{successMessage}</Text> : null}
                </View>

                <GoldActionButton
                  disabled={!email || !password || isBusy}
                  loading={activeAction === mode}
                  onPress={() => {
                    void submitAuth();
                  }}
                  title={submitTitle}
                />
              </View>
            </ImageBackground>

            <Pressable
              accessibilityLabel={secondaryTitle}
              accessibilityRole="button"
              accessibilityState={{ disabled: isBusy }}
              disabled={isBusy}
              onPress={() => setAuthMode(isSignUp ? 'sign-in' : 'sign-up')}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.secondaryButtonPressed,
                isBusy && styles.disabled,
              ]}
            >
              <Text style={styles.secondaryOrnament}>✦</Text>
              <Text style={styles.secondaryText}>{secondaryTitle}</Text>
              <Text style={styles.secondaryOrnament}>✦</Text>
            </Pressable>

            <View style={styles.securityRow}>
              <View style={styles.securityLine} />
              <View aria-hidden style={styles.securityBadge}>
                <SymbolView
                  accessibilityElementsHidden
                  accessible={false}
                  importantForAccessibility="no-hide-descendants"
                  name={{
                    android: 'verified_user',
                    ios: 'lock.shield.fill',
                    web: 'verified_user',
                  }}
                  size={18}
                  tintColor="#D7AF58"
                />
              </View>
              <Text style={styles.securityText}>دخول آمن ومحمي</Text>
              <View style={styles.securityLine} />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

type ModeTabProps = {
  disabled: boolean;
  isActive: boolean;
  label: string;
  onPress: () => void;
};

function ModeTab({ disabled, isActive, label, onPress }: ModeTabProps) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ disabled, selected: isActive }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.modeOption, pressed && styles.pressed]}
    >
      <Text style={[styles.modeText, isActive && styles.modeTextActive]}>{label}</Text>
      <View style={[styles.modeIndicator, isActive && styles.modeIndicatorActive]} />
    </Pressable>
  );
}

type RoyalInputProps = {
  inputRef?: React.RefObject<TextInput | null>;
  symbol: SymbolViewProps['name'];
} & React.ComponentProps<typeof TextInput>;

function RoyalInput({ inputRef, style, symbol, ...props }: RoyalInputProps) {
  return (
    <View style={styles.inputShell}>
      <View aria-hidden style={styles.inputIcon}>
        <SymbolView
          accessibilityElementsHidden
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          name={symbol}
          size={22}
          tintColor="#DAB560"
        />
      </View>
      <TextInput
        placeholderTextColor="#A9997E"
        ref={inputRef}
        selectionColor="#E2C16E"
        style={[styles.input, style]}
        textAlign="right"
        {...props}
      />
    </View>
  );
}

type GoldActionButtonProps = {
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
  title: string;
};

function GoldActionButton({ disabled, loading, onPress, title }: GoldActionButtonProps) {
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.goldButtonOuter,
        pressed && styles.goldButtonPressed,
        disabled && styles.disabled,
      ]}
    >
      <LinearGradient
        colors={['#8D6425', '#E1BF69', '#F4D98E', '#BB8A38']}
        end={{ x: 1, y: 1 }}
        locations={[0, 0.28, 0.62, 1]}
        start={{ x: 0, y: 0 }}
        style={styles.goldButton}
      >
        <Text style={styles.goldButtonOrnament}>✦</Text>
        {loading ? (
          <ActivityIndicator color="#5A0910" />
        ) : (
          <Text style={styles.goldButtonText}>{title}</Text>
        )}
        <Text style={styles.goldButtonOrnament}>✦</Text>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#050101',
    flex: 1,
  },
  stageArtwork: {
    bottom: 0,
    height: '100%',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: '100%',
  },
  keyboard: {
    flex: 1,
  },
  nonInteractive: {
    pointerEvents: 'none',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 12,
  },
  composition: {
    alignItems: 'center',
    alignSelf: 'center',
    maxWidth: 560,
    width: '100%',
  },
  hero: {
    alignItems: 'center',
    width: '100%',
  },
  crestShell: {
    aspectRatio: 1448 / 1086,
    maxWidth: 330,
    position: 'relative',
    width: '76%',
  },
  crestArtwork: {
    height: '100%',
    width: '100%',
  },
  brand: {
    color: '#D9B768',
    fontSize: 21,
    fontWeight: typography.weights.black,
    left: 0,
    position: 'absolute',
    right: 0,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.9)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
    top: '43.5%',
    writingDirection: 'rtl',
  },
  headline: {
    color: '#F3D184',
    fontSize: 27,
    fontWeight: typography.weights.black,
    lineHeight: 38,
    marginBottom: 4,
    marginTop: -4,
    paddingHorizontal: spacing.md,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.92)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 7,
    writingDirection: 'rtl',
  },
  cardArtwork: {
    alignItems: 'stretch',
    justifyContent: 'flex-start',
  },
  cardArtworkImage: {
    borderRadius: 2,
  },
  cardContent: {
    flex: 1,
    gap: 11,
    width: '100%',
  },
  modeSwitch: {
    flexDirection: 'row-reverse',
    marginBottom: 1,
  },
  modeOption: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  modeText: {
    color: '#9F9078',
    fontSize: 15,
    fontWeight: typography.weights.bold,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  modeTextActive: {
    color: '#F0CB76',
  },
  modeIndicator: {
    backgroundColor: 'transparent',
    borderRadius: radius.full,
    height: 3,
    marginTop: 6,
    width: 46,
  },
  modeIndicatorActive: {
    backgroundColor: '#E4B959',
    shadowColor: '#E4B959',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.62,
    shadowRadius: 5,
  },
  inputShell: {
    alignItems: 'center',
    backgroundColor: 'rgba(9,7,6,0.88)',
    borderColor: '#9B7537',
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    minHeight: 56,
    paddingHorizontal: 14,
  },
  inputIcon: {
    height: 24,
    width: 24,
  },
  input: {
    color: '#FFF1D5',
    flex: 1,
    fontSize: 15,
    minHeight: 54,
    paddingHorizontal: 10,
    paddingVertical: 0,
    writingDirection: 'rtl',
  },
  resetButton: {
    alignItems: 'flex-end',
    alignSelf: 'stretch',
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 2,
  },
  resetText: {
    color: '#D8AB4F',
    fontSize: 13,
    fontWeight: typography.weights.semibold,
    textDecorationLine: 'underline',
    writingDirection: 'rtl',
  },
  feedbackSlot: {
    justifyContent: 'center',
    minHeight: 18,
  },
  error: {
    color: '#F3A3A9',
    fontSize: 11,
    fontWeight: typography.weights.semibold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  success: {
    color: '#8BE0B2',
    fontSize: 11,
    fontWeight: typography.weights.semibold,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  goldButtonOuter: {
    borderColor: '#F1D27E',
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#D7A944',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
  },
  goldButton: {
    alignItems: 'center',
    borderColor: 'rgba(77,36,9,0.42)',
    borderWidth: 1,
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: 14,
  },
  goldButtonPressed: {
    transform: [{ scale: 0.988 }],
  },
  goldButtonText: {
    color: '#6B0810',
    fontSize: 18,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  goldButtonOrnament: {
    color: '#734913',
    fontSize: 11,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(77,5,12,0.82)',
    borderColor: '#B88B3F',
    borderRadius: 5,
    borderWidth: 1,
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    marginTop: -2,
    maxWidth: 430,
    minHeight: 54,
    paddingHorizontal: 20,
    width: '92%',
  },
  secondaryButtonPressed: {
    backgroundColor: 'rgba(112,9,19,0.88)',
    transform: [{ scale: 0.988 }],
  },
  secondaryText: {
    color: '#F6DEAA',
    fontSize: 16,
    fontWeight: typography.weights.black,
    textAlign: 'center',
    writingDirection: 'rtl',
  },
  secondaryOrnament: {
    color: '#B88B3F',
    fontSize: 10,
  },
  securityRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 14,
    maxWidth: 350,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    width: '88%',
  },
  securityLine: {
    backgroundColor: 'rgba(184,139,63,0.56)',
    flex: 1,
    height: 1,
  },
  securityBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(76,10,15,0.72)',
    borderColor: '#9D7634',
    borderRadius: radius.full,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  securityText: {
    color: '#BDAA87',
    fontSize: 11,
    fontWeight: typography.weights.semibold,
    writingDirection: 'rtl',
  },
  pressed: {
    opacity: 0.76,
  },
  disabled: {
    opacity: 0.58,
  },
});
