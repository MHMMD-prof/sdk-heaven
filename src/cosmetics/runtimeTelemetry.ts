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
  | 'reaction-aggregate'
  | 'reaction-drop'
  | 'theme-motion-fallback'
  | 'pair-projection-render'
  | 'pair-projection-fallback'
  | 'pair-gate-render'
  | 'pair-gate-fallback'
  | 'pair-entrance-coalesced'
  | 'pair-entrance-render'
  | 'pair-entrance-fallback'
  | 'bottom-stage-shown'
  | 'bottom-stage-reduced'
  | 'bottom-stage-fallback'
  | 'bottom-stage-decode-error'
  | 'bottom-stage-completion'
  | 'bottom-stage-cancellation'
  | 'bottom-stage-queue-drop'
  | 'bottom-stage-combo-update'
  | 'teardown';

export type CosmeticsRuntimeEvent = {
  assetId?: string;
  assetVersionId?: string;
  category?: string;
  elapsedMs?: number;
  event: CosmeticsRuntimeEventName;
  format?: string;
  kind?: 'entry' | 'gift';
  presentation?: 'motion' | 'static' | 'compact';
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

export function recordPairRuntimeEvent(
  event: Extract<CosmeticsRuntimeEventName,
    | 'pair-projection-render'
    | 'pair-projection-fallback'
    | 'pair-gate-render'
    | 'pair-gate-fallback'
    | 'pair-entrance-coalesced'
    | 'pair-entrance-render'
    | 'pair-entrance-fallback'>,
  reason?: 'asset-unavailable' | 'flag-disabled' | 'invalid-pair' | 'motion-reduced' | 'renderer-error',
) {
  recordCosmeticsRuntimeEvent(event, reason ? { reason } : {});
}

type BottomEffectStageRuntimeEvent = Extract<CosmeticsRuntimeEventName,
  | 'bottom-stage-shown'
  | 'bottom-stage-reduced'
  | 'bottom-stage-fallback'
  | 'bottom-stage-decode-error'
  | 'bottom-stage-completion'
  | 'bottom-stage-cancellation'
  | 'bottom-stage-queue-drop'
  | 'bottom-stage-combo-update'>;

const BOTTOM_STAGE_REASONS = new Set([
  'app-background',
  'already-present',
  'already-seen',
  'asset-unavailable',
  'blocked-sender',
  'completed',
  'expired',
  'joined-after-event',
  'memory-warning',
  'participant-left',
  'presence-not-ready',
  'priority-cap',
  'renderer-error',
  'room-suspended',
  'stale-entry',
]);

/** Records a fixed, identity-free outcome shape for the bottom stage. */
export function recordBottomEffectStageRuntimeEvent(
  event: BottomEffectStageRuntimeEvent,
  details: {
    kind: 'entry' | 'gift';
    presentation?: 'motion' | 'static' | 'compact';
    reason?: string;
  },
) {
  const reason = details.reason && BOTTOM_STAGE_REASONS.has(details.reason)
    ? details.reason
    : undefined;
  const next: CosmeticsRuntimeEvent = {
    event,
    kind: details.kind,
    ...(details.presentation ? { presentation: details.presentation } : {}),
    ...(reason ? { reason } : {}),
    timestampMs: Date.now(),
  };
  events = [...events, next].slice(-MAX_EVENTS);
  listeners.forEach((listener) => listener());
  debugLog('cosmetics.runtime', event, next);
}

/** Local rate summary for Wave 10 thresholds. No backend sink required. */
export type CosmeticsRuntimeRateSummary = {
  assetFailureRate: number;
  fallbackRate: number;
  firstFrameDelayP95Ms: number;
  queueExpiryRate: number;
  sampleCount: number;
};

export function summarizeCosmeticsRuntimeRates(
  samples: readonly CosmeticsRuntimeEvent[] = getCosmeticsRuntimeEvents(),
): CosmeticsRuntimeRateSummary {
  const events = Array.isArray(samples) ? samples : [];
  let failure = 0;
  let fallback = 0;
  let ready = 0;
  let queueExpiry = 0;
  let lookup = 0;
  let download = 0;
  let decode = 0;
  const firstFrameDelays: number[] = [];
  for (const sample of events) {
    if (sample.event === 'failure') failure += 1;
    if (sample.event === 'fallback') fallback += 1;
    if (sample.event === 'ready') ready += 1;
    if (sample.event === 'queue-expiry') queueExpiry += 1;
    if (sample.event === 'lookup') lookup += 1;
    if (sample.event === 'download') download += 1;
    if (sample.event === 'decode') decode += 1;
    if (sample.event === 'first-frame' && typeof sample.elapsedMs === 'number') {
      firstFrameDelays.push(sample.elapsedMs);
    }
  }
  const attempts = Math.max(1, lookup + download + decode + ready + failure + fallback);
  const presentationAttempts = Math.max(1, ready + fallback + failure);
  const queueAttempts = Math.max(1, queueExpiry + ready + fallback);
  return {
    assetFailureRate: failure / attempts,
    fallbackRate: fallback / presentationAttempts,
    firstFrameDelayP95Ms: percentile(firstFrameDelays, 0.95),
    queueExpiryRate: queueExpiry / queueAttempts,
    sampleCount: events.length,
  };
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}
