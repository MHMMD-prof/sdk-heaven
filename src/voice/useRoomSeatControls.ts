import { useCallback, useMemo, useRef, useState } from 'react';

import { VoiceRoom } from '../types/voice';
import {
  RoomCommandRequest,
  RoomCommandRequestError,
  createRoomCommandRequestId,
  requestRoomCommand,
} from './requestRoomCommand';
import { RoomSeatMode } from './roomV2Contract';
import { useVoiceProviderConfig } from './useVoiceProviderConfig';

export function useRoomSeatControls(room: VoiceRoom) {
  const providerConfig = useVoiceProviderConfig();
  const sessionId = useMemo(() => `session_${createRoomCommandRequestId()}`, [room.id]);
  const pendingRef = useRef(new Set<string>());
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string>();

  const run = useCallback(async (request: Omit<RoomCommandRequest, 'roomId'>) => {
    const key = `${request.action}:${request.seatId || ''}:${request.targetUid || ''}`;
    if (pendingRef.current.has(key)) return undefined;
    pendingRef.current.add(key);
    setPendingKeys([...pendingRef.current]);
    setErrorMessage(undefined);
    try {
      return await requestRoomCommand({
        ...request,
        roomId: room.id,
        expectedRevision: request.expectedRevision ?? room.revision ?? 1,
        sessionId: request.sessionId ?? sessionId,
      }, providerConfig.liveKit);
    } catch (error) {
      setErrorMessage(error instanceof RoomCommandRequestError ? error.message : 'تعذر تنفيذ أمر مقعد الميكروفون.');
      throw error;
    } finally {
      pendingRef.current.delete(key);
      setPendingKeys([...pendingRef.current]);
    }
  }, [providerConfig.liveKit, room.id, room.revision, sessionId]);

  return useMemo(() => ({
    acceptInvite: (seatId: string) => run({ action: 'accept-seat-invite', seatId }),
    approveRequest: (targetUid: string, seatId: string) => run({ action: 'approve-seat-request', seatId, targetUid }),
    cancelRequest: () => run({ action: 'cancel-seat-request' }),
    claimSeat: (seatId: string) => run({ action: 'claim-seat', seatId }),
    declineInvite: () => run({ action: 'decline-seat-invite' }),
    errorMessage,
    inviteToSeat: (targetUid: string, seatId: string) => run({ action: 'invite-to-seat', seatId, targetUid }),
    isPending: (action: RoomCommandRequest['action'], seatId = '', targetUid = '') =>
      pendingKeys.includes(`${action}:${seatId}:${targetUid}`),
    leaveSeat: () => run({ action: 'leave-seat' }),
    lockSeat: (seatId: string) => run({ action: 'lock-seat', seatId }),
    rejectRequest: (targetUid: string) => run({ action: 'reject-seat-request', targetUid }),
    requestSeat: (seatId: string) => run({ action: 'request-seat', seatId }),
    reserveSeat: () => run({ action: 'reserve-seat' }),
    resizeSeats: (seatTargetCount: 5 | 10 | 15 | 20) => run({ action: 'resize-seats', seatTargetCount }),
    resumeSeat: () => run({ action: 'resume-seat' }),
    sessionId,
    setSeatMode: (seatMode: RoomSeatMode) => run({ action: 'set-seat-mode', seatMode }),
    unlockSeat: (seatId: string) => run({ action: 'unlock-seat', seatId }),
  }), [errorMessage, pendingKeys, run, sessionId]);
}
