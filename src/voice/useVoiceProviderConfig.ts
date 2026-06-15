import { useContext } from 'react';

import { VoiceProviderConfigContext } from './VoiceProvider';

export function useVoiceProviderConfig() {
  const config = useContext(VoiceProviderConfigContext);

  if (!config) {
    throw new Error('useVoiceProviderConfig must be used within VoiceProvider');
  }

  return config;
}
