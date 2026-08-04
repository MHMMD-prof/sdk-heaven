import { useEffect } from 'react';

import { debugError } from '../utils/debugLog';
import { activeVoiceProviderConfig } from './activeVoiceProviderConfig';
import {
  createRoomGameRequestId,
  requestRoomGameCommand,
} from './requestRoomGameCommand';

export function useLeaveRoomGameOnExit({
  roomId,
  sessionId,
  source,
}: {
  roomId?: string;
  sessionId?: string;
  source?: 'games' | 'voice-room';
}) {
  useEffect(() => {
    if (source !== 'voice-room' || !roomId || !sessionId) return undefined;
    const requestId = createRoomGameRequestId();
    return () => {
      void requestRoomGameCommand({
        action: 'leave-room-game',
        requestId,
        roomId,
        sessionId,
      }, activeVoiceProviderConfig.liveKit).catch((error) => {
        debugError('voice.games', 'leave-on-exit:error', error, { roomId, sessionId });
      });
    };
  }, [roomId, sessionId, source]);
}
