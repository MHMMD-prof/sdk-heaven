import {
  OPAQUE_TOKEN_PATTERN,
  PIN_PATTERN,
  REQUEST_ID_PATTERN,
  PUBLIC_REFERENCE_PATTERN,
  type PortalApiErrorCode,
  type PortalCurrency,
  type PortalHistoryResult,
  type PortalReceipt,
  type PortalStatus,
  type RecipientPreview,
  type TransferResult,
  isPortalStatus,
  isPortalHistoryResult,
  isPortalReceipt,
  isRecipientPreview,
  isTransferResult,
} from './contracts';

type FetchLike = typeof fetch;

type PortalApiOptions = {
  allowLocalhost?: boolean;
  fetchImpl?: FetchLike;
  timeoutMilliseconds?: number;
};

type ApiEnvelope = {
  error?: { code?: unknown; messageAr?: unknown };
  ok?: unknown;
  result?: unknown;
};

export class PortalApiError extends Error {
  readonly code: PortalApiErrorCode;
  readonly status: number;

  constructor(code: PortalApiErrorCode, message: string, status: number) {
    super(message);
    this.name = 'PortalApiError';
    this.code = code;
    this.status = status;
  }
}

export function createPortalApi(endpointInput: string, options: PortalApiOptions = {}) {
  const endpoint = normalizePortalEndpoint(endpointInput, options.allowLocalhost === true);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 15_000;

  async function request(action: string, body: Record<string, unknown>, sessionToken?: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
    try {
      const response = await fetchImpl(endpoint, {
        body: JSON.stringify({ action, ...body }),
        cache: 'no-store',
        credentials: 'omit',
        headers: {
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
          'Content-Type': 'application/json',
        },
        method: 'POST',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      const envelope = await readEnvelope(response);
      if (!response.ok || envelope.ok !== true) {
        const code = normalizeErrorCode(envelope.error?.code);
        const message = typeof envelope.error?.messageAr === 'string' && envelope.error.messageAr.trim()
          ? envelope.error.messageAr.trim()
          : 'تعذّر إكمال الطلب. حاول مجدداً.';
        throw new PortalApiError(code, message, response.status);
      }
      return envelope.result;
    } catch (error) {
      if (error instanceof PortalApiError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new PortalApiError('INTERNAL', 'انتهت مهلة الاتصال. حاول مجدداً.', 408);
      }
      throw new PortalApiError('INTERNAL', 'تعذّر الاتصال بالخدمة. تحقق من الإنترنت وحاول مجدداً.', 0);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async exchange(ticket: string): Promise<{ expiresAt: string; sessionToken: string }> {
      if (!OPAQUE_TOKEN_PATTERN.test(ticket)) throw invalidRequest();
      const result = asRecord(await request('exchange', { ticket }));
      if (!result || !OPAQUE_TOKEN_PATTERN.test(String(result.sessionToken ?? '')) || !isIsoDate(result.expiresAt)) throw invalidResponse();
      return { expiresAt: String(result.expiresAt), sessionToken: String(result.sessionToken) };
    },
    async history(
      sessionToken: string,
      input: {
        currency?: '' | PortalCurrency;
        cursor?: string;
        from?: string;
        limit?: number;
        status?: '' | 'completed' | 'reversed';
        to?: string;
      } = {},
    ): Promise<PortalHistoryResult> {
      const body = {
        currency: input.currency ?? '',
        cursor: input.cursor ?? '',
        from: input.from ?? '',
        limit: input.limit ?? 20,
        status: input.status ?? '',
        to: input.to ?? '',
      };
      if ((body.cursor && !OPAQUE_TOKEN_PATTERN.test(body.cursor))
        || !Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > 50
        || (body.currency && body.currency !== 'coins' && body.currency !== 'diamonds')
        || (body.status && body.status !== 'completed' && body.status !== 'reversed')) throw invalidRequest();
      const result = await request('history', body, sessionToken);
      if (!isPortalHistoryResult(result)) throw invalidResponse();
      return result;
    },
    async lookupReceipt(sessionToken: string, publicReference: string): Promise<PortalReceipt> {
      const normalized = publicReference.trim().toUpperCase();
      if (!PUBLIC_REFERENCE_PATTERN.test(normalized)) throw invalidRequest();
      const result = await request('receipt-lookup', { publicReference: normalized }, sessionToken);
      if (!isPortalReceipt(result)) throw invalidResponse();
      return result;
    },
    async previewRecipient(sessionToken: string, recipientPublicId: string): Promise<RecipientPreview> {
      const result = await request('recipient-preview', { recipientPublicId }, sessionToken);
      if (!isRecipientPreview(result)) throw invalidResponse();
      return result;
    },
    async setupPin(sessionToken: string, pin: string): Promise<void> {
      if (!PIN_PATTERN.test(pin)) throw invalidRequest();
      const result = asRecord(await request('pin-setup', { pin }, sessionToken));
      const pinResult = asRecord(result?.pin);
      if (pinResult?.state !== 'ready') throw invalidResponse();
    },
    async status(sessionToken: string): Promise<PortalStatus> {
      const result = await request('status', {}, sessionToken);
      if (!isPortalStatus(result)) throw invalidResponse();
      return result;
    },
    async transfer(
      sessionToken: string,
      input: { amount: number; currency: PortalCurrency; pin: string; proof: string; requestId: string },
    ): Promise<TransferResult> {
      if (!Number.isSafeInteger(input.amount) || input.amount < 1 || !PIN_PATTERN.test(input.pin)
        || !OPAQUE_TOKEN_PATTERN.test(input.proof) || !REQUEST_ID_PATTERN.test(input.requestId)) throw invalidRequest();
      const result = await request('transfer', input, sessionToken);
      if (!isTransferResult(result)) throw invalidResponse();
      return result;
    },
  };
}

export function normalizePortalEndpoint(input: string, allowLocalhost = false): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error('VITE_REPRESENTATIVE_PORTAL_API_URL is invalid.');
  }
  const local = allowLocalhost && parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !local) throw new Error('The representative portal API must use HTTPS.');
  if (parsed.username || parsed.password || parsed.hash) throw new Error('The representative portal API URL must not contain credentials or fragments.');
  return parsed.toString();
}

async function readEnvelope(response: Response): Promise<ApiEnvelope> {
  try {
    const value = await response.json();
    return asRecord(value) as ApiEnvelope ?? {};
  } catch {
    throw invalidResponse();
  }
}

function normalizeErrorCode(value: unknown): PortalApiErrorCode {
  const allowed: PortalApiErrorCode[] = [
    'CURSOR_INVALID', 'FEATURE_DISABLED', 'FRESH_AUTH_REQUIRED', 'INSUFFICIENT_FUNDS', 'INTERNAL', 'INVALID_RECIPIENT',
    'INVALID_REQUEST', 'PERMISSION_DENIED', 'PIN_ALREADY_CONFIGURED', 'PIN_CHANGED', 'PIN_INVALID',
    'PIN_LOCKED', 'PIN_NOT_CONFIGURED', 'PIN_RESET_REQUIRED', 'PORTAL_ORIGIN_DENIED',
    'PORTAL_SESSION_INVALID', 'PROOF_INVALID', 'RATE_LIMITED', 'RECEIPT_NOT_FOUND', 'REPRESENTATIVE_REQUIRED',
    'REQUEST_CONFLICT', 'TRANSFER_LIMIT_EXCEEDED', 'TRANSFER_RATE_LIMITED',
  ];
  return allowed.includes(value as PortalApiErrorCode) ? value as PortalApiErrorCode : 'INTERNAL';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isIsoDate(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function invalidRequest(): PortalApiError {
  return new PortalApiError('INVALID_REQUEST', 'بيانات الطلب غير صالحة.', 400);
}

function invalidResponse(): PortalApiError {
  return new PortalApiError('INTERNAL', 'استجابت الخدمة ببيانات غير متوقعة.', 502);
}

export type PortalApi = ReturnType<typeof createPortalApi>;
