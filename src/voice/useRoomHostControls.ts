import { useCallback, useMemo, useState } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { VoiceRoom } from '../types/voice';
import { requestRoomCommand } from './requestRoomCommand';
import { useVoiceProviderConfig } from './useVoiceProviderConfig';

export type HostControlStatus = 'idle' | 'loading' | 'error';

export function useRoomHostControls(room: VoiceRoom) {
  const { authUser } = useAuth();
  const providerConfig = useVoiceProviderConfig();
  const [hostControlStatus, setHostControlStatus] = useState<HostControlStatus>('idle');
  const isHost = useMemo(
    () =>
      room.status === 'active' &&
      room.localMember?.status !== 'removed' &&
      (room.localMember?.role === 'host' || (!room.localMember && authUser?.uid === room.hostId)),
    [authUser?.uid, room.hostId, room.localMember, room.status],
  );

  const runCommand = useCallback(
    async (input: Parameters<typeof requestRoomCommand>[0]) => {
      setHostControlStatus('loading');

      try {
        await requestRoomCommand(input, providerConfig.liveKit);
        setHostControlStatus('idle');
      } catch (error) {
        setHostControlStatus('error');
        throw error;
      }
    },
    [providerConfig.liveKit],
  );

  return {
    closeRoom: () => runCommand({ roomId: room.id, action: 'close-room' }),
    demoteToListener: (targetUid: string) =>
      runCommand({ roomId: room.id, action: 'demote-listener', targetUid }),
    hostControlStatus,
    isHost,
    promoteToSpeaker: (targetUid: string) =>
      runCommand({ roomId: room.id, action: 'promote-speaker', targetUid }),
    removeMember: (targetUid: string) =>
      runCommand({ roomId: room.id, action: 'remove-member', targetUid }),
    reportMember: (targetUid: string, reason?: string) =>
      runCommand({ roomId: room.id, action: 'report-member', targetUid, reason }),
  };
}
