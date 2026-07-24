import { useEffect, useMemo, useState } from 'react';

import { hasActiveRepresentativeBadge } from './representativeBadge';

export function useRepresentativeBadgeProjection(uids: string[]) {
  const uidsKey = useMemo(
    () => JSON.stringify([...new Set(uids.filter(Boolean))].sort()),
    [uids],
  );
  const [activeByUid, setActiveByUid] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const targetUids = JSON.parse(uidsKey) as string[];
    let cancelled = false;
    let unsubscribes: Array<() => void> = [];
    setActiveByUid({});

    if (!targetUids.length) return undefined;

    void Promise.all([
      import('../auth/firebase'),
      import('firebase/firestore'),
    ]).then(([{ firebaseDb }, { doc, onSnapshot }]) => {
      if (cancelled) return;
      unsubscribes = targetUids.map((uid) => onSnapshot(
        doc(firebaseDb, 'publicProfiles', uid),
        (snapshot) => {
          if (cancelled) return;
          setActiveByUid((current) => ({
            ...current,
            [uid]: snapshot.exists() && hasActiveRepresentativeBadge(snapshot.data()),
          }));
        },
        () => {
          if (cancelled) return;
          setActiveByUid((current) => ({ ...current, [uid]: false }));
        },
      ));
    }).catch(() => {
      if (!cancelled) setActiveByUid({});
    });

    return () => {
      cancelled = true;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [uidsKey]);

  return activeByUid;
}
