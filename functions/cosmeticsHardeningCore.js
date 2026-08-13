'use strict';

/** Alert thresholds for cosmetics runtime telemetry samples. Fail-closed evaluators. */
const COSMETICS_ALERT_THRESHOLDS = Object.freeze({
  assetFailureRate: 0.05,
  crashFreeSessionRatio: 0.995,
  firstFrameDelayMs: 1_500,
  fallbackRate: 0.15,
  memoryPressureRate: 0.05,
  queueExpiryRate: 0.10,
});

const KNOWN_EVENTS = Object.freeze([
  'failure',
  'fallback',
  'first-frame',
  'queue-expiry',
  'memory-pressure',
  'session-crash',
  'session-ok',
  'ready',
  'download',
  'decode',
  'lookup',
]);

function summarizeCosmeticsTelemetrySamples(samples = []) {
  const events = Array.isArray(samples) ? samples.filter((sample) => isRecord(sample)) : [];
  const counts = Object.fromEntries(KNOWN_EVENTS.map((name) => [name, 0]));
  const firstFrameDelays = [];
  for (const sample of events) {
    const event = readString(sample.event);
    if (Object.prototype.hasOwnProperty.call(counts, event)) counts[event] += 1;
    if (event === 'first-frame' && Number.isFinite(sample.elapsedMs)) {
      firstFrameDelays.push(Math.max(0, Number(sample.elapsedMs)));
    }
  }
  const attempts = Math.max(
    1,
    counts.lookup + counts.download + counts.decode + counts.ready + counts.failure + counts.fallback,
  );
  const presentationAttempts = Math.max(1, counts.ready + counts.fallback + counts.failure);
  const sessionTotal = Math.max(1, counts['session-ok'] + counts['session-crash']);
  const queueAttempts = Math.max(1, counts['queue-expiry'] + counts.ready + counts.fallback);
  return {
    assetFailureRate: counts.failure / attempts,
    crashFreeSessionRatio: counts['session-ok'] / sessionTotal,
    counts,
    fallbackRate: counts.fallback / presentationAttempts,
    firstFrameDelayP95Ms: percentile(firstFrameDelays, 0.95),
    memoryPressureRate: counts['memory-pressure'] / sessionTotal,
    queueExpiryRate: counts['queue-expiry'] / queueAttempts,
    sampleCount: events.length,
  };
}

function evaluateCosmeticsAlertThresholds(
  samples = [],
  thresholds = COSMETICS_ALERT_THRESHOLDS,
) {
  const metrics = summarizeCosmeticsTelemetrySamples(samples);
  const limits = {
    assetFailureRate: Number(thresholds.assetFailureRate),
    crashFreeSessionRatio: Number(thresholds.crashFreeSessionRatio),
    firstFrameDelayMs: Number(thresholds.firstFrameDelayMs),
    fallbackRate: Number(thresholds.fallbackRate),
    memoryPressureRate: Number(thresholds.memoryPressureRate),
    queueExpiryRate: Number(thresholds.queueExpiryRate),
  };
  const alerts = [];
  if (metrics.assetFailureRate > limits.assetFailureRate) {
    alerts.push(alert('ASSET_FAILURE_RATE', metrics.assetFailureRate, limits.assetFailureRate));
  }
  if (metrics.fallbackRate > limits.fallbackRate) {
    alerts.push(alert('FALLBACK_RATE', metrics.fallbackRate, limits.fallbackRate));
  }
  if (metrics.firstFrameDelayP95Ms > limits.firstFrameDelayMs) {
    alerts.push(alert('FIRST_FRAME_DELAY', metrics.firstFrameDelayP95Ms, limits.firstFrameDelayMs));
  }
  if (metrics.queueExpiryRate > limits.queueExpiryRate) {
    alerts.push(alert('QUEUE_EXPIRY_RATE', metrics.queueExpiryRate, limits.queueExpiryRate));
  }
  if (metrics.memoryPressureRate > limits.memoryPressureRate) {
    alerts.push(alert('MEMORY_PRESSURE_RATE', metrics.memoryPressureRate, limits.memoryPressureRate));
  }
  if (metrics.crashFreeSessionRatio < limits.crashFreeSessionRatio) {
    alerts.push(alert(
      'CRASH_FREE_SESSION_RATIO',
      metrics.crashFreeSessionRatio,
      limits.crashFreeSessionRatio,
      'below',
    ));
  }
  return {
    alerts,
    metrics,
    ok: alerts.length === 0,
    thresholds: limits,
  };
}

function alert(code, value, threshold, direction = 'above') {
  return Object.freeze({
    code,
    direction,
    threshold,
    value: Number(value),
  });
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

module.exports = {
  COSMETICS_ALERT_THRESHOLDS,
  evaluateCosmeticsAlertThresholds,
  summarizeCosmeticsTelemetrySamples,
};
