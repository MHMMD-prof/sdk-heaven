import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { resolveAuthGateRoute } from '../auth/authGate';
import { useAuth } from '../auth/AuthProvider';
import { CarromScreen } from '../screens/CarromScreen';
import { AccountSettingsScreen } from '../screens/AccountSettingsScreen';
import { DrawingGuessScreen } from '../drawingGuess/screens/DrawingGuessScreen';
import { EmailVerificationScreen } from '../screens/EmailVerificationScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { MainShellScreen } from '../screens/MainShellScreen';
import { MiniGameScreen } from '../screens/MiniGameScreen';
import { ProfileSetupScreen } from '../screens/ProfileSetupScreen';
import { VoiceRoomScreen } from '../screens/VoiceRoomScreen';
import { colors } from '../theme';
import { RootStackParamList } from '../types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.backgroundDeep,
    text: colors.text,
    border: colors.border,
    primary: colors.gold,
  },
};

export function RootNavigator() {
  const { initializing, isEmailVerified, profileStatus, user } = useAuth();
  const authRoute = resolveAuthGateRoute({
    initializing,
    isEmailVerified,
    profileStatus,
    userExists: Boolean(user),
  });

  if (authRoute === 'loading') {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {authRoute === 'main' ? (
          <>
            <Stack.Screen name="Main" component={MainShellScreen} />
            <Stack.Screen name="AccountSettings" component={AccountSettingsScreen} />
            <Stack.Screen name="MiniGame" component={MiniGameScreen} />
            <Stack.Screen name="Carrom" component={CarromScreen} />
            <Stack.Screen name="DrawingGuess" component={DrawingGuessScreen} />
            <Stack.Screen name="VoiceRoom" component={VoiceRoomScreen} />
          </>
        ) : authRoute === 'email-verification' ? (
          <Stack.Screen name="EmailVerification" component={EmailVerificationScreen} />
        ) : authRoute === 'profile-setup' ? (
          <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
        ) : (
          <Stack.Screen name="Login" component={LoginScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
  },
});
