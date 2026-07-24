import { MockVoiceClient } from './MockVoiceClient';
import { VoiceClient } from './VoiceClient';
import { VoiceProviderConfig } from './types';

export function createVoiceClient(config: VoiceProviderConfig): VoiceClient {
  if (config.provider === 'mock') {
    return new MockVoiceClient();
  }

  if (config.provider === 'livekit') {
    const { LiveKitVoiceClient } = require('./LiveKitVoiceClient') as typeof import('./LiveKitVoiceClient');

    return new LiveKitVoiceClient();
  }

  throw new Error(`Voice provider "${config.provider}" is not implemented in this wave.`);
}
