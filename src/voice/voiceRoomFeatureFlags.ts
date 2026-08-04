import { useEffect, useState } from 'react';

export type VoiceRoomFeatureFlags = {
  chat: boolean;
  commandCenter: boolean;
  entryEffects: boolean;
  games: boolean;
  gifts: boolean;
  media: boolean;
  /** Kill switch: false blocks create/join; absent/true allows (fail-open for capacity). */
  newJoins: boolean;
  ownershipTransfer: boolean;
  ownerTargetPayouts: boolean;
  ownerTargets: boolean;
  payrollPayouts: boolean;
  payrollTracking: boolean;
  rocketRewards: boolean;
  safety: boolean;
  seats: boolean;
  safetyRecording: boolean;
  sharedMusic: boolean;
  superModeration: boolean;
  themes: boolean;
  themePurchases: boolean;
  supporterRankings: boolean;
  v2Mutations: boolean;
};

export const disabledVoiceRoomFeatureFlags: VoiceRoomFeatureFlags = Object.freeze({
  chat: false,
  commandCenter: false,
  entryEffects: false,
  games: false,
  gifts: false,
  media: false,
  newJoins: true,
  ownershipTransfer: false,
  ownerTargetPayouts: false,
  ownerTargets: false,
  payrollPayouts: false,
  payrollTracking: false,
  rocketRewards: false,
  safety: false,
  seats: false,
  safetyRecording: false,
  sharedMusic: false,
  superModeration: false,
  themes: false,
  themePurchases: false,
  supporterRankings: false,
  v2Mutations: false,
});

export function mapVoiceRoomFeatureFlags(data: unknown): VoiceRoomFeatureFlags {
  if (!data || typeof data !== 'object') return disabledVoiceRoomFeatureFlags;
  const candidate = data as Record<string, unknown>;
  return {
    chat: candidate.voice_room_chat === true,
    commandCenter: candidate.voice_room_command_center === true,
    entryEffects: candidate.voice_room_entry_effects === true,
    games: candidate.voice_room_games === true,
    gifts: candidate.voice_room_gifts === true,
    media: candidate.voice_room_media === true,
    newJoins: candidate.voice_room_new_joins !== false,
    ownershipTransfer: candidate.voice_room_ownership_transfer === true,
    ownerTargetPayouts: candidate.voice_room_owner_target_payouts === true,
    ownerTargets: candidate.voice_room_owner_targets === true,
    payrollPayouts: candidate.voice_room_payroll_payouts === true,
    payrollTracking: candidate.voice_room_payroll_tracking === true,
    rocketRewards: candidate.voice_room_rocket_rewards === true,
    safety: candidate.voice_room_safety === true,
    seats: candidate.voice_room_seats === true,
    safetyRecording: candidate.voice_room_safety_recording === true,
    sharedMusic: candidate.voice_room_shared_music === true,
    superModeration: candidate.voice_room_super_moderation === true,
    themes: candidate.voice_room_themes === true,
    themePurchases: candidate.voice_room_theme_purchases === true,
    supporterRankings: candidate.voice_room_supporter_rankings === true,
    v2Mutations: candidate.voice_room_v2_mutations === true,
  };
}

export async function subscribeVoiceRoomFeatureFlags(listener: (flags: VoiceRoomFeatureFlags) => void) {
  const [{ firebaseDb }, { doc, onSnapshot }] = await Promise.all([
    import('../auth/firebase'),
    import('firebase/firestore'),
  ]);
  return onSnapshot(
    doc(firebaseDb, 'appConfig', 'voiceRoomFeatures'),
    (snapshot) => listener(mapVoiceRoomFeatureFlags(snapshot.exists() ? snapshot.data() : undefined)),
    () => listener(disabledVoiceRoomFeatureFlags),
  );
}

export function useVoiceRoomFeatureFlags() {
  const [flags, setFlags] = useState(disabledVoiceRoomFeatureFlags);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    void subscribeVoiceRoomFeatureFlags((nextFlags) => {
      if (mounted) setFlags(nextFlags);
    }).then((stop) => {
      if (mounted) unsubscribe = stop;
      else stop();
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  return flags;
}
