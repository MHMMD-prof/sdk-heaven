import { useEffect, useMemo, useState } from 'react';

import {
  readAvatarFrameProjection,
  type AvatarFrameProjection,
} from '../cosmetics/avatarFrameProjection';

export const MAX_LIVE_AVATAR_FRAME_PROJECTIONS = 64;

export function useAvatarFrameProjection(uids: string[]) {
  const uidsKey = useMemo(
    () => JSON.stringify(normalizeLiveAvatarFrameUids(uids)),
    [uids],
  );
  const [framesByUid, setFramesByUid] = useState<Record<string, AvatarFrameProjection>>({});

  useEffect(() => {
    const targetUids = JSON.parse(uidsKey) as string[];
    let cancelled = false;
    let unsubscribes: Array<() => void> = [];
    setFramesByUid({});
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
          const value = readAvatarFrameProjection(snapshot.exists() ? snapshot.data() : undefined);
          setFramesByUid((current) => {
            if (!value) {
              const next = { ...current };
              delete next[uid];
              return next;
            }
            return { ...current, [uid]: value };
          });
        },
        () => {
          if (cancelled) return;
          setFramesByUid((current) => {
            const next = { ...current };
            delete next[uid];
            return next;
          });
        },
      ));
    }).catch(() => {
      if (!cancelled) setFramesByUid({});
    });

    return () => {
      cancelled = true;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [uidsKey]);

  return framesByUid;
}

export function normalizeLiveAvatarFrameUids(uids: string[]) {
  return [...new Set(uids.filter((uid) => /^[^/\s]{1,128}$/.test(uid)))]
    .sort()
    .slice(0, MAX_LIVE_AVATAR_FRAME_PROJECTIONS);
}
