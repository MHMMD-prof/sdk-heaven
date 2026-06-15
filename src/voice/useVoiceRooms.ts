import { useContext } from 'react';

import { VoiceRoomsContext } from './VoiceRoomsProvider';

export function useVoiceRooms() {
  const context = useContext(VoiceRoomsContext);

  if (!context) {
    throw new Error('useVoiceRooms must be used within VoiceRoomsProvider');
  }

  return context;
}
