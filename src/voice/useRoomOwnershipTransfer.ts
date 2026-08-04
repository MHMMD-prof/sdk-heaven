import { useCallback, useEffect, useState } from 'react';

import { VoiceRoom } from '../types/voice';
import {
  reauthenticateRoomOwnership,
  requestRoomOwnershipCommand,
  RoomOwnershipCommandResult,
  RoomOwnershipRequestError,
} from './requestRoomOwnershipCommand';
import { useVoiceProviderConfig } from './useVoiceProviderConfig';

export type RoomOwnershipTransferRecord = {
  id: string;
  expiresAtMs: number;
  fromUid: string;
  roomId: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  toUid: string;
};

export function useRoomOwnershipTransfer(room: VoiceRoom, enabled: boolean) {
  const providerConfig = useVoiceProviderConfig();
  const [transfer, setTransfer] = useState<RoomOwnershipTransferRecord>();
  const [pendingAction, setPendingAction] = useState<string>();
  const [errorMessage, setErrorMessage] = useState<string>();

  useEffect(() => {
    if (!enabled || !room.pendingOwnershipTransferId || !room.localMember?.id) {
      setTransfer(undefined);
      return undefined;
    }
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void Promise.all([import('../auth/firebase'), import('firebase/firestore')])
      .then(([{ firebaseDb }, { doc, onSnapshot }]) => {
        if (!active) return;
        unsubscribe = onSnapshot(
          doc(firebaseDb, 'rooms', room.id, 'ownershipTransfers', room.pendingOwnershipTransferId!),
          (snapshot) => {
            const data = snapshot.data();
            if (!snapshot.exists() || !data) {
              setTransfer(undefined);
              return;
            }
            const expiresAtMs = typeof data.expiresAt?.toMillis === 'function'
              ? data.expiresAt.toMillis()
              : 0;
            setTransfer({
              expiresAtMs,
              fromUid: typeof data.fromUid === 'string' ? data.fromUid : '',
              id: snapshot.id,
              roomId: room.id,
              status: data.status,
              toUid: typeof data.toUid === 'string' ? data.toUid : '',
            });
          },
          () => setTransfer(undefined),
        );
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [enabled, room.id, room.localMember?.id, room.pendingOwnershipTransferId]);

  const run = useCallback(async (
    action: 'offer' | 'accept' | 'decline' | 'cancel',
    options: { password?: string; targetUid?: string; transferId?: string } = {},
  ): Promise<RoomOwnershipCommandResult> => {
    if (pendingAction) throw new Error('Ownership command is already pending.');
    setPendingAction(action);
    setErrorMessage(undefined);
    try {
      if (action === 'offer' || action === 'accept') {
        await reauthenticateRoomOwnership(options.password || '');
      }
      return await requestRoomOwnershipCommand({
        action: action === 'offer'
          ? 'offer-ownership-transfer'
          : action === 'accept'
            ? 'accept-ownership-transfer'
            : action === 'decline'
              ? 'decline-ownership-transfer'
              : 'cancel-ownership-transfer',
        expectedOwnershipRevision: action === 'offer' ? room.ownershipRevision ?? 1 : undefined,
        roomId: room.id,
        targetUid: action === 'offer' ? options.targetUid : undefined,
        transferId: action === 'offer' ? undefined : options.transferId,
      }, providerConfig.liveKit);
    } catch (error) {
      const message = error instanceof RoomOwnershipRequestError
        ? error.message
        : 'تعذر تنفيذ أمر ملكية الغرفة.';
      setErrorMessage(message);
      throw error;
    } finally {
      setPendingAction(undefined);
    }
  }, [pendingAction, providerConfig.liveKit, room.id, room.ownershipRevision]);

  return {
    accept: (password: string) => run('accept', { password, transferId: transfer?.id }),
    cancel: () => run('cancel', { transferId: transfer?.id || room.pendingOwnershipTransferId }),
    decline: () => run('decline', { transferId: transfer?.id }),
    errorMessage,
    offer: (targetUid: string, password: string) => run('offer', { password, targetUid }),
    pendingAction,
    transfer,
  };
}
