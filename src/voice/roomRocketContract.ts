import { mapRewardBundleV1 } from './weeklyIncentiveContract';
import type { RewardBundleV1 } from './weeklyIncentiveContract';

export type RoomRocketAssetV1 = {
  durationMs?: number;
  format: 'png' | 'webp' | 'animated-webp' | 'mp3' | 'm4a';
  height?: number;
  uri: string;
  width?: number;
};

export type RoomRocketPodiumEntryV1 = {
  eligibleSpendCoins: number;
  rank: number;
  rewardBundle: RewardBundleV1;
  supportPoints: number;
  uid: string;
};

export type RoomRocketCycleV1 = {
  appearance: {
    animationAsset?: RoomRocketAssetV1;
    name: { ar: string; en: string };
    soundAsset?: RoomRocketAssetV1;
    staticAsset?: RoomRocketAssetV1;
  };
  cycleId: string;
  enabledRankCount: 1 | 2 | 3;
  endAtMillis: number;
  finalPodium: RoomRocketPodiumEntryV1[];
  roomId: string;
  startAtMillis: number;
  state: 'active' | 'unlocked' | 'missed' | 'ready' | 'settling' | 'settled' | 'held';
  supportPoints: number;
  targetSupportPoints: number;
  templateRevision: number;
};

export type RoomRocketPublicConfigV1 = {
  effectiveFromAtMillis: number;
  effectiveFromCycleId: string;
  minimumClientVersion: string;
  renderingEnabled: boolean;
  revision: number;
  schemaVersion: 1;
};

export type RoomRocketPublicTemplateV1 = {
  appearance: RoomRocketCycleV1['appearance'];
  effectiveFromAtMillis: number;
  effectiveFromCycleId: string;
  enabledRankCount: 1 | 2 | 3;
  minimumClientVersion: string;
  revision: number;
  rewards: Partial<Record<'1' | '2' | '3', RewardBundleV1>>;
  targetSupportPoints: number;
  timeZone: string;
};

export function mapRoomRocketPublicConfigV1(value: unknown): RoomRocketPublicConfigV1 | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.renderingEnabled !== 'boolean') return undefined;
  const revision = readInteger(value.revision);
  const effectiveFromAtMillis = value.effectiveFromAt === undefined ? 0 : timestampToMillis(value.effectiveFromAt);
  const effectiveFromCycleId = typeof value.effectiveFromCycleId === 'string' && isCycleId(value.effectiveFromCycleId)
    ? value.effectiveFromCycleId
    : '';
  const minimumClientVersion = typeof value.minimumClientVersion === 'string'
    && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.minimumClientVersion)
    ? value.minimumClientVersion
    : '';
  if (revision < 1 || effectiveFromAtMillis < 0) return undefined;
  if (value.renderingEnabled && (!effectiveFromCycleId || !minimumClientVersion)) return undefined;
  return {
    effectiveFromAtMillis,
    effectiveFromCycleId,
    minimumClientVersion,
    renderingEnabled: value.renderingEnabled,
    revision,
    schemaVersion: 1,
  };
}

export function mapRoomRocketCycleV1(
  value: unknown,
  expectedRoomId: string,
): RoomRocketCycleV1 | undefined {
  if (!isRecord(value) || value.roomId !== expectedRoomId || !isCycleId(value.cycleId)) return undefined;
  const startAtMillis = timestampToMillis(value.startAt);
  const endAtMillis = timestampToMillis(value.endAt);
  const supportPoints = readInteger(value.supportPoints);
  const targetSupportPoints = readInteger(value.targetSupportPoints);
  const templateRevision = readInteger(value.templateRevision);
  const enabledRankCount = readInteger(value.enabledRankCount);
  const states = ['active', 'unlocked', 'missed', 'ready', 'settling', 'settled', 'held'] as const;
  const state = states.find((candidate) => candidate === value.state);
  const appearance = mapAppearance(value.appearance);
  if (
    !appearance
    || !state
    || ![1, 2, 3].includes(enabledRankCount)
    || startAtMillis < 0
    || endAtMillis <= startAtMillis
    || supportPoints < 0
    || targetSupportPoints < 1
    || templateRevision < 1
  ) return undefined;
  const rawPodium = Array.isArray(value.finalPodium) ? value.finalPodium : [];
  const finalPodium = rawPodium.map(mapPodiumEntry);
  if (
    finalPodium.some((entry) => !entry)
    || finalPodium.length > enabledRankCount
    || finalPodium.some((entry, index) => entry?.rank !== index + 1)
  ) return undefined;
  return {
    appearance,
    cycleId: value.cycleId as string,
    enabledRankCount: enabledRankCount as 1 | 2 | 3,
    endAtMillis,
    finalPodium: finalPodium as RoomRocketPodiumEntryV1[],
    roomId: value.roomId as string,
    startAtMillis,
    state,
    supportPoints,
    targetSupportPoints,
    templateRevision,
  };
}

export function mapRoomRocketPublicTemplateV1(value: unknown): RoomRocketPublicTemplateV1 | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.template)) return undefined;
  const template = value.template;
  const appearance = mapAppearance(template.appearance);
  const revision = readInteger(value.revision);
  const effectiveFromAtMillis = timestampToMillis(value.effectiveFromAt);
  const effectiveFromCycleId = typeof value.effectiveFromCycleId === 'string' && isCycleId(value.effectiveFromCycleId)
    ? value.effectiveFromCycleId
    : '';
  const enabledRankCount = readInteger(template.enabledRankCount);
  const targetSupportPoints = readInteger(template.targetSupportPoints);
  const minimumClientVersion = typeof template.minimumClientVersion === 'string'
    && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(template.minimumClientVersion)
    ? template.minimumClientVersion
    : '';
  const timeZone = typeof template.timeZone === 'string' ? template.timeZone.slice(0, 80) : '';
  if (
    !appearance
    || revision < 1
    || effectiveFromAtMillis < 0
    || !effectiveFromCycleId
    || ![1, 2, 3].includes(enabledRankCount)
    || targetSupportPoints < 1
    || !minimumClientVersion
    || !timeZone
  ) return undefined;
  const rewards: RoomRocketPublicTemplateV1['rewards'] = {};
  for (let rank = 1; rank <= enabledRankCount; rank += 1) {
    const reward = mapRewardBundleV1(template.rewards && isRecord(template.rewards)
      ? template.rewards[String(rank)]
      : undefined);
    if (!reward) return undefined;
    rewards[String(rank) as '1' | '2' | '3'] = reward;
  }
  return {
    appearance,
    effectiveFromAtMillis,
    effectiveFromCycleId,
    enabledRankCount: enabledRankCount as 1 | 2 | 3,
    minimumClientVersion,
    revision,
    rewards,
    targetSupportPoints,
    timeZone,
  };
}

function mapAppearance(value: unknown): RoomRocketCycleV1['appearance'] | undefined {
  if (!isRecord(value) || !isRecord(value.name)) return undefined;
  const ar = typeof value.name.ar === 'string' ? value.name.ar.trim().slice(0, 60) : '';
  const en = typeof value.name.en === 'string' ? value.name.en.trim().slice(0, 60) : '';
  const staticAsset = mapAsset(value.staticAsset, ['png', 'webp']);
  const animationAsset = mapAsset(value.animationAsset, ['animated-webp']);
  const soundAsset = mapAsset(value.soundAsset, ['mp3', 'm4a']);
  if (!ar || !en || !staticAsset || !animationAsset) return undefined;
  return { animationAsset, name: { ar, en }, ...(soundAsset ? { soundAsset } : {}), staticAsset };
}

function mapAsset(value: unknown, formats: RoomRocketAssetV1['format'][]): RoomRocketAssetV1 | undefined {
  if (!isRecord(value) || typeof value.uri !== 'string' || !/^https:\/\/[^\s]{1,2039}$/.test(value.uri)) return undefined;
  if (!formats.includes(value.format as RoomRocketAssetV1['format'])) return undefined;
  const durationMs = readOptionalInteger(value.durationMs);
  const height = readOptionalInteger(value.height);
  const width = readOptionalInteger(value.width);
  if (durationMs === -1 || height === -1 || width === -1) return undefined;
  return {
    ...(durationMs === undefined ? {} : { durationMs }),
    format: value.format as RoomRocketAssetV1['format'],
    ...(height === undefined ? {} : { height }),
    uri: value.uri,
    ...(width === undefined ? {} : { width }),
  };
}

function mapPodiumEntry(value: unknown): RoomRocketPodiumEntryV1 | undefined {
  if (!isRecord(value) || !isFirestoreId(value.uid)) return undefined;
  const rewardBundle = mapRewardBundleV1(value.rewardBundle);
  const eligibleSpendCoins = readInteger(value.eligibleSpendCoins);
  const rank = readInteger(value.rank);
  const supportPoints = readInteger(value.supportPoints);
  return rewardBundle && eligibleSpendCoins >= 0 && [1, 2, 3].includes(rank) && supportPoints >= 0
    ? { eligibleSpendCoins, rank, rewardBundle, supportPoints, uid: value.uid }
    : undefined;
}

function timestampToMillis(value: unknown) {
  if (isRecord(value) && typeof value.toMillis === 'function') {
    return readInteger((value.toMillis as () => unknown)());
  }
  return readInteger(value);
}

function readOptionalInteger(value: unknown) {
  return value === undefined ? undefined : readInteger(value);
}

function readInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : -1;
}

function isCycleId(value: unknown): value is string {
  return typeof value === 'string' && /^weekly_[A-Za-z0-9_-]{3,120}$/.test(value);
}

function isFirestoreId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && !value.includes('/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
