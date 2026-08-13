import { useEffect, useState } from 'react';

export type CosmeticsFeatureFlags = {
  animatedAvatarFrames: boolean;
  assetRegistry: boolean;
  coupleEntrances: boolean;
  coupleEffects: boolean;
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
  roomBottomEffectStage: boolean;
  roomBottomEffectStageRollout: 'off' | 'testers' | 'rooms' | 'global';
  roomBottomEffectStageRoomIds: string[];
  roomBottomEffectStageTesterHashes: string[];
  roomReactions: boolean;
  roomReactionCatalog: Array<{ assetId: string; assetVersionId: string }>;
  roomAnimatedThemes: boolean;
  sharedRenderer: boolean;
  unifiedAvatarFrames: boolean;
  video: boolean;
  customSubmissions: boolean;
  customRendering: boolean;
};

export const disabledCosmeticsFeatureFlags: CosmeticsFeatureFlags = Object.freeze({
  animatedAvatarFrames: false,
  assetRegistry: false,
  coupleEntrances: false,
  coupleEffects: false,
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
  roomBottomEffectStage: false,
  roomBottomEffectStageRollout: 'off',
  roomBottomEffectStageRoomIds: [],
  roomBottomEffectStageTesterHashes: [],
  roomReactions: false,
  roomReactionCatalog: [],
  roomAnimatedThemes: false,
  sharedRenderer: false,
  unifiedAvatarFrames: false,
  video: false,
  customSubmissions: false,
  customRendering: false,
});

export function mapCosmeticsFeatureFlags(data: unknown): CosmeticsFeatureFlags {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return disabledCosmeticsFeatureFlags;
  }
  const value = data as Record<string, unknown>;
  return {
    animatedAvatarFrames: value.cosmetics_animated_avatar_frames === true,
    assetRegistry: value.cosmetics_asset_registry === true,
    coupleEntrances: value.cosmetics_couple_entrances === true,
    coupleEffects: value.cosmetics_couple_effects === true,
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
    roomBottomEffectStage: value.room_bottom_effect_stage === true,
    roomBottomEffectStageRollout: mapBottomEffectStageRollout(
      value.room_bottom_effect_stage_rollout,
    ),
    roomBottomEffectStageRoomIds: mapRolloutIdentifiers(
      value.room_bottom_effect_stage_room_ids,
    ),
    roomBottomEffectStageTesterHashes: mapRolloutHashes(
      value.room_bottom_effect_stage_test_uid_hashes,
    ),
    roomReactions: value.room_reactions === true,
    roomReactionCatalog: mapReactionCatalog(value.room_reaction_catalog),
    roomAnimatedThemes: value.room_animated_themes === true,
    sharedRenderer: value.cosmetics_shared_renderer === true,
    unifiedAvatarFrames: value.cosmetics_unified_avatar_frames === true,
    video: value.cosmetics_video === true,
    customSubmissions: value.cosmetics_custom_submissions === true,
    customRendering: value.cosmetics_custom_rendering === true,
  };
}

function mapBottomEffectStageRollout(
  value: unknown,
): CosmeticsFeatureFlags['roomBottomEffectStageRollout'] {
  return value === 'testers' || value === 'rooms' || value === 'global' ? value : 'off';
}

function mapRolloutIdentifiers(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((entry) => (
    typeof entry === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{1,127}$/.test(entry)
      ? [entry]
      : []
  )))].slice(0, 100);
}

function mapRolloutHashes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((entry) => (
    typeof entry === 'string' && /^[a-f0-9]{64}$/.test(entry)
      ? [entry]
      : []
  )))].slice(0, 100);
}

function mapReactionCatalog(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const candidate = entry as Record<string, unknown>;
    const assetId = typeof candidate.assetId === 'string' ? candidate.assetId : '';
    const assetVersionId = typeof candidate.assetVersionId === 'string' ? candidate.assetVersionId : '';
    return /^[a-z0-9][a-z0-9_-]{2,79}$/.test(assetId)
      && /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/.test(assetVersionId)
      ? [{ assetId, assetVersionId }]
      : [];
  });
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
