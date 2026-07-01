import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { I18nManager, StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { RootNavigator } from './src/navigation/RootNavigator';
import { activeVoiceProviderConfig } from './src/voice/activeVoiceProviderConfig';
import { VoiceProvider } from './src/voice/VoiceProvider';
import { VoiceRoomsProvider } from './src/voice/VoiceRoomsProvider';

export default function App() {
  useEffect(() => {
    I18nManager.allowRTL(true);
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <VoiceProvider config={activeVoiceProviderConfig}>
          <VoiceRoomsProvider>
            <RootNavigator />
          </VoiceRoomsProvider>
        </VoiceProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
