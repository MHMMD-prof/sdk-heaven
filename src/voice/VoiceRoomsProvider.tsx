import { PropsWithChildren, createContext, useCallback, useMemo, useRef, useState } from 'react';

import { mockVoiceRooms } from '../data/mockVoiceRooms';
import { VoiceRoom, VoiceRoomType } from '../types/voice';
import { createMockVoiceRoomDraft } from './createMockVoiceRoomDraft';

type VoiceRoomsContextValue = {
  rooms: VoiceRoom[];
  createDraftRoom: (type: VoiceRoomType, title?: string) => VoiceRoom;
  getRoomById: (roomId: string) => VoiceRoom;
};

export const VoiceRoomsContext = createContext<VoiceRoomsContextValue | undefined>(undefined);

export function VoiceRoomsProvider({ children }: PropsWithChildren) {
  const [draftRooms, setDraftRooms] = useState<VoiceRoom[]>([]);
  const draftCounterRef = useRef(0);
  const rooms = useMemo(() => [...draftRooms, ...mockVoiceRooms], [draftRooms]);

  const createDraftRoom = useCallback((type: VoiceRoomType, title?: string) => {
    draftCounterRef.current += 1;
    const draftRoom = createMockVoiceRoomDraft({
      id: `draft-${type}-${draftCounterRef.current}`,
      title,
      type,
    });

    setDraftRooms((currentRooms) => [draftRoom, ...currentRooms]);

    return draftRoom;
  }, []);

  const getRoomById = useCallback(
    (roomId: string) => {
      return (
        rooms.find((room) => room.id === roomId) ??
        createMockVoiceRoomDraft({
          id: roomId,
          type: roomId.includes('game') ? 'game' : 'voice',
        })
      );
    },
    [rooms],
  );

  const value = useMemo(
    () => ({
      createDraftRoom,
      getRoomById,
      rooms,
    }),
    [createDraftRoom, getRoomById, rooms],
  );

  return <VoiceRoomsContext.Provider value={value}>{children}</VoiceRoomsContext.Provider>;
}
