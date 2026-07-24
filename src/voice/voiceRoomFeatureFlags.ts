import { useEffect, useState } from 'react';

export type VoiceRoomFeatureFlags = {
  chat: boolean;
  commandCenter: boolean;
  media: boolean;
  safety: boolean;
  seats: boolean;
  v2Mutations: boolean;
};

export const disabledVoiceRoomFeatureFlags: VoiceRoomFeatureFlags = Object.freeze({
  chat: false,
  commandCenter: false,
  media: false,
  safety: false,
  seats: false,
  v2Mutations: false,
});

export function mapVoiceRoomFeatureFlags(data: unknown): VoiceRoomFeatureFlags {
  if (!data || typeof data !== 'object') return disabledVoiceRoomFeatureFlags;
  const candidate = data as Record<string, unknown>;
  return {
    chat: candidate.voice_room_chat === true,
    commandCenter: candidate.voice_room_command_center === true,
    media: candidate.voice_room_media === true,
    safety: candidate.voice_room_safety === true,
    seats: candidate.voice_room_seats === true,
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
