import type { RepresentativePortalTicketResult } from './types';

export const REPRESENTATIVE_PORTAL_BRIDGE_VERSION = 1 as const;
export const REPRESENTATIVE_PORTAL_TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const MAX_RECEIPT_TEXT_LENGTH = 2_000;
const MAX_RECEIPT_IMAGE_DATA_URL_LENGTH = 2_000_000;
const MAX_BRIDGE_MESSAGE_LENGTH = MAX_RECEIPT_IMAGE_DATA_URL_LENGTH + 2_500;
const SIMPLE_MESSAGE_TYPES = new Set([
  'close',
  'feature-disabled',
  'refresh-balance',
  'session-expired',
]);

export type RepresentativePortalBridgeMessage =
  | { type: 'close'; version: 1 }
  | { type: 'feature-disabled'; version: 1 }
  | { type: 'refresh-balance'; version: 1 }
  | { type: 'session-expired'; version: 1 }
  | { imageDataUrl?: string; text: string; type: 'receipt-share'; version: 1 };

export type RepresentativePortalLaunch = {
  expiresAtMillis: number;
  origin: string;
  uri: string;
};

export function createRepresentativePortalLaunch(
  result: RepresentativePortalTicketResult,
  nowMillis = Date.now(),
): RepresentativePortalLaunch | undefined {
  const origin = normalizeRepresentativePortalOrigin(result.portalOrigin);
  const ticket = typeof result.ticket === 'string' ? result.ticket : '';
  const expiresAtMillis = Date.parse(result.expiresAt);

  if (!origin
    || !REPRESENTATIVE_PORTAL_TICKET_PATTERN.test(ticket)
    || !Number.isFinite(expiresAtMillis)
    || expiresAtMillis <= nowMillis) {
    return undefined;
  }

  return {
    expiresAtMillis,
    origin,
    uri: `${origin}/#ticket=${encodeURIComponent(ticket)}`,
  };
}

export function isAllowedRepresentativePortalNavigation(
  portalOrigin: string,
  candidateUrl: string,
): boolean {
  const origin = normalizeRepresentativePortalOrigin(portalOrigin);
  if (!origin || typeof candidateUrl !== 'string' || !candidateUrl) return false;

  try {
    const candidate = new URL(candidateUrl);
    return candidate.protocol === 'https:'
      && candidate.username === ''
      && candidate.password === ''
      && candidate.origin === origin;
  } catch {
    return false;
  }
}

export function parseRepresentativePortalBridgeMessage(
  serialized: string,
): RepresentativePortalBridgeMessage | undefined {
  if (typeof serialized !== 'string' || serialized.length > MAX_BRIDGE_MESSAGE_LENGTH) {
    return undefined;
  }

  try {
    const value = JSON.parse(serialized);
    return isRepresentativePortalBridgeMessage(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function createRepresentativePortalRefreshMessage(): string {
  return JSON.stringify({
    type: 'refresh-balance',
    version: REPRESENTATIVE_PORTAL_BRIDGE_VERSION,
  });
}

function normalizeRepresentativePortalOrigin(input: string): string | undefined {
  const value = typeof input === 'string' ? input.trim() : '';
  if (!value) return undefined;

  try {
    const parsed = new URL(value);
    const isOriginOnly = parsed.username === ''
      && parsed.password === ''
      && (parsed.pathname === '' || parsed.pathname === '/')
      && parsed.search === ''
      && parsed.hash === '';

    return parsed.protocol === 'https:' && isOriginOnly
      ? parsed.origin
      : undefined;
  } catch {
    return undefined;
  }
}

function isRepresentativePortalBridgeMessage(
  value: unknown,
): value is RepresentativePortalBridgeMessage {
  const record = asRecord(value);
  if (!record
    || record.version !== REPRESENTATIVE_PORTAL_BRIDGE_VERSION
    || typeof record.type !== 'string') {
    return false;
  }

  if (SIMPLE_MESSAGE_TYPES.has(record.type)) {
    return Object.keys(record).length === 2;
  }

  if (record.type !== 'receipt-share'
    || typeof record.text !== 'string'
    || !record.text.trim()
    || record.text.length > MAX_RECEIPT_TEXT_LENGTH) {
    return false;
  }

  if (record.imageDataUrl !== undefined
    && (typeof record.imageDataUrl !== 'string'
      || !record.imageDataUrl.startsWith('data:image/png;base64,')
      || record.imageDataUrl.length > MAX_RECEIPT_IMAGE_DATA_URL_LENGTH)) {
    return false;
  }

  return Object.keys(record).every((key) => (
    key === 'imageDataUrl' || key === 'text' || key === 'type' || key === 'version'
  ));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
