const crypto = require('node:crypto');

const NOTIFICATION_CATEGORIES = Object.freeze(['coupleRequests', 'friendRequests', 'gifts', 'walletTransfers']);
const LEGACY_NOTIFICATION_CATEGORIES = Object.freeze(['coupleRequests', 'friendRequests', 'gifts']);
const NOTIFICATION_MUTATION_ACTIONS = Object.freeze([
  'register-push-device',
  'unregister-push-device',
  'update-notification-preferences',
]);

function createDefaultNotificationPreferences() {
  return { coupleRequests: true, friendRequests: true, gifts: true, walletTransfers: true };
}

function createPushTokenId(token) {
  return crypto.createHash('sha256').update(`expo-push-token-v1\u0000${token}`).digest('hex');
}

function createNotificationDeliveryId(uid, requestId) {
  return crypto.createHash('sha256').update(`social-notification-v1\u0000${uid}\u0000${requestId}`).digest('hex');
}

function isExpoPushToken(value) {
  return typeof value === 'string'
    && /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/.test(value.trim());
}

function normalizePushDeviceInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'INVALID_REQUEST' };
  if (Object.keys(input).some((key) => !['deviceName', 'platform', 'token'].includes(key))) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  const platform = typeof input.platform === 'string' ? input.platform.trim() : '';
  const deviceName = typeof input.deviceName === 'string' ? input.deviceName.trim().slice(0, 80) : '';
  if (!isExpoPushToken(token) || !['android', 'ios'].includes(platform)) return { ok: false, code: 'INVALID_REQUEST' };
  return { ok: true, value: { deviceName, platform, token, tokenId: createPushTokenId(token) } };
}

function normalizeUnregisterPushDeviceInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => key !== 'token')) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  if (!isExpoPushToken(token)) return { ok: false, code: 'INVALID_REQUEST' };
  return { ok: true, value: { token, tokenId: createPushTokenId(token) } };
}

function normalizeNotificationPreferencesInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'INVALID_REQUEST' };
  const keys = Object.keys(input);
  if (keys.some((key) => !NOTIFICATION_CATEGORIES.includes(key))
    || LEGACY_NOTIFICATION_CATEGORIES.some((key) => !keys.includes(key))
    || (keys.length !== LEGACY_NOTIFICATION_CATEGORIES.length && keys.length !== NOTIFICATION_CATEGORIES.length)) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  if (keys.some((key) => typeof input[key] !== 'boolean')) return { ok: false, code: 'INVALID_REQUEST' };
  return { ok: true, value: { ...createDefaultNotificationPreferences(), ...Object.fromEntries(keys.map((key) => [key, input[key]])) } };
}

function mapNotificationPreferences(value) {
  const defaults = createDefaultNotificationPreferences();
  if (!value || typeof value !== 'object') return defaults;
  return Object.fromEntries(NOTIFICATION_CATEGORIES.map((key) => [key, typeof value[key] === 'boolean' ? value[key] : defaults[key]]));
}

function notificationCategoryForKind(kind) {
  if (['couple-request', 'couple-accepted'].includes(kind)) return 'coupleRequests';
  if (['friend-request', 'friend-accepted'].includes(kind)) return 'friendRequests';
  if (['gift-received', 'store-gift-received', 'store-gift-sent'].includes(kind)) return 'gifts';
  if ([
    'representative-transfer-received',
    'representative-transfer-sent',
    'representative-reversal-recipient',
    'representative-reversal-representative',
  ].includes(kind)) return 'walletTransfers';
  return undefined;
}

function buildArabicNotification(kind, actorDisplayName, actorUid) {
  const name = typeof actorDisplayName === 'string' && actorDisplayName.trim()
    ? actorDisplayName.trim().slice(0, 32)
    : 'مستخدم';
  const definitions = {
    'couple-request': { title: 'طلب ارتباط جديد', body: `${name} أرسل لك طلب ارتباط`, route: 'UserProfile' },
    'couple-accepted': { title: 'تم قبول الارتباط', body: `${name} قبل طلب الارتباط`, route: 'Couples' },
    'friend-request': { title: 'طلب صداقة جديد', body: `${name} أرسل لك طلب صداقة`, route: 'UserProfile' },
    'friend-accepted': { title: 'تم قبول طلب الصداقة', body: `${name} أصبح ضمن أصدقائك`, route: 'Friends' },
    'gift-received': { title: 'وصلتك هدية جديدة', body: `${name} أرسل لك هدية`, route: 'Gifts' },
    'store-gift-received': { title: 'وصلتك هدية من المتجر', body: `${name} أرسل لك عنصراً جديداً`, route: 'Store' },
    'store-gift-sent': { title: 'تم إرسال هديتك', body: `وصلت هديتك إلى ${name}`, route: 'Store' },
  };
  definitions['representative-transfer-received'] = { title: 'تم شحن محفظتك', body: `أرسل ${name} رصيداً إلى محفظتك`, route: 'WalletStore' };
  definitions['representative-transfer-sent'] = { title: 'تم إرسال الرصيد', body: `اكتملت عملية الشحن إلى ${name}`, route: 'RepresentativeTransfer' };
  definitions['representative-reversal-recipient'] = { title: 'تم عكس عملية الشحن', body: `أعادت الإدارة الرصيد المرسل من ${name}`, route: 'WalletStore' };
  definitions['representative-reversal-representative'] = { title: 'تمت إعادة الرصيد', body: `أعادت الإدارة رصيد العملية مع ${name} إلى محفظتك`, route: 'RepresentativeTransfer' };
  const definition = definitions[kind];
  if (!definition || typeof actorUid !== 'string' || !actorUid) return undefined;
  return { ...definition, actorUid, kind };
}

function buildRepresentativeReversalNotificationCommands(result, requestId) {
  if (!result || typeof result !== 'object'
    || typeof result.recipientUid !== 'string' || !result.recipientUid
    || typeof result.representativeUid !== 'string' || !result.representativeUid
    || typeof requestId !== 'string' || !requestId) return [];
  return [
    {
      actorUid: result.representativeUid,
      kind: 'representative-reversal-recipient',
      recipientUid: result.recipientUid,
      requestId: `representative_reversal_recipient_${requestId}`,
    },
    {
      actorUid: result.recipientUid,
      kind: 'representative-reversal-representative',
      recipientUid: result.representativeUid,
      requestId: `representative_reversal_representative_${requestId}`,
    },
  ];
}

module.exports = {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_MUTATION_ACTIONS,
  buildArabicNotification,
  buildRepresentativeReversalNotificationCommands,
  createDefaultNotificationPreferences,
  createNotificationDeliveryId,
  createPushTokenId,
  isExpoPushToken,
  mapNotificationPreferences,
  normalizeNotificationPreferencesInput,
  normalizePushDeviceInput,
  normalizeUnregisterPushDeviceInput,
  notificationCategoryForKind,
};
