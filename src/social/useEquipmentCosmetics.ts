import { useEffect, useMemo, useState } from 'react';

import { readEquipmentCosmetics, type EquipmentCosmetics } from '../cosmetics/equipmentCosmetics';

export const MAX_LIVE_EQUIPMENT_COSMETIC_PROJECTIONS = 20;

export function useEquipmentCosmetics(uids: string[]) {
  const uidsKey = useMemo(() => JSON.stringify(normalizeEquipmentCosmeticUids(uids)), [uids]);
  const [byUid, setByUid] = useState<Record<string, EquipmentCosmetics>>({});
  useEffect(() => {
    const targetUids = JSON.parse(uidsKey) as string[];
    let cancelled = false;
    let unsubscribes: Array<() => void> = [];
    setByUid({});
    if (!targetUids.length) return undefined;
    void Promise.all([import('../auth/firebase'), import('firebase/firestore')]).then(([{ firebaseDb }, { doc, onSnapshot }]) => {
      if (cancelled) return;
      unsubscribes = targetUids.map((uid) => onSnapshot(doc(firebaseDb, 'publicProfiles', uid), (snapshot) => {
        if (!cancelled) setByUid((current) => ({ ...current, [uid]: readEquipmentCosmetics(snapshot.exists() ? snapshot.data() : undefined) }));
      }, () => {
        if (!cancelled) setByUid((current) => {
          const next = { ...current };
          delete next[uid];
          return next;
        });
      }));
    }).catch(() => { if (!cancelled) setByUid({}); });
    return () => { cancelled = true; unsubscribes.forEach((unsubscribe) => unsubscribe()); };
  }, [uidsKey]);
  return byUid;
}

export function normalizeEquipmentCosmeticUids(uids: string[]) {
  return [...new Set(uids.filter((uid) => /^[^/\s]{1,128}$/.test(uid)))].sort().slice(0, MAX_LIVE_EQUIPMENT_COSMETIC_PROJECTIONS);
}
