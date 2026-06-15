import { useCallback, useEffect, useMemo } from 'react';
import { AppState } from 'react-native';

import { VoiceRoom } from '../types/voice';
import { createMockVoiceConnectOptions } from './createMockVoiceConnectOptions';
import { requestLiveKitConnectOptions } from './requestLiveKitConnectOptions';
import { VoiceRoomCommandType } from './types';
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
  const voiceRoom = useVoiceRoom();
  const {
    blockParticipant,
    connect,
    connectionState,
    disconnect,
    kickParticipant,
    listeners,
    muteParticipant,
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
      if (nextState !== 'active') {
        void disconnect();
      }
    });

    return () => subscription.remove();
  }, [disconnect]);

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

  const liveKitModerationUnsupported = providerConfig.provider === 'livekit';
  const moderationTarget = listeners[0] ?? speakers.find((participant) => participant.role !== 'host');
  const moderationActions: VoiceRoomModerationAction[] = useMemo(
    () => [
      {
        key: 'mute',
        label: 'كتم',
        onPress: () => moderationTarget && muteParticipant(moderationTarget.id),
        isDisabled: !moderationTarget || liveKitModerationUnsupported,
      },
      {
        key: 'kick',
        label: 'طرد',
        onPress: () => moderationTarget && kickParticipant(moderationTarget.id),
        isDisabled: !moderationTarget || liveKitModerationUnsupported,
      },
      {
        key: 'report',
        label: 'إبلاغ',
        onPress: () => moderationTarget && reportParticipant(moderationTarget.id),
        isDisabled: !moderationTarget || liveKitModerationUnsupported,
      },
      {
        key: 'block',
        label: 'حظر',
        onPress: () => moderationTarget && blockParticipant(moderationTarget.id),
        isDisabled: !moderationTarget || liveKitModerationUnsupported,
      },
    ],
    [
      blockParticipant,
      kickParticipant,
      liveKitModerationUnsupported,
      moderationTarget,
      muteParticipant,
      reportParticipant,
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
