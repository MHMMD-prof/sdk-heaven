import { PropsWithChildren, createContext, useMemo } from 'react';

import { VoiceClient } from './VoiceClient';
import { createVoiceClient } from './createVoiceClient';
import { VoiceProviderConfig } from './types';

export const VoiceContext = createContext<VoiceClient | undefined>(undefined);
export const VoiceProviderConfigContext = createContext<VoiceProviderConfig | undefined>(
  undefined,
);

type VoiceProviderProps = PropsWithChildren<{
  client?: VoiceClient;
  config?: VoiceProviderConfig;
}>;

const defaultVoiceProviderConfig: VoiceProviderConfig = {
  provider: 'mock',
};

export function VoiceProvider({ children, client, config = defaultVoiceProviderConfig }: VoiceProviderProps) {
  const voiceClient = useMemo(() => client ?? createVoiceClient(config), [client, config]);

  return (
    <VoiceProviderConfigContext.Provider value={config}>
      <VoiceContext.Provider value={voiceClient}>{children}</VoiceContext.Provider>
    </VoiceProviderConfigContext.Provider>
  );
}
