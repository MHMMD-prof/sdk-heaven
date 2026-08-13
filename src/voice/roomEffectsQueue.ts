import {
  buildRoomEffectCopy,
  normalizeRoomEffectCopyInput,
  resolveRoomEffectSurface,
  type RoomEffectCopyInput,
  type RoomEffectSurface,
  type RoomGiftPresentationTier,
} from './roomEffectPresentation';

export type RoomEffectKind = 'room-entry' | 'room-gift' | 'room-rocket';

export type RoomEffectViewerMode = 'full' | 'reduced' | 'off';
export type RoomEffectPresentation = 'visual' | 'compact';
export type { RoomGiftPresentationTier } from './roomEffectPresentation';

export type QueuedRoomEffect = {
  assetId?: string;
  assetVersionId?: string;
  comboCount?: number;
  comboKey?: string;
  comboSequence?: number;
  comboWindowExpiresAtMs?: number;
  comboWindowId?: string;
  copy?: RoomEffectCopyInput;
  coupleEntrance?: boolean;
  coupleAssetFormat?: 'png' | 'lottie-json';
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
  surface?: RoomEffectSurface;
  giftPresentationTier?: RoomGiftPresentationTier;
  giftId?: string;
  hapticPolicy?: 'off' | 'light' | 'success';
  luckyOutcome?: {
    kind: 'none' | 'display-crumb';
    labelAr: string;
    oddsLabelAr: string;
  };
  magicFrame?: {
    accentColor: string;
    labelAr: string;
    templateId: string;
  };
  fallbackAssetId?: string;
  fallbackAssetVersionId?: string;
  participantUids?: string[];
  animationEnabled?: boolean;
  audioEnabled?: boolean;
  customSource?: boolean;
  statusSource?: boolean;
  soundUrl?: string;
  theaterKind?: 'standard' | 'combo' | 'storm' | 'lucky' | 'magic';
  thumbnailUrl?: string;
  posterUrl?: string;
  visualFormat?: 'lottie-json' | 'mp4' | 'animated-webp';
};

export type RoomEventMappingOptions = {
  blockedUids?: ReadonlySet<string>;
  coupleEntrancesEnabled?: boolean;
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

export type RoomEffectEnqueueOutcome = {
  comboUpdate: boolean;
  dropped: Array<{ effect: QueuedRoomEffect; reason: 'expired' | 'priority-cap' }>;
  queue: QueuedRoomEffect[];
};

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
    ? active.findIndex((item) => areRoomGiftComboEffectsCompatible(item, next))
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

export function enqueueRoomEffectWithOutcome(
  queue: QueuedRoomEffect[],
  next: QueuedRoomEffect,
  nowMs = Date.now(),
): RoomEffectEnqueueOutcome {
  const eligible = queue.filter((item) => item.expiresAtMs > nowMs && item.eventId !== next.eventId);
  const comboUpdate = next.expiresAtMs > nowMs && isRoomEffectComboUpdate(eligible, next);
  const result = enqueueRoomEffect(queue, next, nowMs);
  const dropped: RoomEffectEnqueueOutcome['dropped'] = [];
  for (const effect of queue) {
    if (effect.eventId === next.eventId) continue;
    if (effect.expiresAtMs <= nowMs) {
      dropped.push({ effect, reason: 'expired' });
    } else if (!result.some((queued) => queued.eventId === effect.eventId)) {
      dropped.push({ effect, reason: 'priority-cap' });
    }
  }
  if (
    next.expiresAtMs <= nowMs
    || (!comboUpdate && !result.some((effect) => effect.eventId === next.eventId))
  ) {
    dropped.push({
      effect: next,
      reason: next.expiresAtMs <= nowMs ? 'expired' : 'priority-cap',
    });
  }
  return { comboUpdate, dropped, queue: result };
}

export function isRoomEffectComboUpdate(
  queue: QueuedRoomEffect[],
  next: QueuedRoomEffect,
) {
  return next.kind === 'room-gift'
    && Boolean(next.comboKey)
    && queue.some((item) => areRoomGiftComboEffectsCompatible(item, next));
}

export function areRoomGiftComboEffectsCompatible(
  current: QueuedRoomEffect,
  next: QueuedRoomEffect,
) {
  if (
    current.kind !== 'room-gift'
    || next.kind !== 'room-gift'
    || !current.comboKey
    || current.comboKey !== next.comboKey
    || (current.giftId || '') !== (next.giftId || '')
    || (current.senderUid || '') !== (next.senderUid || '')
    || (current.recipientUid || '') !== (next.recipientUid || '')
    || current.giftPresentationTier !== next.giftPresentationTier
    || current.surface !== next.surface
    || (current.assetId || '') !== (next.assetId || '')
    || (current.assetVersionId || '') !== (next.assetVersionId || '')
    || current.animationEnabled !== next.animationEnabled
    || current.audioEnabled !== next.audioEnabled
  ) return false;
  if (current.comboWindowId && next.comboWindowId) {
    return current.comboWindowId === next.comboWindowId;
  }
  return true;
}

export function removeRoomEffect(queue: QueuedRoomEffect[], eventId: string) {
  return queue.filter((item) => item.eventId !== eventId);
}

export function completeRoomEffectIfActive(
  queue: QueuedRoomEffect[],
  eventId: string,
  viewerMode: RoomEffectViewerMode,
  nowMs = Date.now(),
) {
  const active = selectActiveRoomEffect(queue, viewerMode, nowMs);
  return active?.eventId === eventId ? removeRoomEffect(queue, eventId) : queue;
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
    return { ...selected, presentation: 'compact', posterUrl: undefined, soundUrl: undefined, thumbnailUrl: undefined };
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
  const coupleEntrance = payload.coupleEntrance === true;
  if (coupleEntrance && options.coupleEntrancesEnabled !== true) return null;
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
  const participantUids = coupleEntrance && Array.isArray(payload.memberUids)
    ? payload.memberUids.map((value) => readShortString(value, 128)).filter(Boolean)
    : [];
  if (
    coupleEntrance
    && (
      participantUids.length !== 2
      || participantUids[0] === participantUids[1]
      || participantUids.some((uid) => options.blockedUids?.has(uid))
    )
  ) return null;
  const priorityValue = Number.isInteger(candidate.priority)
    ? Number(candidate.priority)
    : (Number.isInteger(payload.priority) ? Number(payload.priority) : 1);
  const priority = Math.min(4, Math.max(0, priorityValue));
  const memberDisplayNames = coupleEntrance && Array.isArray(payload.memberDisplayNames)
    ? payload.memberDisplayNames.map((value) => readShortString(value, 40)).filter(Boolean)
    : [];
  if (coupleEntrance && memberDisplayNames.length !== 2) return null;
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
  const rawPoster = isRocket
    ? readShortString(staticAsset.uri, 2_048)
    : '';
  const posterUrl = rawPoster && /^https:\/\/[^\s]{1,2039}$/.test(rawPoster)
    ? rawPoster
    : undefined;
  const rawSound = readShortString(isRocket ? soundAsset.uri : undefined, 2_048);
  const soundUrl = rawSound && /^https:\/\/[^\s]{1,2039}$/.test(rawSound)
    ? rawSound
    : undefined;
  const assetCandidate = coupleEntrance
    ? payload
    : isRecord(payload.cosmeticAsset)
      ? payload.cosmeticAsset
    : (isRecord(appearance.cosmeticAsset) ? appearance.cosmeticAsset : {});
  const assetId = readShortString(assetCandidate.assetId, 80);
  const assetVersionId = readShortString(assetCandidate.assetVersionId, 32);
  const hasCanonicalAsset = /^[a-z0-9][a-z0-9_-]{2,79}$/.test(assetId)
    && /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/.test(assetVersionId);
  const fallbackAssetId = readShortString(payload.fallbackAssetId, 80);
  const fallbackAssetVersionId = readShortString(payload.fallbackAssetVersionId, 32);
  const hasPairFallback = !coupleEntrance || (
    /^[a-z0-9][a-z0-9_-]{2,79}$/.test(fallbackAssetId)
    && /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/.test(fallbackAssetVersionId)
  );
  const coupleAssetFormat = coupleEntrance && ['png', 'lottie-json'].includes(String(payload.format))
    ? payload.format as 'png' | 'lottie-json'
    : undefined;
  if (coupleEntrance && (!hasCanonicalAsset || !hasPairFallback || !coupleAssetFormat)) return null;
  const comboKey = kind === 'room-gift'
    ? readShortString(payload.comboKey, 128)
    : '';
  const comboCount = Number.isSafeInteger(payload.comboCount)
    ? Math.min(999, Math.max(1, Number(payload.comboCount)))
    : 1;
  const comboSequence = Number.isSafeInteger(payload.comboSequence)
    ? Math.min(1_000_000_000, Math.max(1, Number(payload.comboSequence)))
    : undefined;
  const comboWindowExpiresAtMs = readMillis(payload.comboWindowExpiresAtMs);
  const comboWindowId = readShortString(payload.comboWindowId, 32);
  const giftPresentationTier = kind === 'room-gift'
    && ['inline', 'targeted', 'major', 'global'].includes(String(payload.presentationTier))
    ? payload.presentationTier as RoomGiftPresentationTier
    : kind === 'room-gift' ? 'inline' : undefined;
  const quantity = Number.isSafeInteger(payload.quantity)
    ? Math.min(20, Math.max(1, Number(payload.quantity)))
    : undefined;
  const giftId = kind === 'room-gift' ? readShortString(payload.giftId, 80) : '';
  const recipientUid = readShortString(payload.recipientUid, 128);
  const recipientDisplayName = readShortString(payload.recipientDisplayName, 80);
  const senderDisplayName = readShortString(payload.senderDisplayName, 80);
  const hapticPolicy = ['off', 'light', 'success'].includes(String(payload.hapticPolicy))
    ? payload.hapticPolicy as 'off' | 'light' | 'success'
    : 'off';
  const theaterKind = ['standard', 'combo', 'storm', 'lucky', 'magic'].includes(String(payload.theaterKind))
    ? payload.theaterKind as QueuedRoomEffect['theaterKind']
    : undefined;
  const luckyOutcome = isRecord(payload.luckyOutcome)
    && (payload.luckyOutcome.kind === 'none' || payload.luckyOutcome.kind === 'display-crumb')
    && typeof payload.luckyOutcome.labelAr === 'string'
    && typeof payload.luckyOutcome.oddsLabelAr === 'string'
    ? {
      kind: payload.luckyOutcome.kind as 'none' | 'display-crumb',
      labelAr: String(payload.luckyOutcome.labelAr).slice(0, 40),
      oddsLabelAr: String(payload.luckyOutcome.oddsLabelAr).slice(0, 16),
    }
    : undefined;
  const magicFrame = isRecord(payload.magicFrame)
    && typeof payload.magicFrame.templateId === 'string'
    && typeof payload.magicFrame.labelAr === 'string'
    && typeof payload.magicFrame.accentColor === 'string'
    ? {
      accentColor: String(payload.magicFrame.accentColor).slice(0, 7),
      labelAr: String(payload.magicFrame.labelAr).slice(0, 40),
      templateId: String(payload.magicFrame.templateId).slice(0, 40),
    }
    : undefined;
  const visualFormat = isRocket && ['lottie-json', 'mp4', 'animated-webp'].includes(String(animationAsset.format))
    ? animationAsset.format as 'lottie-json' | 'mp4' | 'animated-webp'
    : kind === 'room-entry' && ['lottie-json', 'mp4'].includes(String(payload.visualFormat))
      ? payload.visualFormat as 'lottie-json' | 'mp4'
      : undefined;
  const legacyCopy: RoomEffectCopyInput | undefined = coupleEntrance
    ? {
      entrantDisplayNames: memberDisplayNames,
      kind: 'couple-entry',
      schemaVersion: 1,
    }
    : kind === 'room-entry'
      ? {
        entrantDisplayNames: [displayName],
        itemName: {
          ...(readShortString(payload.nameAr, 80) ? { ar: readShortString(payload.nameAr, 80) } : {}),
          ...(readShortString(payload.nameEn, 80) ? { en: readShortString(payload.nameEn, 80) } : {}),
        },
        kind: 'entry',
        schemaVersion: 1,
      }
      : kind === 'room-gift'
        ? {
          itemName: { ar: nameAr },
          kind: 'gift',
          quantity: quantity || 1,
          recipientDisplayName,
          schemaVersion: 1,
          senderDisplayName,
        }
        : undefined;
  const copy = normalizeRoomEffectCopyInput(payload.copy) || legacyCopy;
  const surface = resolveRoomEffectSurface(kind, giftPresentationTier);
  return {
    ...(hasCanonicalAsset ? { assetId, assetVersionId } : {}),
    ...(coupleEntrance ? {
      coupleAssetFormat,
      coupleEntrance: true,
      fallbackAssetId,
      fallbackAssetVersionId,
      participantUids,
    } : {}),
    ...(comboKey && /^[A-Za-z0-9][A-Za-z0-9:_-]{2,127}$/.test(comboKey)
      ? {
        comboCount,
        comboKey,
        ...(comboSequence ? { comboSequence } : {}),
        ...(comboWindowExpiresAtMs ? { comboWindowExpiresAtMs } : {}),
        ...(/^gcw_[a-f0-9]{24}$/.test(comboWindowId) ? { comboWindowId } : {}),
      }
      : {}),
    animationEnabled: payload.animationEnabled === true,
    audioEnabled: payload.audioEnabled === true,
    ...(copy ? { copy } : {}),
    ...(payload.customSource === true ? { customSource: true } : {}),
    ...(payload.statusSource === true ? { statusSource: true } : {}),
    durationMs,
    eventId,
    expiresAtMs,
    ...(giftPresentationTier ? { giftPresentationTier } : {}),
    ...(giftId ? { giftId } : {}),
    hapticPolicy,
    kind,
    label: copy ? buildRoomEffectCopy(copy, 'ar') : nameAr,
    ...(luckyOutcome ? { luckyOutcome } : {}),
    ...(magicFrame ? { magicFrame } : {}),
    ...(eventOccurredAtMs ? { occurredAtMs: eventOccurredAtMs } : {}),
    priority: kind === 'room-rocket' ? 4 : priority,
    ...(quantity ? { quantity } : {}),
    recipientDisplayName,
    recipientUid,
    senderDisplayName,
    senderUid,
    surface,
    soundUrl,
    ...(theaterKind ? { theaterKind } : {}),
    thumbnailUrl,
    ...(posterUrl ? { posterUrl } : {}),
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
  const copy = next.copy?.kind === 'gift'
    ? { ...next.copy, quantity: comboCount }
    : next.copy || current.copy;
  return {
    ...current,
    comboCount,
    ...(copy ? { copy } : {}),
    comboSequence: Math.max(current.comboSequence || 0, next.comboSequence || 0) || undefined,
    comboWindowExpiresAtMs: Math.max(
      current.comboWindowExpiresAtMs || 0,
      next.comboWindowExpiresAtMs || 0,
    ) || undefined,
    durationMs: Math.max(current.durationMs, next.durationMs),
    expiresAtMs: Math.max(current.expiresAtMs, next.expiresAtMs),
    label: copy ? buildRoomEffectCopy(copy, 'ar') : `${next.label.replace(/\s×\d+$/, '')} ×${comboCount}`,
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
