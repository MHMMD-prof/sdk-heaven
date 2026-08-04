export const WEEKLY_INCENTIVE_SCHEMA_VERSION = 1 as const;

export type WeeklyIncentiveFeature = 'rocket-rewards' | 'payroll' | 'owner-targets';
export type WeeklySettlementState =
  | 'preview'
  | 'eligible'
  | 'held'
  | 'paying'
  | 'paid'
  | 'ineligible'
  | 'reversed'
  | 'failed';

export type WeeklyCycleV1 = {
  cycleId: string;
  endAtMillis: number;
  schemaVersion: typeof WEEKLY_INCENTIVE_SCHEMA_VERSION;
  startAtMillis: number;
  state: 'scheduled' | 'active' | 'closed' | 'settling' | 'settled' | 'failed';
  templateVersion: number;
  timeZone: string;
};

export type RewardBundleV1 = {
  coins: number;
  diamonds: number;
  items: Array<{
    itemId: string;
    duplicateFallback?: {
      amount: number;
      currency: 'coins' | 'diamonds';
    };
  }>;
  schemaVersion: typeof WEEKLY_INCENTIVE_SCHEMA_VERSION;
};

export function mapWeeklyCycleV1(value: unknown): WeeklyCycleV1 | undefined {
  if (!isRecord(value) || hasUnknownKeys(value, [
    'cycleId', 'endAtMillis', 'schemaVersion', 'startAtMillis', 'state', 'templateVersion', 'timeZone',
  ])) return undefined;
  if (
    !isIdentifier(value.cycleId, 120)
    || value.schemaVersion !== WEEKLY_INCENTIVE_SCHEMA_VERSION
    || !Number.isSafeInteger(value.startAtMillis)
    || !Number.isSafeInteger(value.endAtMillis)
    || Number(value.endAtMillis) - Number(value.startAtMillis) < 7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000
    || Number(value.endAtMillis) - Number(value.startAtMillis) > 7 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000
    || !Number.isSafeInteger(value.templateVersion)
    || Number(value.templateVersion) < 1
    || !['scheduled', 'active', 'closed', 'settling', 'settled', 'failed'].includes(String(value.state))
    || typeof value.timeZone !== 'string'
    || value.timeZone.length > 80
  ) return undefined;
  return value as WeeklyCycleV1;
}

export function mapRewardBundleV1(value: unknown): RewardBundleV1 | undefined {
  if (!isRecord(value) || hasUnknownKeys(value, ['coins', 'diamonds', 'items', 'schemaVersion'])) return undefined;
  if (
    value.schemaVersion !== WEEKLY_INCENTIVE_SCHEMA_VERSION
    || !isRewardAmount(value.coins)
    || !isRewardAmount(value.diamonds)
    || !Array.isArray(value.items)
    || value.items.length > 10
  ) return undefined;
  const itemIds = new Set<string>();
  for (const item of value.items) {
    if (!isRecord(item) || hasUnknownKeys(item, ['duplicateFallback', 'itemId']) || !isIdentifier(item.itemId, 80) || itemIds.has(item.itemId as string)) return undefined;
    itemIds.add(item.itemId as string);
    if (item.duplicateFallback !== undefined) {
      const fallback = item.duplicateFallback;
      if (
        !isRecord(fallback)
        || hasUnknownKeys(fallback, ['amount', 'currency'])
        || !['coins', 'diamonds'].includes(String(fallback.currency))
        || !isRewardAmount(fallback.amount)
        || Number(fallback.amount) < 1
      ) return undefined;
    }
  }
  if (value.coins === 0 && value.diamonds === 0 && value.items.length === 0) return undefined;
  return value as RewardBundleV1;
}

function isIdentifier(value: unknown, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length <= maxLength
    && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
}

function isRewardAmount(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1_000_000_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasUnknownKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).some((key) => !allowed.includes(key));
}
