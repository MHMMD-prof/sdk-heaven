import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { activeVoiceProviderConfig } from './activeVoiceProviderConfig';
import {
  ROOM_RECORDING_POLICY_VERSION,
  RoomRecordingStatus,
  requestRoomRecordingCommand,
} from './requestRoomRecordingCommand';
import { useVoiceRoomFeatureFlags } from './voiceRoomFeatureFlags';

type UseRoomRecordingOptions = {
  enabled: boolean;
  roomId: string;
};

export function useRoomRecordingSafety({ enabled, roomId }: UseRoomRecordingOptions) {
  const flags = useVoiceRoomFeatureFlags();
  const [status, setStatus] = useState<RoomRecordingStatus | null>(null);
  const [noticeVisible, setNoticeVisible] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled || !flags.safetyRecording || !roomId) {
      setStatus(null);
      setNoticeVisible(false);
      return;
    }
    try {
      const result = await requestRoomRecordingCommand(
        { action: 'get-recording-status', roomId },
        activeVoiceProviderConfig.liveKit,
      );
      const next = result.status || null;
      setStatus(next);
      setNoticeVisible(Boolean(next?.featureEnabled && !next.noticeAcknowledged));
      if (next?.featureEnabled) {
        await requestRoomRecordingCommand(
          { action: 'ensure-rolling-session', roomId },
          activeVoiceProviderConfig.liveKit,
        ).catch(() => undefined);
      }
    } catch {
      setStatus(null);
    }
  }, [enabled, flags.safetyRecording, roomId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const acknowledgeNotice = useCallback(async () => {
    try {
      await requestRoomRecordingCommand(
        {
          action: 'acknowledge-recording-notice',
          noticeVersion: ROOM_RECORDING_POLICY_VERSION,
          roomId,
        },
        activeVoiceProviderConfig.liveKit,
      );
      setNoticeVisible(false);
      await refresh();
    } catch (error) {
      Alert.alert(
        'تسجيل الأمان',
        error instanceof Error ? error.message : 'تعذّر حفظ الموافقة.',
      );
    }
  }, [refresh, roomId]);

  return {
    acknowledgeNotice,
    indicatorActive: status?.featureEnabled === true,
    noticeVisible,
    refresh,
    status,
  };
}
