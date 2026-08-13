import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';

import App from './App';
import { initializeObservability, wrapWithObservability } from './src/observability/sentry';

initializeObservability();

if (Platform.OS !== 'web') {
  const { registerGlobals } = require('@livekit/react-native') as typeof import('@livekit/react-native');

  registerGlobals();
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(wrapWithObservability(App));
