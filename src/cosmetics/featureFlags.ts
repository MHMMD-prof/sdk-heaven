import { useEffect, useState } from 'react';

export type CosmeticsFeatureFlags = {
  animatedAvatarFrames: boolean;
  assetRegistry: boolean;
  effectAudio: boolean;
  profileSkins: boolean;
  chatBubbles: boolean;
  nameplates: boolean;
  cosmeticBadges: boolean;
  seatEffects: boolean;
  lottie: boolean;
  roomEntryAnimations: boolean;
  roomEntryAudio: boolean;
  roomEntryVideo: boolean;
  roomGiftAnimations: boolean;
  roomGiftAudio: boolean;
  roomGiftGlobalEffects: boolean;
  roomGiftVideo: boolean;
  sharedRenderer: boolean;
  unifiedAvatarFrames: boolean;
  video: boolean;
};

export const disabledCosmeticsFeatureFlags: CosmeticsFeatureFlags = Object.freeze({
  animatedAvatarFrames: false,
  assetRegistry: false,
  effectAudio: false,
  profileSkins: false,
  chatBubbles: false,
  nameplates: false,
  cosmeticBadges: false,
  seatEffects: false,
  lottie: false,
  roomEntryAnimations: false,
  roomEntryAudio: false,
  roomEntryVideo: false,
  roomGiftAnimations: false,
  roomGiftAudio: false,
  roomGiftGlobalEffects: false,
  roomGiftVideo: false,
  sharedRenderer: false,
  unifiedAvatarFrames: false,
  video: false,
});

export function mapCosmeticsFeatureFlags(data: unknown): CosmeticsFeatureFlags {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return disabledCosmeticsFeatureFlags;
  }
  const value = data as Record<string, unknown>;
  return {
    animatedAvatarFrames: value.cosmetics_animated_avatar_frames === true,
    assetRegistry: value.cosmetics_asset_registry === true,
    effectAudio: value.cosmetics_effect_audio === true,
    profileSkins: value.cosmetics_profile_skins === true,
    chatBubbles: value.cosmetics_chat_bubbles === true,
    nameplates: value.cosmetics_nameplates === true,
    cosmeticBadges: value.cosmetics_badges === true,
    seatEffects: value.cosmetics_seat_effects === true,
    lottie: value.cosmetics_lottie === true,
    roomEntryAnimations: value.room_entry_animations === true,
    roomEntryAudio: value.room_entry_audio === true,
    roomEntryVideo: value.room_entry_video === true,
    roomGiftAnimations: value.room_gift_animations === true,
    roomGiftAudio: value.room_gift_audio === true,
    roomGiftGlobalEffects: value.room_gift_global_effects === true,
    roomGiftVideo: value.room_gift_video === true,
    sharedRenderer: value.cosmetics_shared_renderer === true,
    unifiedAvatarFrames: value.cosmetics_unified_avatar_frames === true,
    video: value.cosmetics_video === true,
  };
}

export async function subscribeCosmeticsFeatureFlags(
  listener: (flags: CosmeticsFeatureFlags) => void,
) {
  const [{ firebaseDb }, { doc, onSnapshot }] = await Promise.all([
    import('../auth/firebase'),
    import('firebase/firestore'),
  ]);
  return onSnapshot(
    doc(firebaseDb, 'appConfig', 'cosmeticsFeatures'),
    (snapshot) => listener(mapCosmeticsFeatureFlags(snapshot.exists() ? snapshot.data() : undefined)),
    () => listener(disabledCosmeticsFeatureFlags),
  );
}

export function useCosmeticsFeatureFlags() {
  const [flags, setFlags] = useState(disabledCosmeticsFeatureFlags);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void subscribeCosmeticsFeatureFlags((next) => {
      if (active) setFlags(next);
    }).then((stop) => {
      if (active) unsubscribe = stop;
      else stop();
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return flags;
}
