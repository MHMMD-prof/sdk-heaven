import type { SocialFeatureFlags } from './types';

export const disabledSocialFeatureFlags: SocialFeatureFlags = Object.freeze({
  avatarUploads: false,
  couples: false,
  directMessageMedia: false,
  directMessageRequests: false,
  directMessages: false,
  following: false,
  friends: false,
  gifts: false,
  personalChatsFrontendV2: false,
  pushNotifications: false,
  representativeTransfers: false,
  usersDiscovery: false,
  wallet: false,
});

export function mapSocialFeatureFlags(data: unknown): SocialFeatureFlags {
  if (!data || typeof data !== 'object') {
    return disabledSocialFeatureFlags;
  }

  const candidate = data as Record<string, unknown>;
  return {
    avatarUploads: candidate.avatarUploads === true,
    couples: candidate.couples === true,
    directMessageMedia: candidate.directMessageMedia === true,
    directMessageRequests: candidate.directMessageRequests === true,
    directMessages: candidate.directMessages === true,
    following: candidate.following === true,
    friends: candidate.friends === true,
    gifts: candidate.gifts === true,
    personalChatsFrontendV2: candidate.personalChatsFrontendV2 === true,
    pushNotifications: candidate.pushNotifications === true,
    representativeTransfers: candidate.representativeTransfers === true,
    usersDiscovery: candidate.usersDiscovery === true,
    wallet: candidate.wallet === true,
  };
}

export async function subscribeSocialFeatureFlags(listener: (flags: SocialFeatureFlags) => void) {
  const [{ firebaseDb }, { doc, onSnapshot }] = await Promise.all([
    import('../auth/firebase'),
    import('firebase/firestore'),
  ]);
  return onSnapshot(
    doc(firebaseDb, 'appConfig', 'socialFeatures'),
    (snapshot) => listener(mapSocialFeatureFlags(snapshot.exists() ? snapshot.data() : undefined)),
    () => listener(disabledSocialFeatureFlags),
  );
}
