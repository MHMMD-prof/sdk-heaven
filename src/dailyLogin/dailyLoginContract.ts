export type DailyLoginRewardItem = {
  duplicateFallback?: { amount: number; currency: 'coins' | 'diamonds' };
  itemId: string;
};

export type DailyLoginRewardBundle = {
  coins: number;
  diamonds: number;
  items: DailyLoginRewardItem[];
  schemaVersion: 1;
};

export type DailyLoginCalendarDay = {
  day: number;
  reward: DailyLoginRewardBundle;
};

export type DailyLoginReceipt = {
  campaignRevision: number;
  dayId: string;
  receiptId: string;
  settlementId: string;
  streakPosition: number;
};

export type DailyLoginStatus = {
  alreadyClaimed: boolean;
  calendar: DailyLoginCalendarDay[];
  campaignRevision: number;
  claimable: boolean;
  enabled: boolean;
  itemRewardsEnabled: boolean;
  lastReceipt?: DailyLoginReceipt;
  minimumClientVersion: string;
  nextResetAtMillis: number;
  presentationVisible: boolean;
  reason: string;
  streakPosition: number;
  timeZone: 'Asia/Baghdad';
  todayDayId: string;
};

export type DailyLoginClaimResult = {
  balances: { coins: number; diamonds: number };
  campaignRevision: number;
  dayId: string;
  items: Array<{
    fallback?: { amount: number; currency: 'coins' | 'diamonds' };
    itemId: string;
    outcome: 'duplicate-fallback' | 'extended' | 'granted';
  }>;
  nextResetAtMillis: number;
  receiptId: string;
  reward: DailyLoginRewardBundle;
  settlementId: string;
  streakPosition: number;
  walletCredits: Array<{ amount: number; balanceAfter: number; currency: 'coins' | 'diamonds' }>;
};

export function mapDailyLoginStatus(input: unknown): DailyLoginStatus | undefined {
  if (!isRecord(input)) return undefined;
  const calendar = mapCalendar(input.calendar);
  if (
    typeof input.alreadyClaimed !== 'boolean'
    || !calendar
    || !isNonNegativeInteger(input.campaignRevision)
    || typeof input.claimable !== 'boolean'
    || typeof input.enabled !== 'boolean'
    || typeof input.itemRewardsEnabled !== 'boolean'
    || typeof input.minimumClientVersion !== 'string'
    || !isNonNegativeInteger(input.nextResetAtMillis)
    || typeof input.presentationVisible !== 'boolean'
    || typeof input.reason !== 'string'
    || !isPositiveInteger(input.streakPosition)
    || input.streakPosition > 7
    || input.timeZone !== 'Asia/Baghdad'
    || !isNonEmptyString(input.todayDayId)
  ) return undefined;
  const lastReceipt = input.lastReceipt === undefined ? undefined : mapReceipt(input.lastReceipt);
  if (input.lastReceipt !== undefined && !lastReceipt) return undefined;
  return {
    alreadyClaimed: input.alreadyClaimed,
    calendar,
    campaignRevision: input.campaignRevision,
    claimable: input.claimable,
    enabled: input.enabled,
    itemRewardsEnabled: input.itemRewardsEnabled,
    ...(lastReceipt ? { lastReceipt } : {}),
    minimumClientVersion: input.minimumClientVersion,
    nextResetAtMillis: input.nextResetAtMillis,
    presentationVisible: input.presentationVisible,
    reason: input.reason,
    streakPosition: input.streakPosition,
    timeZone: 'Asia/Baghdad',
    todayDayId: input.todayDayId,
  };
}

export function mapDailyLoginClaimResult(input: unknown): DailyLoginClaimResult | undefined {
  if (!isRecord(input)) return undefined;
  const reward = mapReward(input.reward);
  const balances = mapBalances(input.balances);
  const walletCredits = mapWalletCredits(input.walletCredits);
  const items = mapClaimItems(input.items);
  if (
    !reward
    || !balances
    || !walletCredits
    || !items
    || !isPositiveInteger(input.campaignRevision)
    || !isNonEmptyString(input.dayId)
    || !isNonNegativeInteger(input.nextResetAtMillis)
    || !isNonEmptyString(input.receiptId)
    || !isNonEmptyString(input.settlementId)
    || !isPositiveInteger(input.streakPosition)
    || input.streakPosition > 7
  ) return undefined;
  return {
    balances,
    campaignRevision: input.campaignRevision,
    dayId: input.dayId,
    items,
    nextResetAtMillis: input.nextResetAtMillis,
    receiptId: input.receiptId,
    reward,
    settlementId: input.settlementId,
    streakPosition: input.streakPosition,
    walletCredits,
  };
}

function mapCalendar(input: unknown): DailyLoginCalendarDay[] | undefined {
  if (!Array.isArray(input)) return undefined;
  if (input.length === 0) return [];
  if (input.length !== 7) return undefined;
  const days = input.map((entry, index) => {
    if (!isRecord(entry) || entry.day !== index + 1) return undefined;
    const reward = mapReward(entry.reward);
    return reward ? { day: index + 1, reward } : undefined;
  });
  return days.every(Boolean) ? days as DailyLoginCalendarDay[] : undefined;
}

function mapReward(input: unknown): DailyLoginRewardBundle | undefined {
  if (!isRecord(input) || !isNonNegativeInteger(input.coins) || !isNonNegativeInteger(input.diamonds) || input.schemaVersion !== 1 || !Array.isArray(input.items)) {
    return undefined;
  }
  const items = input.items.map(mapRewardItem);
  return items.every(Boolean)
    ? { coins: input.coins, diamonds: input.diamonds, items: items as DailyLoginRewardItem[], schemaVersion: 1 }
    : undefined;
}

function mapRewardItem(input: unknown): DailyLoginRewardItem | undefined {
  if (!isRecord(input) || typeof input.itemId !== 'string' || !input.itemId) return undefined;
  if (input.duplicateFallback === undefined) return { itemId: input.itemId };
  const fallback = mapFallback(input.duplicateFallback);
  return fallback ? { duplicateFallback: fallback, itemId: input.itemId } : undefined;
}

function mapReceipt(input: unknown): DailyLoginReceipt | undefined {
  if (
    !isRecord(input)
    || !isPositiveInteger(input.campaignRevision)
    || !isNonEmptyString(input.dayId)
    || !isNonEmptyString(input.receiptId)
    || !isNonEmptyString(input.settlementId)
    || !isPositiveInteger(input.streakPosition)
    || input.streakPosition > 7
  ) return undefined;
  return input as DailyLoginReceipt;
}

function mapBalances(input: unknown) {
  return isRecord(input) && isNonNegativeInteger(input.coins) && isNonNegativeInteger(input.diamonds)
    ? { coins: input.coins, diamonds: input.diamonds }
    : undefined;
}

function mapWalletCredits(input: unknown): DailyLoginClaimResult['walletCredits'] | undefined {
  if (!Array.isArray(input)) return undefined;
  const values = input.map((entry) => (
    isRecord(entry)
    && isPositiveInteger(entry.amount)
    && isNonNegativeInteger(entry.balanceAfter)
    && ['coins', 'diamonds'].includes(String(entry.currency))
      ? {
          amount: entry.amount,
          balanceAfter: entry.balanceAfter,
          currency: entry.currency as 'coins' | 'diamonds',
        }
      : undefined
  ));
  return values.every(Boolean) ? values as DailyLoginClaimResult['walletCredits'] : undefined;
}

function mapClaimItems(input: unknown): DailyLoginClaimResult['items'] | undefined {
  if (!Array.isArray(input)) return undefined;
  const values = input.map((entry) => {
    if (
      !isRecord(entry)
      || !isNonEmptyString(entry.itemId)
      || !['duplicate-fallback', 'extended', 'granted'].includes(String(entry.outcome))
    ) return undefined;
    const fallback = entry.fallback === undefined ? undefined : mapFallback(entry.fallback);
    if (entry.fallback !== undefined && !fallback) return undefined;
    return {
      ...(fallback ? { fallback } : {}),
      itemId: entry.itemId,
      outcome: entry.outcome as DailyLoginClaimResult['items'][number]['outcome'],
    };
  });
  return values.every(Boolean) ? values as DailyLoginClaimResult['items'] : undefined;
}

function mapFallback(input: unknown) {
  return isRecord(input)
    && isPositiveInteger(input.amount)
    && ['coins', 'diamonds'].includes(String(input.currency))
    ? { amount: input.amount, currency: input.currency as 'coins' | 'diamonds' }
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
