import { useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';

import { VoiceContext } from './VoiceProvider';
import {
  VoiceConnectOptions,
  VoiceConnectionState,
  VoiceRoomSession,
} from './types';
import {
  initialVoiceRoomSessionState,
  voiceRoomSessionReducer,
} from './voiceRoomSessionReducer';

export function useVoiceRoom() {
  const client = useContext(VoiceContext);

  if (!client) {
    throw new Error('useVoiceRoom must be used within VoiceProvider');
  }

  const [state, dispatch] = useReducer(
    voiceRoomSessionReducer,
    initialVoiceRoomSessionState,
  );
  const connectionStateRef = useRef<VoiceConnectionState>('idle');
  const roomIdRef = useRef<string | undefined>(undefined);
  const connectRequestRef = useRef(0);
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    const offEvent = client.onEvent((event) => {
      if (!isMountedRef.current) {
        return;
      }

      if (event.type === 'participantsChanged') {
        dispatch({ type: 'participantsChanged', participants: event.participants });
      }

      if (event.type === 'speakingChanged') {
        dispatch({ type: 'speakingChanged', participantIds: event.participantIds });
      }

      if (event.type === 'connectionStateChanged') {
        connectionStateRef.current = event.connectionState;
        dispatch({
          type: 'connectionStateChanged',
          connectionState: event.connectionState,
        });
      }

      if (event.type === 'error') {
        dispatch({
          type: 'connectionErrorChanged',
          errorMessage: event.message,
        });
      }
    });

    return () => {
      isMountedRef.current = false;
      connectRequestRef.current += 1;
      offEvent();
    };
  }, [client]);

  const connect = useCallback(
    async (options: VoiceConnectOptions) => {
      const nextRoomId = options.roomId;
      const currentState = connectionStateRef.current;

      if (
        roomIdRef.current === nextRoomId &&
        (currentState === 'connecting' || currentState === 'connected')
      ) {
        return;
      }

      const requestId = connectRequestRef.current + 1;
      connectRequestRef.current = requestId;
      roomIdRef.current = nextRoomId;
      dispatch({ type: 'roomIdChanged', roomId: nextRoomId });
      dispatch({
        type: 'publishAudioChanged',
        canPublishAudio: options.canPublishAudio ?? true,
      });

      try {
        await client.connect(options);
      } catch (error) {
        if (!isMountedRef.current || requestId !== connectRequestRef.current) {
          return;
        }

        dispatch({
          type: 'connectionErrorChanged',
          errorMessage: getErrorMessage(error),
        });
        return;
      }

      if (!isMountedRef.current || requestId !== connectRequestRef.current) {
        return;
      }

      const nextParticipants = await client.getParticipants();
      dispatch({ type: 'participantsChanged', participants: nextParticipants });
    },
    [client],
  );

  const disconnect = useCallback(async () => {
    connectRequestRef.current += 1;
    roomIdRef.current = undefined;
    try {
      await client.disconnect();
    } catch (error) {
      dispatch({
        type: 'connectionErrorChanged',
        errorMessage: getErrorMessage(error),
      });
    } finally {
      dispatch({ type: 'reset' });
    }
  }, [client]);

  const reconnect = useCallback(
    async (options: VoiceConnectOptions) => {
      await disconnect();
      await connect(options);
    },
    [connect, disconnect],
  );

  const muteMic = useCallback(async () => {
    try {
      await client.muteMic();
      dispatch({ type: 'micMutedChanged', isMicMuted: true });
    } catch (error) {
      dispatch({
        type: 'connectionErrorChanged',
        errorMessage: getErrorMessage(error),
      });
    }
  }, [client]);

  const unmuteMic = useCallback(async () => {
    try {
      await client.unmuteMic();
      dispatch({ type: 'micMutedChanged', isMicMuted: false });
    } catch (error) {
      dispatch({
        type: 'connectionErrorChanged',
        errorMessage: getErrorMessage(error),
      });
    }
  }, [client]);

  const setSpeakerEnabled = useCallback(
    async (enabled: boolean) => {
      try {
        await client.setSpeakerEnabled(enabled);
        dispatch({ type: 'speakerEnabledChanged', isSpeakerEnabled: enabled });
      } catch (error) {
        dispatch({
          type: 'connectionErrorChanged',
          errorMessage: getErrorMessage(error),
        });
      }
    },
    [client],
  );

  const setConnectionError = useCallback((error: unknown) => {
    dispatch({
      type: 'connectionErrorChanged',
      errorMessage: getErrorMessage(error),
    });
  }, []);

  const executeCommand = useCallback(
    async (type: 'mute' | 'kick' | 'report' | 'block', participantId: string) => {
      const result = await client.executeRoomCommand({ participantId, type });
      dispatch({ type: 'commandCompleted', result });
      return result;
    },
    [client],
  );

  const muteParticipant = useCallback(
    (participantId: string) => executeCommand('mute', participantId),
    [executeCommand],
  );

  const kickParticipant = useCallback(
    (participantId: string) => executeCommand('kick', participantId),
    [executeCommand],
  );

  const reportParticipant = useCallback(
    (participantId: string) => executeCommand('report', participantId),
    [executeCommand],
  );

  const blockParticipant = useCallback(
    (participantId: string) => executeCommand('block', participantId),
    [executeCommand],
  );

  const speakers = useMemo(
    () => state.participants.filter((participant) => participant.role !== 'listener'),
    [state.participants],
  );
  const listeners = useMemo(
    () => state.participants.filter((participant) => participant.role === 'listener'),
    [state.participants],
  );
  const session: VoiceRoomSession = useMemo(
    () => ({
      connectionState: state.connectionState,
      canPublishAudio: state.canPublishAudio,
      errorMessage: state.errorMessage,
      isConnected: state.connectionState === 'connected',
      isConnecting: state.connectionState === 'connecting',
      isMicMuted: state.isMicMuted,
      isSpeakerEnabled: state.isSpeakerEnabled,
      listeners,
      participants: state.participants,
      roomId: state.roomId,
      speakers,
      speakingParticipantIds: state.speakingParticipantIds,
    }),
    [
      state.connectionState,
      state.canPublishAudio,
      state.errorMessage,
      state.isMicMuted,
      state.isSpeakerEnabled,
      state.participants,
      state.roomId,
      state.speakingParticipantIds,
      listeners,
      speakers,
    ],
  );

  return {
    ...session,
    blockParticipant,
    connect,
    disconnect,
    kickParticipant,
    lastCommandResult: state.lastCommandResult,
    muteMic,
    muteParticipant,
    reconnect,
    reportParticipant,
    setConnectionError,
    setSpeakerEnabled,
    unmuteMic,
  };
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (
      error.message === 'Voice room is not connected.' ||
      error.message === 'Voice audio session is not active.'
    ) {
      return 'Voice room is not connected.';
    }

    if (
      error.message === 'Microphone permission is required for voice chat.' ||
      error.message === 'No microphone is available for voice chat.' ||
      error.message === 'Microphone setup failed.' ||
      error.message === 'Voice token request timed out.' ||
      error.message === 'Voice token request failed.' ||
      error.message === 'Requested voice audio output is not available.'
    ) {
      return error.message;
    }

    return 'Voice operation failed.';
  }

  return 'Voice connection failed.';
}
