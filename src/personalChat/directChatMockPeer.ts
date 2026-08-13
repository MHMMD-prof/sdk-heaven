import type { FriendConnectionSummary, PublicUserProfile } from '../social/types';

/** Fixed Auth/Firestore UID created by functions/scripts/seedDirectChatMockPeer.js */
export const DIRECT_CHAT_MOCK_PEER_UID = 'directChatMockPeer001';

export const DIRECT_CHAT_MOCK_PEER_NAME = 'مستخدم تجريبي';

export function isDirectChatMockPeerEnabled() {
  return typeof __DEV__ !== 'undefined' && __DEV__ === true;
}

export function createDirectChatMockFriendSummary(): FriendConnectionSummary {
  const profile: PublicUserProfile = {
    avatarModerationStatus: 'clear',
    avatarUrl: '',
    bio: 'حساب تجريبي للمحادثات الخاصة',
    countryCode: 'IQ',
    coupleLevel: 0,
    displayName: DIRECT_CHAT_MOCK_PEER_NAME,
    friendCount: 1,
    followerCount: 0,
    followingCount: 0,
    giftScore: 0,
    moderationStatus: 'active',
    normalizedName: DIRECT_CHAT_MOCK_PEER_NAME,
    publicId: 'MOCKPEER',
    uid: DIRECT_CHAT_MOCK_PEER_UID,
  };
  return { profile };
}

export function mergeDirectChatMockFriend(friends: FriendConnectionSummary[]): FriendConnectionSummary[] {
  if (!isDirectChatMockPeerEnabled()) return friends;
  if (friends.some((row) => row.profile.uid === DIRECT_CHAT_MOCK_PEER_UID)) return friends;
  return [createDirectChatMockFriendSummary(), ...friends];
}
