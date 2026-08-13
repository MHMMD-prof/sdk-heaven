import type { FriendConnectionSummary } from '../../social/types';
import { normalizeSearch } from '../directChatSearch';

export type ChatComposeSection = {
  data: FriendConnectionSummary[];
  key: 'friends' | 'recent';
  title: string;
};

export function buildComposeSections({
  friends,
  friendsTitle,
  query,
  recentPeerUids,
  recentTitle,
}: {
  friends: FriendConnectionSummary[];
  friendsTitle: string;
  query: string;
  recentPeerUids: string[];
  recentTitle: string;
}): ChatComposeSection[] {
  const normalized = normalizeSearch(query);
  const visible = friends.filter((row) => !normalized || normalizeSearch(row.profile.displayName).includes(normalized));
  if (normalized) return visible.length ? [{ data: visible, key: 'friends', title: friendsTitle }] : [];
  const recentOrder = new Map(recentPeerUids.map((uid, index) => [uid, index]));
  const recent = visible
    .filter((row) => recentOrder.has(row.profile.uid))
    .sort((left, right) => (recentOrder.get(left.profile.uid) ?? Number.MAX_SAFE_INTEGER) - (recentOrder.get(right.profile.uid) ?? Number.MAX_SAFE_INTEGER))
    .slice(0, 5);
  const recentIds = new Set(recent.map((row) => row.profile.uid));
  const remaining = visible.filter((row) => !recentIds.has(row.profile.uid));
  return [
    ...(recent.length ? [{ data: recent, key: 'recent' as const, title: recentTitle }] : []),
    ...(remaining.length ? [{ data: remaining, key: 'friends' as const, title: friendsTitle }] : []),
  ];
}
