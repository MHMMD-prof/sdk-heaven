import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';

import { VoiceRoom } from '../types/voice';
import { createMockVoiceConnectOptions } from './createMockVoiceConnectOptions';
import { requestLiveKitConnectOptions } from './requestLiveKitConnectOptions';
import { shouldReconnectVoiceRoom } from './roomReconnect';
import { VoiceRoomCommandType } from './types';
import { useRoomHostControls } from './useRoomHostControls';
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

  const createConnectOptions = useCallback(async () => {
    if (providerConfig.provider === 'livekit') {
      return requestLiveKitConnectOptions(room, providerConfig.liveKit);
    }

    return createMockVoiceConnectOptions(room);
  }, [providerConfig, room]);

  const connectToRoom = useCallback(async () => {
    try {
      const connectOptions = await createConnectOptions();
      await connect(connectOptions);
    } catch (error) {
      setConnectionError(error);
    }
  }, [connect, createConnectOptions, setConnectionError]);

  const leaveRoom = useCallback(async () => {
    await disconnect();
  }, [disconnect]);

  const reconnectToRoom = useCallback(async () => {
    try {
      const connectOptions = await createConnectOptions();
      await reconnect(connectOptions);
    } catch (error) {
      setConnectionError(error);
    }
  }, [createConnectOptions, reconnect, setConnectionError]);

  useEffect(() => {
    void connectToRoom();

    return () => {
      void disconnect();
    };
  }, [connectToRoom, disconnect]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;

      if (shouldReconnectVoiceRoom(previousState, nextState)) {
        void reconnectToRoom();
        return;
      }

      if (nextState !== 'active') {
        void disconnect();
      }
    });

    return () => subscription.remove();
  }, [disconnect, reconnectToRoom]);

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
        isDisabled: !canUseHostControls || !promotableTarget || hostControls.hostControlStatus === 'loading',
      },
      {
        key: 'demote',
        label: 'إنزال',
        onPress: () => demotableTarget && hostControls.demoteToListener(demotableTarget.id),
        isDisabled: !canUseHostControls || !demotableTarget || hostControls.hostControlStatus === 'loading',
      },
      {
        key: 'remove',
        label: 'إزالة',
        onPress: () => removableTarget && hostControls.removeMember(removableTarget.id),
        isDisabled: !canUseHostControls || !removableTarget || hostControls.hostControlStatus === 'loading',
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
        isDisabled: !removableTarget || (liveKitModeration && hostControls.hostControlStatus === 'loading'),
      },
      {
        key: 'close',
        label: 'إغلاق',
        onPress: () => hostControls.closeRoom(),
        isDisabled: !canUseHostControls || hostControls.hostControlStatus === 'loading',
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
    moderationActions,
    reconnectToRoom,
    statusLabel,
  };
}
