import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { VoiceRoom } from '../types/voice';
import { debugError, debugLog } from '../utils/debugLog';
import { createMockVoiceConnectOptions } from './createMockVoiceConnectOptions';
import { requestLiveKitConnectOptions } from './requestLiveKitConnectOptions';
import { shouldReconnectVoiceRoom } from './roomReconnect';
import { VoiceRoomCommandType } from './types';
import { useRoomHostControls } from './useRoomHostControls';
import { useRoomSeatControls } from './useRoomSeatControls';
import { useVoiceProviderConfig } from './useVoiceProviderConfig';
import { useVoiceRoom } from './useVoiceRoom';

type VoiceRoomModerationAction = {
  key: VoiceRoomCommandType;
  label: string;
  onPress: () => void;
  isDisabled: boolean;
};

export function useVoiceRoomController(room: VoiceRoom) {
  const providerConfig = useVoiceProviderConfig();
  const hostControls = useRoomHostControls(room);
  const seatControls = useRoomSeatControls(room);
  const voiceRoom = useVoiceRoom();
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const {
    connect,
    connectionState,
    disconnect,
    listeners,
    reconnect,
    reportParticipant,
    setConnectionError,
    speakers,
  } = voiceRoom;
  const connectKey = useMemo(
    () =>
      [
        providerConfig.provider,
        providerConfig.liveKit?.tokenEndpoint ?? '',
        providerConfig.liveKit?.roomCommandEndpoint ?? '',
        room.id,
        room.localMember?.role ?? '',
        String(room.localMember?.canPublishAudio ?? ''),
      ].join('|'),
    [
      providerConfig.liveKit?.roomCommandEndpoint,
      providerConfig.liveKit?.tokenEndpoint,
      providerConfig.provider,
      room.id,
      room.localMember?.canPublishAudio,
      room.localMember?.role,
    ],
  );

  const createConnectOptions = useCallback(async () => {
    debugLog('voice.controller', 'createConnectOptions:start', {
      provider: providerConfig.provider,
      roomId: room.id,
      localRole: room.localMember?.role,
      localCanPublishAudio: room.localMember?.canPublishAudio,
    });

    if (providerConfig.provider === 'livekit') {
      return requestLiveKitConnectOptions(room, providerConfig.liveKit);
    }

    return createMockVoiceConnectOptions(room);
  }, [providerConfig, room]);

  const connectToRoom = useCallback(async () => {
    try {
      debugLog('voice.controller', 'connect:start', { roomId: room.id });
      const connectOptions = await createConnectOptions();
      await connect(connectOptions);
      debugLog('voice.controller', 'connect:success', {
        roomId: room.id,
        provider: providerConfig.provider,
        canPublishAudio: connectOptions.canPublishAudio,
      });
    } catch (error) {
      debugError('voice.controller', 'connect:error', error, { roomId: room.id });
      setConnectionError(error);
    }
  }, [connect, createConnectOptions, providerConfig.provider, room.id, setConnectionError]);

  const leaveRoom = useCallback(async () => {
    if (room.localMember?.seatId) {
      try {
        await seatControls.leaveSeat();
      } catch (error) {
        debugError('voice.controller', 'seat:leave:error', error, { roomId: room.id });
      }
    }
    await disconnect();
  }, [disconnect, room.id, room.localMember?.seatId, seatControls]);

  const reconnectToRoom = useCallback(async () => {
    try {
      debugLog('voice.controller', 'reconnect:start', { roomId: room.id });
      const connectOptions = await createConnectOptions();
      await reconnect(connectOptions);
      debugLog('voice.controller', 'reconnect:success', {
        roomId: room.id,
        canPublishAudio: connectOptions.canPublishAudio,
      });
    } catch (error) {
      debugError('voice.controller', 'reconnect:error', error, { roomId: room.id });
      setConnectionError(error);
    }
  }, [createConnectOptions, reconnect, room.id, setConnectionError]);

  useEffect(() => {
    debugLog('voice.controller', 'connectEffect:start', {
      connectKey,
      roomId: room.id,
    });
    void connectToRoom();

    return () => {
      debugLog('voice.controller', 'connectEffect:cleanup', {
        connectKey,
        roomId: room.id,
      });
      void disconnect();
    };
  }, [connectKey, disconnect]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;

      if (shouldReconnectVoiceRoom(previousState, nextState)) {
        debugLog('voice.controller', 'appState:reconnect', { previousState, nextState, roomId: room.id });
        void (async () => {
          if (room.localMember?.seatId) {
            try {
              await seatControls.resumeSeat();
            } catch (error) {
              debugError('voice.controller', 'seat:resume:error', error, { roomId: room.id });
            }
          }
          await reconnectToRoom();
        })();
        return;
      }

      if (nextState !== 'active') {
        debugLog('voice.controller', 'appState:disconnect', { previousState, nextState, roomId: room.id });
        void (async () => {
          if (room.localMember?.seatId) {
            try {
              await seatControls.reserveSeat();
            } catch (error) {
              debugError('voice.controller', 'seat:reserve:error', error, { roomId: room.id });
            }
          }
          await disconnect();
        })();
      }
    });

    return () => subscription.remove();
  }, [disconnect, reconnectToRoom, room.id, room.localMember?.seatId, seatControls]);

  const statusLabel = useMemo(() => {
    if (connectionState === 'connecting') {
      return 'جاري الاتصال';
    }

    if (connectionState === 'connected') {
      return 'متصل بالصوت';
    }

    if (connectionState === 'disconnected') {
      return 'تمت مغادرة المجموعة';
    }

    if (connectionState === 'error') {
      return 'تعذر الاتصال بالصوت';
    }

    return 'جاهز للاتصال';
  }, [connectionState]);

  const liveKitModeration = providerConfig.provider === 'livekit';
  const removableTarget = listeners[0] ?? speakers.find((participant) => participant.role !== 'host');
  const promotableTarget = listeners[0];
  const demotableTarget = speakers.find((participant) => participant.role === 'speaker');
  const canUseHostControls = liveKitModeration && hostControls.isHost;
  const moderationActions: VoiceRoomModerationAction[] = useMemo(
    () => [
      {
        key: 'promote',
        label: 'ترقية',
        onPress: () => promotableTarget && hostControls.promoteToSpeaker(promotableTarget.id),
        isDisabled: !canUseHostControls || !promotableTarget || hostControls.isCommandPending('promote-speaker', promotableTarget.id),
      },
      {
        key: 'demote',
        label: 'إنزال',
        onPress: () => demotableTarget && hostControls.demoteToListener(demotableTarget.id),
        isDisabled: !canUseHostControls || !demotableTarget || hostControls.isCommandPending('demote-listener', demotableTarget.id),
      },
      {
        key: 'remove',
        label: 'إزالة',
        onPress: () => removableTarget && hostControls.removeMember(removableTarget.id),
        isDisabled: !canUseHostControls || !removableTarget || hostControls.isCommandPending('remove-member', removableTarget.id),
      },
      {
        key: 'report',
        label: 'إبلاغ',
        onPress: () =>
          removableTarget
            ? liveKitModeration
              ? hostControls.reportMember(removableTarget.id)
              : reportParticipant(removableTarget.id)
            : undefined,
        isDisabled: !removableTarget || (liveKitModeration && hostControls.isCommandPending('report-member', removableTarget.id)),
      },
      {
        key: 'close',
        label: 'إغلاق',
        onPress: () => hostControls.closeRoom(),
        isDisabled: !canUseHostControls || hostControls.isCommandPending('close-room'),
      },
    ],
    [
      canUseHostControls,
      demotableTarget,
      hostControls,
      liveKitModeration,
      promotableTarget,
      reportParticipant,
      removableTarget,
    ],
  );

  return {
    ...voiceRoom,
    connectToRoom,
    leaveRoom,
    hostControls,
    moderationActions,
    moderationErrorMessage: hostControls.errorMessage,
    reconnectToRoom,
    seatControls,
    statusLabel,
  };
}
