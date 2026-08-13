import { useEffect, useMemo, useState } from 'react';

import { mapStatusPresentation, type StatusPresentation } from './statusPresentation';

export const MAX_LIVE_STATUS_PROJECTIONS = 20;

export function useStatusPresentations(uids: string[], enabled = true) {
  const key = useMemo(() => JSON.stringify(normalizeStatusUids(enabled ? uids : [])), [enabled, uids]);
  const [byUid, setByUid] = useState<Record<string, StatusPresentation>>({});
  useEffect(() => {
    const targets = JSON.parse(key) as string[];
    let cancelled = false;
    let unsubscribes: Array<() => void> = [];
    setByUid({});
    if (!targets.length) return undefined;
    void Promise.all([import('../auth/firebase'), import('firebase/firestore')]).then(([{ firebaseDb }, { doc, onSnapshot }]) => {
      if (cancelled) return;
      unsubscribes = targets.map((uid) => onSnapshot(doc(firebaseDb, 'publicProfiles', uid), (snapshot) => {
        if (cancelled) return;
        const presentation = mapStatusPresentation(snapshot.exists() ? snapshot.data().statusPresentation : undefined);
        setByUid((current) => {
          const next = { ...current };
          if (presentation) next[uid] = presentation;
          else delete next[uid];
          return next;
        });
      }, () => {
        if (!cancelled) setByUid((current) => { const next = { ...current }; delete next[uid]; return next; });
      }));
    }).catch(() => { if (!cancelled) setByUid({}); });
    return () => { cancelled = true; unsubscribes.forEach((stop) => stop()); };
  }, [key]);
  return byUid;
}

export function normalizeStatusUids(uids: string[]) {
  return [...new Set(uids.filter((uid) => /^[^/\s]{1,128}$/.test(uid)))].sort().slice(0, MAX_LIVE_STATUS_PROJECTIONS);
}
