import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { I18nManager, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from './src/navigation/RootNavigator';
import { AuthProvider } from './src/auth/AuthProvider';

export default function App() {
  useEffect(() => {
    I18nManager.allowRTL(true);
  }, []);

  const visualFixtureEnabled = __DEV__ && process.env.EXPO_PUBLIC_PERSONAL_CHAT_VISUAL_FIXTURE === '1';
  if (visualFixtureEnabled) {
    const fixtureRtl = process.env.EXPO_PUBLIC_PERSONAL_CHAT_FIXTURE_RTL !== '0';
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(fixtureRtl);
    const { PersonalChatVisualFixtureScreen } = require('./src/personalChat/PersonalChatVisualFixtureScreen') as typeof import('./src/personalChat/PersonalChatVisualFixtureScreen');
    return (
      <GestureHandlerRootView style={styles.root}>
        <SafeAreaProvider>
          <StatusBar style="light" />
          <PersonalChatVisualFixtureScreen />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AuthProvider>
          <RootNavigator />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
