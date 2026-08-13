const crypto = require('node:crypto');

const SOCIAL_NOTIFICATION_CATEGORIES = Object.freeze(['coupleRequests', 'friendRequests', 'follows', 'gifts', 'walletTransfers']);
const DIRECT_CHAT_NOTIFICATION_CATEGORIES = Object.freeze(['directMessages', 'directMessageRequests']);
const NOTIFICATION_CATEGORIES = Object.freeze([
  ...SOCIAL_NOTIFICATION_CATEGORIES,
  ...DIRECT_CHAT_NOTIFICATION_CATEGORIES,
]);
const NOTIFICATION_PRIVACY_KEYS = Object.freeze(['showMessagePreview', 'readReceipts', 'showOnlineStatus']);
const NOTIFICATION_PREFERENCE_KEYS = Object.freeze([...NOTIFICATION_CATEGORIES, ...NOTIFICATION_PRIVACY_KEYS]);
// Oldest clients only sent the original three social toggles; walletTransfers, follows, and chat keys fill from defaults.
const LEGACY_NOTIFICATION_CATEGORIES = Object.freeze(['coupleRequests', 'friendRequests', 'gifts']);
const NOTIFICATION_MUTATION_ACTIONS = Object.freeze([
  'register-push-device',
  'unregister-push-device',
  'update-notification-preferences',
]);
const DIRECT_CHAT_NOTIFICATION_COALESCE_MS = 30_000;
const DIRECT_CHAT_PREVIEW_LENGTH = 80;

function createDefaultNotificationPreferences() {
  return {
    coupleRequests: true,
    directMessageRequests: true,
    directMessages: true,
    follows: true,
    friendRequests: true,
    gifts: true,
    readReceipts: true,
    showMessagePreview: true,
    showOnlineStatus: true,
    walletTransfers: true,
  };
}

function createPushTokenId(token) {
  return crypto.createHash('sha256').update(`expo-push-token-v1\u0000${token}`).digest('hex');
}

function createNotificationDeliveryId(uid, requestId) {
  return crypto.createHash('sha256').update(`social-notification-v1\u0000${uid}\u0000${requestId}`).digest('hex');
}

function createDirectChatCoalesceId(recipientUid, conversationId) {
  if (typeof recipientUid !== 'string' || !recipientUid || typeof conversationId !== 'string' || !conversationId) return '';
  return crypto.createHash('sha256')
    .update(`direct-chat-coalesce-v1\u0000${recipientUid}\u0000${conversationId}`)
    .digest('hex');
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
  // Require the original social trio so old clients keep working; any known chat/privacy key is optional and filled from defaults.
  if (keys.some((key) => !NOTIFICATION_PREFERENCE_KEYS.includes(key))
    || LEGACY_NOTIFICATION_CATEGORIES.some((key) => !keys.includes(key))
    || keys.some((key) => typeof input[key] !== 'boolean')) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  return {
    ok: true,
    value: {
      ...createDefaultNotificationPreferences(),
      ...Object.fromEntries(keys.map((key) => [key, input[key]])),
    },
  };
}

function mapNotificationPreferences(value) {
  const defaults = createDefaultNotificationPreferences();
  if (!value || typeof value !== 'object') return defaults;
  return Object.fromEntries(NOTIFICATION_PREFERENCE_KEYS.map((key) => [
    key,
    typeof value[key] === 'boolean' ? value[key] : defaults[key],
  ]));
}

function notificationCategoryForKind(kind) {
  if (['couple-request', 'couple-accepted'].includes(kind)) return 'coupleRequests';
  if (['friend-request', 'friend-accepted'].includes(kind)) return 'friendRequests';
  if (kind === 'new-follower') return 'follows';
  if (['gift-received', 'store-gift-received', 'store-gift-sent', 'rocket-reward-paid', 'room-target-selected'].includes(kind)) return 'gifts';
  if ([
    'representative-transfer-received',
    'representative-transfer-sent',
    'representative-reversal-recipient',
    'representative-reversal-representative',
  ].includes(kind)) return 'walletTransfers';
  if (kind === 'direct-message') return 'directMessages';
  if (kind === 'direct-message-request') return 'directMessageRequests';
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
    'new-follower': { title: 'متابع جديد', body: `${name} بدأ بمتابعتك`, route: 'UserProfile' },
    'gift-received': { title: 'وصلتك هدية جديدة', body: `${name} أرسل لك هدية`, route: 'Gifts' },
    'store-gift-received': { title: 'وصلتك هدية من المتجر', body: `${name} أرسل لك عنصراً جديداً`, route: 'Store' },
    'store-gift-sent': { title: 'تم إرسال هديتك', body: `وصلت هديتك إلى ${name}`, route: 'Store' },
  };
  definitions['representative-transfer-received'] = { title: 'تم شحن محفظتك', body: `أرسل ${name} رصيداً إلى محفظتك`, route: 'WalletStore' };
  definitions['representative-transfer-sent'] = { title: 'تم إرسال الرصيد', body: `اكتملت عملية الشحن إلى ${name}`, route: 'RepresentativeTransfer' };
  definitions['representative-reversal-recipient'] = { title: 'تم عكس عملية الشحن', body: `أعادت الإدارة الرصيد المرسل من ${name}`, route: 'WalletStore' };
  definitions['representative-reversal-representative'] = { title: 'تمت إعادة الرصيد', body: `أعادت الإدارة رصيد العملية مع ${name} إلى محفظتك`, route: 'RepresentativeTransfer' };
  definitions['rocket-reward-paid'] = {
    title: 'تم إيداع مكافأة الصاروخ',
    body: 'وصلت مكافأة ترتيبك الأسبوعي في الغرفة إلى محفظتك',
    route: 'Rooms',
  };
  definitions['room-target-selected'] = {
    title: 'تم اختيارك لهدف الغرفة',
    body: 'أضافك مالك الغرفة إلى قائمة هدف الأسبوع القادم. افتح الغرفة لمراجعة الشروط والمواعيد.',
    route: 'Rooms',
  };
  const definition = definitions[kind];
  if (!definition || typeof actorUid !== 'string' || !actorUid) return undefined;
  return { ...definition, actorUid, kind };
}

// Requests are always hidden. Accepted chats honor showMessagePreview: off reveals neither sender nor content.
function buildDirectChatNotificationContent({
  actorDisplayName,
  actorUid,
  kind,
  messageKind,
  showMessagePreview,
  text,
}) {
  if (typeof actorUid !== 'string' || !actorUid) return undefined;
  if (kind === 'direct-message-request') {
    return {
      actorUid,
      body: 'لديك طلب رسالة جديد',
      kind,
      route: 'DirectChat',
      title: 'طلب رسالة جديدة',
    };
  }
  if (kind !== 'direct-message') return undefined;
  if (showMessagePreview !== true) {
    return {
      actorUid,
      body: 'لديك رسالة جديدة',
      kind,
      route: 'DirectChat',
      title: 'رسالة جديدة',
    };
  }
  const name = typeof actorDisplayName === 'string' && actorDisplayName.trim()
    ? actorDisplayName.trim().slice(0, 32)
    : 'مستخدم';
  return {
    actorUid,
    body: directChatPreviewBody(messageKind, text),
    kind,
    route: 'DirectChat',
    title: name,
  };
}

function directChatPreviewBody(messageKind, text) {
  if (messageKind === 'image') return 'صورة';
  if (messageKind === 'voice-note') return 'رسالة صوتية';
  if (messageKind === 'sticker') return 'ملصق';
  if (messageKind === 'emoji') {
    return typeof text === 'string' && text.trim() ? text.trim().slice(0, 16) : 'إيموجي';
  }
  if (typeof text === 'string' && text.trim()) {
    return [...text.trim()].slice(0, DIRECT_CHAT_PREVIEW_LENGTH).join('');
  }
  return 'رسالة جديدة';
}

function shouldCoalesceDirectChatNotification({ lastSentAtMs, nowMs }) {
  if (!Number.isFinite(lastSentAtMs) || !Number.isFinite(nowMs)) return false;
  return nowMs - lastSentAtMs < DIRECT_CHAT_NOTIFICATION_COALESCE_MS && nowMs >= lastSentAtMs;
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
  DIRECT_CHAT_NOTIFICATION_CATEGORIES,
  DIRECT_CHAT_NOTIFICATION_COALESCE_MS,
  DIRECT_CHAT_PREVIEW_LENGTH,
  LEGACY_NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_MUTATION_ACTIONS,
  NOTIFICATION_PREFERENCE_KEYS,
  NOTIFICATION_PRIVACY_KEYS,
  SOCIAL_NOTIFICATION_CATEGORIES,
  buildArabicNotification,
  buildDirectChatNotificationContent,
  buildRepresentativeReversalNotificationCommands,
  createDefaultNotificationPreferences,
  createDirectChatCoalesceId,
  createNotificationDeliveryId,
  createPushTokenId,
  directChatPreviewBody,
  isExpoPushToken,
  mapNotificationPreferences,
  normalizeNotificationPreferencesInput,
  normalizePushDeviceInput,
  normalizeUnregisterPushDeviceInput,
  notificationCategoryForKind,
  shouldCoalesceDirectChatNotification,
};
