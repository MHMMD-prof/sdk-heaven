import { startPersonalChatOperation } from '../observability/personalChatTelemetry';
import { DirectChatAction, DIRECT_CHAT_COMMAND_VERSION } from './directChatContract';

export type DirectChatCommandInput = {
  action: DirectChatAction;
  payload?: Record<string, unknown>;
  requestId?: string;
};

export type DirectChatCommandResult<T = Record<string, unknown>> = {
  ok: true;
  replayed: boolean;
  result: T;
};

export class DirectChatCommandError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'DirectChatCommandError';
    this.code = code;
    this.status = status;
  }
}

export async function requestDirectChatCommand<T = Record<string, unknown>>(
  input: DirectChatCommandInput,
  options: {
    endpoint?: string;
    getAppCheckToken?: (forceRefresh?: boolean) => Promise<string>;
    getIdToken?: () => Promise<string>;
    timeoutMs?: number;
  } = {},
): Promise<DirectChatCommandResult<T>> {
  const operation = startPersonalChatOperation('command', { command_action: input.action });
  let operationFinished = false;
  const finishOperation = (outcome: 'failure' | 'success', errorCode = '') => {
    if (operationFinished) return;
    operationFinished = true;
    operation.finish(outcome, errorCode);
  };
  const endpoint = resolveDirectChatCommandEndpoint(options.endpoint);
  if (!endpoint) {
    finishOperation('failure', 'ENDPOINT_MISSING');
    throw new DirectChatCommandError('ENDPOINT_MISSING', 'خدمة المحادثات الشخصية غير مهيأة.', 0);
  }
  const requestId = input.requestId || createDirectChatRequestId();
  const body = {
    action: input.action,
    payload: input.payload || {},
    requestId,
    version: DIRECT_CHAT_COMMAND_VERSION,
  };
  const getIdToken = options.getIdToken || getDefaultFirebaseIdToken;
  const getAppCheckToken = options.getAppCheckToken || getDefaultFirebaseAppCheckToken;
  const idToken = await getIdToken();
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 10_000);
    try {
      const appCheckToken = await getAppCheckToken(attempt > 0);
      const response = await fetch(endpoint, {
        body: JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
          ...(appCheckToken ? { 'X-Firebase-AppCheck': appCheckToken } : {}),
        },
        method: 'POST',
        signal: controller.signal,
      });
      const payload = await readPayload<T>(response);
      if (!response.ok || payload.ok !== true || !payload.result) {
        const error = new DirectChatCommandError(
          payload.code || `HTTP_${response.status}`,
          payload.messageAr || payload.error || 'تعذر تنفيذ طلب المحادثة الشخصية.',
          response.status,
        );
        if ((response.status >= 500 || error.code === 'APP_CHECK_INVALID') && attempt === 0) {
          lastError = error;
          continue;
        }
        finishOperation('failure', error.code);
        throw error;
      }
      finishOperation('success');
      return { ok: true, replayed: payload.replayed === true, result: payload.result };
    } catch (error) {
      if (error instanceof DirectChatCommandError) throw error;
      lastError = error;
      if (attempt > 0) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  const finalCode = lastError instanceof Error && lastError.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR';
  finishOperation('failure', finalCode);
  throw new DirectChatCommandError(
    finalCode,
    'تعذر الاتصال بخدمة المحادثات الشخصية.',
    0,
  );
}

export function createDirectChatRequestId(now = Date.now(), random = Math.random()) {
  const entropy = Math.floor(random * Number.MAX_SAFE_INTEGER).toString(36).padStart(11, '0');
  return `dm_${now.toString(36)}_${entropy}`;
}

export function resolveDirectChatCommandEndpoint(explicit?: string) {
  const env = process.env as Record<string, string | undefined>;
  return explicit || env.EXPO_PUBLIC_DIRECT_CHAT_COMMAND_ENDPOINT || deriveDirectChatEndpoint(env.EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT);
}

export function deriveDirectChatEndpoint(tokenEndpoint?: string) {
  if (!tokenEndpoint) return '';
  try {
    const url = new URL(tokenEndpoint);
    if (url.protocol !== 'https:') return '';
    url.pathname = url.pathname.replace(/\/[^/]*$/, '/directChatCommand');
    return url.toString();
  } catch {
    return '';
  }
}

async function readPayload<T>(response: Response): Promise<{
  code?: string;
  error?: string;
  messageAr?: string;
  ok?: boolean;
  replayed?: boolean;
  result?: T;
}> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function getDefaultFirebaseIdToken() {
  const { getCurrentFirebaseIdToken } = await import('../auth/getCurrentFirebaseIdToken');
  return getCurrentFirebaseIdToken();
}

async function getDefaultFirebaseAppCheckToken(forceRefresh = false) {
  const { getFirebaseAppCheckToken } = await import('../auth/appCheck');
  return getFirebaseAppCheckToken(forceRefresh);
}
