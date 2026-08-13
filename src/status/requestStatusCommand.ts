import { getFunctions, httpsCallable } from 'firebase/functions';

import { firebaseApp } from '../auth/firebase';
import { createSocialRequestId } from '../social/publicProfile';
import { mapAristocracyQuote, mapStatusCenter, type AristocracyQuote, type StatusCenter } from './statusCenter';

const functions = getFunctions(firebaseApp, 'us-central1');
export type StatusErrorCode = 'AUTH_REQUIRED' | 'CATALOG_CHANGED' | 'CATALOG_UNAVAILABLE' | 'COMPLIMENTARY_ACTIVE' | 'DOWNGRADE_NOT_ALLOWED' | 'ENTITLEMENT_RESTRICTED' | 'FEATURE_DISABLED' | 'INSUFFICIENT_FUNDS' | 'INVALID_REQUEST' | 'OFFLINE' | 'PROFILE_INCOMPLETE' | 'QUOTE_EXPIRED' | 'QUOTE_INVALID' | 'QUOTE_STALE' | 'QUOTE_UNAVAILABLE' | 'QUOTE_USED' | 'RANK_UNAVAILABLE' | 'RATE_LIMITED' | 'REQUEST_CONFLICT' | 'INTERNAL';
export type StatusResponse<T> = { ok: true; result: T } | { ok: false; error: { code: StatusErrorCode; messageAr: string; messageEn: string } };

export async function requestStatusCenter(): Promise<StatusResponse<StatusCenter>> {
  const response = await callStatus('get-status-center', {});
  if (!response.ok) return response;
  const result = mapStatusCenter(response.result);
  return result ? { ok: true, result } : error('INTERNAL');
}
export async function requestAristocracyQuote(catalogVersion: string, targetRankId: string): Promise<StatusResponse<AristocracyQuote>> {
  const response = await callStatus('quote-aristocracy', { catalogVersion, targetRankId });
  if (!response.ok) return response;
  const result = mapAristocracyQuote(response.result);
  return result ? { ok: true, result } : error('INTERNAL');
}
export async function requestAristocracyPurchase(quoteId: string, requestId = quoteId): Promise<StatusResponse<Record<string, unknown>>> {
  return callStatus('purchase-aristocracy', { quoteId }, requestId);
}
export async function requestStatusVisibility(publicDisplay: boolean): Promise<StatusResponse<{ visibility: 'public' | 'hidden'; syncState: 'pending' }>> {
  return callStatus('update-status-visibility', { publicDisplay });
}

async function callStatus<T>(action: string, payload: Record<string, unknown>, requestId = createSocialRequestId('status')): Promise<StatusResponse<T>> {
  try {
    const callable = httpsCallable(functions, 'statusCommand');
    const response = await callable({ action, payload, requestId, version: 1 });
    const data = response.data as { ok?: unknown; result?: unknown };
    return data?.ok === true ? { ok: true, result: data.result as T } : error('INTERNAL');
  } catch (caught) {
    return error(readCode(caught));
  }
}

function readCode(caught: unknown): StatusErrorCode {
  if (!caught || typeof caught !== 'object') return 'INTERNAL';
  const value = caught as { code?: unknown; message?: unknown; details?: unknown };
  const details = value.details && typeof value.details === 'object' ? value.details as { code?: unknown } : undefined;
  const raw = typeof details?.code === 'string' ? details.code : typeof value.code === 'string' ? value.code : typeof value.message === 'string' ? value.message : '';
  const normalized = raw.replace(/^functions\//, '').toUpperCase().replace(/-/g, '_');
  if (normalized.includes('UNAVAILABLE') || normalized.includes('NETWORK')) return 'OFFLINE';
  return CODES.includes(normalized as StatusErrorCode) ? normalized as StatusErrorCode : 'INTERNAL';
}
const CODES: StatusErrorCode[] = ['AUTH_REQUIRED', 'CATALOG_CHANGED', 'CATALOG_UNAVAILABLE', 'COMPLIMENTARY_ACTIVE', 'DOWNGRADE_NOT_ALLOWED', 'ENTITLEMENT_RESTRICTED', 'FEATURE_DISABLED', 'INSUFFICIENT_FUNDS', 'INVALID_REQUEST', 'OFFLINE', 'PROFILE_INCOMPLETE', 'QUOTE_EXPIRED', 'QUOTE_INVALID', 'QUOTE_STALE', 'QUOTE_UNAVAILABLE', 'QUOTE_USED', 'RANK_UNAVAILABLE', 'RATE_LIMITED', 'REQUEST_CONFLICT', 'INTERNAL'];
const COPY: Record<StatusErrorCode, [string, string]> = {
  AUTH_REQUIRED: ['سجّل الدخول لفتح مركز الحالة.', 'Sign in to open the Status Center.'],
  CATALOG_CHANGED: ['تغيّرت الأسعار أو الرتب. حدّث الصفحة واطلب سعراً جديداً.', 'Ranks or prices changed. Refresh and request a new quote.'],
  CATALOG_UNAVAILABLE: ['كتالوج الرتب غير متاح حالياً.', 'The rank catalog is currently unavailable.'],
  COMPLIMENTARY_ACTIVE: ['لديك رتبة ممنوحة نشطة. انتظر انتهاءها قبل الشراء.', 'You have an active complimentary rank. Wait until it expires before purchasing.'],
  DOWNGRADE_NOT_ALLOWED: ['لا يمكن الانتقال إلى رتبة أقل قبل انتهاء الرتبة الحالية.', 'You cannot move to a lower rank until the current rank expires.'],
  ENTITLEMENT_RESTRICTED: ['الرتبة مجمدة أو قيد المراجعة، لذلك لا يمكن تغييرها الآن.', 'The rank is frozen or under review, so it cannot be changed now.'],
  FEATURE_DISABLED: ['الخدمة متوقفة مؤقتاً. تبقى الرتبة الحالية وتاريخها محفوظين.', 'The service is temporarily paused. Your current rank and history remain saved.'],
  INSUFFICIENT_FUNDS: ['رصيد العملات غير كافٍ.', 'Your coin balance is insufficient.'],
  INVALID_REQUEST: ['الطلب غير صالح. حدّث الصفحة وحاول مجدداً.', 'The request is invalid. Refresh and try again.'],
  OFFLINE: ['لا يوجد اتصال. نعرض آخر بيانات محفوظة إن وجدت.', 'You appear offline. The last loaded data remains visible when available.'],
  PROFILE_INCOMPLETE: ['أكمل ملفك الشخصي أولاً.', 'Complete your profile first.'],
  QUOTE_EXPIRED: ['انتهت مهلة السعر. اطلب سعراً جديداً.', 'This quote expired. Request a new quote.'],
  QUOTE_INVALID: ['عرض السعر غير صالح.', 'This quote is invalid.'],
  QUOTE_STALE: ['تغيّرت حالة الرتبة أو الرصيد. اطلب سعراً جديداً.', 'Your rank or balance changed. Request a new quote.'],
  QUOTE_UNAVAILABLE: ['لا يمكن إنشاء عرض سعر لهذه الرتبة حالياً.', 'A quote is not currently available for this rank.'],
  QUOTE_USED: ['تم استخدام عرض السعر مسبقاً.', 'This quote was already used.'],
  RANK_UNAVAILABLE: ['الرتبة المختارة لم تعد متاحة.', 'The selected rank is no longer available.'],
  RATE_LIMITED: ['محاولات كثيرة. انتظر قليلاً ثم حاول.', 'Too many attempts. Wait briefly and try again.'],
  REQUEST_CONFLICT: ['تعارض الطلب مع عملية سابقة. حدّث الصفحة.', 'This request conflicts with an earlier operation. Refresh.'],
  INTERNAL: ['تعذر تنفيذ الطلب. حاول مرة أخرى.', 'The request could not be completed. Try again.'],
};
function error(code: StatusErrorCode): StatusResponse<never> { return { ok: false, error: { code, messageAr: COPY[code][0], messageEn: COPY[code][1] } }; }
