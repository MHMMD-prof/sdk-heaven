import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CarromScreen } from '../screens/CarromScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { MainShellScreen } from '../screens/MainShellScreen';
import { MiniGameScreen } from '../screens/MiniGameScreen';
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
  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        initialRouteName="Login"
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Main" component={MainShellScreen} />
        <Stack.Screen name="MiniGame" component={MiniGameScreen} />
        <Stack.Screen name="Carrom" component={CarromScreen} />
        <Stack.Screen name="VoiceRoom" component={VoiceRoomScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
