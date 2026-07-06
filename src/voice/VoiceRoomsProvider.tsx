import { PropsWithChildren, createContext, useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore';

import { useAuth } from '../auth/AuthProvider';
import { firebaseDb } from '../auth/firebase';
import { mockVoiceRooms } from '../data/mockVoiceRooms';
import { VoiceRoom, VoiceRoomType } from '../types/voice';
import { createMockVoiceRoomDraft } from './createMockVoiceRoomDraft';
import {
  CreateRoomInput,
  RoomsStatus,
  createRoomDocument,
  createRoomMemberDocument,
  mapRoomDocument,
  mapRoomDocumentToVoiceRoom,
  mapRoomMemberDocument,
} from './roomProfile';

type VoiceRoomsContextValue = {
  rooms: VoiceRoom[];
  roomsStatus: RoomsStatus;
  createRoom: (input: CreateRoomInput) => Promise<VoiceRoom>;
  createDraftRoom: (type: VoiceRoomType, title?: string) => Promise<VoiceRoom>;
  getRoomById: (roomId: string) => VoiceRoom;
  joinRoom: (roomId: string) => Promise<VoiceRoom>;
};

export const VoiceRoomsContext = createContext<VoiceRoomsContextValue | undefined>(undefined);

export function VoiceRoomsProvider({ children }: PropsWithChildren) {
  const { authUser } = useAuth();
  const [firestoreRooms, setFirestoreRooms] = useState<VoiceRoom[]>([]);
  const [joinedRoomOverrides, setJoinedRoomOverrides] = useState<Record<string, VoiceRoom>>({});
  const [roomsStatus, setRoomsStatus] = useState<RoomsStatus>('loading');
  const rooms = useMemo(
    () => {
      const sourceRooms = firestoreRooms.length > 0 ? firestoreRooms : mockVoiceRooms;

      return sourceRooms.map((room) => joinedRoomOverrides[room.id] ?? room);
    },
    [firestoreRooms, joinedRoomOverrides],
  );
  const joinedRoomIds = useMemo(() => Object.keys(joinedRoomOverrides).sort(), [joinedRoomOverrides]);
  const joinedRoomIdsKey = joinedRoomIds.join('|');

  useEffect(() => {
    if (!authUser) {
      setFirestoreRooms([]);
      setRoomsStatus('ready');
      return undefined;
    }

    setRoomsStatus('loading');

    return onSnapshot(
      query(collection(firebaseDb, 'rooms'), where('status', '==', 'active')),
      (snapshot) => {
        const nextRooms = snapshot.docs
          .map((roomSnapshot) => mapRoomDocument(roomSnapshot.data(), roomSnapshot.id))
          .filter((room): room is NonNullable<typeof room> => room !== null)
          .map((room) => mapRoomDocumentToVoiceRoom(room));

        setFirestoreRooms(nextRooms);
        setRoomsStatus('ready');
      },
      () => {
        setFirestoreRooms([]);
        setRoomsStatus('error');
      },
    );
  }, [authUser]);

  useEffect(() => {
    if (!authUser || joinedRoomIds.length === 0) {
      return undefined;
    }

    const unsubscribeCallbacks = joinedRoomIds.flatMap((roomId) => {
      const roomRef = doc(firebaseDb, 'rooms', roomId);
      const memberRef = doc(firebaseDb, 'rooms', roomId, 'members', authUser.uid);

      return [
        onSnapshot(roomRef, (snapshot) => {
          const roomDocument = snapshot.exists() ? mapRoomDocument(snapshot.data(), snapshot.id) : null;

          if (!roomDocument) {
            return;
          }

          setJoinedRoomOverrides((currentRooms) => {
            const currentRoom = currentRooms[roomId];

            if (!currentRoom) {
              return currentRooms;
            }

            return {
              ...currentRooms,
              [roomId]: {
                ...mapRoomDocumentToVoiceRoom(roomDocument),
                localMember: currentRoom.localMember,
              },
            };
          });
        }),
        onSnapshot(memberRef, (snapshot) => {
          const memberDocument = snapshot.exists() ? mapRoomMemberDocument(snapshot.data()) : null;

          if (!memberDocument) {
            return;
          }

          setJoinedRoomOverrides((currentRooms) => {
            const currentRoom = currentRooms[roomId];

            if (!currentRoom) {
              return currentRooms;
            }

            return {
              ...currentRooms,
              [roomId]: {
                ...currentRoom,
                localMember: {
                  id: memberDocument.uid,
                  displayName: memberDocument.displayName,
                  avatarLabel: memberDocument.avatarLabel,
                  role: memberDocument.role,
                  status: memberDocument.status,
                  canPublishAudio: memberDocument.canPublishAudio,
                },
              },
            };
          });
        }),
      ];
    });

    return () => {
      unsubscribeCallbacks.forEach((unsubscribe) => unsubscribe());
    };
  }, [authUser, authUser?.uid, joinedRoomIdsKey]);

  const createRoom = useCallback(
    async (input: CreateRoomInput) => {
      if (!authUser) {
        throw new Error('A complete signed-in profile is required to create a room.');
      }

      const roomRef = doc(collection(firebaseDb, 'rooms'));
      const memberRef = doc(firebaseDb, 'rooms', roomRef.id, 'members', authUser.uid);
      const roomDocument = createRoomDocument(roomRef.id, input, authUser);
      const memberDocument = createRoomMemberDocument(authUser, 'host');
      const batch = writeBatch(firebaseDb);

      batch.set(roomRef, {
        ...roomDocument,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(memberRef, {
        ...memberDocument,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await batch.commit();

      const room = {
        ...mapRoomDocumentToVoiceRoom(roomDocument, [memberDocument]),
        localMember: {
          id: memberDocument.uid,
          displayName: memberDocument.displayName,
          avatarLabel: memberDocument.avatarLabel,
          role: memberDocument.role,
          status: memberDocument.status,
          canPublishAudio: memberDocument.canPublishAudio,
        },
      };

      setJoinedRoomOverrides((currentRooms) => ({ ...currentRooms, [room.id]: room }));

      return room;
    },
    [authUser],
  );

  const createDraftRoom = useCallback(
    (type: VoiceRoomType, title?: string) => createRoom({ type, title }),
    [createRoom],
  );

  const joinRoom = useCallback(
    async (roomId: string) => {
      if (!authUser) {
        throw new Error('A complete signed-in profile is required to join a room.');
      }

      const fallbackRoom = mockVoiceRooms.find((room) => room.id === roomId);

      if (fallbackRoom && (roomsStatus === 'error' || firestoreRooms.length === 0)) {
        return fallbackRoom;
      }

      const roomRef = doc(firebaseDb, 'rooms', roomId);
      const memberRef = doc(firebaseDb, 'rooms', roomId, 'members', authUser.uid);

      const room = await runTransaction(firebaseDb, async (transaction) => {
        const roomSnapshot = await transaction.get(roomRef);

        if (!roomSnapshot.exists()) {
          throw new Error('Room was not found.');
        }

        const roomDocument = mapRoomDocument(roomSnapshot.data(), roomSnapshot.id);

        if (!roomDocument || roomDocument.status !== 'active') {
          throw new Error('Room is not available.');
        }

        const existingMember = await transaction.get(memberRef);
        const existingMemberData = existingMember.data();
        const role =
          existingMemberData?.role === 'host' || existingMemberData?.role === 'speaker'
            ? existingMemberData.role
            : 'listener';
        const memberDocument = createRoomMemberDocument(authUser, role);
        transaction.set(
          memberRef,
          {
            ...memberDocument,
            joinedAt: existingMember.exists() ? existingMember.data().joinedAt : serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );

        if (!existingMember.exists()) {
          transaction.update(roomRef, {
            participantCount: increment(1),
            updatedAt: serverTimestamp(),
          });
        }

        return {
          ...mapRoomDocumentToVoiceRoom(roomDocument, [memberDocument]),
          localMember: {
            id: memberDocument.uid,
            displayName: memberDocument.displayName,
            avatarLabel: memberDocument.avatarLabel,
            role: memberDocument.role,
            status: memberDocument.status,
            canPublishAudio: memberDocument.canPublishAudio,
          },
        };
      });

      setJoinedRoomOverrides((currentRooms) => ({ ...currentRooms, [room.id]: room }));

      return room;
    },
    [authUser, firestoreRooms.length, roomsStatus],
  );

  const getRoomById = useCallback(
    (roomId: string) => {
      return (
        joinedRoomOverrides[roomId] ??
        rooms.find((room) => room.id === roomId) ??
        createMockVoiceRoomDraft({
          host: authUser
            ? {
                avatarLabel: authUser.avatarLabel,
                displayName: authUser.displayName,
                id: authUser.uid,
              }
            : undefined,
          id: roomId,
          type: roomId.includes('game') ? 'game' : 'voice',
        })
      );
    },
    [authUser, joinedRoomOverrides, rooms],
  );

  const value = useMemo(
    () => ({
      createDraftRoom,
      createRoom,
      getRoomById,
      joinRoom,
      rooms,
      roomsStatus,
    }),
    [createDraftRoom, createRoom, getRoomById, joinRoom, rooms, roomsStatus],
  );

  return <VoiceRoomsContext.Provider value={value}>{children}</VoiceRoomsContext.Provider>;
}
