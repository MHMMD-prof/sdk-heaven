export const BRIDGE_VERSION = 1 as const;

export type PortalBridgeMessage =
  | { type: 'close'; version: 1 }
  | { type: 'feature-disabled'; version: 1 }
  | { type: 'refresh-balance'; version: 1 }
  | { type: 'session-expired'; version: 1 }
  | { imageDataUrl?: string; text: string; type: 'receipt-share'; version: 1 };

type ReactNativeWindow = Window & {
  ReactNativeWebView?: {
    postMessage(message: string): void;
  };
};

const SIMPLE_TYPES = new Set(['close', 'feature-disabled', 'refresh-balance', 'session-expired']);

export function isPortalBridgeMessage(value: unknown): value is PortalBridgeMessage {
  const record = asRecord(value);
  if (!record || record.version !== BRIDGE_VERSION || typeof record.type !== 'string') return false;
  if (SIMPLE_TYPES.has(record.type)) {
    return Object.keys(record).length === 2;
  }
  if (record.type !== 'receipt-share' || typeof record.text !== 'string' || !record.text.trim() || record.text.length > 2_000) return false;
  if (record.imageDataUrl !== undefined
    && (typeof record.imageDataUrl !== 'string' || !record.imageDataUrl.startsWith('data:image/png;base64,') || record.imageDataUrl.length > 2_000_000)) return false;
  return Object.keys(record).every((key) => ['imageDataUrl', 'text', 'type', 'version'].includes(key));
}

export function postPortalBridgeMessage(message: PortalBridgeMessage, target: ReactNativeWindow = window as ReactNativeWindow): boolean {
  if (!isPortalBridgeMessage(message)) return false;
  const bridge = target.ReactNativeWebView;
  if (!bridge || typeof bridge.postMessage !== 'function') return false;
  bridge.postMessage(JSON.stringify(message));
  return true;
}

export function parsePortalBridgeMessage(serialized: string): PortalBridgeMessage | undefined {
  try {
    const value = JSON.parse(serialized);
    return isPortalBridgeMessage(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
