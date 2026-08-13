export const ROOM_EFFECT_COPY_TEMPLATE_VERSION = 1 as const;

export type RoomEffectCopyLocale = 'ar' | 'en';
export type RoomEffectSurface = 'bottom-stage' | 'compact' | 'full-overlay' | 'target-seat';
export type RoomGiftPresentationTier = 'inline' | 'targeted' | 'major' | 'global';

type LocalizedItemName = {
  ar?: string;
  en?: string;
};

export type RoomEffectCopyInput =
  | {
    entrantDisplayNames: string[];
    itemName?: LocalizedItemName;
    kind: 'entry' | 'couple-entry';
    schemaVersion: typeof ROOM_EFFECT_COPY_TEMPLATE_VERSION;
  }
  | {
    itemName?: LocalizedItemName;
    kind: 'gift';
    quantity: number;
    recipientDisplayName: string;
    schemaVersion: typeof ROOM_EFFECT_COPY_TEMPLATE_VERSION;
    senderDisplayName: string;
  };

export function buildRoomEffectCopy(
  input: RoomEffectCopyInput,
  locale: RoomEffectCopyLocale = 'ar',
) {
  const member = locale === 'ar' ? 'عضو' : 'Member';
  const item = localizedItemName(input.itemName, locale)
    || (locale === 'ar' ? input.kind === 'gift' ? 'هدية' : 'مؤثر الدخول' : input.kind === 'gift' ? 'gift' : 'entry effect');
  if (input.kind === 'gift') {
    const sender = cleanText(input.senderDisplayName, 80) || member;
    const recipient = cleanText(input.recipientDisplayName, 80) || member;
    const quantity = Math.min(999, Math.max(1, Math.round(input.quantity || 1)));
    const count = quantity > 1 ? ` ×${quantity}` : '';
    return locale === 'ar'
      ? `${sender} أرسل ${item}${count} إلى ${recipient}`
      : `${sender} sent ${item}${count} to ${recipient}`;
  }

  const entrants = input.entrantDisplayNames
    .map((name) => cleanText(name, 40))
    .filter(Boolean)
    .slice(0, 2);
  if (input.kind === 'couple-entry') {
    const first = entrants[0] || member;
    const second = entrants[1] || member;
    return locale === 'ar'
      ? `${first} و${second} دخلا إلى الغرفة معًا`
      : `${first} and ${second} entered the room together`;
  }
  const entrant = entrants[0] || member;
  return locale === 'ar'
    ? `${entrant} دخل إلى الغرفة باستخدام ${item}`
    : `${entrant} entered the room using ${item}`;
}

export function normalizeRoomEffectCopyInput(value: unknown): RoomEffectCopyInput | undefined {
  if (!isRecord(value) || value.schemaVersion !== ROOM_EFFECT_COPY_TEMPLATE_VERSION) return undefined;
  const itemName = normalizeItemName(value.itemName);
  if (value.kind === 'gift') {
    const quantity = Number(value.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) return undefined;
    return {
      ...(itemName ? { itemName } : {}),
      kind: 'gift',
      quantity,
      recipientDisplayName: cleanText(value.recipientDisplayName, 80),
      schemaVersion: ROOM_EFFECT_COPY_TEMPLATE_VERSION,
      senderDisplayName: cleanText(value.senderDisplayName, 80),
    };
  }
  if (value.kind !== 'entry' && value.kind !== 'couple-entry') return undefined;
  if (!Array.isArray(value.entrantDisplayNames)) return undefined;
  const entrantDisplayNames = value.entrantDisplayNames
    .map((name) => cleanText(name, 40))
    .filter(Boolean);
  if (
    (value.kind === 'entry' && entrantDisplayNames.length !== 1)
    || (value.kind === 'couple-entry' && entrantDisplayNames.length !== 2)
  ) return undefined;
  return {
    entrantDisplayNames,
    ...(itemName ? { itemName } : {}),
    kind: value.kind,
    schemaVersion: ROOM_EFFECT_COPY_TEMPLATE_VERSION,
  };
}

export function resolveRoomEffectSurface(
  kind: 'room-entry' | 'room-gift' | 'room-rocket',
  giftTier?: RoomGiftPresentationTier,
): RoomEffectSurface {
  if (kind === 'room-entry') return 'bottom-stage';
  if (kind === 'room-rocket') return 'full-overlay';
  if (giftTier === 'targeted') return 'target-seat';
  if (giftTier === 'major' || giftTier === 'global') return 'bottom-stage';
  return 'compact';
}

function normalizeItemName(value: unknown): LocalizedItemName | undefined {
  if (!isRecord(value)) return undefined;
  const ar = cleanText(value.ar, 80);
  const en = cleanText(value.en, 80);
  return ar || en ? { ...(ar ? { ar } : {}), ...(en ? { en } : {}) } : undefined;
}

function localizedItemName(value: LocalizedItemName | undefined, locale: RoomEffectCopyLocale) {
  if (!value) return '';
  return cleanText(value[locale], 80)
    || cleanText(locale === 'ar' ? value.en : value.ar, 80);
}

function cleanText(value: unknown, maximum: number) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
