export const ADMIN_REQUEST_TIMEOUT_MS = 20_000;

const readOnlyActions = new Set([
  'admin-settings', 'administrators', 'audit-detail', 'audit-events', 'audit-export', 'audit-summary',
  'cosmetic-assets', 'economy-history', 'gift-catalog', 'overview', 'report-detail', 'report-summary', 'reports',
  'daily-login-campaign',
  'room-detail', 'room-summary', 'rooms', 'session', 'special-id-catalog', 'store-catalog',
  'store-summary', 'user-detail', 'user-history', 'user-summary', 'users',
]);

export function isReadOnlyAdminAction(action: string) {
  return readOnlyActions.has(action);
}

export function shouldRetryAdminRequest(action: string, attempt: number, status: number) {
  return attempt === 0 && isReadOnlyAdminAction(action) && (status === 0 || status === 408 || status === 429 || status >= 500);
}

export function adminRequestErrorMessage(status: number, serverMessage = '') {
  if (status === 0) return 'تعذّر الاتصال بخدمة الإدارة. تحقق من الشبكة وحاول مجددًا.';
  if (status === 401) return 'انتهت جلسة الإدارة. سجّل الدخول مرة أخرى.';
  if (status === 403) return serverMessage.includes('role') ? 'دورك الإداري لا يسمح بتنفيذ هذا الإجراء.' : 'ليس لديك صلاحية لتنفيذ هذا الإجراء.';
  if (status === 408) return 'انتهت مهلة الطلب قبل اكتماله. حاول مجددًا.';
  if (status === 409) return 'تغيّرت البيانات منذ فتحها. حدّث الصفحة ثم أعد المحاولة.';
  if (status === 429) return 'طلبات كثيرة خلال وقت قصير. انتظر قليلًا ثم حاول مجددًا.';
  if (status >= 500) return 'تعذّرت خدمة الإدارة مؤقتًا. أُبلغ فريق التشغيل ويمكنك إعادة المحاولة.';
  return serverMessage || 'تعذّر تنفيذ طلب الإدارة.';
}
