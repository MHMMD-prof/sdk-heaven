export type RoomEffectKind = 'room-entry' | 'room-gift' | 'room-rocket';

export type RoomEffectViewerMode = 'full' | 'reduced' | 'off';
export type RoomEffectPresentation = 'visual' | 'compact';
export type RoomGiftPresentationTier = 'inline' | 'targeted' | 'major' | 'global';

export type QueuedRoomEffect = {
  assetId?: string;
  assetVersionId?: string;
  comboCount?: number;
  comboKey?: string;
  comboSequence?: number;
  durationMs: number;
  eventId: string;
  expiresAtMs: number;
  kind: RoomEffectKind;
  label: string;
  occurredAtMs?: number;
  presentation?: RoomEffectPresentation;
  priority: number;
  quantity?: number;
  queuedAtMs?: number;
  recipientDisplayName?: string;
  recipientUid?: string;
  senderDisplayName?: string;
  senderUid?: string;
  giftPresentationTier?: RoomGiftPresentationTier;
  hapticPolicy?: 'off' | 'light' | 'success';
  animationEnabled?: boolean;
  audioEnabled?: boolean;
  soundUrl?: string;
  thumbnailUrl?: string;
  visualFormat?: 'lottie-json' | 'mp4';
};

export type RoomEventMappingOptions = {
  blockedUids?: ReadonlySet<string>;
  enabledKinds?: ReadonlySet<RoomEffectKind>;
  expectedRoomId?: string;
  globalEvent?: boolean;
  viewerCountryCode?: string;
  viewerRoomVisibility?: 'public' | 'private' | string;
};

export const MAX_ROOM_EFFECT_QUEUE = 8;
export const DEFAULT_ENTRY_EFFECT_DURATION_MS = 4_000;
export const DEFAULT_GIFT_EFFECT_DURATION_MS = 3_000;
export const DEFAULT_ROCKET_EFFECT_DURATION_MS = 5_000;
export const ROCKET_EFFECT_DELIVERY_GRACE_MS = 15_000;

export function resolveViewerEffectMode(input: {
  appReducedMotion?: boolean;
  lowMemory?: boolean;
  roomEffectsPolicy?: RoomEffectViewerMode | string;
}): RoomEffectViewerMode {
  if (input.roomEffectsPolicy === 'off') return 'off';
  if (input.roomEffectsPolicy === 'reduced' || input.appReducedMotion || input.lowMemory) {
    return 'reduced';
  }
  return 'full';
}

export function enqueueRoomEffect(
  queue: QueuedRoomEffect[],
  next: QueuedRoomEffect,
  nowMs = Date.now(),
): QueuedRoomEffect[] {
  const active = queue.filter((item) => item.expiresAtMs > nowMs && item.eventId !== next.eventId);
  if (next.expiresAtMs <= nowMs) return active;
  const comboIndex = next.kind === 'room-gift' && next.comboKey
    ? active.findIndex((item) => item.kind === 'room-gift' && item.comboKey === next.comboKey)
    : -1;
  const combined = comboIndex >= 0
    ? active.map((item, index) => index === comboIndex ? mergeComboEffect(item, next, nowMs) : item)
    : [...active, { ...next, queuedAtMs: next.queuedAtMs || nowMs }];
  const merged = combined.sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority;
    return left.expiresAtMs - right.expiresAtMs;
  });
  return merged.slice(0, MAX_ROOM_EFFECT_QUEUE);
}

export function isRoomEffectComboUpdate(
  queue: QueuedRoomEffect[],
  next: QueuedRoomEffect,
) {
  return next.kind === 'room-gift'
    && Boolean(next.comboKey)
    && queue.some((item) => item.kind === 'room-gift' && item.comboKey === next.comboKey);
}

export function removeRoomEffect(queue: QueuedRoomEffect[], eventId: string) {
  return queue.filter((item) => item.eventId !== eventId);
}

export function selectActiveRoomEffect(
  queue: QueuedRoomEffect[],
  viewerMode: RoomEffectViewerMode,
  nowMs = Date.now(),
): QueuedRoomEffect | null {
  const active = queue.filter((item) => item.expiresAtMs > nowMs);
  const selected = viewerMode === 'off'
    ? active.find((item) => item.kind === 'room-gift')
    : active[0];
  if (!selected) return null;
  if (viewerMode !== 'full') {
    return { ...selected, presentation: 'compact', soundUrl: undefined, thumbnailUrl: undefined };
  }
  return { ...selected, presentation: 'visual' };
}

export function mapRoomEventDocument(
  data: unknown,
  nowMs = Date.now(),
  options: RoomEventMappingOptions = {},
): QueuedRoomEffect | null {
  if (!isRecord(data)) return null;
  const candidate = data;
  const isRocket = candidate.type === 'rocket-goal-crossed';
  if (!isRocket && candidate.status !== 'ready') return null;
  const payload = isRecord(candidate.payload) ? candidate.payload : {};
  const kind: RoomEffectKind | null = isRocket
    ? 'room-rocket'
    : candidate.kind === 'room-entry' || candidate.kind === 'room-gift'
      ? candidate.kind
      : null;
  if (!kind || (options.enabledKinds && !options.enabledKinds.has(kind))) return null;
  if (options.globalEvent) {
    const audience = isRecord(payload.globalAudience) ? payload.globalAudience : {};
    const visibilities = Array.isArray(audience.allowedRoomVisibilities)
      ? audience.allowedRoomVisibilities.filter((value): value is string => typeof value === 'string')
      : [];
    const countryCodes = Array.isArray(audience.countryCodes)
      ? audience.countryCodes.filter((value): value is string => typeof value === 'string')
      : [];
    if (!visibilities.includes(String(options.viewerRoomVisibility))) return null;
    if (countryCodes.length > 0 && !countryCodes.includes(String(options.viewerCountryCode).toUpperCase())) return null;
  }
  if (
    !options.globalEvent
    && options.expectedRoomId
    && candidate.roomId !== options.expectedRoomId
    && payload.roomId !== options.expectedRoomId
  ) return null;
  const eventId = typeof candidate.eventId === 'string'
    ? candidate.eventId
    : (typeof payload.eventId === 'string' ? payload.eventId : '');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/.test(eventId)) return null;

  const appearance = isRecord(candidate.appearance) ? candidate.appearance : {};
  const animationAsset = isRecord(appearance.animationAsset) ? appearance.animationAsset : {};
  const staticAsset = isRecord(appearance.staticAsset) ? appearance.staticAsset : {};
  const soundAsset = isRecord(appearance.soundAsset) ? appearance.soundAsset : {};
  const occurredAtMs = readMillis(candidate.occurredAt);
  const eventOccurredAtMs = occurredAtMs || readMillis(candidate.createdAt);
  const rocketDuration = clampDuration(
    Number(animationAsset.durationMs),
    500,
    12_000,
    DEFAULT_ROCKET_EFFECT_DURATION_MS,
  );
  const expiresAtMs = isRocket
    ? occurredAtMs + rocketDuration + ROCKET_EFFECT_DELIVERY_GRACE_MS
    : readMillis(payload.expiresAtMs) || readMillis(candidate.expiresAt);
  if (!expiresAtMs || expiresAtMs <= nowMs) return null;

  const senderUid = readShortString(payload.senderUid || candidate.uid, 128);
  if (senderUid && options.blockedUids?.has(senderUid)) return null;
  const priorityValue = Number.isInteger(candidate.priority)
    ? Number(candidate.priority)
    : (Number.isInteger(payload.priority) ? Number(payload.priority) : 1);
  const priority = Math.min(4, Math.max(0, priorityValue));
  const displayName = readShortString(payload.displayName, 40) || 'عضو';
  const appearanceName = isRecord(appearance.name) ? readShortString(appearance.name.ar, 80) : '';
  const nameAr = appearanceName
    || readShortString(payload.nameAr, 80)
    || (kind === 'room-entry' ? 'مركبة' : kind === 'room-rocket' ? 'اكتمل صاروخ الغرفة' : 'هدية');
  const rawDuration = Number(payload.durationMs);
  const durationMs = kind === 'room-entry'
    ? clampDuration(rawDuration, 3_000, 5_000, DEFAULT_ENTRY_EFFECT_DURATION_MS)
    : kind === 'room-rocket'
      ? rocketDuration
      : clampDuration(rawDuration, 1_500, 6_000, DEFAULT_GIFT_EFFECT_DURATION_MS);
  const rawThumbnail = readShortString(
    isRocket
      ? animationAsset.uri || staticAsset.uri
      : payload.thumbnailUrl || payload.fallbackArtworkUrl,
    2_048,
  );
  const thumbnailUrl = rawThumbnail && /^https:\/\/[^\s]{1,2039}$/.test(rawThumbnail)
    ? rawThumbnail
    : undefined;
  const rawSound = readShortString(isRocket ? soundAsset.uri : undefined, 2_048);
  const soundUrl = rawSound && /^https:\/\/[^\s]{1,2039}$/.test(rawSound)
    ? rawSound
    : undefined;
  const assetCandidate = payload.animationEnabled !== false && isRecord(payload.cosmeticAsset)
    ? payload.cosmeticAsset
    : (isRecord(appearance.cosmeticAsset) ? appearance.cosmeticAsset : {});
  const assetId = readShortString(assetCandidate.assetId, 80);
  const assetVersionId = readShortString(assetCandidate.assetVersionId, 32);
  const hasCanonicalAsset = /^[a-z0-9][a-z0-9_-]{2,79}$/.test(assetId)
    && /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/.test(assetVersionId);
  const comboKey = kind === 'room-gift'
    ? readShortString(payload.comboKey, 128)
    : '';
  const comboCount = Number.isSafeInteger(payload.comboCount)
    ? Math.min(999, Math.max(1, Number(payload.comboCount)))
    : 1;
  const comboSequence = Number.isSafeInteger(payload.comboSequence)
    ? Math.min(1_000_000_000, Math.max(1, Number(payload.comboSequence)))
    : undefined;
  const giftPresentationTier = kind === 'room-gift'
    && ['inline', 'targeted', 'major', 'global'].includes(String(payload.presentationTier))
    ? payload.presentationTier as RoomGiftPresentationTier
    : kind === 'room-gift' ? 'inline' : undefined;
  const quantity = Number.isSafeInteger(payload.quantity)
    ? Math.min(20, Math.max(1, Number(payload.quantity)))
    : undefined;
  const recipientUid = readShortString(payload.recipientUid, 128);
  const recipientDisplayName = readShortString(payload.recipientDisplayName, 80);
  const senderDisplayName = readShortString(payload.senderDisplayName, 80);
  const hapticPolicy = ['off', 'light', 'success'].includes(String(payload.hapticPolicy))
    ? payload.hapticPolicy as 'off' | 'light' | 'success'
    : 'off';
  const visualFormat = kind === 'room-entry' && ['lottie-json', 'mp4'].includes(String(payload.visualFormat))
    ? payload.visualFormat as 'lottie-json' | 'mp4'
    : undefined;
  return {
    ...(hasCanonicalAsset ? { assetId, assetVersionId } : {}),
    ...(comboKey && /^[A-Za-z0-9][A-Za-z0-9:_-]{2,127}$/.test(comboKey)
      ? { comboCount, comboKey, ...(comboSequence ? { comboSequence } : {}) }
      : {}),
    animationEnabled: payload.animationEnabled === true,
    audioEnabled: payload.audioEnabled === true,
    durationMs,
    eventId,
    expiresAtMs,
    ...(giftPresentationTier ? { giftPresentationTier } : {}),
    hapticPolicy,
    kind,
    label: kind === 'room-entry'
      ? `${displayName} — ${nameAr}`
      : kind === 'room-gift' && (senderDisplayName || recipientDisplayName)
        ? `${senderDisplayName || 'عضو'} أرسل ${nameAr}${quantity && quantity > 1 ? ` ×${quantity}` : ''} إلى ${recipientDisplayName || 'عضو'}`
        : nameAr,
    ...(eventOccurredAtMs ? { occurredAtMs: eventOccurredAtMs } : {}),
    priority: kind === 'room-rocket' ? 4 : priority,
    ...(quantity ? { quantity } : {}),
    recipientDisplayName,
    recipientUid,
    senderDisplayName,
    senderUid,
    soundUrl,
    thumbnailUrl,
    ...(visualFormat ? { visualFormat } : {}),
  };
}

function mergeComboEffect(
  current: QueuedRoomEffect,
  next: QueuedRoomEffect,
  nowMs: number,
): QueuedRoomEffect {
  const comboCount = next.comboSequence !== undefined
    ? Math.max(current.comboCount || 1, next.comboCount || 1)
    : Math.min(999, (current.comboCount || 1) + (next.comboCount || 1));
  const baseLabel = next.label.replace(/\s×\d+$/, '');
  return {
    ...current,
    ...(next.assetId && next.assetVersionId
      ? { assetId: next.assetId, assetVersionId: next.assetVersionId }
      : {}),
    comboCount,
    comboSequence: Math.max(current.comboSequence || 0, next.comboSequence || 0) || undefined,
    durationMs: Math.max(current.durationMs, next.durationMs),
    expiresAtMs: Math.max(current.expiresAtMs, next.expiresAtMs),
    label: `${baseLabel} ×${comboCount}`,
    priority: Math.max(current.priority, next.priority),
    queuedAtMs: current.queuedAtMs || nowMs,
    soundUrl: next.soundUrl || current.soundUrl,
    thumbnailUrl: next.thumbnailUrl || current.thumbnailUrl,
    quantity: next.quantity || current.quantity,
    recipientDisplayName: next.recipientDisplayName || current.recipientDisplayName,
    recipientUid: next.recipientUid || current.recipientUid,
    senderDisplayName: next.senderDisplayName || current.senderDisplayName,
  };
}

function clampDuration(value: number, minimum: number, maximum: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function readShortString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function readMillis(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (isRecord(value) && typeof value.toMillis === 'function') {
    return Number((value.toMillis as () => unknown)()) || 0;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
