'use strict';

const ROOM_EFFECT_COPY_TEMPLATE_VERSION = 1;

function buildEntryEffectCopySnapshot({ displayName, itemNameAr, itemNameEn }) {
  return {
    entrantDisplayNames: [cleanText(displayName, 40) || 'عضو'],
    itemName: localizedItem(itemNameAr, itemNameEn),
    kind: 'entry',
    schemaVersion: ROOM_EFFECT_COPY_TEMPLATE_VERSION,
  };
}

function buildCoupleEntryCopySnapshot({ memberDisplayNames }) {
  const names = Array.isArray(memberDisplayNames)
    ? memberDisplayNames.map((name) => cleanText(name, 40)).filter(Boolean).slice(0, 2)
    : [];
  return {
    entrantDisplayNames: names.length === 2 ? names : ['عضو', 'عضو'],
    kind: 'couple-entry',
    schemaVersion: ROOM_EFFECT_COPY_TEMPLATE_VERSION,
  };
}

function buildGiftEffectCopySnapshot({
  giftNameAr,
  giftNameEn,
  quantity,
  recipientDisplayName,
  senderDisplayName,
}) {
  return {
    itemName: localizedItem(giftNameAr, giftNameEn),
    kind: 'gift',
    quantity: Number.isSafeInteger(quantity) ? Math.min(999, Math.max(1, quantity)) : 1,
    recipientDisplayName: cleanText(recipientDisplayName, 80),
    schemaVersion: ROOM_EFFECT_COPY_TEMPLATE_VERSION,
    senderDisplayName: cleanText(senderDisplayName, 80),
  };
}

function resolveRoomEffectSurface(kind, giftTier = '') {
  if (kind === 'room-entry') return 'bottom-stage';
  if (kind === 'room-rocket') return 'full-overlay';
  if (kind !== 'room-gift') return 'compact';
  if (giftTier === 'targeted') return 'target-seat';
  if (giftTier === 'major' || giftTier === 'global') return 'bottom-stage';
  return 'compact';
}

function localizedItem(ar, en) {
  const arName = cleanText(ar, 80);
  const enName = cleanText(en, 80);
  return {
    ...(arName ? { ar: arName } : {}),
    ...(enName ? { en: enName } : {}),
  };
}

function cleanText(value, maximum) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';
}

module.exports = {
  ROOM_EFFECT_COPY_TEMPLATE_VERSION,
  buildCoupleEntryCopySnapshot,
  buildEntryEffectCopySnapshot,
  buildGiftEffectCopySnapshot,
  resolveRoomEffectSurface,
};
