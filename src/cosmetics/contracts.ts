export const COSMETIC_ASSET_SCHEMA_VERSION = 1 as const;

export const COSMETIC_ASSET_FORMATS = [
  'png',
  'jpeg',
  'lottie-json',
  'mp4',
  'm4a-aac',
  'legacy-webp',
] as const;

export const COSMETIC_CATEGORIES = [
  'avatar-frame',
  'profile-skin',
  'chat-bubble',
  'nameplate',
  'cosmetic-badge',
  'entry-effect',
  'seat-effect',
  'gift-effect',
  'room-theme',
  'room-reaction',
  'couple-effect',
  'effect-audio',
] as const;

export const COSMETIC_EQUIPMENT_SLOTS = [
  'avatar-frame',
  'profile-skin',
  'chat-bubble',
  'nameplate',
  'cosmetic-badge',
  'entry-effect',
  'seat-effect',
] as const;

export const COSMETIC_MODERATION_STATUSES = [
  'draft',
  'processing',
  'pending',
  'approved',
  'rejected',
  'suspended',
] as const;

export const COSMETIC_PUBLICATION_STATUSES = [
  'unpublished',
  'published',
  'disabled',
] as const;

export const COSMETIC_PERFORMANCE_TIERS = ['low', 'standard', 'high'] as const;
export const COSMETIC_USAGES = ['static', 'looping', 'one-shot'] as const;
export const COSMETIC_VIEWER_MODES = ['full', 'reduced', 'off'] as const;
export const COSMETIC_RENDER_STATES = [
  'static',
  'loading',
  'ready',
  'failed',
  'disabled',
  'expired',
  'incompatible',
  'reduced-motion',
  'muted',
  'off',
] as const;

export type CosmeticAssetFormat = typeof COSMETIC_ASSET_FORMATS[number];
export type CosmeticCategory = typeof COSMETIC_CATEGORIES[number];
export type CosmeticEquipmentSlot = typeof COSMETIC_EQUIPMENT_SLOTS[number];
export type CosmeticModerationStatus = typeof COSMETIC_MODERATION_STATUSES[number];
export type CosmeticPublicationStatus = typeof COSMETIC_PUBLICATION_STATUSES[number];
export type CosmeticPerformanceTier = typeof COSMETIC_PERFORMANCE_TIERS[number];
export type CosmeticUsage = typeof COSMETIC_USAGES[number];
export type CosmeticViewerMode = typeof COSMETIC_VIEWER_MODES[number];
export type CosmeticRenderState = typeof COSMETIC_RENDER_STATES[number];

export type CosmeticCanvasSpec = {
  width: number;
  height: number;
  safeArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export const COSMETIC_CATEGORY_CANVASES:
Record<Exclude<CosmeticCategory, 'effect-audio'>, CosmeticCanvasSpec> = Object.freeze({
  'avatar-frame': canvas(512, 512, 56, 56, 400, 400),
  'profile-skin': canvas(1440, 1920, 96, 192, 1248, 1536),
  'chat-bubble': canvas(1080, 420, 96, 60, 888, 300),
  nameplate: canvas(1000, 240, 80, 40, 840, 160),
  'cosmetic-badge': canvas(256, 256, 24, 24, 208, 208),
  'entry-effect': canvas(1280, 720, 64, 72, 1152, 576),
  'seat-effect': canvas(512, 512, 56, 56, 400, 400),
  'gift-effect': canvas(1280, 720, 64, 72, 1152, 576),
  'room-theme': canvas(1280, 720, 64, 72, 1152, 576),
  'room-reaction': canvas(512, 512, 48, 48, 416, 416),
  'couple-effect': canvas(1080, 420, 96, 60, 888, 300),
});

export type CosmeticAssetDescriptorV1 = {
  schemaVersion: typeof COSMETIC_ASSET_SCHEMA_VERSION;
  assetId: string;
  assetVersionId: string;
  ownerType: 'platform' | 'user';
  ownerUid?: string;
  category: CosmeticCategory;
  slot?: CosmeticEquipmentSlot;
  format: CosmeticAssetFormat;
  usage: CosmeticUsage;
  uri: string;
  fallbackAssetId?: string;
  fallbackAssetVersionId?: string;
  audioAssetId?: string;
  audioAssetVersionId?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  frameRate?: number;
  byteSize: number;
  sha256: string;
  transparent: boolean;
  loop: boolean;
  performanceTier: CosmeticPerformanceTier;
  minimumClientVersion: string;
  moderationStatus: CosmeticModerationStatus;
  publicationStatus: CosmeticPublicationStatus;
  approvalId?: string;
  revision: number;
};

export type CosmeticAssetValidationOptions = {
  allowBundledAssets?: boolean;
  allowLegacyWebp?: boolean;
  requireRenderable?: boolean;
};

export type CosmeticAssetValidationResult =
  | { ok: true; descriptor: CosmeticAssetDescriptorV1 }
  | { ok: false; reason: string };

export type CosmeticAssetBudget = {
  maxBytes: number;
  maxDimension: number;
  maxDurationMs: number;
  maxFrameRate: number;
};

const MEBIBYTE = 1024 * 1024;
const VISUAL_DIMENSION_LIMIT = 2_560;
const DEFAULT_VISUAL_BUDGET: CosmeticAssetBudget = Object.freeze({
  maxBytes: 3 * MEBIBYTE,
  maxDimension: VISUAL_DIMENSION_LIMIT,
  maxDurationMs: 0,
  maxFrameRate: 0,
});
const LOTTIE_BUDGET: CosmeticAssetBudget = Object.freeze({
  maxBytes: MEBIBYTE,
  maxDimension: VISUAL_DIMENSION_LIMIT,
  maxDurationMs: 6_000,
  maxFrameRate: 30,
});
const VIDEO_BUDGET: CosmeticAssetBudget = Object.freeze({
  maxBytes: 5 * MEBIBYTE,
  maxDimension: 1_280,
  maxDurationMs: 6_000,
  maxFrameRate: 30,
});
const ROOM_VIDEO_BUDGET: CosmeticAssetBudget = Object.freeze({
  maxBytes: 10 * MEBIBYTE,
  maxDimension: 1_280,
  maxDurationMs: 30_000,
  maxFrameRate: 30,
});
const AUDIO_BUDGET: CosmeticAssetBudget = Object.freeze({
  maxBytes: 500 * 1024,
  maxDimension: 0,
  maxDurationMs: 6_000,
  maxFrameRate: 0,
});
const LEGACY_WEBP_BUDGET: CosmeticAssetBudget = Object.freeze({
  maxBytes: 5 * MEBIBYTE,
  maxDimension: VISUAL_DIMENSION_LIMIT,
  maxDurationMs: 0,
  maxFrameRate: 0,
});

const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const VERSION_ID_PATTERN = /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/;
const APPROVAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const UID_PATTERN = /^[^/\s]{1,128}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CLIENT_VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const HTTPS_URI_PATTERN = /^https:\/\/[^\s]{1,2039}$/;
const BUNDLE_URI_PATTERN = /^bundle:\/\/[a-z0-9][a-z0-9/_-]{1,159}$/;

const DESCRIPTOR_KEYS = new Set<keyof CosmeticAssetDescriptorV1>([
  'schemaVersion',
  'assetId',
  'assetVersionId',
  'ownerType',
  'ownerUid',
  'category',
  'slot',
  'format',
  'usage',
  'uri',
  'fallbackAssetId',
  'fallbackAssetVersionId',
  'audioAssetId',
  'audioAssetVersionId',
  'width',
  'height',
  'durationMs',
  'frameRate',
  'byteSize',
  'sha256',
  'transparent',
  'loop',
  'performanceTier',
  'minimumClientVersion',
  'moderationStatus',
  'publicationStatus',
  'approvalId',
  'revision',
]);

const CATEGORY_FORMATS: Record<CosmeticCategory, readonly CosmeticAssetFormat[]> = {
  'avatar-frame': ['png', 'lottie-json', 'legacy-webp'],
  'profile-skin': ['png', 'jpeg', 'legacy-webp'],
  'chat-bubble': ['png', 'lottie-json', 'legacy-webp'],
  nameplate: ['png', 'lottie-json', 'legacy-webp'],
  'cosmetic-badge': ['png', 'lottie-json', 'legacy-webp'],
  'entry-effect': ['png', 'lottie-json', 'mp4', 'legacy-webp'],
  'seat-effect': ['png', 'lottie-json', 'legacy-webp'],
  'gift-effect': ['png', 'lottie-json', 'mp4', 'legacy-webp'],
  'room-theme': ['png', 'jpeg', 'lottie-json', 'mp4', 'legacy-webp'],
  'room-reaction': ['png', 'lottie-json', 'legacy-webp'],
  'couple-effect': ['png', 'lottie-json', 'legacy-webp'],
  'effect-audio': ['m4a-aac'],
};

const CATEGORY_SLOTS: Partial<Record<CosmeticCategory, CosmeticEquipmentSlot>> = {
  'avatar-frame': 'avatar-frame',
  'profile-skin': 'profile-skin',
  'chat-bubble': 'chat-bubble',
  nameplate: 'nameplate',
  'cosmetic-badge': 'cosmetic-badge',
  'entry-effect': 'entry-effect',
  'seat-effect': 'seat-effect',
};

const LOOPING_CATEGORIES = new Set<CosmeticCategory>([
  'avatar-frame',
  'chat-bubble',
  'nameplate',
  'cosmetic-badge',
  'seat-effect',
  'room-theme',
  'room-reaction',
  'couple-effect',
]);

export const COSMETIC_LAYER_ORDER = Object.freeze({
  roomThemeBackground: 0,
  roomThemeStage: 10,
  roomSeats: 20,
  seatEffect: 30,
  userAvatar: 40,
  avatarFrame: 50,
  speakingAndSeatState: 60,
  authorityBadges: 70,
  roomChatAndControls: 80,
  ambientReaction: 90,
  majorEffect: 100,
  safetyAndConnectionNotice: 200,
});

export function getCosmeticAssetBudget(
  format: CosmeticAssetFormat,
  category: CosmeticCategory,
): CosmeticAssetBudget {
  if (format === 'lottie-json') return LOTTIE_BUDGET;
  if (format === 'mp4') return category === 'room-theme' ? ROOM_VIDEO_BUDGET : VIDEO_BUDGET;
  if (format === 'm4a-aac') return AUDIO_BUDGET;
  if (format === 'legacy-webp') return LEGACY_WEBP_BUDGET;
  return DEFAULT_VISUAL_BUDGET;
}

export function validateCosmeticAssetDescriptorV1(
  value: unknown,
  options: CosmeticAssetValidationOptions = {},
): CosmeticAssetValidationResult {
  if (!isRecord(value)) return invalid('Descriptor must be an object.');
  if (Object.keys(value).some((key) => !DESCRIPTOR_KEYS.has(key as keyof CosmeticAssetDescriptorV1))) {
    return invalid('Descriptor contains unsupported fields.');
  }

  const category = includes(COSMETIC_CATEGORIES, value.category);
  const format = includes(COSMETIC_ASSET_FORMATS, value.format);
  const usage = includes(COSMETIC_USAGES, value.usage);
  const performanceTier = includes(COSMETIC_PERFORMANCE_TIERS, value.performanceTier);
  const moderationStatus = includes(COSMETIC_MODERATION_STATUSES, value.moderationStatus);
  const publicationStatus = includes(COSMETIC_PUBLICATION_STATUSES, value.publicationStatus);
  if (
    value.schemaVersion !== COSMETIC_ASSET_SCHEMA_VERSION
    || typeof value.assetId !== 'string'
    || !ASSET_ID_PATTERN.test(value.assetId)
    || typeof value.assetVersionId !== 'string'
    || !VERSION_ID_PATTERN.test(value.assetVersionId)
    || !category
    || !format
    || !usage
    || !performanceTier
    || !moderationStatus
    || !publicationStatus
  ) {
    return invalid('Descriptor identity or enum value is invalid.');
  }

  if (
    (value.ownerType !== 'platform' && value.ownerType !== 'user')
    || (value.ownerType === 'platform' && value.ownerUid !== undefined)
    || (
      value.ownerType === 'user'
      && (typeof value.ownerUid !== 'string' || !UID_PATTERN.test(value.ownerUid))
    )
  ) {
    return invalid('Descriptor owner is invalid.');
  }

  const expectedSlot = CATEGORY_SLOTS[category];
  if (
    (expectedSlot && value.slot !== expectedSlot)
    || (!expectedSlot && value.slot !== undefined)
  ) {
    return invalid('Descriptor equipment slot does not match its category.');
  }

  if (!CATEGORY_FORMATS[category].includes(format)) {
    return invalid('Format is not allowed for this category.');
  }
  if (format === 'legacy-webp' && options.allowLegacyWebp !== true) {
    return invalid('Legacy WebP is compatibility-only.');
  }

  const uriValid = typeof value.uri === 'string'
    && (
      HTTPS_URI_PATTERN.test(value.uri)
      || (options.allowBundledAssets === true && BUNDLE_URI_PATTERN.test(value.uri))
    );
  if (!uriValid) return invalid('Asset URI is invalid.');

  if (
    typeof value.byteSize !== 'number'
    || !Number.isSafeInteger(value.byteSize)
    || value.byteSize < 1
    || typeof value.sha256 !== 'string'
    || !SHA256_PATTERN.test(value.sha256)
    || typeof value.transparent !== 'boolean'
    || typeof value.loop !== 'boolean'
    || typeof value.minimumClientVersion !== 'string'
    || !CLIENT_VERSION_PATTERN.test(value.minimumClientVersion)
    || typeof value.revision !== 'number'
    || !Number.isSafeInteger(value.revision)
    || value.revision < 1
  ) {
    return invalid('Descriptor integrity or compatibility metadata is invalid.');
  }

  const budget = getCosmeticAssetBudget(format, category);
  if (value.byteSize > budget.maxBytes) return invalid('Asset exceeds its byte-size budget.');

  if (format === 'm4a-aac') {
    if (
      value.width !== undefined
      || value.height !== undefined
      || value.frameRate !== undefined
      || value.transparent
      || value.loop
      || usage !== 'one-shot'
      || !validPositiveInteger(value.durationMs)
      || Number(value.durationMs) > budget.maxDurationMs
    ) {
      return invalid('Audio metadata is invalid.');
    }
  } else if (
    !validPositiveInteger(value.width)
    || !validPositiveInteger(value.height)
    || Number(value.width) > budget.maxDimension
    || Number(value.height) > budget.maxDimension
  ) {
    return invalid('Visual dimensions are invalid.');
  }

  if (format === 'jpeg' && value.transparent) return invalid('JPEG cannot be transparent.');
  if (format === 'png' || format === 'jpeg' || format === 'legacy-webp') {
    if (
      usage !== 'static'
      || value.loop
      || value.durationMs !== undefined
      || value.frameRate !== undefined
    ) {
      return invalid('Static image playback metadata is invalid.');
    }
  }

  if (format === 'lottie-json' || format === 'mp4') {
    if (
      (usage !== 'looping' && usage !== 'one-shot')
      || !validPositiveInteger(value.durationMs)
      || Number(value.durationMs) > budget.maxDurationMs
      || !validPositiveInteger(value.frameRate)
      || Number(value.frameRate) > budget.maxFrameRate
      || typeof value.fallbackAssetId !== 'string'
      || !ASSET_ID_PATTERN.test(value.fallbackAssetId)
      || typeof value.fallbackAssetVersionId !== 'string'
      || !VERSION_ID_PATTERN.test(value.fallbackAssetVersionId)
      || (usage === 'looping') !== value.loop
    ) {
      return invalid('Animation playback or fallback metadata is invalid.');
    }
    if (format === 'mp4' && value.transparent) return invalid('MP4 transparency is not supported.');
    if (value.loop && !LOOPING_CATEGORIES.has(category)) {
      return invalid('This category cannot loop.');
    }
  }

  if (
    (value.audioAssetId !== undefined || value.audioAssetVersionId !== undefined)
    && (
      format === 'm4a-aac'
      || typeof value.audioAssetId !== 'string'
      || !ASSET_ID_PATTERN.test(value.audioAssetId)
      || typeof value.audioAssetVersionId !== 'string'
      || !VERSION_ID_PATTERN.test(value.audioAssetVersionId)
    )
  ) {
    return invalid('Audio asset reference is invalid.');
  }

  if (
    (value.fallbackAssetId !== undefined || value.fallbackAssetVersionId !== undefined)
    && format !== 'lottie-json'
    && format !== 'mp4'
  ) {
    return invalid('Only animated assets may declare a fallback.');
  }

  const isApproved = moderationStatus === 'approved';
  if (
    (isApproved && (typeof value.approvalId !== 'string' || !APPROVAL_ID_PATTERN.test(value.approvalId)))
    || (!isApproved && value.approvalId !== undefined)
  ) {
    return invalid('Approval metadata does not match moderation state.');
  }

  if (
    options.requireRenderable === true
    && (
      moderationStatus !== 'approved'
      || publicationStatus !== 'published'
      || !value.approvalId
    )
  ) {
    return invalid('Asset is not approved and published for rendering.');
  }

  return { ok: true, descriptor: value as CosmeticAssetDescriptorV1 };
}

export function resolveCosmeticViewerMode(input: {
  appReducedMotion?: boolean;
  expensiveEffectsDisabled?: boolean;
  lowMemory?: boolean;
  roomEffectsPolicy?: CosmeticViewerMode | string;
}): CosmeticViewerMode {
  if (input.roomEffectsPolicy === 'off' || input.expensiveEffectsDisabled) return 'off';
  if (input.roomEffectsPolicy === 'reduced' || input.appReducedMotion || input.lowMemory) {
    return 'reduced';
  }
  return 'full';
}

export function isCosmeticClientVersionCompatible(
  minimumVersion: string,
  currentVersion: string,
) {
  const minimum = parseVersion(minimumVersion);
  const current = parseVersion(currentVersion);
  if (!minimum || !current) return false;
  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] > minimum[index]) return true;
    if (current[index] < minimum[index]) return false;
  }
  return true;
}

function parseVersion(value: string) {
  if (!CLIENT_VERSION_PATTERN.test(value)) return undefined;
  return value.split('.').map(Number) as [number, number, number];
}

function includes<Value extends string>(
  values: readonly Value[],
  value: unknown,
): Value | undefined {
  return typeof value === 'string' && values.includes(value as Value)
    ? value as Value
    : undefined;
}

function validPositiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function invalid(reason: string): CosmeticAssetValidationResult {
  return { ok: false, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function canvas(
  width: number,
  height: number,
  x: number,
  y: number,
  safeWidth: number,
  safeHeight: number,
): CosmeticCanvasSpec {
  return {
    width,
    height,
    safeArea: { x, y, width: safeWidth, height: safeHeight },
  };
}
