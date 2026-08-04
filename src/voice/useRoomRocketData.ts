import Constants from 'expo-constants';
import { useEffect, useMemo, useState } from 'react';

import { isClientVersionCompatible } from './roomThemeContract';
import {
  RoomRocketCycleV1,
  RoomRocketPublicConfigV1,
  RoomRocketPublicTemplateV1,
  mapRoomRocketCycleV1,
  mapRoomRocketPublicConfigV1,
  mapRoomRocketPublicTemplateV1,
} from './roomRocketContract';
import {
  RoomSupportLeaderboardV1,
  mapRoomSupportLeaderboardV1,
} from './roomSupportLeaderboardContract';
import { createRoomSupportPeriodIds } from './roomRocketPeriod';

export type RoomRocketData = {
  cycle?: RoomRocketCycleV1;
  error: boolean;
  loading: boolean;
  renderingEnabled: boolean;
  template?: RoomRocketPublicTemplateV1;
  today?: RoomSupportLeaderboardV1;
  week?: RoomSupportLeaderboardV1;
};

const EMPTY_DATA: RoomRocketData = {
  error: false,
  loading: false,
  renderingEnabled: false,
};

export function useRoomRocketData({
  enabled,
  roomId,
}: {
  enabled: boolean;
  roomId: string;
}): RoomRocketData {
  const [config, setConfig] = useState<RoomRocketPublicConfigV1>();
  const [template, setTemplate] = useState<RoomRocketPublicTemplateV1>();
  const [cycle, setCycle] = useState<RoomRocketCycleV1>();
  const [today, setToday] = useState<RoomSupportLeaderboardV1>();
  const [week, setWeek] = useState<RoomSupportLeaderboardV1>();
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);
  const [periodClock, setPeriodClock] = useState(Date.now());
  const periodIds = useMemo(() => createRoomSupportPeriodIds(periodClock), [periodClock, roomId]);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => setPeriodClock(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [enabled]);

  useEffect(() => {
    setConfig(undefined);
    setTemplate(undefined);
    setCycle(undefined);
    setToday(undefined);
    setWeek(undefined);
    setError(false);
    setLoading(enabled);
    if (!enabled || !roomId) return undefined;
    let cancelled = false;
    const unsubscribers: Array<() => void> = [];
    let received = 0;
    const markReceived = () => {
      received += 1;
      if (received >= 5 && !cancelled) setLoading(false);
    };
    const fail = () => {
      if (!cancelled) {
        setError(true);
        setLoading(false);
      }
    };
    void Promise.all([
      import('../auth/firebase'),
      import('firebase/firestore'),
    ]).then(([{ firebaseDb }, firestore]) => {
      if (cancelled) return;
      const now = firestore.Timestamp.fromMillis(Date.now());
      unsubscribers.push(
        firestore.onSnapshot(
          firestore.doc(firebaseDb, 'appConfig', 'roomRocketPublic'),
          (snapshot) => {
            setConfig(mapRoomRocketPublicConfigV1(snapshot.exists() ? snapshot.data() : undefined));
            markReceived();
          },
          fail,
        ),
        firestore.onSnapshot(
          firestore.query(
            firestore.collection(firebaseDb, 'roomRocketPublicVersions'),
            firestore.where('effectiveFromAt', '<=', now),
            firestore.orderBy('effectiveFromAt', 'desc'),
            firestore.limit(1),
          ),
          (snapshot) => {
            setTemplate(mapRoomRocketPublicTemplateV1(snapshot.docs[0]?.data()));
            markReceived();
          },
          fail,
        ),
        firestore.onSnapshot(
          firestore.doc(firebaseDb, 'rooms', roomId, 'rocketCycles', periodIds.weekId),
          (snapshot) => {
            setCycle(mapRoomRocketCycleV1(snapshot.exists() ? snapshot.data() : undefined, roomId));
            markReceived();
          },
          fail,
        ),
        firestore.onSnapshot(
          firestore.doc(firebaseDb, 'rooms', roomId, 'supportLeaderboards', periodIds.dayId),
          (snapshot) => {
            setToday(mapRoomSupportLeaderboardV1(snapshot.exists() ? snapshot.data() : undefined, roomId));
            markReceived();
          },
          fail,
        ),
        firestore.onSnapshot(
          firestore.doc(firebaseDb, 'rooms', roomId, 'supportLeaderboards', periodIds.weekId),
          (snapshot) => {
            setWeek(mapRoomSupportLeaderboardV1(snapshot.exists() ? snapshot.data() : undefined, roomId));
            markReceived();
          },
          fail,
        ),
      );
    }).catch(fail);
    return () => {
      cancelled = true;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [enabled, periodIds.dayId, periodIds.weekId, roomId]);

  if (!enabled) return EMPTY_DATA;
  const clientVersion = Constants.expoConfig?.version || '1.0.0';
  const compatible = template
    ? isClientVersionCompatible(template.minimumClientVersion, clientVersion)
    : config
      ? isClientVersionCompatible(config.minimumClientVersion, clientVersion)
      : false;
  return {
    cycle,
    error,
    loading,
    renderingEnabled: config?.renderingEnabled === true && compatible,
    template,
    today,
    week,
  };
}
