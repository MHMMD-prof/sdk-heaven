import { useEffect, useState } from 'react';

export type RoomSeatRequestRecord = {
  requesterUid: string;
  requestedSeatId: string;
  status: 'pending';
  createdAtMs?: number;
  expiresAtMs?: number;
};

export type RoomSeatInviteRecord = {
  targetUid: string;
  seatId: string;
  invitedByUid: string;
  status: 'pending';
  createdAtMs?: number;
  expiresAtMs?: number;
};

export type RoomModerationEventRecord = {
  id: string;
  action: string;
  actorAuthority: string;
  actorUid: string;
  targetUid: string;
  reason: string;
  status: string;
  createdAtMs?: number;
};

export type RoomBanRecord = {
  targetUid: string;
  actorUid: string;
  reason: string;
  status: 'active';
  createdAtMs?: number;
  expiresAtMs?: number;
};

type RoomCommandCenterData = {
  bans: RoomBanRecord[];
  moderationEvents: RoomModerationEventRecord[];
  seatInvites: RoomSeatInviteRecord[];
  seatRequests: RoomSeatRequestRecord[];
};

const EMPTY_DATA: RoomCommandCenterData = {
  bans: [],
  moderationEvents: [],
  seatInvites: [],
  seatRequests: [],
};

export function useRoomCommandCenterData(roomId: string, uid: string | undefined, canManage: boolean) {
  const [data, setData] = useState<RoomCommandCenterData>(EMPTY_DATA);

  useEffect(() => {
    if (!roomId || !uid) {
      setData(EMPTY_DATA);
      return undefined;
    }
    let mounted = true;
    const unsubscribers: (() => void)[] = [];
    const update = <Key extends keyof RoomCommandCenterData>(key: Key, value: RoomCommandCenterData[Key]) => {
      if (mounted) setData((current) => ({ ...current, [key]: value }));
    };

    void Promise.all([
      import('../auth/firebase'),
      import('firebase/firestore'),
    ]).then(([{ firebaseDb }, firestore]) => {
      if (!mounted) return;
      const roomCollection = (name: string) => firestore.collection(
        firebaseDb,
        'rooms',
        roomId,
        name,
      );

      if (canManage) {
        unsubscribers.push(
          firestore.onSnapshot(
            firestore.query(roomCollection('seatRequests'), firestore.where('status', '==', 'pending')),
            (snapshot) => update(
              'seatRequests',
              snapshot.docs.map((item) => mapSeatRequest(item.data())).filter(isPresent),
            ),
            () => update('seatRequests', []),
          ),
          firestore.onSnapshot(
            firestore.query(roomCollection('seatInvites'), firestore.where('status', '==', 'pending')),
            (snapshot) => update(
              'seatInvites',
              snapshot.docs.map((item) => mapSeatInvite(item.data())).filter(isPresent),
            ),
            () => update('seatInvites', []),
          ),
          firestore.onSnapshot(
            firestore.query(
              roomCollection('moderationEvents'),
              firestore.orderBy('createdAt', 'desc'),
              firestore.limit(50),
            ),
            (snapshot) => update(
              'moderationEvents',
              snapshot.docs.map((item) => mapModerationEvent(item.id, item.data())).filter(isPresent),
            ),
            () => update('moderationEvents', []),
          ),
          firestore.onSnapshot(
            firestore.query(roomCollection('bans'), firestore.where('status', '==', 'active')),
            (snapshot) => update(
              'bans',
              snapshot.docs.map((item) => mapRoomBan(item.id, item.data())).filter(isPresent),
            ),
            () => update('bans', []),
          ),
        );
      } else {
        unsubscribers.push(
          firestore.onSnapshot(
            firestore.doc(firebaseDb, 'rooms', roomId, 'seatRequests', uid),
            (snapshot) => update('seatRequests', snapshot.exists()
              ? [mapSeatRequest(snapshot.data())].filter(isPresent)
              : []),
            () => update('seatRequests', []),
          ),
          firestore.onSnapshot(
            firestore.doc(firebaseDb, 'rooms', roomId, 'seatInvites', uid),
            (snapshot) => update('seatInvites', snapshot.exists()
              ? [mapSeatInvite(snapshot.data())].filter(isPresent)
              : []),
            () => update('seatInvites', []),
          ),
        );
      }
    });

    return () => {
      mounted = false;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [canManage, roomId, uid]);

  return data;
}

export function mapSeatRequest(value: unknown): RoomSeatRequestRecord | null {
  if (!isRecord(value)) return null;
  if (
    value.status !== 'pending'
    || !nonEmpty(value.requesterUid)
    || !validSeatId(value.requestedSeatId)
  ) return null;
  return {
    requesterUid: value.requesterUid,
    requestedSeatId: value.requestedSeatId,
    status: 'pending',
    createdAtMs: timestampToMillis(value.createdAt),
    expiresAtMs: timestampToMillis(value.expiresAt),
  };
}

export function mapSeatInvite(value: unknown): RoomSeatInviteRecord | null {
  if (!isRecord(value)) return null;
  if (
    value.status !== 'pending'
    || !nonEmpty(value.targetUid)
    || !nonEmpty(value.invitedByUid)
    || !validSeatId(value.seatId)
  ) return null;
  return {
    targetUid: value.targetUid,
    seatId: value.seatId,
    invitedByUid: value.invitedByUid,
    status: 'pending',
    createdAtMs: timestampToMillis(value.createdAt),
    expiresAtMs: timestampToMillis(value.expiresAt),
  };
}

export function mapModerationEvent(id: string, value: unknown): RoomModerationEventRecord | null {
  if (!nonEmpty(id) || !isRecord(value) || !nonEmpty(value.action) || !nonEmpty(value.actorUid)) return null;
  return {
    id,
    action: value.action,
    actorAuthority: nonEmpty(value.actorAuthority) ? value.actorAuthority : '',
    actorUid: value.actorUid,
    targetUid: nonEmpty(value.targetUid) ? value.targetUid : '',
    reason: typeof value.reason === 'string' ? value.reason : '',
    status: nonEmpty(value.status) ? value.status : '',
    createdAtMs: timestampToMillis(value.createdAt),
  };
}

export function mapRoomBan(id: string, value: unknown): RoomBanRecord | null {
  if (!nonEmpty(id) || !isRecord(value) || value.status !== 'active') return null;
  const targetUid = nonEmpty(value.targetUid) ? value.targetUid : id;
  return {
    targetUid,
    actorUid: nonEmpty(value.actorUid) ? value.actorUid : '',
    reason: typeof value.reason === 'string' ? value.reason : '',
    status: 'active',
    createdAtMs: timestampToMillis(value.createdAt),
    expiresAtMs: timestampToMillis(value.expiresAt),
  };
}

function timestampToMillis(value: unknown) {
  if (!isRecord(value)) return undefined;
  if (typeof value.toMillis === 'function') {
    const millis = value.toMillis.call(value);
    return typeof millis === 'number' && Number.isFinite(millis) ? millis : undefined;
  }
  return typeof value.seconds === 'number'
    ? value.seconds * 1_000 + Math.floor((typeof value.nanoseconds === 'number' ? value.nanoseconds : 0) / 1_000_000)
    : undefined;
}

function validSeatId(value: unknown): value is string {
  return typeof value === 'string' && /^(0[1-9]|1[0-9]|20)$/.test(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPresent<Value>(value: Value | null): value is Value {
  return value !== null;
}
