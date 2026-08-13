import { getCurrentFirebaseIdToken } from '../auth/getCurrentFirebaseIdToken';
import { derivePayrollProgressEndpoint } from './payrollEndpoint';

declare const process:
  | {
      env?: Record<string, string | undefined>;
    }
  | undefined;

export type PayrollProgress = {
  cycle: { cycleId: string; endAtMillis: number; startAtMillis: number; timeZone: string };
  enrolled: true;
  /** True when `voice_room_payroll_payouts` is live (Wave 4 economic stage 7). */
  payoutEnabled?: boolean;
  plan: {
    category: 'super-admin' | 'employee' | 'female-host';
    currency: 'coins' | 'diamonds';
    dailyMinimumMinutes: number;
    name: { ar: string; en: string };
    planId: string;
    requiredWeekdays: number[];
    weeklyAmount: number;
  };
  progress: {
    amount: number;
    currency: 'coins' | 'diamonds';
    daily: Array<{
      dayId: string;
      manuallyExcused: boolean;
      met: boolean;
      outageExcusedMinutes: number;
      qualifiedMinutes: number;
      requiredMinutes: number;
      weekday: number;
    }>;
    qualified: boolean;
    result: string;
  };
  settlement?: {
    mode: 'live' | 'report-only';
    nextSettlementEstimateAtMillis: number;
  };
  uid: string;
};

export async function requestPayrollProgress(): Promise<PayrollProgress | null> {
  const env = typeof process === 'undefined' ? {} : process.env ?? {};
  const endpoint = env.EXPO_PUBLIC_PAYROLL_PROGRESS_ENDPOINT
    || derivePayrollProgressEndpoint(env.EXPO_PUBLIC_LIVEKIT_TOKEN_ENDPOINT);
  if (!endpoint) return null;
  const response = await fetch(endpoint, {
    body: '{}',
    headers: {
      Authorization: `Bearer ${await getCurrentFirebaseIdToken()}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const payload = await readPayload(response);
  if (!response.ok || payload.ok !== true) throw new Error(payload.error || 'Payroll progress is unavailable.');
  return payload.payroll?.enrolled === true ? payload.payroll as PayrollProgress : null;
}

async function readPayload(response: Response): Promise<{
  error?: string;
  ok?: boolean;
  payroll?: PayrollProgress | { enrolled: false };
}> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
