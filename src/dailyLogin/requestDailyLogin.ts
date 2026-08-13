import Constants from 'expo-constants';

import { getCurrentFirebaseIdToken } from '../auth/getCurrentFirebaseIdToken';
import {
  DailyLoginClaimResult,
  DailyLoginStatus,
  mapDailyLoginClaimResult,
  mapDailyLoginStatus,
} from './dailyLoginContract';
import { deriveDailyLoginCommandEndpoint } from './dailyLoginEndpoint';

declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

export class DailyLoginRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DailyLoginRequestError';
    this.code = code;
  }
}

export async function requestDailyLoginStatus(): Promise<DailyLoginStatus | null> {
  const payload = await request({ action: 'get-daily-login-status' });
  const status = mapDailyLoginStatus(payload.result);
  if (!status) throw new DailyLoginRequestError('INVALID_RESPONSE', 'بيانات مكافأة الدخول غير صالحة.');
  return status;
}

export async function claimDailyLoginReward(requestId: string): Promise<DailyLoginClaimResult> {
  const payload = await request({ action: 'claim-daily-login-reward', requestId });
  const result = mapDailyLoginClaimResult(payload.result);
  if (!result) throw new DailyLoginRequestError('INVALID_RESPONSE', 'إيصال مكافأة الدخول غير صالح.');
  return result;
}

async function request(body: { action: 'get-daily-login-status' } | { action: 'claim-daily-login-reward'; requestId: string }) {
  const env = typeof process === 'undefined' ? {} : process.env ?? {};
  const endpoint = env.EXPO_PUBLIC_DAILY_LOGIN_COMMAND_ENDPOINT
    || deriveDailyLoginCommandEndpoint(env.EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT);
  if (!endpoint) return noEndpoint(body.action);
  const response = await fetch(endpoint, {
    body: JSON.stringify({
      ...body,
      clientVersion: Constants.expoConfig?.version || '1.0.0',
    }),
    headers: {
      Authorization: `Bearer ${await getCurrentFirebaseIdToken()}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const payload = await readPayload(response);
  if (!response.ok || payload.ok !== true) {
    throw new DailyLoginRequestError(
      payload.code || `HTTP_${response.status}`,
      arabicServiceError(payload.code, payload.error),
    );
  }
  return payload;
}

function noEndpoint(action: 'get-daily-login-status' | 'claim-daily-login-reward'): never {
  throw new DailyLoginRequestError(
    'ENDPOINT_MISSING',
    action === 'get-daily-login-status'
      ? 'مكافآت الدخول غير مفعّلة حالياً.'
      : 'استلام مكافأة الدخول غير مفعّل حالياً.',
  );
}

function arabicServiceError(code?: string, fallback?: string) {
  if (code === 'RATE_LIMITED') return 'محاولات كثيرة. حاول مرة أخرى بعد قليل.';
  if (code === 'CLIENT_INCOMPATIBLE') return 'حدّث التطبيق لاستلام المكافأة.';
  if (code === 'CLAIMS_PAUSED' || code === 'EMERGENCY_DISABLED') return 'المكافآت متوقفة مؤقتاً.';
  if (code === 'ALREADY_CLAIMED') return 'تم استلام هدية اليوم مسبقاً.';
  if (code === 'CLAIM_CONFLICT' || code === 'CLAIM_STATE_CONFLICT') return 'حالة مكافأة اليوم قيد المراجعة. حاول لاحقاً.';
  if (code === 'ITEM_REWARDS_DISABLED') return 'هدية اليوم غير متاحة حالياً.';
  if (code === 'NOT_CLAIMABLE') return 'المكافأة غير متاحة الآن.';
  if (fallback && /[\u0600-\u06FF]/.test(fallback)) return fallback;
  return 'تعذر الوصول إلى خدمة المكافآت.';
}

async function readPayload(response: Response): Promise<{
  code?: string;
  error?: string;
  ok?: boolean;
  replayed?: boolean;
  result?: unknown;
}> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
