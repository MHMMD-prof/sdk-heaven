import { describe, expect, it } from 'vitest';

import {
  disabledVoiceRoomFeatureFlags,
  mapVoiceRoomFeatureFlags,
} from '../voiceRoomFeatureFlags';

describe('voiceRoomFeatureFlags', () => {
  it('fails closed for missing or malformed configuration', () => {
    expect(mapVoiceRoomFeatureFlags(undefined)).toEqual(disabledVoiceRoomFeatureFlags);
    expect(mapVoiceRoomFeatureFlags({
      voice_room_chat: 'true',
      voice_room_command_center: 'true',
      voice_room_entry_effects: 'true',
      voice_room_games: 'true',
      voice_room_gifts: 'true',
      voice_room_media: 'true',
      voice_room_ownership_transfer: 'true',
      voice_room_safety: 1,
      voice_room_seats: 1,
      voice_room_v2_mutations: null,
    })).toEqual(disabledVoiceRoomFeatureFlags);
  });

  it('maps only explicit true values', () => {
    expect(mapVoiceRoomFeatureFlags({
      voice_room_chat: true,
      voice_room_command_center: true,
      voice_room_entry_effects: true,
      voice_room_games: true,
      voice_room_gifts: true,
      voice_room_media: true,
      voice_room_ownership_transfer: true,
      voice_room_safety: true,
      voice_room_seats: true,
      voice_room_super_moderation: true,
      voice_room_v2_mutations: false,
    })).toEqual({
      chat: true,
      commandCenter: true,
      entryEffects: true,
      games: true,
      gifts: true,
      media: true,
      newJoins: true,
      ownershipTransfer: true,
      ownerTargetPayouts: false,
      ownerTargets: false,
      payrollPayouts: false,
      payrollTracking: false,
      rocketRewards: false,
      safety: true,
      seats: true,
      safetyRecording: false,
      sharedMusic: false,
      superModeration: true,
      themePurchases: false,
      themes: false,
      supporterRankings: false,
      v2Mutations: false,
    });
  });

  it('keeps rendering and purchasing behind independent theme flags', () => {
    expect(mapVoiceRoomFeatureFlags({
      voice_room_theme_purchases: true,
      voice_room_themes: false,
    })).toMatchObject({ themePurchases: true, themes: false });
  });

  it('maps shared music and safety recording only when explicitly true', () => {
    expect(mapVoiceRoomFeatureFlags({ voice_room_shared_music: true }).sharedMusic).toBe(true);
    expect(mapVoiceRoomFeatureFlags({ voice_room_safety_recording: true }).safetyRecording).toBe(true);
  });

  it('keeps tracking and money-moving incentive flags independent', () => {
    expect(mapVoiceRoomFeatureFlags({
      voice_room_owner_target_payouts: false,
      voice_room_owner_targets: true,
      voice_room_payroll_payouts: false,
      voice_room_payroll_tracking: true,
      voice_room_rocket_rewards: false,
      voice_room_supporter_rankings: true,
    })).toMatchObject({
      ownerTargetPayouts: false,
      ownerTargets: true,
      payrollPayouts: false,
      payrollTracking: true,
      rocketRewards: false,
      supporterRankings: true,
    });
  });

  it('treats newJoins as a fail-open kill switch', () => {
    expect(mapVoiceRoomFeatureFlags({ voice_room_new_joins: false }).newJoins).toBe(false);
    expect(mapVoiceRoomFeatureFlags({}).newJoins).toBe(true);
  });
});
