import { useEffect, useState } from 'react';

export type GrowthFeatureFlags = {
  crossRoomPk: boolean;
  dailyMissions: boolean;
  families: boolean;
  giftCombos: boolean;
  leaderboards: boolean;
  luckyBag: boolean;
  luckyGifts: boolean;
  magicGiftTemplates: boolean;
  maskedMatch: boolean;
  opsEvents: boolean;
  quickMatch: boolean;
  roomGameEconomy: boolean;
  roomPk: boolean;
  softOneToOneMatch: boolean;
  vipTiers: boolean;
  watchTogether: boolean;
};

export const disabledGrowthFeatureFlags: GrowthFeatureFlags = Object.freeze({
  crossRoomPk: false,
  dailyMissions: false,
  families: false,
  giftCombos: false,
  leaderboards: false,
  luckyBag: false,
  luckyGifts: false,
  magicGiftTemplates: false,
  maskedMatch: false,
  opsEvents: false,
  quickMatch: false,
  roomGameEconomy: false,
  roomPk: false,
  softOneToOneMatch: false,
  vipTiers: false,
  watchTogether: false,
});

export function mapGrowthFeatureFlags(data: unknown): GrowthFeatureFlags {
  if (!data || typeof data !== 'object') {
    return disabledGrowthFeatureFlags;
  }
  const candidate = data as Record<string, unknown>;
  return {
    crossRoomPk: candidate.crossRoomPk === true,
    dailyMissions: candidate.dailyMissions === true,
    families: candidate.families === true,
    giftCombos: candidate.giftCombos === true,
    leaderboards: candidate.leaderboards === true,
    luckyBag: candidate.luckyBag === true,
    luckyGifts: candidate.luckyGifts === true,
    magicGiftTemplates: candidate.magicGiftTemplates === true,
    maskedMatch: candidate.maskedMatch === true,
    opsEvents: candidate.opsEvents === true,
    quickMatch: candidate.quickMatch === true,
    roomGameEconomy: candidate.roomGameEconomy === true,
    roomPk: candidate.roomPk === true,
    softOneToOneMatch: candidate.softOneToOneMatch === true,
    vipTiers: candidate.vipTiers === true,
    watchTogether: candidate.watchTogether === true,
  };
}

export async function subscribeGrowthFeatureFlags(listener: (flags: GrowthFeatureFlags) => void) {
  const [{ firebaseDb }, { doc, onSnapshot }] = await Promise.all([
    import('../auth/firebase'),
    import('firebase/firestore'),
  ]);
  return onSnapshot(
    doc(firebaseDb, 'appConfig', 'growthFeatures'),
    (snapshot) => listener(mapGrowthFeatureFlags(snapshot.exists() ? snapshot.data() : undefined)),
    () => listener(disabledGrowthFeatureFlags),
  );
}

export function useGrowthFeatureFlags() {
  const [flags, setFlags] = useState(disabledGrowthFeatureFlags);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    void subscribeGrowthFeatureFlags((nextFlags) => {
      if (active) setFlags(nextFlags);
    }).then((nextUnsubscribe) => {
      if (active) unsubscribe = nextUnsubscribe;
      else nextUnsubscribe();
    }).catch(() => {
      if (active) setFlags(disabledGrowthFeatureFlags);
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return flags;
}
