import { PropsWithChildren, createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { DocumentData, QuerySnapshot } from 'firebase/firestore';
import { AppState, InteractionManager } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { firebaseDb } from '../auth/firebase';
import { mockVoiceRooms } from '../data/mockVoiceRooms';
import { RoomCountryCode, VoiceRoom, VoiceRoomType } from '../types/voice';
import { debugError, debugLog } from '../utils/debugLog';
import { isVoiceRoomMockFallbackAllowed } from './voiceRoomLaunchGates';
import {
  CreateRoomInput,
  JoinPrivateRoomInput,
  RoomsStatus,
  canJoinRoomWithInvite,
  createRoomDocument,
  createRoomMemberDocument,
  mapRoomDocumentResult,
  mapRoomDocumentToVoiceRoom,
  mapRoomMemberDocument,
  selectMostRecentRoomDocument,
} from './roomProfile';
import { applyRoomPresence, mapRoomPresenceDocument } from './roomPresence';
import { useVoiceRoomFeatureFlags } from './voiceRoomFeatureFlags';
import { voiceRoomPerformanceBudgets } from './voiceRoomPerformanceBudgets';
import {
  MAX_ROOM_SEATS,
  createVacantRoomSeatDocument,
  mapRoomSeatDocument,
  roomSeatDocumentId,
} from './roomV2Contract';
import {
  VisitedRoomSummary,
  createVisitedRoomSummary,
  loadVisitedRooms,
  normalizeVisitedRooms,
  removeVisitedRoom,
  saveVisitedRooms,
  shouldApplyVisitedRoomsForUser,
  upsertVisitedRoom,
} from './visitedRooms';

type VoiceRoomsContextValue = {
  rooms: VoiceRoom[];
  roomsStatus: RoomsStatus;
  myActiveRoom?: VoiceRoom;
  myActiveRoomStatus: RoomsStatus;
  isMyActiveRoomLoading: boolean;
  visitedRooms: VisitedRoomSummary[];
  createRoom: (input: CreateRoomInput) => Promise<VoiceRoom>;
  createDraftRoom: (type: VoiceRoomType, title?: string, countryCode?: RoomCountryCode) => Promise<VoiceRoom>;
  createPrivateRoom: (input: CreateRoomInput) => Promise<VoiceRoom>;
  getRoomById: (roomId: string) => VoiceRoom | undefined;
  joinRoom: (roomId: string) => Promise<VoiceRoom>;
  joinPrivateRoom: (input: JoinPrivateRoomInput) => Promise<VoiceRoom>;
  forgetVisitedRoom: (roomId: string) => Promise<void>;
  startRoomPresence: (roomId: string) => void;
  stopRoomPresence: (roomId: string) => Promise<void>;
  getPresenceSessionId: (roomId: string) => string | undefined;
};

const hostedRoomLookupTimeoutMs = 4_000;
const roomSyncInteractionFallbackMs = 350;

function isReconnectableRoomPresence(data: DocumentData | undefined, nowMs = Date.now()) {
  const leaseExpiresAtMs = typeof data?.leaseExpiresAt?.toMillis === 'function'
    ? data.leaseExpiresAt.toMillis()
    : 0;
  return (
    (data?.status === 'online' || data?.status === 'reconnecting')
    && leaseExpiresAtMs >= nowMs
  );
}

function mapCompatibleRoomDocument(data: unknown, roomId: string, source: string) {
  const result = mapRoomDocumentResult(data, roomId);

  if (result.status === 'unsupported') {
    debugLog('voice.rooms', 'roomSchema:unsupported', {
      roomId,
      schemaVersion: result.schemaVersion,
      source,
    });
  }

  return result.status === 'ready' ? result.room : null;
}

export const VoiceRoomsContext = createContext<VoiceRoomsContextValue | undefined>(undefined);

export function VoiceRoomsProvider({ children }: PropsWithChildren) {
  const { authUser } = useAuth();
  const voiceRoomFeatureFlags = useVoiceRoomFeatureFlags();
  const [isRoomSyncReady, setRoomSyncReady] = useState(false);
  const [firestoreActivityRooms, setFirestoreActivityRooms] = useState<VoiceRoom[]>([]);
  const [firestorePopularRooms, setFirestorePopularRooms] = useState<VoiceRoom[]>([]);
  const [joinedRoomOverrides, setJoinedRoomOverrides] = useState<Record<string, VoiceRoom>>({});
  const [activePresenceRoomIds, setActivePresenceRoomIds] = useState<string[]>([]);
  const [roomsStatus, setRoomsStatus] = useState<RoomsStatus>('loading');
  const [myActiveRoom, setMyActiveRoom] = useState<VoiceRoom>();
  const [myActiveRoomStatus, setMyActiveRoomStatus] = useState<RoomsStatus>('loading');
  const [visitedRooms, setVisitedRooms] = useState<VisitedRoomSummary[]>([]);
  const joinedRoomBaseRef = useRef<Record<string, VoiceRoom>>({});
  const joinedRoomOverridesRef = useRef(joinedRoomOverrides);
  const presenceJoinedRoomIdsRef = useRef<Set<string>>(new Set());
  const presenceSessionIdsRef = useRef<Record<string, string>>({});
  const presenceAppStateRef = useRef(AppState.currentState);
  const visitedRoomsRef = useRef<VisitedRoomSummary[]>([]);
  const visitedRoomsOwnerIdRef = useRef<string | undefined>(undefined);
  const visitedRoomsWriteRef = useRef(Promise.resolve());
  const currentAuthUserIdRef = useRef(authUser?.uid);
  currentAuthUserIdRef.current = authUser?.uid;
  const firestoreRooms = useMemo(() => {
    const roomsById = new Map<string, VoiceRoom>();

    [...firestoreActivityRooms, ...firestorePopularRooms].forEach((room) => {
      roomsById.set(room.id, room);
    });

    return [...roomsById.values()];
  }, [firestoreActivityRooms, firestorePopularRooms]);
  const rooms = useMemo(
    () => {
      const sourceRooms =
        roomsStatus === 'error' && isVoiceRoomMockFallbackAllowed()
          ? mockVoiceRooms
          : firestoreRooms;

      return sourceRooms.map((room) => joinedRoomOverrides[room.id] ?? room);
    },
    [firestoreRooms, joinedRoomOverrides, roomsStatus],
  );
  const joinedRoomIds = useMemo(
    () =>
      activePresenceRoomIds
        .filter((roomId) => {
          const room = joinedRoomOverrides[roomId];
          return room?.localMember?.id === authUser?.uid && room.localMember?.status !== 'removed';
        })
        .sort(),
    [activePresenceRoomIds, authUser?.uid, joinedRoomOverrides],
  );
  const joinedRoomIdsKey = joinedRoomIds.join('|');
  const activePresenceRoomIdsKey = activePresenceRoomIds.join('|');

  useEffect(() => {
    joinedRoomOverridesRef.current = joinedRoomOverrides;
  }, [joinedRoomOverrides]);

  useEffect(() => {
    if (!authUser) {
      visitedRoomsOwnerIdRef.current = undefined;
      visitedRoomsRef.current = [];
      setVisitedRooms([]);
      return undefined;
    }

    const userId = authUser.uid;
    let cancelled = false;
    visitedRoomsOwnerIdRef.current = userId;
    visitedRoomsRef.current = [];
    setVisitedRooms([]);

    void loadVisitedRooms(userId).then((storedRooms) => {
      if (
        cancelled ||
        !shouldApplyVisitedRoomsForUser(userId, currentAuthUserIdRef.current) ||
        visitedRoomsOwnerIdRef.current !== userId
      ) {
        return;
      }

      const mergedRooms = normalizeVisitedRooms([...visitedRoomsRef.current, ...storedRooms]);
      visitedRoomsRef.current = mergedRooms;
      setVisitedRooms(mergedRooms);
    });

    return () => {
      cancelled = true;
    };
  }, [authUser?.uid]);

  const queueVisitedRoomsSave = useCallback((userId: string, nextRooms: VisitedRoomSummary[]) => {
    visitedRoomsWriteRef.current = visitedRoomsWriteRef.current
      .then(() => saveVisitedRooms(userId, nextRooms))
      .then(() => undefined);
  }, []);

  const recordVisitedRoom = useCallback(
    (room: VoiceRoom) => {
      if (!authUser) {
        return;
      }

      const userId = authUser.uid;

      if (!shouldApplyVisitedRoomsForUser(userId, currentAuthUserIdRef.current)) {
        return;
      }

      if (visitedRoomsOwnerIdRef.current !== userId) {
        visitedRoomsOwnerIdRef.current = userId;
        visitedRoomsRef.current = [];
      }

      const nextRooms = upsertVisitedRoom(visitedRoomsRef.current, createVisitedRoomSummary(room));
      visitedRoomsRef.current = nextRooms;
      setVisitedRooms(nextRooms);
      queueVisitedRoomsSave(userId, nextRooms);
    },
    [authUser, queueVisitedRoomsSave],
  );

  const forgetVisitedRoom = useCallback(
    async (roomId: string) => {
      if (!authUser) {
        return;
      }

      const userId = authUser.uid;

      if (!shouldApplyVisitedRoomsForUser(userId, currentAuthUserIdRef.current)) {
        return;
      }

      if (visitedRoomsOwnerIdRef.current !== userId) {
        visitedRoomsOwnerIdRef.current = userId;
        visitedRoomsRef.current = [];
      }

      const nextRooms = removeVisitedRoom(visitedRoomsRef.current, roomId);
      visitedRoomsRef.current = nextRooms;
      setVisitedRooms(nextRooms);
      queueVisitedRoomsSave(userId, nextRooms);
      await visitedRoomsWriteRef.current;
    },
    [authUser, queueVisitedRoomsSave],
  );

  useEffect(() => {
    if (!authUser) {
      setRoomSyncReady(false);
      return undefined;
    }

    setRoomSyncReady(false);
    let hasStartedRoomSync = false;
    const startRoomSync = () => {
      if (hasStartedRoomSync) {
        return;
      }

      hasStartedRoomSync = true;
      setRoomSyncReady(true);
    };
    const interactionHandle = InteractionManager.runAfterInteractions(startRoomSync);
    const fallbackTimer = setTimeout(startRoomSync, roomSyncInteractionFallbackMs);

    return () => {
      clearTimeout(fallbackTimer);
      interactionHandle.cancel();
    };
  }, [authUser]);

  useEffect(() => {
    if (!authUser) {
      setFirestoreActivityRooms([]);
      setFirestorePopularRooms([]);
      setRoomsStatus('ready');
      return undefined;
    }

    if (!isRoomSyncReady) {
      setRoomsStatus('loading');
      return undefined;
    }

    setRoomsStatus('loading');
    let activityReady = false;
    let popularReady = false;
    let hasFailed = false;
    const markSnapshotReady = (kind: 'activity' | 'popular') => {
      activityReady = activityReady || kind === 'activity';
      popularReady = popularReady || kind === 'popular';

      if (!hasFailed && activityReady && popularReady) {
        setRoomsStatus('ready');
      }
    };
    const handleSnapshotError = (kind: 'activity' | 'popular') => {
      hasFailed = true;
      debugLog('voice.rooms', 'publicRoomsSnapshot:error', { kind });
      setFirestoreActivityRooms([]);
      setFirestorePopularRooms([]);
      setRoomsStatus('error');
    };
    const mapSnapshotRooms = (snapshot: QuerySnapshot<DocumentData>) =>
      snapshot.docs
        .map((roomSnapshot) => mapCompatibleRoomDocument(roomSnapshot.data(), roomSnapshot.id, 'public-list'))
        .filter((room): room is NonNullable<typeof room> => room !== null)
        .map((room) => mapRoomDocumentToVoiceRoom(room));

    const unsubscribeActivity = onSnapshot(
      query(
        collection(firebaseDb, 'rooms'),
        where('status', '==', 'active'),
        where('visibility', '==', 'public'),
        orderBy('updatedAt', 'desc'),
        limit(40),
      ),
      (snapshot) => {
        debugLog('voice.rooms', 'publicRoomsSnapshot', { count: snapshot.docs.length, kind: 'activity' });
        setFirestoreActivityRooms(mapSnapshotRooms(snapshot));
        markSnapshotReady('activity');
      },
      () => handleSnapshotError('activity'),
    );
    const unsubscribePopular = onSnapshot(
      query(
        collection(firebaseDb, 'rooms'),
        where('status', '==', 'active'),
        where('visibility', '==', 'public'),
        orderBy('participantCount', 'desc'),
        limit(40),
      ),
      (snapshot) => {
        debugLog('voice.rooms', 'publicRoomsSnapshot', { count: snapshot.docs.length, kind: 'popular' });
        setFirestorePopularRooms(mapSnapshotRooms(snapshot));
        markSnapshotReady('popular');
      },
      () => handleSnapshotError('popular'),
    );

    return () => {
      unsubscribeActivity();
      unsubscribePopular();
    };
  }, [authUser, isRoomSyncReady]);

  useEffect(() => {
    if (!authUser) {
      setMyActiveRoom(undefined);
      setMyActiveRoomStatus('ready');
      return undefined;
    }

    if (!isRoomSyncReady) {
      setMyActiveRoom(undefined);
      setMyActiveRoomStatus('loading');
      return undefined;
    }

    setMyActiveRoomStatus('loading');
    let hasHostedRoomSnapshotSettled = false;
    const hostedRoomLookupTimeout = setTimeout(() => {
      if (hasHostedRoomSnapshotSettled) {
        return;
      }

      debugLog('voice.rooms', 'hostedRoomsSnapshot:timeout', {
        timeoutMs: hostedRoomLookupTimeoutMs,
        uid: authUser.uid,
      });
      setMyActiveRoom(undefined);
      setMyActiveRoomStatus('error');
    }, hostedRoomLookupTimeoutMs);
    const unsubscribeHostedRooms = onSnapshot(
      query(
        collection(firebaseDb, 'rooms'),
        where('hostId', '==', authUser.uid),
        where('status', '==', 'active'),
      ),
      (snapshot) => {
        hasHostedRoomSnapshotSettled = true;
        clearTimeout(hostedRoomLookupTimeout);
        const hostedRooms = snapshot.docs
          .map((roomSnapshot) => mapCompatibleRoomDocument(roomSnapshot.data(), roomSnapshot.id, 'owner-list'))
          .filter((room): room is NonNullable<typeof room> => room !== null);
        const latestRoom = selectMostRecentRoomDocument(hostedRooms);

        setMyActiveRoom(
          latestRoom
            ? {
                ...mapRoomDocumentToVoiceRoom(latestRoom),
                localMember: {
                  id: authUser.uid,
                  displayName: authUser.displayName,
                  avatarLabel: authUser.avatarLabel,
                  role: 'host',
                  status: 'active',
                  canPublishAudio: true,
                },
              }
            : undefined,
        );
        setMyActiveRoomStatus('ready');
      },
      (error) => {
        hasHostedRoomSnapshotSettled = true;
        clearTimeout(hostedRoomLookupTimeout);
        debugError('voice.rooms', 'hostedRoomsSnapshot:error', error, { uid: authUser.uid });
        setMyActiveRoom(undefined);
        setMyActiveRoomStatus('error');
      },
    );

    return () => {
      clearTimeout(hostedRoomLookupTimeout);
      unsubscribeHostedRooms();
    };
  }, [authUser, isRoomSyncReady]);

  useEffect(() => {
    if (!authUser || joinedRoomIds.length === 0) {
      return undefined;
    }

    const unsubscribeCallbacks = joinedRoomIds.flatMap((roomId) => {
      const roomRef = doc(firebaseDb, 'rooms', roomId);
      const memberRef = doc(firebaseDb, 'rooms', roomId, 'members', authUser.uid);
      const presenceRef = doc(firebaseDb, 'rooms', roomId, 'presence', authUser.uid);

      return [
        onSnapshot(
          roomRef,
          (snapshot) => {
            const roomDocument = snapshot.exists()
              ? mapCompatibleRoomDocument(snapshot.data(), snapshot.id, 'joined-room-snapshot')
              : null;

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
                seats: currentRoom.seats,
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
          },
          (error) => {
            debugError('voice.rooms', 'roomSnapshot:error', error, { roomId });
          },
        ),
        onSnapshot(
          memberRef,
          (snapshot) => {
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
                  authorityRole: memberDocument.authorityRole,
                  seatId: memberDocument.seatId,
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
          },
          (error) => {
            debugError('voice.rooms', 'memberSnapshot:error', error, { roomId, uid: authUser.uid });
          },
        ),
        onSnapshot(
          collection(firebaseDb, 'rooms', roomId, 'seats'),
          (snapshot) => {
            const seats = snapshot.docs
              .map((seatSnapshot) => mapRoomSeatDocument(seatSnapshot.data(), seatSnapshot.id))
              .filter((seat): seat is NonNullable<typeof seat> => seat !== null)
              .sort((left, right) => left.seatNumber - right.seatNumber);
            setJoinedRoomOverrides((currentRooms) => {
              const currentRoom = currentRooms[roomId];
              if (!currentRoom) return currentRooms;
              const nextBaseRoom = { ...(joinedRoomBaseRef.current[roomId] ?? currentRoom), seats };
              joinedRoomBaseRef.current = { ...joinedRoomBaseRef.current, [roomId]: nextBaseRoom };
              return { ...currentRooms, [roomId]: nextBaseRoom };
            });
          },
          (error) => debugError('voice.rooms', 'seatSnapshot:error', error, { roomId, uid: authUser.uid }),
        ),
        onSnapshot(
          query(
            collection(firebaseDb, 'rooms', roomId, 'presence'),
            orderBy('updatedAt', 'desc'),
            limit(voiceRoomPerformanceBudgets.presenceListenerLimit),
          ),
          (snapshot) => {
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
          },
          (error) => {
            debugError('voice.rooms', 'presenceSnapshot:error', error, { roomId, uid: authUser.uid });
          },
        ),
      ];
    });

    return () => {
      unsubscribeCallbacks.forEach((unsubscribe) => unsubscribe());
    };
  }, [authUser, authUser?.uid, joinedRoomIdsKey]);

  const writeRoomPresence = useCallback(
    async (room: VoiceRoom, status: 'online' | 'reconnecting' | 'stale') => {
      if (!authUser || room.status !== 'active' || room.localMember?.status === 'removed') {
        return;
      }

      const member = room.localMember;

      if (!member?.role || typeof member.canPublishAudio !== 'boolean') {
        return;
      }

      const hasJoinedPresence = presenceJoinedRoomIdsRef.current.has(room.id);
      const sessionId = presenceSessionIdsRef.current[room.id]
        ?? `presence_${authUser.uid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
      presenceSessionIdsRef.current[room.id] = sessionId;
      const nowMs = Date.now();
      const presencePayload = {
        uid: authUser.uid,
        displayName: member.displayName,
        avatarLabel: member.avatarLabel,
        role: member.role,
        status,
        canPublishAudio: member.canPublishAudio,
        authorityRole: member.authorityRole ?? (member.role === 'host' ? 'owner' : 'member'),
        seatId: member.seatId ?? null,
        sessionId,
        leaseExpiresAt: Timestamp.fromMillis(status === 'online' ? nowMs + 45_000 : nowMs),
        lastSeenAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...(hasJoinedPresence ? {} : { joinedAt: serverTimestamp() }),
      };

      try {
        await setDoc(doc(firebaseDb, 'rooms', room.id, 'presence', authUser.uid), presencePayload, { merge: true });
        debugLog('voice.presence', 'write:success', {
          roomId: room.id,
          status,
          role: member.role,
          canPublishAudio: member.canPublishAudio,
        });
        presenceJoinedRoomIdsRef.current.add(room.id);
      } catch (error) {
        debugError('voice.presence', 'write:error', error, {
          roomId: room.id,
          status,
          role: member.role,
          canPublishAudio: member.canPublishAudio,
        });
        throw error;
      }
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
      if (presenceAppStateRef.current !== 'active') return;
      activePresenceRoomIds
        .map((roomId) => joinedRoomOverridesRef.current[roomId])
        .filter((room): room is VoiceRoom => !!room)
        .forEach((room) => {
          void writeRoomPresence(room, 'online').catch(() => undefined);
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
          void writeRoomPresence(room, 'stale').catch(() => undefined);
        });
    };
  }, [activePresenceRoomIds, activePresenceRoomIdsKey, authUser, writeRoomPresence]);

  useEffect(() => {
    if (!authUser || activePresenceRoomIds.length === 0) return undefined;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previousState = presenceAppStateRef.current;
      presenceAppStateRef.current = nextState;
      if (previousState === nextState) return;
      const status = nextState === 'active' ? 'online' : 'reconnecting';
      activePresenceRoomIds
        .map((roomId) => joinedRoomOverridesRef.current[roomId])
        .filter((room): room is VoiceRoom => !!room)
        .forEach((room) => void writeRoomPresence(room, status).catch(() => undefined));
    });
    return () => subscription.remove();
  }, [activePresenceRoomIds, activePresenceRoomIdsKey, authUser, writeRoomPresence]);

  const startRoomPresence = useCallback((roomId: string) => {
    presenceSessionIdsRef.current[roomId] =
      `presence_${roomId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    presenceJoinedRoomIdsRef.current.delete(roomId);
    setActivePresenceRoomIds((currentRoomIds) =>
      currentRoomIds.includes(roomId) ? currentRoomIds : [...currentRoomIds, roomId].sort(),
    );
  }, []);

  const getPresenceSessionId = useCallback((roomId: string) => {
    return presenceSessionIdsRef.current[roomId];
  }, []);

  const stopRoomPresence = useCallback(
    async (roomId: string) => {
      setActivePresenceRoomIds((currentRoomIds) => currentRoomIds.filter((currentRoomId) => currentRoomId !== roomId));

      const room = joinedRoomOverridesRef.current[roomId];

      try {
        if (room) {
          await writeRoomPresence(room, 'stale');
        }
      } finally {
        delete presenceSessionIdsRef.current[roomId];
        presenceJoinedRoomIdsRef.current.delete(roomId);

        const { [roomId]: _removedBaseRoom, ...remainingBaseRooms } = joinedRoomBaseRef.current;
        joinedRoomBaseRef.current = remainingBaseRooms;
        setJoinedRoomOverrides((currentRooms) => {
          if (!currentRooms[roomId]) return currentRooms;
          const { [roomId]: _removedRoom, ...remainingRooms } = currentRooms;
          joinedRoomOverridesRef.current = remainingRooms;
          return remainingRooms;
        });
      }
    },
    [writeRoomPresence],
  );

  const createRoom = useCallback(
    async (input: CreateRoomInput) => {
      if (!authUser) {
        throw new Error('A complete signed-in profile is required to create a room.');
      }
      if (!voiceRoomFeatureFlags.newJoins) {
        throw new Error('إنشاء الغرف متوقف مؤقتاً.');
      }

      if (myActiveRoom?.status === 'active') {
        throw new Error('Close your active room before creating another room.');
      }

      const roomRef = doc(collection(firebaseDb, 'rooms'));
      const memberRef = doc(firebaseDb, 'rooms', roomRef.id, 'members', authUser.uid);
      const roomDocument = createRoomDocument(roomRef.id, input, authUser);
      const memberDocument = createRoomMemberDocument(authUser, 'host');
      const batch = writeBatch(firebaseDb);

      debugLog('voice.rooms', 'createRoom:commit:start', {
        roomId: roomRef.id,
        type: roomDocument.type,
        visibility: roomDocument.visibility,
        hostId: authUser.uid,
      });

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
      for (let seatNumber = 1; seatNumber <= MAX_ROOM_SEATS; seatNumber += 1) {
        const seatRef = doc(firebaseDb, 'rooms', roomRef.id, 'seats', roomSeatDocumentId(seatNumber));
        batch.set(seatRef, {
          ...createVacantRoomSeatDocument(seatNumber),
          updatedAt: serverTimestamp(),
        });
      }

      try {
        await batch.commit();
      } catch (error) {
        debugError('voice.rooms', 'createRoom:commit:error', error, {
          roomId: roomRef.id,
          visibility: roomDocument.visibility,
        });
        throw error;
      }

      debugLog('voice.rooms', 'createRoom:commit:success', {
        roomId: roomRef.id,
        memberRole: memberDocument.role,
      });

      if (currentAuthUserIdRef.current !== authUser.uid) {
        throw new Error('The signed-in account changed while creating the room.');
      }

      const now = Date.now();
      const room = {
        ...mapRoomDocumentToVoiceRoom(roomDocument, [memberDocument]),
        createdAtMs: now,
        updatedAtMs: now,
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
      setMyActiveRoom(room);
      setMyActiveRoomStatus('ready');
      recordVisitedRoom(room);

      return room;
    },
    [authUser, myActiveRoom, recordVisitedRoom, voiceRoomFeatureFlags.newJoins],
  );

  const createDraftRoom = useCallback(
    (type: VoiceRoomType, title?: string, countryCode: RoomCountryCode = 'IQ') =>
      createRoom({ type, title, countryCode }),
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

      if (isVoiceRoomMockFallbackAllowed()) {
        const fallbackRoom = mockVoiceRooms.find((room) => room.id === roomId);
        if (fallbackRoom && roomsStatus === 'error') {
          recordVisitedRoom(fallbackRoom);
          return fallbackRoom;
        }
      }

      const roomRef = doc(firebaseDb, 'rooms', roomId);
      const memberRef = doc(firebaseDb, 'rooms', roomId, 'members', authUser.uid);
      const presenceRef = doc(firebaseDb, 'rooms', roomId, 'presence', authUser.uid);

      debugLog('voice.rooms', 'joinRoom:transaction:start', { roomId, uid: authUser.uid });

      const room = await runTransaction(firebaseDb, async (transaction) => {
        const roomSnapshot = await transaction.get(roomRef);

        if (!roomSnapshot.exists()) {
          throw new Error('Room was not found.');
        }

        const roomMapping = mapRoomDocumentResult(roomSnapshot.data(), roomSnapshot.id);
        if (roomMapping.status === 'unsupported') {
          throw new Error('This room requires a newer app version.');
        }
        const roomDocument = roomMapping.status === 'ready' ? roomMapping.room : null;

        if (!roomDocument || roomDocument.status !== 'active') {
          throw new Error('Room is not available.');
        }

        const existingMember = await transaction.get(memberRef);
        if (!voiceRoomFeatureFlags.newJoins) {
          const existingPresence = existingMember.exists()
            ? await transaction.get(presenceRef)
            : null;
          if (
            !existingMember.exists()
            || !existingPresence?.exists()
            || !isReconnectableRoomPresence(existingPresence.data())
          ) {
            throw new Error('الانضمام إلى الغرف متوقف مؤقتاً.');
          }
        }
        if (roomDocument.visibility === 'private' && !existingMember.exists()) {
          throw new Error('Private room invite is required.');
        }

        const existingMemberData = existingMember.data();
        const role =
          existingMemberData?.role === 'host' || existingMemberData?.role === 'speaker'
            ? existingMemberData.role
            : 'listener';
        const memberDocument = createRoomMemberDocument(authUser, role, undefined, existingMemberData);
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
      }).catch((error) => {
        debugError('voice.rooms', 'joinRoom:transaction:error', error, { roomId, uid: authUser.uid });
        throw error;
      });

      debugLog('voice.rooms', 'joinRoom:transaction:success', {
        roomId: room.id,
        localRole: room.localMember?.role,
        localCanPublishAudio: room.localMember?.canPublishAudio,
      });

      if (currentAuthUserIdRef.current !== authUser.uid) {
        throw new Error('The signed-in account changed while joining the room.');
      }

      setJoinedRoomOverrides((currentRooms) => ({ ...currentRooms, [room.id]: room }));
      joinedRoomBaseRef.current = { ...joinedRoomBaseRef.current, [room.id]: room };
      recordVisitedRoom(room);

      return room;
    },
    [authUser, recordVisitedRoom, roomsStatus, voiceRoomFeatureFlags.newJoins],
  );

  const joinPrivateRoom = useCallback(
    async (input: JoinPrivateRoomInput) => {
      if (!authUser) {
        throw new Error('A complete signed-in profile is required to join a private room.');
      }

      const roomRef = doc(firebaseDb, 'rooms', input.roomId);
      const memberRef = doc(firebaseDb, 'rooms', input.roomId, 'members', authUser.uid);
      const presenceRef = doc(firebaseDb, 'rooms', input.roomId, 'presence', authUser.uid);

      debugLog('voice.rooms', 'joinPrivateRoom:transaction:start', {
        roomId: input.roomId,
        uid: authUser.uid,
        hasInviteCode: Boolean(input.inviteCode),
      });

      const room = await runTransaction(firebaseDb, async (transaction) => {
        const roomSnapshot = await transaction.get(roomRef);

        if (!roomSnapshot.exists()) {
          throw new Error('Room was not found.');
        }

        const roomMapping = mapRoomDocumentResult(roomSnapshot.data(), roomSnapshot.id);
        if (roomMapping.status === 'unsupported') {
          throw new Error('This room requires a newer app version.');
        }
        const roomDocument = roomMapping.status === 'ready' ? roomMapping.room : null;

        if (!roomDocument || roomDocument.status !== 'active' || roomDocument.visibility !== 'private') {
          throw new Error('Private room is not available.');
        }

        const existingMember = await transaction.get(memberRef);

        if (!voiceRoomFeatureFlags.newJoins) {
          const existingPresence = existingMember.exists()
            ? await transaction.get(presenceRef)
            : null;
          if (
            !existingMember.exists()
            || !existingPresence?.exists()
            || !isReconnectableRoomPresence(existingPresence.data())
          ) {
            throw new Error('الانضمام إلى الغرف متوقف مؤقتاً.');
          }
        }

        if (!canJoinRoomWithInvite(roomDocument, input.inviteCode, existingMember.exists())) {
          throw new Error('Private room invite is invalid.');
        }

        const existingMemberData = existingMember.data();
        const role =
          existingMemberData?.role === 'host' || existingMemberData?.role === 'speaker'
            ? existingMemberData.role
            : 'listener';
        const memberDocument = createRoomMemberDocument(authUser, role, input.inviteCode, existingMemberData);

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
      }).catch((error) => {
        debugError('voice.rooms', 'joinPrivateRoom:transaction:error', error, {
          roomId: input.roomId,
          uid: authUser.uid,
        });
        throw error;
      });

      debugLog('voice.rooms', 'joinPrivateRoom:transaction:success', {
        roomId: room.id,
        localRole: room.localMember?.role,
        localCanPublishAudio: room.localMember?.canPublishAudio,
      });

      if (currentAuthUserIdRef.current !== authUser.uid) {
        throw new Error('The signed-in account changed while joining the private room.');
      }

      setJoinedRoomOverrides((currentRooms) => ({ ...currentRooms, [room.id]: room }));
      joinedRoomBaseRef.current = { ...joinedRoomBaseRef.current, [room.id]: room };
      recordVisitedRoom(room);

      return room;
    },
    [authUser, recordVisitedRoom, voiceRoomFeatureFlags.newJoins],
  );

  const getRoomById = useCallback(
    (roomId: string) =>
      joinedRoomOverrides[roomId]
      ?? (myActiveRoom?.id === roomId ? myActiveRoom : undefined)
      ?? rooms.find((room) => room.id === roomId),
    [joinedRoomOverrides, myActiveRoom, rooms],
  );

  const value = useMemo(
    () => ({
      createDraftRoom,
      createPrivateRoom,
      createRoom,
      forgetVisitedRoom,
      getRoomById,
      isMyActiveRoomLoading: myActiveRoomStatus === 'loading',
      joinPrivateRoom,
      joinRoom,
      myActiveRoom,
      myActiveRoomStatus,
      rooms,
      roomsStatus,
      startRoomPresence,
      stopRoomPresence,
      getPresenceSessionId,
      visitedRooms,
    }),
    [
      createDraftRoom,
      createPrivateRoom,
      createRoom,
      forgetVisitedRoom,
      getPresenceSessionId,
      getRoomById,
      joinPrivateRoom,
      joinRoom,
      myActiveRoom,
      myActiveRoomStatus,
      rooms,
      roomsStatus,
      startRoomPresence,
      stopRoomPresence,
      visitedRooms,
    ],
  );

  return <VoiceRoomsContext.Provider value={value}>{children}</VoiceRoomsContext.Provider>;
}
