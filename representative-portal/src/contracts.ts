export type PortalCurrency = 'coins' | 'diamonds';

export type CurrencyAmounts = {
  coins: number;
  diamonds: number;
};

export type CurrencyLimits = {
  maxPerDay: number;
  maxPerTransfer: number;
  maxTransfersPerHour: number;
};

export type PortalReceipt = {
  amount: number;
  balanceAfter?: number;
  balanceBefore?: number;
  createdAt: string;
  currency: PortalCurrency;
  kind: 'reversal' | 'transfer';
  publicReference: string;
  recipientDisplayName?: string;
  recipientPublicId: string;
  reversedAt?: string;
  status: 'completed' | 'reversed';
};

export type PortalHistoryResult = {
  items: PortalReceipt[];
  nextCursor: string;
};

export type PortalPinState =
  | { state: 'not-configured' | 'ready' | 'reset-required' }
  | { lockedUntil: string; state: 'locked' };

export type PortalStatus = {
  dailyAllowance: Partial<CurrencyAmounts>;
  feature: {
    available: boolean;
    enabled: boolean;
    policyConfigured: boolean;
    portalConfigured: boolean;
  };
  limits: {
    configured: boolean;
    effective?: Record<PortalCurrency, CurrencyLimits>;
    overrideCurrencies: string[];
  };
  pin: PortalPinState;
  privilege: {
    active: boolean;
    currencies: Record<PortalCurrency, boolean>;
  };
  recentTransfers: PortalReceipt[];
  wallet: {
    balances: CurrencyAmounts;
    updatedAt?: unknown;
  };
};

export type RecipientPreview = {
  expiresAt: string;
  proof: string;
  recipient: {
    avatarUrl: string;
    displayName: string;
    publicId: string;
  };
};

export type TransferResult = {
  amount: number;
  balances: CurrencyAmounts;
  currency: PortalCurrency;
  publicReference: string;
  recipient: {
    displayName: string;
    publicId: string;
  };
};

export type PortalApiErrorCode =
  | 'FEATURE_DISABLED'
  | 'FRESH_AUTH_REQUIRED'
  | 'INSUFFICIENT_FUNDS'
  | 'INTERNAL'
  | 'INVALID_RECIPIENT'
  | 'INVALID_REQUEST'
  | 'PERMISSION_DENIED'
  | 'PIN_ALREADY_CONFIGURED'
  | 'PIN_CHANGED'
  | 'PIN_INVALID'
  | 'PIN_LOCKED'
  | 'PIN_NOT_CONFIGURED'
  | 'PIN_RESET_REQUIRED'
  | 'PORTAL_ORIGIN_DENIED'
  | 'PORTAL_SESSION_INVALID'
  | 'PROOF_INVALID'
  | 'CURSOR_INVALID'
  | 'RATE_LIMITED'
  | 'RECEIPT_NOT_FOUND'
  | 'REPRESENTATIVE_REQUIRED'
  | 'REQUEST_CONFLICT'
  | 'TRANSFER_LIMIT_EXCEEDED'
  | 'TRANSFER_RATE_LIMITED';

export const PORTAL_SESSION_POLL_MILLISECONDS = 15_000;
export const RECIPIENT_PROOF_MILLISECONDS = 60_000;
export const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const PUBLIC_REFERENCE_PATTERN = /^RPT-[0-9A-HJKMNP-TV-Z]{16}$/;
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{12,80}$/;
export const NORMAL_PUBLIC_ID_PATTERN = /^[1-9][0-9]{6}$/;
export const PIN_PATTERN = /^[0-9]{6}$/;

export function isCurrency(value: unknown): value is PortalCurrency {
  return value === 'coins' || value === 'diamonds';
}

export function isCurrencyAmounts(value: unknown): value is CurrencyAmounts {
  const record = asRecord(value);
  if (!record) return false;
  return isPositiveOrZeroInteger(record.coins)
    && isPositiveOrZeroInteger(record.diamonds);
}

export function isPortalStatus(value: unknown): value is PortalStatus {
  const record = asRecord(value);
  if (!record) return false;
  const feature = asRecord(record?.feature);
  const privilege = asRecord(record?.privilege);
  const currencies = asRecord(privilege?.currencies);
  const wallet = asRecord(record?.wallet);
  return feature?.available === true
    && feature?.enabled === true
    && feature?.policyConfigured === true
    && feature?.portalConfigured === true
    && privilege?.active === true
    && typeof currencies?.coins === 'boolean'
    && typeof currencies?.diamonds === 'boolean'
    && isCurrencyAmounts(wallet?.balances)
    && Array.isArray(record.recentTransfers)
    && record.recentTransfers.every(isPortalReceipt)
    && Boolean(asRecord(record.pin))
    && Boolean(asRecord(record.dailyAllowance))
    && Boolean(asRecord(record.limits));
}

export function isPortalReceipt(value: unknown): value is PortalReceipt {
  const record = asRecord(value);
  if (!record) return false;
  const status = record.status;
  const kind = record.kind ?? (status === 'reversed' ? 'reversal' : 'transfer');
  return isPositiveInteger(record.amount)
    && isCurrency(record.currency)
    && isIsoDate(record.createdAt)
    && (kind === 'transfer' || kind === 'reversal')
    && PUBLIC_REFERENCE_PATTERN.test(String(record.publicReference ?? ''))
    && NORMAL_PUBLIC_ID_PATTERN.test(String(record.recipientPublicId ?? ''))
    && (status === 'completed' || status === 'reversed')
    && (record.recipientDisplayName === undefined || typeof record.recipientDisplayName === 'string')
    && (record.reversedAt === undefined || isIsoDate(record.reversedAt));
}

export function isPortalHistoryResult(value: unknown): value is PortalHistoryResult {
  const record = asRecord(value);
  return Boolean(record)
    && Array.isArray(record?.items)
    && record.items.every(isPortalReceipt)
    && typeof record.nextCursor === 'string'
    && (record.nextCursor === '' || OPAQUE_TOKEN_PATTERN.test(record.nextCursor));
}

export function isRecipientPreview(value: unknown): value is RecipientPreview {
  const record = asRecord(value);
  if (!record) return false;
  const recipient = asRecord(record?.recipient);
  return OPAQUE_TOKEN_PATTERN.test(String(record.proof ?? ''))
    && isFutureIsoDate(record?.expiresAt)
    && NORMAL_PUBLIC_ID_PATTERN.test(String(recipient?.publicId ?? ''))
    && typeof recipient?.displayName === 'string'
    && recipient.displayName.trim().length > 0
    && typeof recipient?.avatarUrl === 'string';
}

export function isTransferResult(value: unknown): value is TransferResult {
  const record = asRecord(value);
  if (!record) return false;
  const recipient = asRecord(record?.recipient);
  return isPositiveInteger(record.amount)
    && isCurrency(record?.currency)
    && isCurrencyAmounts(record?.balances)
    && PUBLIC_REFERENCE_PATTERN.test(String(record?.publicReference ?? ''))
    && NORMAL_PUBLIC_ID_PATTERN.test(String(recipient?.publicId ?? ''))
    && typeof recipient?.displayName === 'string'
    && recipient.displayName.trim().length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isPositiveOrZeroInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isFutureIsoDate(value: unknown): value is string {
  return isIsoDate(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
