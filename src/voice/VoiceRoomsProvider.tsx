import { PropsWithChildren, createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
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
  JoinPrivateRoomInput,
  RoomsStatus,
  canJoinRoomWithInvite,
  createRoomDocument,
  createRoomMemberDocument,
  mapRoomDocument,
  mapRoomDocumentToVoiceRoom,
  mapRoomMemberDocument,
} from './roomProfile';
import { applyRoomPresence, mapRoomPresenceDocument } from './roomPresence';

type VoiceRoomsContextValue = {
  rooms: VoiceRoom[];
  roomsStatus: RoomsStatus;
  createRoom: (input: CreateRoomInput) => Promise<VoiceRoom>;
  createDraftRoom: (type: VoiceRoomType, title?: string) => Promise<VoiceRoom>;
  createPrivateRoom: (input: CreateRoomInput) => Promise<VoiceRoom>;
  getRoomById: (roomId: string) => VoiceRoom;
  joinRoom: (roomId: string) => Promise<VoiceRoom>;
  joinPrivateRoom: (input: JoinPrivateRoomInput) => Promise<VoiceRoom>;
  startRoomPresence: (roomId: string) => void;
  stopRoomPresence: (roomId: string) => Promise<void>;
};

export const VoiceRoomsContext = createContext<VoiceRoomsContextValue | undefined>(undefined);

export function VoiceRoomsProvider({ children }: PropsWithChildren) {
  const { authUser } = useAuth();
  const [firestoreRooms, setFirestoreRooms] = useState<VoiceRoom[]>([]);
  const [joinedRoomOverrides, setJoinedRoomOverrides] = useState<Record<string, VoiceRoom>>({});
  const [activePresenceRoomIds, setActivePresenceRoomIds] = useState<string[]>([]);
  const [roomsStatus, setRoomsStatus] = useState<RoomsStatus>('loading');
  const joinedRoomBaseRef = useRef<Record<string, VoiceRoom>>({});
  const joinedRoomOverridesRef = useRef(joinedRoomOverrides);
  const presenceJoinedRoomIdsRef = useRef<Set<string>>(new Set());
  const rooms = useMemo(
    () => {
      const sourceRooms = firestoreRooms.length > 0 ? firestoreRooms : mockVoiceRooms;

      return sourceRooms.map((room) => joinedRoomOverrides[room.id] ?? room);
    },
    [firestoreRooms, joinedRoomOverrides],
  );
  const joinedRoomIds = useMemo(() => Object.keys(joinedRoomOverrides).sort(), [joinedRoomOverrides]);
  const joinedRoomIdsKey = joinedRoomIds.join('|');
  const activePresenceRoomIdsKey = activePresenceRoomIds.join('|');

  useEffect(() => {
    joinedRoomOverridesRef.current = joinedRoomOverrides;
  }, [joinedRoomOverrides]);

  useEffect(() => {
    if (!authUser) {
      setFirestoreRooms([]);
      setRoomsStatus('ready');
      return undefined;
    }

    setRoomsStatus('loading');

    return onSnapshot(
      query(collection(firebaseDb, 'rooms'), where('status', '==', 'active'), where('visibility', '==', 'public')),
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

            const nextBaseRoom = {
              ...mapRoomDocumentToVoiceRoom(roomDocument),
              localMember: currentRoom.localMember,
            };
            joinedRoomBaseRef.current = {
              ...joinedRoomBaseRef.current,
              [roomId]: nextBaseRoom,
            };

            return {
              ...currentRooms,
              [roomId]: nextBaseRoom,
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

            const baseRoom = joinedRoomBaseRef.current[roomId] ?? currentRoom;
            const nextBaseRoom = {
              ...baseRoom,
              localMember: {
                id: memberDocument.uid,
                displayName: memberDocument.displayName,
                avatarLabel: memberDocument.avatarLabel,
                role: memberDocument.role,
                status: memberDocument.status,
                canPublishAudio: memberDocument.canPublishAudio,
              },
            };
            joinedRoomBaseRef.current = {
              ...joinedRoomBaseRef.current,
              [roomId]: nextBaseRoom,
            };

            return {
              ...currentRooms,
              [roomId]: nextBaseRoom,
            };
          });
        }),
        onSnapshot(collection(firebaseDb, 'rooms', roomId, 'presence'), (snapshot) => {
          const presenceDocuments = snapshot.docs
            .map((presenceSnapshot) => mapRoomPresenceDocument(presenceSnapshot.data()))
            .filter((presence): presence is NonNullable<typeof presence> => presence !== null);

          setJoinedRoomOverrides((currentRooms) => {
            const currentRoom = currentRooms[roomId];

            if (!currentRoom) {
              return currentRooms;
            }

            return {
              ...currentRooms,
              [roomId]: applyRoomPresence(joinedRoomBaseRef.current[roomId] ?? currentRoom, presenceDocuments),
            };
          });
        }),
      ];
    });

    return () => {
      unsubscribeCallbacks.forEach((unsubscribe) => unsubscribe());
    };
  }, [authUser, authUser?.uid, joinedRoomIdsKey]);

  const writeRoomPresence = useCallback(
    async (room: VoiceRoom, status: 'online' | 'stale') => {
      if (!authUser || room.status !== 'active' || room.localMember?.status === 'removed') {
        return;
      }

      const member = room.localMember;

      if (!member?.role || typeof member.canPublishAudio !== 'boolean') {
        return;
      }

      const hasJoinedPresence = presenceJoinedRoomIdsRef.current.has(room.id);
      const presencePayload = {
        uid: authUser.uid,
        displayName: member.displayName,
        avatarLabel: member.avatarLabel,
        role: member.role,
        status,
        canPublishAudio: member.canPublishAudio,
        lastSeenAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...(hasJoinedPresence ? {} : { joinedAt: serverTimestamp() }),
      };

      await setDoc(doc(firebaseDb, 'rooms', room.id, 'presence', authUser.uid), presencePayload, { merge: true });
      presenceJoinedRoomIdsRef.current.add(room.id);
    },
    [authUser],
  );

  useEffect(() => {
    if (!authUser || activePresenceRoomIds.length === 0) {
      return undefined;
    }

    if (!activePresenceRoomIds.some((roomId) => joinedRoomOverridesRef.current[roomId])) {
      return undefined;
    }

    const heartbeat = () => {
      activePresenceRoomIds
        .map((roomId) => joinedRoomOverridesRef.current[roomId])
        .filter((room): room is VoiceRoom => !!room)
        .forEach((room) => {
          void writeRoomPresence(room, 'online');
        });
    };
    heartbeat();

    const heartbeatId = setInterval(heartbeat, 20_000);

    return () => {
      clearInterval(heartbeatId);
      activePresenceRoomIds
        .map((roomId) => joinedRoomOverridesRef.current[roomId])
        .filter((room): room is VoiceRoom => !!room)
        .forEach((room) => {
          void writeRoomPresence(room, 'stale');
        });
    };
  }, [activePresenceRoomIds, activePresenceRoomIdsKey, authUser, writeRoomPresence]);

  const startRoomPresence = useCallback((roomId: string) => {
    setActivePresenceRoomIds((currentRoomIds) =>
      currentRoomIds.includes(roomId) ? currentRoomIds : [...currentRoomIds, roomId].sort(),
    );
  }, []);

  const stopRoomPresence = useCallback(
    async (roomId: string) => {
      setActivePresenceRoomIds((currentRoomIds) => currentRoomIds.filter((currentRoomId) => currentRoomId !== roomId));

      const room = joinedRoomOverridesRef.current[roomId];

      if (room) {
        await writeRoomPresence(room, 'stale');
      }
    },
    [writeRoomPresence],
  );

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
      joinedRoomBaseRef.current = { ...joinedRoomBaseRef.current, [room.id]: room };

      return room;
    },
    [authUser],
  );

  const createDraftRoom = useCallback(
    (type: VoiceRoomType, title?: string) => createRoom({ type, title }),
    [createRoom],
  );

  const createPrivateRoom = useCallback(
    (input: CreateRoomInput) => createRoom({ ...input, visibility: 'private' }),
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
        if (roomDocument.visibility === 'private' && !existingMember.exists()) {
          throw new Error('Private room invite is required.');
        }

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
      joinedRoomBaseRef.current = { ...joinedRoomBaseRef.current, [room.id]: room };

      return room;
    },
    [authUser, firestoreRooms.length, roomsStatus],
  );

  const joinPrivateRoom = useCallback(
    async (input: JoinPrivateRoomInput) => {
      if (!authUser) {
        throw new Error('A complete signed-in profile is required to join a private room.');
      }

      const roomRef = doc(firebaseDb, 'rooms', input.roomId);
      const memberRef = doc(firebaseDb, 'rooms', input.roomId, 'members', authUser.uid);

      const room = await runTransaction(firebaseDb, async (transaction) => {
        const roomSnapshot = await transaction.get(roomRef);

        if (!roomSnapshot.exists()) {
          throw new Error('Room was not found.');
        }

        const roomDocument = mapRoomDocument(roomSnapshot.data(), roomSnapshot.id);

        if (!roomDocument || roomDocument.status !== 'active' || roomDocument.visibility !== 'private') {
          throw new Error('Private room is not available.');
        }

        const existingMember = await transaction.get(memberRef);

        if (!canJoinRoomWithInvite(roomDocument, input.inviteCode, existingMember.exists())) {
          throw new Error('Private room invite is invalid.');
        }

        const existingMemberData = existingMember.data();
        const role =
          existingMemberData?.role === 'host' || existingMemberData?.role === 'speaker'
            ? existingMemberData.role
            : 'listener';
        const memberDocument = createRoomMemberDocument(authUser, role, input.inviteCode);

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
      joinedRoomBaseRef.current = { ...joinedRoomBaseRef.current, [room.id]: room };

      return room;
    },
    [authUser],
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
      createPrivateRoom,
      createRoom,
      getRoomById,
      joinPrivateRoom,
      joinRoom,
      rooms,
      roomsStatus,
      startRoomPresence,
      stopRoomPresence,
    }),
    [
      createDraftRoom,
      createPrivateRoom,
      createRoom,
      getRoomById,
      joinPrivateRoom,
      joinRoom,
      rooms,
      roomsStatus,
      startRoomPresence,
      stopRoomPresence,
    ],
  );

  return <VoiceRoomsContext.Provider value={value}>{children}</VoiceRoomsContext.Provider>;
}
