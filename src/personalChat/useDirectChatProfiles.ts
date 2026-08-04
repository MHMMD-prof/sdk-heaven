import { useEffect, useMemo, useState } from 'react';

import { subscribePublicProfile } from '../social/publicProfile';
import type { PublicUserProfile } from '../social/types';

export function useDirectChatProfiles(peerUids: string[]) {
  const stableUids = useMemo(
    () => [...new Set(peerUids.filter(Boolean))].sort().slice(0, 50),
    [peerUids.join('\u0000')],
  );
  const [profiles, setProfiles] = useState<Record<string, PublicUserProfile | undefined>>({});

  useEffect(() => {
    let active = true;
    const unsubscribes: Array<() => void> = [];
    setProfiles((current) => Object.fromEntries(stableUids.map((uid) => [uid, current[uid]])));
    for (const uid of stableUids) {
      void subscribePublicProfile(
        uid,
        (profile) => {
          if (active) setProfiles((current) => ({ ...current, [uid]: profile }));
        },
        () => {
          if (active) setProfiles((current) => ({ ...current, [uid]: undefined }));
        },
      ).then((unsubscribe) => {
        if (active) unsubscribes.push(unsubscribe);
        else unsubscribe();
      }).catch(() => undefined);
    }
    return () => {
      active = false;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [stableUids.join('\u0000')]);

  return profiles;
}
