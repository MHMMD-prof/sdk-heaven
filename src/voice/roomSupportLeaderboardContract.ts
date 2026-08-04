import type { AvatarFrameProjection } from '../cosmetics/avatarFrameProjection';
import { readProjectedAvatarFrame } from '../cosmetics/avatarFrameProjection';

export type RoomSupportLeaderboardEntryV1 = {
  avatarLabel: string;
  avatarFrame?: AvatarFrameProjection;
  avatarUrl: string;
  displayName: string;
  eligibleSpendCoins: number;
  firstContributionAtMillis: number;
  rank: number;
  supportPoints: number;
  uid: string;
};

export type RoomSupportLeaderboardV1 = {
  entries: RoomSupportLeaderboardEntryV1[];
  generatedAtMillis: number;
  periodId: string;
  periodType: 'day' | 'week';
  projectionVersion: 1;
  roomId: string;
  totals: {
    eligibleSpendCoins: number;
    giftCount: number;
    supportPoints: number;
  };
};

export function mapRoomSupportLeaderboardV1(
  value: unknown,
  expectedRoomId: string,
): RoomSupportLeaderboardV1 | undefined {
  if (!isRecord(value) || value.roomId !== expectedRoomId || value.projectionVersion !== 1) return undefined;
  if (
    !isFirestoreId(value.roomId)
    || !isPeriodId(value.periodId)
    || !['day', 'week'].includes(String(value.periodType))
    || !Array.isArray(value.entries)
    || value.entries.length > 20
    || !isRecord(value.totals)
  ) return undefined;
  const generatedAtMillis = timestampToMillis(value.generatedAt) || readInteger(value.generatedAtMillis);
  const totals = {
    eligibleSpendCoins: readInteger(value.totals.eligibleSpendCoins),
    giftCount: readInteger(value.totals.giftCount),
    supportPoints: readInteger(value.totals.supportPoints),
  };
  if (generatedAtMillis < 0 || Object.values(totals).some((amount) => amount < 0)) return undefined;
  const entries = value.entries.map(mapEntry);
  if (
    entries.some((entry) => !entry)
    || entries.some((entry, index) => entry?.rank !== index + 1)
    || new Set(entries.map((entry) => entry?.uid)).size !== entries.length
  ) return undefined;
  return {
    entries: entries as RoomSupportLeaderboardEntryV1[],
    generatedAtMillis,
    periodId: value.periodId as string,
    periodType: value.periodType as 'day' | 'week',
    projectionVersion: 1,
    roomId: value.roomId as string,
    totals,
  };
}

function mapEntry(value: unknown): RoomSupportLeaderboardEntryV1 | undefined {
  if (!isRecord(value) || !isFirestoreId(value.uid)) return undefined;
  const firstContributionAtMillis = timestampToMillis(value.firstContributionAt)
    || readInteger(value.firstContributionAtMillis);
  const eligibleSpendCoins = readInteger(value.eligibleSpendCoins);
  const supportPoints = readInteger(value.supportPoints);
  const rank = readInteger(value.rank);
  const displayName = typeof value.displayName === 'string' ? value.displayName.trim().slice(0, 80) : '';
  const avatarLabel = typeof value.avatarLabel === 'string' ? value.avatarLabel.trim().slice(0, 2) : '';
  const avatarUrl = typeof value.avatarUrl === 'string' && /^https:\/\/[^\s]{1,2039}$/.test(value.avatarUrl)
    ? value.avatarUrl
    : '';
  if (firstContributionAtMillis < 0 || eligibleSpendCoins < 0 || supportPoints < 0 || rank < 1 || !displayName) return undefined;
  return {
    avatarLabel,
    ...(readProjectedAvatarFrame(value.avatarFrame) ? { avatarFrame: readProjectedAvatarFrame(value.avatarFrame) } : {}),
    avatarUrl,
    displayName,
    eligibleSpendCoins,
    firstContributionAtMillis,
    rank,
    supportPoints,
    uid: value.uid as string,
  };
}

function timestampToMillis(value: unknown) {
  if (isRecord(value) && typeof value.toMillis === 'function') {
    const milliseconds = (value.toMillis as () => unknown)();
    return readInteger(milliseconds);
  }
  return 0;
}

function readInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : -1;
}

function isPeriodId(value: unknown): value is string {
  return typeof value === 'string' && /^(day|weekly)_[A-Za-z0-9_-]{3,120}$/.test(value);
}

function isFirestoreId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && !value.includes('/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
