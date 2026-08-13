import { useEffect, useState } from 'react';

export type StatusFeatureFlags = {
  aristocracyCard: boolean;
  aristocracyShop: boolean;
  statusAnimations: boolean;
  statusPresentation: boolean;
  svipCard: boolean;
  vipProgression: boolean;
};

export const disabledStatusFeatureFlags: StatusFeatureFlags = Object.freeze({
  aristocracyCard: false,
  aristocracyShop: false,
  statusAnimations: false,
  statusPresentation: false,
  svipCard: false,
  vipProgression: false,
});

export function mapStatusFeatureFlags(value: unknown): StatusFeatureFlags {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value as Record<string, unknown>).schemaVersion !== 1) {
    return disabledStatusFeatureFlags;
  }
  const data = value as Record<string, unknown>;
  return {
    aristocracyCard: data.aristocracyCard === true,
    aristocracyShop: data.aristocracyShop === true,
    statusAnimations: data.statusAnimations === true,
    statusPresentation: data.statusPresentation === true,
    svipCard: data.svipCard === true,
    vipProgression: data.vipProgression === true,
  };
}

export async function subscribeStatusFeatureFlags(listener: (flags: StatusFeatureFlags) => void) {
  const [{ firebaseDb }, { doc, onSnapshot }] = await Promise.all([import('../auth/firebase'), import('firebase/firestore')]);
  return onSnapshot(doc(firebaseDb, 'appConfig', 'statusFeatures'), (snapshot) => {
    listener(mapStatusFeatureFlags(snapshot.exists() ? snapshot.data() : undefined));
  }, () => listener(disabledStatusFeatureFlags));
}

export function useStatusFeatureFlags() {
  const [flags, setFlags] = useState(disabledStatusFeatureFlags);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void subscribeStatusFeatureFlags((next) => { if (active) setFlags(next); }).then((stop) => {
      if (active) unsubscribe = stop;
      else stop();
    });
    return () => { active = false; unsubscribe?.(); };
  }, []);
  return flags;
}
