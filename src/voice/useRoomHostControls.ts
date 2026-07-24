import { useCallback, useMemo, useRef, useState } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { VoiceRoom } from '../types/voice';
import { RoomCommandRequestError, RoomSettingsPatch, requestRoomCommand } from './requestRoomCommand';
import { useVoiceProviderConfig } from './useVoiceProviderConfig';

export type HostControlStatus = 'idle' | 'loading' | 'error';

export function useRoomHostControls(room: VoiceRoom) {
  const { authUser } = useAuth();
  const providerConfig = useVoiceProviderConfig();
  const [hostControlStatus, setHostControlStatus] = useState<HostControlStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>();
  const pendingKeysRef = useRef(new Set<string>());
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const isHost = useMemo(
    () =>
      room.status === 'active' &&
      room.localMember?.status !== 'removed' &&
      (
        room.localMember?.authorityRole === 'owner' ||
        room.localMember?.authorityRole === 'moderator' ||
        room.localMember?.role === 'host' ||
        (!room.localMember && authUser?.uid === (room.ownerUid || room.hostId))
      ),
    [authUser?.uid, room.hostId, room.localMember, room.ownerUid, room.status],
  );
  const isOwner = room.localMember?.authorityRole === 'owner'
    || (!room.localMember && authUser?.uid === (room.ownerUid || room.hostId));
  const isModerator = room.localMember?.authorityRole === 'moderator';

  const runCommand = useCallback(
    async (input: Parameters<typeof requestRoomCommand>[0]) => {
      const commandKey = `${input.action}:${input.targetUid || ''}`;
      if (pendingKeysRef.current.has(commandKey)) return;
      pendingKeysRef.current.add(commandKey);
      setPendingKeys([...pendingKeysRef.current]);
      setHostControlStatus('loading');
      setErrorMessage(undefined);
      let failed = false;

      try {
        await requestRoomCommand({ ...input, expectedRevision: room.revision ?? 1 }, providerConfig.liveKit);
        setHostControlStatus('idle');
      } catch (error) {
        failed = true;
        setHostControlStatus('error');
        setErrorMessage(error instanceof RoomCommandRequestError ? error.message : 'تعذر تنفيذ أمر الغرفة.');
        throw error;
      } finally {
        pendingKeysRef.current.delete(commandKey);
        setPendingKeys([...pendingKeysRef.current]);
        if (pendingKeysRef.current.size === 0 && !failed) setHostControlStatus('idle');
      }
    },
    [providerConfig.liveKit, room.revision],
  );

  return {
    closeRoom: () => runCommand({ roomId: room.id, action: 'close-room' }),
    removeRoom: (reason: string) => runCommand({ roomId: room.id, action: 'remove-room', reason }),
    updateRoomSettings: (settings: RoomSettingsPatch) =>
      runCommand({ roomId: room.id, action: 'update-room-settings', settings }),
    lockAudio: () => runCommand({ roomId: room.id, action: 'lock-audio' }),
    unlockAudio: () => runCommand({ roomId: room.id, action: 'unlock-audio' }),
    assignModerator: (targetUid: string) =>
      runCommand({ roomId: room.id, action: 'assign-moderator', targetUid }),
    removeModerator: (targetUid: string) =>
      runCommand({ roomId: room.id, action: 'remove-moderator', targetUid }),
    grantDj: (targetUid: string) =>
      runCommand({ roomId: room.id, action: 'grant-dj', targetUid }),
    revokeDj: (targetUid: string) =>
      runCommand({ roomId: room.id, action: 'revoke-dj', targetUid }),
    transferOwnership: (targetUid: string) =>
      runCommand({ roomId: room.id, action: 'transfer-ownership', targetUid }),
    banMember: (targetUid: string, reason: string) =>
      runCommand({ roomId: room.id, action: 'ban-member', targetUid, reason }),
    unbanMember: (targetUid: string) =>
      runCommand({ roomId: room.id, action: 'unban-member', targetUid }),
    demoteToListener: (targetUid: string) =>
      runCommand({ roomId: room.id, action: 'demote-listener', targetUid }),
    hostControlStatus,
    errorMessage,
    isHost,
    isOwner,
    isModerator,
    isCommandPending: (action: string, targetUid?: string) => pendingKeys.includes(`${action}:${targetUid || ''}`),
    promoteToSpeaker: (targetUid: string) =>
      runCommand({ roomId: room.id, action: 'promote-speaker', targetUid }),
    removeMember: (targetUid: string) =>
      runCommand({ roomId: room.id, action: 'remove-member', targetUid }),
    reportMember: (targetUid: string, reason?: string) =>
      runCommand({ roomId: room.id, action: 'report-member', targetUid, reason }),
  };
}
