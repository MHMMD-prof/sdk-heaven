const GIFT_CATALOG_LIMIT = 30;
const { readPublicAvatarFrameProjection } = require('./avatarFrameProjectionCore');
const {
  buildLegacyGiftPresentation,
  createGiftPhysicalApprovalReceiptId,
  mapGiftPresentation,
} = require('./roomGiftPresentationCore');
const { mapGiftTheater } = require('./giftTheaterCore');
const GIFT_HISTORY_LIMIT = 20;
const GIFT_KINDS = Object.freeze(['rose', 'crown', 'diamond', 'heart', 'star']);

function normalizeGiftCenterInput(input, uid) {
  if (input === undefined) return { ok: true, value: { targetUid: '' } };
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => key !== 'targetUid')) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const targetUid = typeof input.targetUid === 'string' ? input.targetUid.trim() : '';
  if (!targetUid || targetUid === uid || targetUid.length > 128) return { ok: false, code: 'INVALID_REQUEST' };
  return { ok: true, value: { targetUid } };
}

function normalizeSendGiftInput(input, uid) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'INVALID_REQUEST' };
  if (Object.keys(input).some((key) => !['giftId', 'message', 'targetUid'].includes(key))) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  const giftId = typeof input.giftId === 'string' ? input.giftId.trim() : '';
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  const targetUid = typeof input.targetUid === 'string' ? input.targetUid.trim() : '';
  if (!/^[a-z0-9_-]{2,40}$/.test(giftId) || !targetUid || targetUid === uid || targetUid.length > 128 || message.length > 80) {
    return { ok: false, code: 'INVALID_REQUEST' };
  }
  return { ok: true, value: { giftId, message, targetUid } };
}

function mapGiftCatalogItem(data) {
  if (!data || typeof data !== 'object') return undefined;
  const giftId = typeof data.giftId === 'string' ? data.giftId.trim() : '';
  const nameAr = typeof data.nameAr === 'string' ? data.nameAr.trim() : '';
  if (!/^[a-z0-9_-]{2,40}$/.test(giftId) || nameAr.length < 2 || nameAr.length > 32) return undefined;
  if (!GIFT_KINDS.includes(data.iconKey) || !['available', 'disabled'].includes(data.status)) return undefined;
  if (!Number.isSafeInteger(data.price) || data.price < 1 || !Number.isSafeInteger(data.scoreValue) || data.scoreValue < 1) return undefined;
  const presentation = data.presentation === undefined
    ? buildLegacyGiftPresentation()
    : mapGiftPresentation(data.presentation);
  if (!presentation) return undefined;
  const theater = mapGiftTheater(data.theater);
  if (!theater) return undefined;
  return {
    giftId,
    iconKey: data.iconKey,
    nameAr,
    price: data.price,
    presentation,
    scoreValue: data.scoreValue,
    status: data.status,
    theater,
  };
}

function mapGiftEvent(document) {
  const data = document?.data?.() || document;
  if (!data || typeof data !== 'object') return undefined;
  const giftId = typeof data.giftId === 'string' ? data.giftId.trim() : '';
  const senderUid = typeof data.senderUid === 'string' ? data.senderUid.trim() : '';
  const recipientUid = typeof data.recipientUid === 'string' ? data.recipientUid.trim() : '';
  if (!giftId || !senderUid || !recipientUid) return undefined;
  return {
    createdAt: data.createdAt,
    eventId: typeof document?.id === 'string' ? document.id : (typeof data.eventId === 'string' ? data.eventId : ''),
    giftId,
    iconKey: GIFT_KINDS.includes(data.iconKey) ? data.iconKey : 'star',
    message: typeof data.message === 'string' ? data.message.slice(0, 80) : '',
    nameAr: typeof data.nameAr === 'string' ? data.nameAr.slice(0, 32) : '',
    price: readNonNegativeInteger(data.price),
    recipientDisplayName: typeof data.recipientDisplayName === 'string' ? data.recipientDisplayName.slice(0, 32) : '',
    ...(readPublicAvatarFrameProjection({
      equippedAvatarFrame: data.recipientAvatarFrame,
      equippedCosmetics: { avatarFrame: data.recipientAvatarFrame?.canonicalAsset ? { ...data.recipientAvatarFrame.canonicalAsset, itemId: data.recipientAvatarFrame.itemId } : undefined },
    }) ? { recipientAvatarFrame: data.recipientAvatarFrame } : {}),
    recipientUid,
    scoreValue: readNonNegativeInteger(data.scoreValue),
    senderDisplayName: typeof data.senderDisplayName === 'string' ? data.senderDisplayName.slice(0, 32) : '',
    ...(readPublicAvatarFrameProjection({
      equippedAvatarFrame: data.senderAvatarFrame,
      equippedCosmetics: { avatarFrame: data.senderAvatarFrame?.canonicalAsset ? { ...data.senderAvatarFrame.canonicalAsset, itemId: data.senderAvatarFrame.itemId } : undefined },
    }) ? { senderAvatarFrame: data.senderAvatarFrame } : {}),
    senderUid,
  };
}

function normalizeAdminGiftCatalogInput(input) {
  const expectedUpdatedAt = typeof input?.expectedUpdatedAt === 'string' ? input.expectedUpdatedAt.trim().slice(0, 80) : '';
  const reason = typeof input?.reason === 'string' ? input.reason.trim().slice(0, 300) : '';
  const requestId = typeof input?.requestId === 'string' ? input.requestId.trim() : '';
  const rawPresentation = normalizeAdminGiftPresentationInput(input?.presentation, input);
  if (!rawPresentation.ok) return rawPresentation;
  const item = mapGiftCatalogItem({
    giftId: typeof input?.giftId === 'string' ? input.giftId.trim() : '',
    iconKey: input?.iconKey,
    nameAr: typeof input?.nameAr === 'string' ? input.nameAr.trim() : '',
    price: Number(input?.price),
    scoreValue: Number(input?.scoreValue),
    status: input?.status,
    theater: input?.theater,
    presentation: rawPresentation.value,
  });
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(requestId) || reason.length < 2 || !item) {
    return { ok: false, error: 'Valid requestId and gift catalog fields are required.' };
  }
  return {
    ok: true,
    value: {
      ...item,
      expectedUpdatedAt,
      ...(rawPresentation.physicalApproval ? { physicalApproval: rawPresentation.physicalApproval } : {}),
      reason,
      requestId,
    },
  };
}

function normalizeAdminGiftPresentationInput(value, input) {
  if (value === undefined || value === null) return { ok: true, value: buildLegacyGiftPresentation() };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Gift presentation is invalid.' };
  }
  const animationEnabled = value.animationEnabled === true;
  const existingReceiptId = typeof value.physicalApprovalReceiptId === 'string'
    ? value.physicalApprovalReceiptId.trim()
    : '';
  const requestedMode = typeof value.approvalMode === 'string' ? value.approvalMode.trim() : '';
  if (animationEnabled && requestedMode && requestedMode !== 'strict') {
    return { ok: false, error: 'New animated gifts require strict physical approval.' };
  }
  const approvalMode = animationEnabled ? 'strict' : undefined;
  const reuseExistingReceipt = animationEnabled
    && input?.reusePhysicalApprovalReceipt === true
    && Boolean(existingReceiptId);
  const generatedReceiptId = animationEnabled
    ? createGiftPhysicalApprovalReceiptId(
      typeof input?.giftId === 'string' ? input.giftId.trim() : '',
      typeof value?.visualAsset?.assetVersionId === 'string' ? value.visualAsset.assetVersionId.trim() : '',
      value,
    )
    : '';
  const presentation = mapGiftPresentation({
    ...value,
    animationEnabled,
    ...(approvalMode ? { approvalMode } : {}),
    physicalApprovalReceiptId: approvalMode
      ? (reuseExistingReceipt ? existingReceiptId : generatedReceiptId)
      : undefined,
    schemaVersion: 1,
  });
  if (!presentation) return { ok: false, error: 'Gift presentation fields are invalid.' };
  if (!animationEnabled) {
    return { ok: true, value: presentation };
  }
  const reusesReceipt = reuseExistingReceipt;
  const androidDevice = typeof input?.physicalApproval?.androidDevice === 'string'
    ? input.physicalApproval.androidDevice.trim().slice(0, 120)
    : '';
  const iosDevice = typeof input?.physicalApproval?.iosDevice === 'string'
    ? input.physicalApproval.iosDevice.trim().slice(0, 120)
    : '';
  const testedClientVersion = typeof input?.physicalApproval?.testedClientVersion === 'string'
    ? input.physicalApproval.testedClientVersion.trim()
    : '';
  if (animationEnabled && !reusesReceipt && (
    input?.physicalApproval?.androidPassed !== true
    || input?.physicalApproval?.iosPassed !== true
    || input?.physicalApproval?.controlsSafeZonePassed !== true
    || androidDevice.length < 2
    || iosDevice.length < 2
    || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(testedClientVersion)
  )) {
    return { ok: false, error: 'Android and iOS physical approval are required for strict animated gifts.' };
  }
  const notes = typeof input?.physicalApproval?.notes === 'string'
    ? input.physicalApproval.notes.trim().slice(0, 500)
    : '';
  return {
    ok: true,
    value: presentation,
    ...(animationEnabled && !reusesReceipt ? {
      physicalApproval: {
        androidPassed: true,
        androidDevice,
        controlsSafeZonePassed: true,
        iosPassed: true,
        iosDevice,
        notes,
        testedClientVersion,
      },
    } : {}),
  };
}

function readNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function isExpectedAdminGiftRevisionCurrent(expectedUpdatedAt, currentUpdatedAt) {
  return !expectedUpdatedAt || expectedUpdatedAt === currentUpdatedAt;
}

module.exports = {
  GIFT_CATALOG_LIMIT,
  GIFT_HISTORY_LIMIT,
  GIFT_KINDS,
  isExpectedAdminGiftRevisionCurrent,
  mapGiftCatalogItem,
  mapGiftEvent,
  normalizeAdminGiftCatalogInput,
  normalizeGiftCenterInput,
  normalizeSendGiftInput,
};
