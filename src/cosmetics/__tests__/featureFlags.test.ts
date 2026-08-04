import { describe, expect, it } from 'vitest';

import {
  disabledCosmeticsFeatureFlags,
  mapCosmeticsFeatureFlags,
} from '../featureFlags';

describe('cosmetics feature flags', () => {
  it('fails closed for missing, malformed, and truthy non-boolean values', () => {
    expect(mapCosmeticsFeatureFlags(undefined)).toEqual(disabledCosmeticsFeatureFlags);
    expect(mapCosmeticsFeatureFlags({
      cosmetics_asset_registry: 'true',
      cosmetics_effect_audio: 1,
      cosmetics_lottie: null,
      cosmetics_shared_renderer: {},
      cosmetics_video: [],
    })).toEqual(disabledCosmeticsFeatureFlags);
  });

  it('maps only the exact server flags', () => {
    expect(mapCosmeticsFeatureFlags({
      cosmetics_animated_avatar_frames: true,
      cosmetics_asset_registry: true,
      cosmetics_effect_audio: true,
      cosmetics_lottie: true,
      cosmetics_profile_skins: true,
      cosmetics_chat_bubbles: true,
      cosmetics_nameplates: true,
      cosmetics_badges: true,
      cosmetics_seat_effects: true,
      room_entry_animations: true,
      room_entry_audio: true,
      room_entry_video: true,
      room_gift_animations: true,
      room_gift_audio: true,
      room_gift_global_effects: true,
      room_gift_video: true,
      cosmetics_shared_renderer: true,
      cosmetics_unified_avatar_frames: true,
      cosmetics_video: true,
      video: true,
    })).toEqual({
      animatedAvatarFrames: true,
      assetRegistry: true,
      effectAudio: true,
      lottie: true,
      profileSkins: true,
      chatBubbles: true,
      nameplates: true,
      cosmeticBadges: true,
      seatEffects: true,
      roomEntryAnimations: true,
      roomEntryAudio: true,
      roomEntryVideo: true,
      roomGiftAnimations: true,
      roomGiftAudio: true,
      roomGiftGlobalEffects: true,
      roomGiftVideo: true,
      sharedRenderer: true,
      unifiedAvatarFrames: true,
      video: true,
    });
  });
});
