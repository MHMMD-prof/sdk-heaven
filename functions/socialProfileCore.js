const crypto = require('node:crypto');

const DEFAULT_COUNTRY_CODE = 'IQ';
const PUBLIC_ID_MAX = 9999999;
const PUBLIC_ID_MIN = 1000000;
const SOCIAL_COMMAND_VERSION = 1;
const SUPPORTED_COUNTRY_CODES = [
  'IQ', 'SA', 'SY', 'LB', 'YE', 'DZ', 'EG', 'JO', 'PS', 'AE', 'KW',
  'QA', 'BH', 'OM', 'MA', 'TN', 'LY', 'SD', 'SO', 'DJ', 'MR', 'KM',
];
const SOCIAL_FEATURE_FLAGS = [
  'usersDiscovery',
  'friends',
  'wallet',
  'gifts',
  'couples',
  'pushNotifications',
  'representativeTransfers',
];

const SOCIAL_ERRORS = Object.freeze({
  AUTH_REQUIRED: {
    httpsCode: 'unauthenticated',
    message: 'Authentication is required.',
    messageAr: 'يجب تسجيل الدخول للمتابعة.',
  },
  EMAIL_VERIFICATION_REQUIRED: {
    httpsCode: 'permission-denied',
    message: 'Email verification is required.',
    messageAr: 'يجب تأكيد البريد الإلكتروني للمتابعة.',
  },
  INVALID_REQUEST: {
    httpsCode: 'invalid-argument',
    message: 'The social command request is invalid.',
    messageAr: 'طلب النظام الاجتماعي غير صالح.',
  },
  PROFILE_INCOMPLETE: {
    httpsCode: 'failed-precondition',
    message: 'A complete private profile is required.',
    messageAr: 'يجب إكمال الملف الشخصي أولاً.',
  },
  PUBLIC_ID_EXHAUSTED: {
    httpsCode: 'resource-exhausted',
    message: 'A public ID could not be allocated.',
    messageAr: 'تعذر إنشاء رقم مستخدم حالياً. حاول لاحقاً.',
  },
  PERMISSION_DENIED: {
    httpsCode: 'permission-denied',
    message: 'This action is not permitted.',
    messageAr: 'لا تملك صلاحية تنفيذ هذا الإجراء.',
  },
  FEATURE_DISABLED: {
    httpsCode: 'failed-precondition',
    message: 'This social feature is not enabled.',
    messageAr: 'هذه الميزة غير متاحة حالياً.',
  },
  CONFLICT: {
    httpsCode: 'already-exists',
    message: 'The requested social relationship conflicts with its current state.',
    messageAr: 'تعارض الطلب مع حالة العلاقة الحالية.',
  },
  NOT_FOUND: {
    httpsCode: 'not-found',
    message: 'The requested social relationship was not found.',
    messageAr: 'لم يعد هذا الطلب أو المستخدم متاحاً.',
  },
  INSUFFICIENT_FUNDS: {
    httpsCode: 'failed-precondition',
    message: 'The wallet balance is insufficient.',
    messageAr: 'رصيد المحفظة غير كافٍ لإتمام الشراء.',
  },
  ITEM_UNAVAILABLE: {
    httpsCode: 'failed-precondition', message: 'This store item is unavailable.', messageAr: 'هذا العنصر غير متاح للشراء حالياً.',
  },
  OUT_OF_STOCK: {
    httpsCode: 'resource-exhausted', message: 'This store item is sold out.', messageAr: 'نفدت كمية هذا العنصر.',
  },
  DUPLICATE_OWNERSHIP: {
    httpsCode: 'already-exists', message: 'You already own this item.', messageAr: 'أنت تملك هذا العنصر بالفعل.',
  },
  REQUEST_CONFLICT: {
    httpsCode: 'already-exists', message: 'This request ID was already used.', messageAr: 'تم استخدام معرّف الطلب لعملية أخرى.',
  },
  INVALID_RECIPIENT: {
    httpsCode: 'invalid-argument', message: 'The gift recipient is invalid.', messageAr: 'معرّف مستلم الهدية غير صالح أو غير متاح.',
  },
  REPRESENTATIVE_REQUIRED: {
    httpsCode: 'permission-denied', message: 'An active representative permission is required.', messageAr: 'هذه العملية متاحة للوكلاء المعتمدين فقط.',
  },
  RATE_LIMITED: {
    httpsCode: 'resource-exhausted',
    message: 'Too many requests. Try again later.',
    messageAr: 'طلبات كثيرة جداً. حاول مرة أخرى لاحقاً.',
  },
  INTERNAL: {
    httpsCode: 'internal',
    message: 'The social command failed.',
    messageAr: 'تعذر تنفيذ الطلب. حاول مرة أخرى.',
  },
});

function createPublicIdCandidate(randomInt = crypto.randomInt) {
  return String(randomInt(PUBLIC_ID_MIN, PUBLIC_ID_MAX + 1));
}

function createDisabledFeatureFlags() {
  return Object.fromEntries(SOCIAL_FEATURE_FLAGS.map((flag) => [flag, false]));
}

function mergeSocialFeatureFlags(existing = {}, updates = {}) {
  const merged = createDisabledFeatureFlags();

  for (const flag of SOCIAL_FEATURE_FLAGS) {
    if (typeof existing[flag] === 'boolean') {
      merged[flag] = existing[flag];
    }

    if (typeof updates[flag] === 'boolean') {
      merged[flag] = updates[flag];
    }
  }

  return merged;
}

function isSupportedCountryCode(value) {
  return typeof value === 'string' && SUPPORTED_COUNTRY_CODES.includes(value);
}

function isValidPublicId(value) {
  return typeof value === 'string' && /^[1-9][0-9]{6}$/.test(value);
}

function isValidSpecialId(value) {
  return typeof value === 'string' && /^[0-9]{7}$/.test(value);
}

function normalizeDisplayName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeSearchName(value) {
  return normalizeDisplayName(value)
    .normalize('NFKC')
    .replace(/[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .toLocaleLowerCase('ar');
}

function validatePrivateProfile(data, uid) {
  if (!data || typeof data !== 'object') {
    return { ok: false, code: 'PROFILE_INCOMPLETE' };
  }

  const displayName = normalizeDisplayName(data.displayName);
  const normalizedName = normalizeSearchName(displayName);

  if (
    data.uid !== uid ||
    typeof data.email !== 'string' ||
    !data.email.trim() ||
    displayName.length < 2 ||
    displayName.length > 32 ||
    normalizedName.length < 2 ||
    normalizedName.length > 64 ||
    typeof data.avatarLabel !== 'string' ||
    [...data.avatarLabel.trim()].length !== 1
  ) {
    return { ok: false, code: 'PROFILE_INCOMPLETE' };
  }

  return {
    ok: true,
    value: {
      avatarLabel: data.avatarLabel.trim(),
      displayName,
      email: data.email.trim(),
      uid,
    },
  };
}

function resolveSocialCommandRequest({ auth, data }) {
  if (!auth?.uid) {
    return { ok: false, code: 'AUTH_REQUIRED' };
  }

  if (!data || typeof data !== 'object') {
    return { ok: false, code: 'INVALID_REQUEST' };
  }

  const action = typeof data.action === 'string' ? data.action.trim() : '';
  const requestId = typeof data.requestId === 'string' ? data.requestId.trim() : '';
  const version = Number(data.version);

  if (
    version !== SOCIAL_COMMAND_VERSION ||
    ![
      'bootstrap-profile',
      'get-readiness',
      'search-users',
      'get-friends',
      'get-friendship-status',
      'send-friend-request',
      'accept-friend-request',
      'decline-friend-request',
      'cancel-friend-request',
      'remove-friend',
      'get-wallet-store',
      'purchase-special-id',
      'get-store-catalog',
      'purchase-store-item',
      'get-my-store-items',
      'equip-store-item',
      'gift-store-item',
      'get-representative-status',
      'create-representative-portal-ticket',
      'get-gift-center',
      'send-gift',
      'get-couples',
      'get-couple-status',
      'send-couple-request',
      'accept-couple-request',
      'decline-couple-request',
      'cancel-couple-request',
      'dissolve-couple',
      'get-notification-settings',
      'register-push-device',
      'unregister-push-device',
      'update-notification-preferences',
    ].includes(action) ||
    !/^[A-Za-z0-9_-]{16,80}$/.test(requestId)
  ) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }

  return {
    ok: true,
    value: {
      action,
      requestId,
      uid: auth.uid,
      version,
      ...(data.payload !== undefined ? { payload: data.payload } : {}),
    },
  };
}

function buildPublicProfileDocument({ existing = {}, privateProfile, publicId, timestamp }) {
  const document = {
    uid: privateProfile.uid,
    publicId,
    displayName: privateProfile.displayName,
    normalizedName: normalizeSearchName(privateProfile.displayName),
    avatarUrl: typeof existing.avatarUrl === 'string' ? existing.avatarUrl.trim().slice(0, 2048) : '',
    countryCode: isSupportedCountryCode(existing.countryCode) ? existing.countryCode : DEFAULT_COUNTRY_CODE,
    bio: typeof existing.bio === 'string' ? existing.bio.trim().slice(0, 160) : '',
    giftScore: readNonNegativeInteger(existing.giftScore),
    friendCount: readNonNegativeInteger(existing.friendCount),
    coupleLevel: readNonNegativeInteger(existing.coupleLevel),
    moderationStatus: ['active', 'suspended', 'removed'].includes(existing.moderationStatus)
      ? existing.moderationStatus
      : 'active',
    avatarModerationStatus: ['clear', 'pending', 'removed'].includes(existing.avatarModerationStatus)
      ? existing.avatarModerationStatus
      : 'clear',
    createdAt: isTimestampLike(existing.createdAt) ? existing.createdAt : timestamp,
    updatedAt: timestamp,
  };

  if (existing.gender === 'male' || existing.gender === 'female') {
    document.gender = existing.gender;
  }

  if (isValidSpecialId(existing.specialId)) {
    document.specialId = existing.specialId;
  }

  if (
    existing.representativeBadge
    && typeof existing.representativeBadge === 'object'
    && typeof existing.representativeBadge.active === 'boolean'
    && isTimestampLike(existing.representativeBadge.updatedAt)
  ) {
    document.representativeBadge = {
      active: existing.representativeBadge.active,
      updatedAt: existing.representativeBadge.updatedAt,
    };
  }

  return document;
}

function buildAdminUserSearchDocument({ privateProfile, timestamp }) {
  return {
    displayName: privateProfile.displayName,
    email: privateProfile.email.toLocaleLowerCase('en'),
    normalizedName: normalizeSearchName(privateProfile.displayName),
    uid: privateProfile.uid,
    updatedAt: timestamp,
  };
}

function inspectPublicProfile(profile, reservation, expectedUid) {
  if (!profile || typeof profile !== 'object') {
    return { ok: false, reason: 'missing-profile' };
  }

  const uid = typeof expectedUid === 'string' && expectedUid ? expectedUid : profile.uid;
  const requiredStringsAreValid = (
    profile.uid === uid
    && isValidPublicId(profile.publicId)
    && typeof profile.displayName === 'string'
    && profile.displayName === normalizeDisplayName(profile.displayName)
    && profile.displayName.length >= 2
    && profile.displayName.length <= 32
    && typeof profile.normalizedName === 'string'
    && profile.normalizedName === normalizeSearchName(profile.displayName)
    && profile.normalizedName.length >= 2
    && profile.normalizedName.length <= 64
    && typeof profile.avatarUrl === 'string'
    && profile.avatarUrl.length <= 2048
    && isSupportedCountryCode(profile.countryCode)
    && typeof profile.bio === 'string'
    && profile.bio.length <= 160
    && (!('specialId' in profile) || isValidSpecialId(profile.specialId))
  );

  if (!requiredStringsAreValid) {
    return { ok: false, reason: 'invalid-profile' };
  }

  if (
    ('gender' in profile && !['male', 'female'].includes(profile.gender))
    || !isNonNegativeInteger(profile.giftScore)
    || !isNonNegativeInteger(profile.friendCount)
    || !isNonNegativeInteger(profile.coupleLevel)
    || !['active', 'suspended', 'removed'].includes(profile.moderationStatus)
    || !['clear', 'pending', 'removed'].includes(profile.avatarModerationStatus)
    || !isTimestampLike(profile.createdAt)
    || !isTimestampLike(profile.updatedAt)
  ) {
    return { ok: false, reason: 'invalid-profile' };
  }

  if (
    !reservation
    || typeof reservation !== 'object'
    || reservation.uid !== uid
    || !isTimestampLike(reservation.createdAt)
  ) {
    return { ok: false, reason: 'invalid-reservation' };
  }

  return { ok: true, reason: 'ready' };
}

function isAdminUserSearchReady(searchDocument, privateProfile) {
  return Boolean(
    searchDocument
    && typeof searchDocument === 'object'
    && searchDocument.uid === privateProfile.uid
    && searchDocument.displayName === privateProfile.displayName
    && searchDocument.email === privateProfile.email.toLocaleLowerCase('en')
    && searchDocument.normalizedName === normalizeSearchName(privateProfile.displayName)
    && isTimestampLike(searchDocument.updatedAt)
  );
}

function isTimestampLike(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && (
      typeof value.toDate === 'function'
      || typeof value.toMillis === 'function'
      || value.__serverTimestamp === true
    )
  );
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function mapProfileBootstrapResult(profile, options = {}) {
  if (!profile || !isValidPublicId(profile.publicId)) {
    return {
      created: false,
      provisioned: false,
      publicId: '',
      repaired: false,
    };
  }

  return {
    created: options.created === true,
    provisioned: true,
    publicId: profile.publicId,
    repaired: options.repaired === true,
  };
}

function readNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function socialError(code) {
  const definition = SOCIAL_ERRORS[code] || SOCIAL_ERRORS.INTERNAL;
  return {
    code: SOCIAL_ERRORS[code] ? code : 'INTERNAL',
    ...definition,
  };
}

module.exports = {
  DEFAULT_COUNTRY_CODE,
  PUBLIC_ID_MAX,
  PUBLIC_ID_MIN,
  SOCIAL_COMMAND_VERSION,
  SOCIAL_ERRORS,
  SOCIAL_FEATURE_FLAGS,
  SUPPORTED_COUNTRY_CODES,
  buildPublicProfileDocument,
  buildAdminUserSearchDocument,
  createDisabledFeatureFlags,
  createPublicIdCandidate,
  inspectPublicProfile,
  isAdminUserSearchReady,
  isSupportedCountryCode,
  isTimestampLike,
  isValidPublicId,
  isValidSpecialId,
  mapProfileBootstrapResult,
  mergeSocialFeatureFlags,
  normalizeDisplayName,
  normalizeSearchName,
  resolveSocialCommandRequest,
  socialError,
  validatePrivateProfile,
};
