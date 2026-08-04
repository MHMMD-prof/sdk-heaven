import { useSyncExternalStore } from 'react';

import { debugLog } from '../utils/debugLog';
import type { CosmeticAssetDescriptorV1 } from './contracts';

export type CosmeticsRuntimeEventName =
  | 'lookup'
  | 'cache-hit'
  | 'cache-miss'
  | 'download'
  | 'decode'
  | 'ready'
  | 'first-frame'
  | 'completion'
  | 'cancellation'
  | 'fallback'
  | 'failure'
  | 'queue-wait'
  | 'queue-expiry'
  | 'priority-drop'
  | 'combo-update'
  | 'teardown';

export type CosmeticsRuntimeEvent = {
  assetId?: string;
  assetVersionId?: string;
  category?: string;
  elapsedMs?: number;
  event: CosmeticsRuntimeEventName;
  format?: string;
  reason?: string;
  timestampMs: number;
};

const MAX_EVENTS = 100;
let events: CosmeticsRuntimeEvent[] = [];
const listeners = new Set<() => void>();

export function recordCosmeticsRuntimeEvent(
  event: CosmeticsRuntimeEventName,
  details: {
    descriptor?: Pick<CosmeticAssetDescriptorV1,
      'assetId' | 'assetVersionId' | 'category' | 'format'>;
    elapsedMs?: number;
    reason?: string;
  } = {},
) {
  const next: CosmeticsRuntimeEvent = {
    ...(details.descriptor ? {
      assetId: details.descriptor.assetId,
      assetVersionId: details.descriptor.assetVersionId,
      category: details.descriptor.category,
      format: details.descriptor.format,
    } : {}),
    ...(Number.isFinite(details.elapsedMs) ? {
      elapsedMs: Math.max(0, Math.round(details.elapsedMs || 0)),
    } : {}),
    event,
    ...(details.reason ? { reason: details.reason.slice(0, 80) } : {}),
    timestampMs: Date.now(),
  };
  events = [...events, next].slice(-MAX_EVENTS);
  listeners.forEach((listener) => listener());
  debugLog('cosmetics.runtime', event, next);
}

export function getCosmeticsRuntimeEvents() {
  return events;
}

export function useCosmeticsRuntimeEvents() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getCosmeticsRuntimeEvents,
    getCosmeticsRuntimeEvents,
  );
}

export function resetCosmeticsRuntimeEventsForTests() {
  events = [];
  listeners.forEach((listener) => listener());
}
