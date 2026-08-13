import { useEffect, useState } from 'react';

import { RoomGameSession } from './requestRoomGameCommand';

export function useRoomGameSession(roomId: string | undefined, enabled: boolean) {
  const [session, setSession] = useState<RoomGameSession | null>(null);
  const [activeGameSessionId, setActiveGameSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !roomId) {
      setSession(null);
      setActiveGameSessionId(null);
      return undefined;
    }

    let mounted = true;
    let unsubscribeRoom: (() => void) | undefined;
    let unsubscribeSession: (() => void) | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
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
          const nextId = typeof snapshot.data()?.activeGameSessionId === 'string'
            ? snapshot.data()?.activeGameSessionId.trim()
            : '';
          setActiveGameSessionId(nextId || null);
          if (nextId === subscribedSessionId) return;
          subscribedSessionId = nextId;
          unsubscribeSession?.();
          unsubscribeSession = undefined;
          if (expiryTimer) clearTimeout(expiryTimer);
          expiryTimer = undefined;
          if (!nextId) {
            setSession(null);
            return;
          }
          unsubscribeSession = onSnapshot(
            doc(firebaseDb, 'rooms', roomId, 'gameSessions', nextId),
            (sessionSnapshot) => {
              if (!mounted) return;
              if (!sessionSnapshot.exists()) {
                setSession(null);
                return;
              }
              const data = sessionSnapshot.data();
              const expiresAtMs = readMillis(data.expiresAt);
              if (
                expiresAtMs <= Date.now()
                || !['lobby', 'active'].includes(typeof data.status === 'string' ? data.status : '')
              ) {
                setSession(null);
                return;
              }
              const nextSession: RoomGameSession = {
                clientRoute: typeof data.clientRoute === 'string' ? data.clientRoute : '',
                economy: mapRoomGameEconomy(data.economy),
                expiresAtMs,
                gameId: typeof data.gameId === 'string' ? data.gameId : '',
                hostUid: typeof data.hostUid === 'string' ? data.hostUid : '',
                maxPlayers: Number.isInteger(data.maxPlayers) ? data.maxPlayers : 0,
                minPlayers: Number.isInteger(data.minPlayers) ? data.minPlayers : 0,
                playerCount: Number.isInteger(data.playerCount) ? data.playerCount : 0,
                playerUids: Array.isArray(data.playerUids)
                  ? data.playerUids.filter((uid): uid is string => typeof uid === 'string')
                  : [],
                rewardPolicy: data.rewardPolicy && typeof data.rewardPolicy === 'object'
                  ? data.rewardPolicy as RoomGameSession['rewardPolicy']
                  : null,
                rewardsEnabled: data.rewardsEnabled === true,
                roomId,
                sessionId: nextId,
                sessionMode: data.sessionMode === 'host-local' ? 'host-local' : 'multiplayer',
                status: typeof data.status === 'string' ? data.status : 'lobby',
              };
              setSession(nextSession);
              if (expiryTimer) clearTimeout(expiryTimer);
              expiryTimer = setTimeout(() => {
                if (mounted && subscribedSessionId === nextId) setSession(null);
              }, Math.max(1, expiresAtMs - Date.now()));
            },
            () => {
              if (mounted) setSession(null);
            },
          );
        },
        () => {
          if (mounted) {
            setActiveGameSessionId(null);
            setSession(null);
          }
        },
      );
    })();

    return () => {
      mounted = false;
      if (expiryTimer) clearTimeout(expiryTimer);
      unsubscribeSession?.();
      unsubscribeRoom?.();
    };
  }, [enabled, roomId]);

  return { activeGameSessionId, session };
}

function readMillis(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  return 0;
}

function mapRoomGameEconomy(value: unknown): RoomGameSession['economy'] {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  return {
    currency: candidate.currency === 'diamonds' ? 'diamonds' : 'coins',
    entryFeeCoins: Number.isInteger(candidate.entryFeeCoins) ? Number(candidate.entryFeeCoins) : 0,
    poolCoins: Number.isInteger(candidate.poolCoins) ? Number(candidate.poolCoins) : 0,
    prizeUid: typeof candidate.prizeUid === 'string' ? candidate.prizeUid : null,
    settled: candidate.settled === true,
    settlementKind: typeof candidate.settlementKind === 'string' ? candidate.settlementKind : null,
    settlementMode: typeof candidate.settlementMode === 'string' ? candidate.settlementMode : null,
  };
}
