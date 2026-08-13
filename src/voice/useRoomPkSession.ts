import { useEffect, useState } from 'react';

import type { RoomPkSession } from './requestRoomPkCommand';

export function useRoomPkSession(roomId: string | undefined, enabled: boolean) {
  const [session, setSession] = useState<RoomPkSession | null>(null);
  const [activePkSessionId, setActivePkSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !roomId) {
      setSession(null);
      setActivePkSessionId(null);
      return undefined;
    }

    let mounted = true;
    let unsubscribeRoom: (() => void) | undefined;
    let unsubscribeSession: (() => void) | undefined;
    let tickTimer: ReturnType<typeof setInterval> | undefined;
    let subscribedSessionId = '';

    void (async () => {
      const [{ firebaseDb }, { doc, onSnapshot }] = await Promise.all([
        import('../auth/firebase'),
        import('firebase/firestore'),
      ]);
      if (!mounted) return;

      unsubscribeRoom = onSnapshot(
        doc(firebaseDb, 'rooms', roomId),
        (snapshot) => {
          if (!mounted) return;
          const nextId = typeof snapshot.data()?.activePkSessionId === 'string'
            ? snapshot.data()?.activePkSessionId.trim()
            : '';
          setActivePkSessionId(nextId || null);
          if (nextId === subscribedSessionId) return;
          subscribedSessionId = nextId;
          unsubscribeSession?.();
          unsubscribeSession = undefined;
          if (!nextId) {
            setSession(null);
            return;
          }
          unsubscribeSession = onSnapshot(
            doc(firebaseDb, 'roomPkSessions', nextId),
            (sessionSnapshot) => {
              if (!mounted) return;
              if (!sessionSnapshot.exists()) {
                setSession(null);
                return;
              }
              const mapped = mapSession(sessionSnapshot.id, sessionSnapshot.data());
              setSession(mapped);
            },
            () => {
              if (mounted) setSession(null);
            },
          );
        },
        () => {
          if (mounted) {
            setActivePkSessionId(null);
            setSession(null);
          }
        },
      );

      // Refresh timer label once a second while a session is live.
      tickTimer = setInterval(() => {
        if (!mounted) return;
        setSession((current) => (current ? { ...current } : current));
      }, 1000);
    })();

    return () => {
      mounted = false;
      if (tickTimer) clearInterval(tickTimer);
      unsubscribeSession?.();
      unsubscribeRoom?.();
    };
  }, [enabled, roomId]);

  return { activePkSessionId, session };
}

function mapSession(pkId: string, data: Record<string, unknown> | undefined): RoomPkSession | null {
  if (!data) return null;
  const status = typeof data.status === 'string' ? data.status : '';
  const teams = data.teams && typeof data.teams === 'object'
    ? data.teams as Record<string, Record<string, unknown>>
    : {};
  const red = teams.red || {};
  const blue = teams.blue || {};
  return {
    durationMs: Number.isSafeInteger(data.durationMs) ? Number(data.durationMs) : 0,
    endsAtMs: readMillis(data.endsAtMs ?? data.endsAt),
    hostUid: typeof data.hostUid === 'string' ? data.hostUid : '',
    mode: typeof data.mode === 'string' ? data.mode : 'in-room-teams',
    pkId,
    roomId: typeof data.roomId === 'string' ? data.roomId : '',
    startedAtMs: readMillis(data.startedAtMs ?? data.startedAt),
    status,
    teams: {
      blue: {
        labelAr: typeof blue.labelAr === 'string' ? blue.labelAr : 'الأزرق',
        memberUids: Array.isArray(blue.memberUids)
          ? blue.memberUids.filter((uid): uid is string => typeof uid === 'string')
          : [],
        score: Number.isSafeInteger(blue.score) ? Number(blue.score) : 0,
      },
      red: {
        labelAr: typeof red.labelAr === 'string' ? red.labelAr : 'الأحمر',
        memberUids: Array.isArray(red.memberUids)
          ? red.memberUids.filter((uid): uid is string => typeof uid === 'string')
          : [],
        score: Number.isSafeInteger(red.score) ? Number(red.score) : 0,
      },
    },
    winner: data.winner === 'red' || data.winner === 'blue' || data.winner === 'draw' || data.winner === 'void'
      ? data.winner
      : null,
    winnerReason: typeof data.winnerReason === 'string' ? data.winnerReason : '',
  };
}

function readMillis(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}
