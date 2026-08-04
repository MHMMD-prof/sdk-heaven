import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { resolveAuthGateRoute } from '../auth/authGate';
import { useAuth } from '../auth/AuthProvider';
import { colors } from '../theme';
import { RootStackParamList } from '../types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();
const GateStack = createNativeStackNavigator<GateStackParamList>();
type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<RootStackParamList, T>;
type GateStackParamList = {
  Gate: undefined;
};

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
  return (
    <NavigationContainer theme={navigationTheme}>
      <GateStack.Navigator screenOptions={stackScreenOptions}>
        <GateStack.Screen name="Gate" component={AuthGateScreen} />
      </GateStack.Navigator>
    </NavigationContainer>
  );
}

function AuthGateScreen() {
  const { initializing, profileStatus, user } = useAuth();
  const authRoute = resolveAuthGateRoute({
    initializing,
    profileStatus,
    userExists: Boolean(user),
  });

  if (authRoute === 'loading') {
    return <LoadingScreen />;
  }

  if (authRoute === 'main') {
    return <MainAppStack />;
  }

  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      {authRoute === 'profile-setup' ? (
        <Stack.Screen name="ProfileSetup" component={ProfileSetupScreenEntry} />
      ) : (
        <Stack.Screen name="Login" component={LoginScreenEntry} />
      )}
    </Stack.Navigator>
  );
}

function LoadingScreen() {
  return (
    <View style={styles.loadingScreen}>
      <ActivityIndicator color={colors.gold} />
    </View>
  );
}

function LoginScreenEntry(props: RootStackScreenProps<'Login'>) {
  const { LoginScreen } = require('../screens/LoginScreen') as typeof import('../screens/LoginScreen');

  return <LoginScreen {...props} />;
}

function ProfileSetupScreenEntry(_props: RootStackScreenProps<'ProfileSetup'>) {
  const { ProfileSetupScreen } = require('../screens/ProfileSetupScreen') as typeof import('../screens/ProfileSetupScreen');

  return <ProfileSetupScreen />;
}

function MainAppStack() {
  const { VoiceRoomsProvider } = require('../voice/VoiceRoomsProvider') as typeof import('../voice/VoiceRoomsProvider');
  const { DirectChatProvider } = require('../personalChat/DirectChatProvider') as typeof import('../personalChat/DirectChatProvider');
  const { AppSwitcherPrivacyShield } = require('../privacy/AppSwitcherPrivacyShield') as typeof import('../privacy/AppSwitcherPrivacyShield');

  return (
    <AppSwitcherPrivacyShield>
      <DirectChatProvider>
        <VoiceRoomsProvider>
          <Stack.Navigator screenOptions={stackScreenOptions}>
        <Stack.Screen name="Main" component={MainScreenEntry} />
        <Stack.Screen name="MeProfile" component={MeProfileScreenEntry} />
        <Stack.Screen name="Friends" component={FriendsScreenEntry} />
        <Stack.Screen name="Couples" component={CouplesScreenEntry} />
        <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreenEntry} />
        <Stack.Screen name="Gifts" component={GiftsScreenEntry} />
        <Stack.Screen name="WalletStore" component={WalletStoreScreenEntry} />
        <Stack.Screen name="Store" component={StoreScreenEntry} />
        <Stack.Screen name="MyItems" component={MyItemsScreenEntry} />
        <Stack.Screen name="RepresentativeTransfer" component={RepresentativeTransferScreenEntry} />
        <Stack.Screen name="UserProfile" component={UserProfileScreenEntry} />
        <Stack.Screen name="DirectChat" component={DirectChatScreenEntry} />
        <Stack.Screen name="UsersDiscovery" component={UsersDiscoveryScreenEntry} />
        <Stack.Screen name="AccountSettings" component={AccountSettingsScreenEntry} />
        {__DEV__ ? (
          <Stack.Screen name="CosmeticsLab" component={CosmeticsFeasibilityScreenEntry} />
        ) : null}
        <Stack.Screen name="MiniGame" component={MiniGameScreenEntry} />
        <Stack.Screen name="Carrom" component={CarromScreenEntry} />
        <Stack.Screen name="DrawingGuess" component={DrawingGuessScreenEntry} />
        <Stack.Screen name="VoiceRoom" component={VoiceRoomScreenEntry} />
          </Stack.Navigator>
        </VoiceRoomsProvider>
      </DirectChatProvider>
    </AppSwitcherPrivacyShield>
  );
}

function MainScreenEntry(props: RootStackScreenProps<'Main'>) {
  const { MainShellScreen } = require('../screens/MainShellScreen') as typeof import('../screens/MainShellScreen');

  return <MainShellScreen {...props} />;
}

function AccountSettingsScreenEntry(props: RootStackScreenProps<'AccountSettings'>) {
  const { AccountSettingsScreen } = require('../screens/AccountSettingsScreen') as typeof import('../screens/AccountSettingsScreen');

  return <AccountSettingsScreen {...props} />;
}

function CosmeticsFeasibilityScreenEntry(props: RootStackScreenProps<'CosmeticsLab'>) {
  const { CosmeticsFeasibilityScreen } = require('../cosmetics/CosmeticsFeasibilityScreen') as typeof import('../cosmetics/CosmeticsFeasibilityScreen');

  return <CosmeticsFeasibilityScreen {...props} />;
}

function MeProfileScreenEntry(props: RootStackScreenProps<'MeProfile'>) {
  const { MeProfileScreen } = require('../screens/MeProfileScreen') as typeof import('../screens/MeProfileScreen');

  return <MeProfileScreen {...props} />;
}

function FriendsScreenEntry(props: RootStackScreenProps<'Friends'>) {
  const { FriendsScreen } = require('../screens/FriendsScreen') as typeof import('../screens/FriendsScreen');

  return <FriendsScreen {...props} />;
}

function CouplesScreenEntry(props: RootStackScreenProps<'Couples'>) {
  const { CouplesScreen } = require('../screens/CouplesScreen') as typeof import('../screens/CouplesScreen');

  return <CouplesScreen {...props} />;
}

function NotificationSettingsScreenEntry(props: RootStackScreenProps<'NotificationSettings'>) {
  const { NotificationSettingsScreen } = require('../screens/NotificationSettingsScreen') as typeof import('../screens/NotificationSettingsScreen');

  return <NotificationSettingsScreen {...props} />;
}

function GiftsScreenEntry(props: RootStackScreenProps<'Gifts'>) {
  const { GiftsScreen } = require('../screens/GiftsScreen') as typeof import('../screens/GiftsScreen');

  return <GiftsScreen {...props} />;
}

function WalletStoreScreenEntry(props: RootStackScreenProps<'WalletStore'>) {
  const { WalletStoreScreen } = require('../screens/WalletStoreScreen') as typeof import('../screens/WalletStoreScreen');
  return <WalletStoreScreen {...props} />;
}

function StoreScreenEntry(props: RootStackScreenProps<'Store'>) {
  const { StoreScreen } = require('../screens/StoreScreen') as typeof import('../screens/StoreScreen');
  return <StoreScreen {...props} />;
}

function MyItemsScreenEntry(props: RootStackScreenProps<'MyItems'>) {
  const { MyItemsScreen } = require('../screens/MyItemsScreen') as typeof import('../screens/MyItemsScreen');
  return <MyItemsScreen {...props} />;
}

function RepresentativeTransferScreenEntry(props: RootStackScreenProps<'RepresentativeTransfer'>) {
  const { RepresentativeTransferScreen } = require('../screens/RepresentativeTransferScreen') as typeof import('../screens/RepresentativeTransferScreen');
  return <RepresentativeTransferScreen {...props} />;
}

function UserProfileScreenEntry(props: RootStackScreenProps<'UserProfile'>) {
  const { UserProfileScreen } = require('../screens/UserProfileScreen') as typeof import('../screens/UserProfileScreen');

  return <UserProfileScreen {...props} />;
}

function DirectChatScreenEntry(props: RootStackScreenProps<'DirectChat'>) {
  const { DirectChatScreen } = require('../screens/DirectChatScreen') as typeof import('../screens/DirectChatScreen');

  return <DirectChatScreen {...props} />;
}

function UsersDiscoveryScreenEntry(props: RootStackScreenProps<'UsersDiscovery'>) {
  const { UsersDiscoveryScreen } = require('../screens/UsersDiscoveryScreen') as typeof import('../screens/UsersDiscoveryScreen');

  return <UsersDiscoveryScreen {...props} />;
}

function MiniGameScreenEntry(props: RootStackScreenProps<'MiniGame'>) {
  const { MiniGameScreen } = require('../screens/MiniGameScreen') as typeof import('../screens/MiniGameScreen');

  return <MiniGameScreen {...props} />;
}

function CarromScreenEntry(props: RootStackScreenProps<'Carrom'>) {
  const { CarromScreen } = require('../screens/CarromScreen') as typeof import('../screens/CarromScreen');

  return <CarromScreen {...props} />;
}

function DrawingGuessScreenEntry(props: RootStackScreenProps<'DrawingGuess'>) {
  const { DrawingGuessScreen } = require('../drawingGuess/screens/DrawingGuessScreen') as typeof import('../drawingGuess/screens/DrawingGuessScreen');

  return <DrawingGuessScreen {...props} />;
}

function VoiceRoomScreenEntry(props: RootStackScreenProps<'VoiceRoom'>) {
  const { activeVoiceProviderConfig } = require('../voice/activeVoiceProviderConfig') as typeof import('../voice/activeVoiceProviderConfig');
  const { VoiceProvider } = require('../voice/VoiceProvider') as typeof import('../voice/VoiceProvider');
  const { VoiceRoomScreen } = require('../screens/VoiceRoomScreen') as typeof import('../screens/VoiceRoomScreen');

  return (
    <VoiceProvider config={activeVoiceProviderConfig}>
      <VoiceRoomScreen {...props} />
    </VoiceProvider>
  );
}

const stackScreenOptions = {
  headerShown: false,
  animation: 'fade',
  contentStyle: { backgroundColor: colors.background },
} as const;

const styles = StyleSheet.create({
  loadingScreen: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
  },
});
