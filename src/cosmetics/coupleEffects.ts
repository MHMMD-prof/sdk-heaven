import type { CosmeticViewerMode } from './contracts';
import { recordPairRuntimeEvent } from './runtimeTelemetry';

export type CoupleEffectProfileMode = 'off' | 'static' | 'looping';
export type CoupleEffectBorderMode = 'off' | 'static' | 'looping';
export type CoupleEffectEntranceMode = 'off' | 'static' | 'one-shot';

export type CoupleEffectProjection = {
  assetId: string;
  assetVersionId: string;
  borderMode: CoupleEffectBorderMode;
  coupleIdHash: string;
  entranceMode: CoupleEffectEntranceMode;
  fallbackAssetId: string;
  fallbackAssetVersionId: string;
  format: 'png' | 'lottie-json';
  itemId: string;
  profileMode: CoupleEffectProfileMode;
};

export type CoupleEffectInventoryItem = {
  acquiredAt?: unknown;
  duration: import('../store/contracts').StoreDuration;
  equipped: boolean;
  expiresAt: unknown | null;
  itemId: string;
  state: 'active' | 'expired' | 'refunded' | 'revoked';
};

export type CoupleEffectsResult = {
  coupleIdHash: string;
  equipment: CoupleEffectProjection | null;
  items: CoupleEffectInventoryItem[];
};

export type CoupleEffectPurchaseResult = {
  balances: import('../social/types').StoreCurrencyAmounts;
  coupleIdHash: string;
  currency: import('../store/contracts').StoreCurrency;
  expiresAt: unknown | null;
  itemId: string;
  ownershipId: string;
};

export type CoupleEffectEquipResult = {
  coupleIdHash: string;
  itemId: string;
  ownershipId: string;
};

export type CoupleEffectUnequipResult = {
  coupleIdHash: string;
  itemId: null;
};

export type CoupleEffectSurface = 'profile' | 'border';

const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const VERSION_ID_PATTERN = /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/;
const COUPLE_ID_HASH_PATTERN = /^[a-f0-9]{64}$/;
const PROJECTION_KEYS = [
  'assetId',
  'assetVersionId',
  'borderMode',
  'coupleIdHash',
  'entranceMode',
  'fallbackAssetId',
  'fallbackAssetVersionId',
  'format',
  'itemId',
  'profileMode',
] as const;

export function readCoupleEffectProjection(
  value: unknown,
  expectedCoupleIdHash?: string,
): CoupleEffectProjection | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value).sort();
  if (
    keys.length !== PROJECTION_KEYS.length
    || keys.some((key, index) => key !== [...PROJECTION_KEYS].sort()[index])
  ) return undefined;
  const projection = value as Record<(typeof PROJECTION_KEYS)[number], unknown>;
  if (
    !ASSET_ID_PATTERN.test(readString(projection.assetId))
    || !VERSION_ID_PATTERN.test(readString(projection.assetVersionId))
    || !ASSET_ID_PATTERN.test(readString(projection.fallbackAssetId))
    || !VERSION_ID_PATTERN.test(readString(projection.fallbackAssetVersionId))
    || !ITEM_ID_PATTERN.test(readString(projection.itemId))
    || !COUPLE_ID_HASH_PATTERN.test(readString(projection.coupleIdHash))
    || (expectedCoupleIdHash !== undefined && projection.coupleIdHash !== expectedCoupleIdHash)
    || (projection.format !== 'png' && projection.format !== 'lottie-json')
    || !includes(['off', 'static', 'looping'] as const, projection.profileMode)
    || !includes(['off', 'static', 'looping'] as const, projection.borderMode)
    || !includes(['off', 'static', 'one-shot'] as const, projection.entranceMode)
    || (
      projection.format === 'png'
      && (
        projection.fallbackAssetId !== projection.assetId
        || projection.fallbackAssetVersionId !== projection.assetVersionId
      )
    )
  ) return undefined;
  return projection as CoupleEffectProjection;
}

export function gateSharedCoupleEffect(
  first: CoupleEffectProjection | undefined,
  second: CoupleEffectProjection | undefined,
): CoupleEffectProjection | undefined {
  if (
    !first
    || !second
    || first.coupleIdHash !== second.coupleIdHash
    || first.itemId !== second.itemId
    || first.assetId !== second.assetId
    || first.assetVersionId !== second.assetVersionId
    || first.fallbackAssetId !== second.fallbackAssetId
    || first.fallbackAssetVersionId !== second.fallbackAssetVersionId
    || first.format !== second.format
    || first.borderMode !== second.borderMode
  ) {
    if (first || second) recordPairRuntimeEvent('pair-gate-fallback', 'invalid-pair');
    return undefined;
  }
  recordPairRuntimeEvent('pair-gate-render');
  return first;
}

export function resolveCoupleEffectSurface(input: {
  enabled: boolean;
  projection?: CoupleEffectProjection;
  reducedMotion: boolean;
  surface: CoupleEffectSurface;
}): {
  preserveIndividualCosmetics: true;
  renderCoupleEffect: boolean;
  viewerMode: CosmeticViewerMode;
} {
  const mode = input.surface === 'profile'
    ? input.projection?.profileMode
    : input.projection?.borderMode;
  if (!input.enabled || !input.projection || mode === 'off' || mode === undefined) {
    return { preserveIndividualCosmetics: true, renderCoupleEffect: false, viewerMode: 'off' };
  }
  return {
    preserveIndividualCosmetics: true,
    renderCoupleEffect: true,
    viewerMode: input.reducedMotion || mode === 'static' ? 'reduced' : 'full',
  };
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function includes<Value extends string>(
  values: readonly Value[],
  value: unknown,
): value is Value {
  return typeof value === 'string' && values.includes(value as Value);
}
