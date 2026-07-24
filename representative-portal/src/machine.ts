import type { PortalApiErrorCode, PortalCurrency, PortalReceipt, PortalStatus, RecipientPreview, TransferResult } from './contracts';

export type PortalStep =
  | 'bootstrapping'
  | 'recipient-entry'
  | 'verifying'
  | 'verified'
  | 'review'
  | 'pin-challenge'
  | 'submitting'
  | 'completed'
  | 'failed'
  | 'locked'
  | 'unavailable';

export type PortalState = {
  amountInput: string;
  busy: boolean;
  currency?: PortalCurrency;
  error: string;
  lastResult?: TransferResult;
  online: boolean;
  preview?: RecipientPreview;
  receipt?: PortalReceipt;
  recipientInput: string;
  status?: PortalStatus;
  step: PortalStep;
};

export type PortalAction =
  | { status: PortalStatus; type: 'BOOTSTRAP_SUCCEEDED' }
  | { message: string; type: 'BOOTSTRAP_FAILED' }
  | { type: 'FEATURE_DISABLED' }
  | { type: 'SESSION_EXPIRED' }
  | { online: boolean; type: 'ONLINE_CHANGED' }
  | { value: string; type: 'RECIPIENT_EDITED' }
  | { type: 'VERIFY_STARTED' }
  | { preview: RecipientPreview; type: 'VERIFY_SUCCEEDED' }
  | { message: string; type: 'VERIFY_FAILED' }
  | { currency: PortalCurrency; type: 'CURRENCY_SELECTED' }
  | { value: string; type: 'AMOUNT_EDITED' }
  | { type: 'REVIEW_OPENED' }
  | { type: 'REVIEW_CLOSED' }
  | { type: 'PIN_OPENED' }
  | { type: 'PIN_CLOSED' }
  | { type: 'SUBMIT_STARTED' }
  | { code: PortalApiErrorCode; message: string; type: 'SUBMIT_FAILED' }
  | { result: TransferResult; type: 'SUBMIT_SUCCEEDED' }
  | { status: PortalStatus; type: 'STATUS_REFRESHED' }
  | { receipt?: PortalReceipt; type: 'RECEIPT_SELECTED' }
  | { type: 'START_ANOTHER' }
  | { type: 'RETRY' };

export const initialPortalState: PortalState = {
  amountInput: '',
  busy: false,
  error: '',
  online: true,
  recipientInput: '',
  step: 'bootstrapping',
};

export function portalReducer(state: PortalState, action: PortalAction): PortalState {
  switch (action.type) {
    case 'BOOTSTRAP_SUCCEEDED': {
      const currency = preferredCurrency(action.status, state.currency);
      const locked = action.status.pin.state === 'locked';
      return { ...state, busy: false, currency, error: '', status: action.status, step: locked ? 'locked' : 'recipient-entry' };
    }
    case 'BOOTSTRAP_FAILED':
      return { ...state, busy: false, error: action.message, step: 'failed' };
    case 'FEATURE_DISABLED':
      return { ...state, busy: false, error: 'خدمة الوكيل غير متاحة حالياً.', preview: undefined, step: 'unavailable' };
    case 'SESSION_EXPIRED':
      return { ...state, busy: false, error: 'انتهت الجلسة. ارجع إلى التطبيق لفتح جلسة جديدة.', preview: undefined, step: 'failed' };
    case 'ONLINE_CHANGED':
      return { ...state, online: action.online, error: action.online ? state.error : 'لا يوجد اتصال بالإنترنت.' };
    case 'RECIPIENT_EDITED':
      return {
        ...state,
        amountInput: '',
        busy: false,
        error: '',
        lastResult: undefined,
        preview: undefined,
        recipientInput: action.value.replace(/\D/g, '').slice(0, 7),
        step: 'recipient-entry',
      };
    case 'VERIFY_STARTED':
      if (state.step !== 'recipient-entry' || state.busy) return state;
      return { ...state, busy: true, error: '', step: 'verifying' };
    case 'VERIFY_SUCCEEDED':
      if (state.step !== 'verifying') return state;
      return { ...state, busy: false, error: '', preview: action.preview, step: 'verified' };
    case 'VERIFY_FAILED':
      return { ...state, busy: false, error: action.message, preview: undefined, step: 'recipient-entry' };
    case 'CURRENCY_SELECTED':
      if (!state.status?.privilege.currencies[action.currency]) return state;
      return { ...state, amountInput: '', currency: action.currency, error: '' };
    case 'AMOUNT_EDITED':
      return { ...state, amountInput: normalizeAmountInput(action.value), error: '' };
    case 'REVIEW_OPENED':
      return canOpenReview(state) ? { ...state, error: '', step: 'review' } : state;
    case 'REVIEW_CLOSED':
      return state.preview ? { ...state, error: '', step: 'verified' } : { ...state, step: 'recipient-entry' };
    case 'PIN_OPENED':
      return state.step === 'review' ? { ...state, error: '', step: 'pin-challenge' } : state;
    case 'PIN_CLOSED':
      return state.step === 'pin-challenge' ? { ...state, error: '', step: 'review' } : state;
    case 'SUBMIT_STARTED':
      if (state.step !== 'pin-challenge' || state.busy) return state;
      return { ...state, busy: true, error: '', step: 'submitting' };
    case 'SUBMIT_SUCCEEDED':
      if (state.step !== 'submitting') return state;
      return {
        ...state,
        busy: false,
        error: '',
        lastResult: action.result,
        status: state.status ? { ...state.status, wallet: { ...state.status.wallet, balances: action.result.balances } } : state.status,
        step: 'completed',
      };
    case 'SUBMIT_FAILED': {
      if (action.code === 'FEATURE_DISABLED') return portalReducer(state, { type: 'FEATURE_DISABLED' });
      if (action.code === 'PORTAL_SESSION_INVALID') return portalReducer(state, { type: 'SESSION_EXPIRED' });
      if (action.code === 'PIN_LOCKED') return { ...state, busy: false, error: action.message, step: 'locked' };
      if (action.code === 'PROOF_INVALID' || action.code === 'INVALID_RECIPIENT') {
        return { ...state, amountInput: '', busy: false, error: action.message, preview: undefined, step: 'recipient-entry' };
      }
      return { ...state, busy: false, error: action.message, step: 'pin-challenge' };
    }
    case 'STATUS_REFRESHED': {
      if (!action.status.feature.available || !action.status.privilege.active) return portalReducer(state, { type: 'FEATURE_DISABLED' });
      if (action.status.pin.state === 'locked') return { ...state, busy: false, status: action.status, step: 'locked' };
      return { ...state, currency: preferredCurrency(action.status, state.currency), status: action.status };
    }
    case 'RECEIPT_SELECTED':
      return { ...state, receipt: action.receipt };
    case 'START_ANOTHER':
      return {
        ...state,
        amountInput: '',
        busy: false,
        error: '',
        lastResult: undefined,
        preview: undefined,
        recipientInput: '',
        step: 'recipient-entry',
      };
    case 'RETRY':
      return { ...initialPortalState, online: state.online };
  }
}

export function canOpenReview(state: PortalState, nowMillis = Date.now()): boolean {
  if (!state.preview || !state.status || !state.currency || state.step !== 'verified') return false;
  const amount = Number(state.amountInput);
  const limit = state.status.limits.effective?.[state.currency];
  const allowance = state.status.dailyAllowance[state.currency];
  return Number.isSafeInteger(amount)
    && amount > 0
    && amount <= state.status.wallet.balances[state.currency]
    && (!limit || amount <= limit.maxPerTransfer)
    && (allowance === undefined || amount <= allowance)
    && Date.parse(state.preview.expiresAt) > nowMillis;
}

export function normalizeAmountInput(value: string): string {
  if (!/^[0-9]*$/.test(value)) return '';
  const digits = value.replace(/^0+(?=\d)/, '').slice(0, 12);
  if (!digits) return '';
  const amount = Number(digits);
  return Number.isSafeInteger(amount) ? String(amount) : '';
}

function preferredCurrency(status: PortalStatus, current?: PortalCurrency): PortalCurrency | undefined {
  if (current && status.privilege.currencies[current]) return current;
  if (status.privilege.currencies.coins) return 'coins';
  if (status.privilege.currencies.diamonds) return 'diamonds';
  return undefined;
}
