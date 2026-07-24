import { useSyncExternalStore } from 'react';

declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

const redactedKeys = new Set(['authorization', 'idToken', 'token']);
const maxDebugEvents = 40;
const listeners = new Set<() => void>();
let debugEvents: string[] = [];
const debugEnabled = process?.env?.EXPO_PUBLIC_VOICE_DEBUG === 'true';

type DebugDetails = Record<string, unknown>;

export function debugLog(scope: string, event: string, details?: DebugDetails) {
  if (!debugEnabled) {
    return;
  }

  const payload = details ? ` ${safeStringify(details)}` : '';
  const line = `[${scope}] ${event}${payload}`;
  debugEvents = [...debugEvents, line].slice(-maxDebugEvents);
  listeners.forEach((listener) => listener());
  console.log(line);
}

export function debugError(scope: string, event: string, error: unknown, details?: DebugDetails) {
  debugLog(scope, event, {
    ...details,
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: error instanceof Error ? error.message : String(error),
  });
}

export function useDebugEvents() {
  return useSyncExternalStore(subscribeToDebugEvents, getDebugEventsSnapshot, getDebugEventsSnapshot);
}

export function isDebugLogEnabled() {
  return debugEnabled;
}

function subscribeToDebugEvents(listener: () => void) {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

function getDebugEventsSnapshot() {
  return debugEvents;
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(redact(value));
  } catch {
    return '[unserializable]';
  }
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      key,
      redactedKeys.has(key) ? '[redacted]' : redact(nestedValue),
    ]),
  );
}
