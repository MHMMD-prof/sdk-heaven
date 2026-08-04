import { useEffect, useMemo, useState } from 'react';

import {
  RoomTargetPublicCycleV1,
  RoomTargetRosterPreviewV1,
  mapRoomTargetPublicCycleV1,
  mapRoomTargetRosterPreviewV1,
} from './roomTargetContract';
import { createRoomSupportPeriodIds } from './roomRocketPeriod';

export type RoomTargetData = {
  cycle?: RoomTargetPublicCycleV1;
  error: boolean;
  loading: boolean;
  nextRoster?: RoomTargetRosterPreviewV1;
  renderingEnabled: boolean;
};

export function useRoomTargetData({
  enabled,
  isOwner,
  ownerUid,
  roomId,
}: {
  enabled: boolean;
  isOwner: boolean;
  ownerUid: string;
  roomId: string;
}): RoomTargetData {
  const [cycle, setCycle] = useState<RoomTargetPublicCycleV1>();
  const [nextRoster, setNextRoster] = useState<RoomTargetRosterPreviewV1>();
  const [renderingEnabled, setRenderingEnabled] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const periods = useMemo(() => ({
    current: createRoomSupportPeriodIds(clock).weekId,
    next: createRoomSupportPeriodIds(clock + 8 * 86_400_000).weekId,
  }), [clock, roomId]);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => setClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [enabled]);

  useEffect(() => {
    setCycle(undefined);
    setNextRoster(undefined);
    setRenderingEnabled(false);
    setLoading(enabled);
    setError(false);
    if (!enabled || !roomId) return undefined;
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];
    let received = 0;
    const required = isOwner && ownerUid ? 3 : 2;
    const markReceived = () => {
      received += 1;
      if (!cancelled && received >= required) setLoading(false);
    };
    const fail = () => {
      if (!cancelled) {
        setError(true);
        setLoading(false);
      }
    };
    void Promise.all([import('../auth/firebase'), import('firebase/firestore')])
      .then(([{ firebaseDb }, firestore]) => {
        if (cancelled) return;
        unsubscribers.push(
          firestore.onSnapshot(
            firestore.doc(firebaseDb, 'appConfig', 'roomTargetPublic'),
            (snapshot) => {
              setRenderingEnabled(snapshot.data()?.renderingEnabled === true);
              markReceived();
            },
            fail,
          ),
          firestore.onSnapshot(
            firestore.doc(firebaseDb, 'rooms', roomId, 'targetPublicCycles', periods.current),
            (snapshot) => {
              setCycle(mapRoomTargetPublicCycleV1(snapshot.exists() ? snapshot.data() : undefined, roomId));
              markReceived();
            },
            fail,
          ),
        );
        if (isOwner && ownerUid) {
          unsubscribers.push(firestore.onSnapshot(
            firestore.doc(firebaseDb, 'rooms', roomId, 'targetRosterPreviews', periods.next),
            (snapshot) => {
              setNextRoster(mapRoomTargetRosterPreviewV1(
                snapshot.exists() ? snapshot.data() : undefined,
                roomId,
                ownerUid,
              ));
              markReceived();
            },
            fail,
          ));
        }
      })
      .catch(fail);
    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [enabled, isOwner, ownerUid, periods.current, periods.next, roomId]);

  return enabled
    ? { cycle, error, loading, nextRoster, renderingEnabled }
    : { error: false, loading: false, renderingEnabled: false };
}
