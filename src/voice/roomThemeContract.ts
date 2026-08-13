import { ROOM_SEAT_COUNTS } from './roomV2Contract';
import { createProductionRoomThemeLayouts } from './roomThemeProductionLayouts';

export const ROOM_THEME_MANIFEST_VERSION = 1 as const;
export const ROOM_THEME_MANIFEST_VERSION_V2 = 2 as const;
export const ROOM_THEME_MANIFEST_VERSION_V3 = 3 as const;
export const DEFAULT_ROOM_THEME_ID = 'majlis-default' as const;
export const ROOM_THEME_IDS = [
  DEFAULT_ROOM_THEME_ID,
  'royal-theater',
  'ruby-constellation',
] as const;
export const BUILT_IN_ROOM_THEME_REVISION = 8 as const;

export type RoomThemeId = string;
export type RoomThemeViewportProfile = 'compact' | 'standard' | 'tall';
export type RoomThemePublicationStatus = 'draft' | 'published' | 'disabled';
export type RoomThemeAssetSlot =
  | 'background'
  | 'stage'
  | 'emptySeatFrame'
  | 'badge'
  | 'dock'
  | 'drawer';

export type RoomThemeAssetV1 = {
  uri: string;
  version: number;
};

export type RoomThemeSeatPositionV1 = {
  seatNumber: number;
  x: number;
  y: number;
  scale: number;
  z: number;
};

export type RoomThemeColorTokensV1 = {
  background: string;
  panel: string;
  panelRaised: string;
  ruby: string;
  rubyBright: string;
  gold: string;
  goldSoft: string;
  text: string;
  textMuted: string;
};

export type RoomThemeManifestV1 = {
  manifestVersion: typeof ROOM_THEME_MANIFEST_VERSION;
  themeId: RoomThemeId;
  publicationStatus: RoomThemePublicationStatus;
  renderingEnabled: boolean;
  purchasingEnabled: boolean;
  minimumClientVersion: string;
  revision: number;
  assets: Record<RoomThemeAssetSlot, RoomThemeAssetV1 | null>;
  colors: RoomThemeColorTokensV1;
  layouts: Record<'5' | '10' | '15' | '20', RoomThemeSeatPositionV1[]>;
};

export type RoomThemeMotionAssetV2 = {
  assetId: string;
  assetVersionId: string;
};

export type RoomThemeAmbientSlotV2 = {
  id: string;
  asset: RoomThemeMotionAssetV2;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RoomThemeManifestV2 = Omit<RoomThemeManifestV1, 'manifestVersion'> & {
  manifestVersion: typeof ROOM_THEME_MANIFEST_VERSION_V2;
  motion: {
    background: RoomThemeMotionAssetV2 | null;
    ambient: RoomThemeAmbientSlotV2[];
  };
};

export type RoomThemeSceneMediaV3 = {
  fit: 'cover' | 'contain';
  focalX: number;
  focalY: number;
};

export type RoomThemeSceneProfileV3 = {
  layouts: Record<'5' | '10' | '15' | '20', RoomThemeSeatPositionV1[]>;
};

export type RoomThemeManifestV3 = Omit<RoomThemeManifestV2, 'manifestVersion'> & {
  manifestVersion: typeof ROOM_THEME_MANIFEST_VERSION_V3;
  scene: {
    background: RoomThemeSceneMediaV3;
    stage: RoomThemeSceneMediaV3;
    profiles: Record<RoomThemeViewportProfile, RoomThemeSceneProfileV3>;
  };
};

export type RoomThemeManifest = RoomThemeManifestV1 | RoomThemeManifestV2 | RoomThemeManifestV3;

export type ResolvedRoomThemeScene = {
  background: RoomThemeSceneMediaV3;
  layouts: RoomThemeManifestV1['layouts'];
  stage: RoomThemeSceneMediaV3;
  viewportProfile: RoomThemeViewportProfile;
};

export type RoomThemeManifestValidationResult =
  | { ok: true; manifest: RoomThemeManifest }
  | { ok: false; reason: string };

const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const CLIENT_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const HTTPS_ASSET_PATTERN = /^https:\/\/[^\s]{1,2039}$/;
const BUNDLED_ASSET_PATTERN = /^bundle:\/\/[a-z0-9][a-z0-9/_-]{1,127}$/;
const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;
const TOKEN_KEYS = [
  'background',
  'panel',
  'panelRaised',
  'ruby',
  'rubyBright',
  'gold',
  'goldSoft',
  'text',
  'textMuted',
] as const;
const ASSET_SLOTS = [
  'background',
  'stage',
  'emptySeatFrame',
  'badge',
  'dock',
  'drawer',
] as const;

export function isRoomThemeId(value: unknown): value is RoomThemeId {
  return typeof value === 'string' && THEME_ID_PATTERN.test(value);
}

export function normalizePersistedRoomThemeId(value: unknown): RoomThemeId {
  if (value === 'royal') return 'royal-theater';
  if (value === 'midnight' || value === 'ocean' || value === 'emerald') return DEFAULT_ROOM_THEME_ID;
  return isRoomThemeId(value) ? value : DEFAULT_ROOM_THEME_ID;
}

export function validateRoomThemeManifestV1(
  value: unknown,
  options: { allowBundledAssets?: boolean } = {},
): RoomThemeManifestValidationResult {
  if (!isRecord(value)) return invalid('Manifest must be an object.');
  if (value.manifestVersion !== ROOM_THEME_MANIFEST_VERSION) return invalid('Unsupported manifest version.');
  if (!isRoomThemeId(value.themeId)) return invalid('Invalid theme ID.');
  if (value.publicationStatus !== 'draft' && value.publicationStatus !== 'published' && value.publicationStatus !== 'disabled') {
    return invalid('Invalid publication status.');
  }
  if (typeof value.renderingEnabled !== 'boolean' || typeof value.purchasingEnabled !== 'boolean') {
    return invalid('Theme switches must be booleans.');
  }
  if (typeof value.minimumClientVersion !== 'string' || !CLIENT_VERSION_PATTERN.test(value.minimumClientVersion)) {
    return invalid('Invalid minimum client version.');
  }
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1) return invalid('Invalid revision.');
  if (!isRecord(value.colors) || !hasExactKeys(value.colors, TOKEN_KEYS)) return invalid('Invalid color tokens.');
  for (const key of TOKEN_KEYS) {
    if (typeof value.colors[key] !== 'string' || !HEX_COLOR_PATTERN.test(value.colors[key])) {
      return invalid(`Invalid ${key} color token.`);
    }
  }
  if (!isRecord(value.assets) || !hasExactKeys(value.assets, ASSET_SLOTS)) return invalid('Invalid theme assets.');
  for (const slot of ASSET_SLOTS) {
    const asset = value.assets[slot];
    if (asset === null) continue;
    if (!isRecord(asset) || !hasExactKeys(asset, ['uri', 'version'])) return invalid(`Invalid ${slot} asset.`);
    const validUri = typeof asset.uri === 'string'
      && (HTTPS_ASSET_PATTERN.test(asset.uri) || (options.allowBundledAssets === true && BUNDLED_ASSET_PATTERN.test(asset.uri)));
    if (!validUri || !Number.isSafeInteger(asset.version) || Number(asset.version) < 1) {
      return invalid(`Invalid ${slot} asset.`);
    }
  }
  if (!isRecord(value.layouts) || !hasExactKeys(value.layouts, ROOM_SEAT_COUNTS.map(String))) {
    return invalid('Layouts for 5, 10, 15 and 20 seats are required.');
  }
  for (const count of ROOM_SEAT_COUNTS) {
    const result = validateSeatLayout(value.layouts[String(count)], count);
    if (!result.ok) return result;
  }
  return { ok: true, manifest: value as RoomThemeManifestV1 };
}

export function validateRoomThemeManifestV2(
  value: unknown,
  options: { allowBundledAssets?: boolean } = {},
): RoomThemeManifestValidationResult {
  if (!isRecord(value) || value.manifestVersion !== ROOM_THEME_MANIFEST_VERSION_V2) {
    return invalid('Unsupported manifest version.');
  }
  const base = validateRoomThemeManifestV1({
    ...value,
    manifestVersion: ROOM_THEME_MANIFEST_VERSION,
  }, options);
  if (!base.ok || !isRecord(value.motion) || !hasExactKeys(value.motion, ['background', 'ambient'])) {
    return invalid('Invalid animated theme manifest.');
  }
  if (value.motion.background !== null && !isMotionReference(value.motion.background)) {
    return invalid('Invalid animated background reference.');
  }
  if (!Array.isArray(value.motion.ambient) || value.motion.ambient.length > 2) {
    return invalid('Invalid ambient theme slots.');
  }
  const seen = new Set<string>();
  for (const slot of value.motion.ambient) {
    if (
      !isRecord(slot)
      || !hasExactKeys(slot, ['id', 'asset', 'x', 'y', 'width', 'height'])
      || typeof slot.id !== 'string'
      || !/^[a-z0-9][a-z0-9-]{1,31}$/.test(slot.id)
      || seen.has(slot.id)
      || !isMotionReference(slot.asset)
      || !inRange(slot.x, 0.05, 0.95)
      || !inRange(slot.y, 0.08, 0.85)
      || !inRange(slot.width, 0.05, 0.6)
      || !inRange(slot.height, 0.05, 0.6)
      || slot.x + slot.width > 0.95
      || slot.y + slot.height > 0.85
    ) {
      return invalid('Invalid ambient theme slot.');
    }
    seen.add(slot.id);
  }
  return { ok: true, manifest: value as RoomThemeManifestV2 };
}

export function validateRoomThemeManifestV3(
  value: unknown,
  options: { allowBundledAssets?: boolean } = {},
): RoomThemeManifestValidationResult {
  if (!isRecord(value) || value.manifestVersion !== ROOM_THEME_MANIFEST_VERSION_V3) {
    return invalid('Unsupported manifest version.');
  }
  const base = validateRoomThemeManifestV2({
    ...value,
    manifestVersion: ROOM_THEME_MANIFEST_VERSION_V2,
  }, options);
  if (!base.ok || !isRecord(value.scene) || !hasExactKeys(value.scene, ['background', 'stage', 'profiles'])) {
    return invalid('Invalid responsive theme scene.');
  }
  if (!validateSceneMedia(value.scene.background) || !validateSceneMedia(value.scene.stage)) {
    return invalid('Invalid scene media positioning.');
  }
  if (!isRecord(value.scene.profiles) || !hasExactKeys(value.scene.profiles, ['compact', 'standard', 'tall'])) {
    return invalid('Compact, standard and tall scene profiles are required.');
  }
  for (const profileName of ['compact', 'standard', 'tall'] as const) {
    const profile = value.scene.profiles[profileName];
    if (!isRecord(profile) || !hasExactKeys(profile, ['layouts']) || !isRecord(profile.layouts)) {
      return invalid(`Invalid ${profileName} scene profile.`);
    }
    if (!hasExactKeys(profile.layouts, ROOM_SEAT_COUNTS.map(String))) {
      return invalid(`Layouts for 5, 10, 15 and 20 seats are required in ${profileName}.`);
    }
    for (const count of ROOM_SEAT_COUNTS) {
      const result = validateSeatLayout(profile.layouts[String(count)], count);
      if (!result.ok) return invalid(`${profileName}: ${result.reason}`);
    }
  }
  return { ok: true, manifest: value as RoomThemeManifestV3 };
}

export function validateRoomThemeManifest(
  value: unknown,
  options: { allowBundledAssets?: boolean } = {},
): RoomThemeManifestValidationResult {
  if (isRecord(value) && value.manifestVersion === ROOM_THEME_MANIFEST_VERSION_V3) {
    return validateRoomThemeManifestV3(value, options);
  }
  return isRecord(value) && value.manifestVersion === ROOM_THEME_MANIFEST_VERSION_V2
    ? validateRoomThemeManifestV2(value, options)
    : validateRoomThemeManifestV1(value, options);
}

export function resolveRoomThemeScene(
  manifest: RoomThemeManifest,
  viewportProfile: RoomThemeViewportProfile,
): ResolvedRoomThemeScene {
  if (manifest.manifestVersion === ROOM_THEME_MANIFEST_VERSION_V3) {
    return {
      background: manifest.scene.background,
      layouts: manifest.scene.profiles[viewportProfile].layouts,
      stage: manifest.scene.stage,
      viewportProfile,
    };
  }
  return {
    background: DEFAULT_SCENE_MEDIA,
    layouts: manifest.layouts,
    stage: DEFAULT_STAGE_MEDIA,
    viewportProfile,
  };
}

export function isClientVersionCompatible(minimumVersion: string, currentVersion: string) {
  const minimum = parseVersion(minimumVersion);
  const current = parseVersion(currentVersion);
  if (!minimum || !current) return false;
  for (let index = 0; index < 3; index += 1) {
    if (current[index] > minimum[index]) return true;
    if (current[index] < minimum[index]) return false;
  }
  return true;
}

export const MAJLIS_DEFAULT_MANIFEST: RoomThemeManifestV1 = {
  manifestVersion: ROOM_THEME_MANIFEST_VERSION,
  themeId: DEFAULT_ROOM_THEME_ID,
  publicationStatus: 'published',
  renderingEnabled: true,
  purchasingEnabled: false,
  minimumClientVersion: '1.0.0',
  revision: BUILT_IN_ROOM_THEME_REVISION,
  assets: {
    background: { uri: 'bundle://room-themes/majlis-default/stage-v2', version: 2 },
    stage: null,
    emptySeatFrame: null,
    badge: null,
    dock: null,
    drawer: null,
  },
  colors: {
    background: '#080405',
    panel: '#130A0B',
    panelRaised: '#211012',
    ruby: '#74151D',
    rubyBright: '#B92A35',
    gold: '#D6A84F',
    goldSoft: '#F4D58A',
    text: '#FFF4DE',
    textMuted: '#CDBB9D',
  },
  layouts: createProductionRoomThemeLayouts(DEFAULT_ROOM_THEME_ID, 'standard'),
};

export function createBuiltInRoomThemeManifest(
  themeId: (typeof ROOM_THEME_IDS)[number],
): RoomThemeManifestV1 {
  if (themeId === DEFAULT_ROOM_THEME_ID) return MAJLIS_DEFAULT_MANIFEST;
  const royal = themeId === 'royal-theater';
  return {
    ...MAJLIS_DEFAULT_MANIFEST,
    themeId,
    purchasingEnabled: true,
    assets: {
      ...MAJLIS_DEFAULT_MANIFEST.assets,
      background: {
        uri: `bundle://room-themes/${themeId}/stage-v2`,
        version: 2,
      },
      stage: null,
    },
    colors: royal
      ? {
          ...MAJLIS_DEFAULT_MANIFEST.colors,
          background: '#090506',
          panel: '#170B0D',
          panelRaised: '#291114',
          ruby: '#861923',
          rubyBright: '#C4323E',
        }
      : {
          ...MAJLIS_DEFAULT_MANIFEST.colors,
          background: '#070407',
          panel: '#120A10',
          panelRaised: '#24101D',
          ruby: '#731630',
          rubyBright: '#B72A4E',
        },
    layouts: createProductionRoomThemeLayouts(themeId, 'standard'),
  };
}

export function createBuiltInRoomThemeManifestV3(
  themeId: (typeof ROOM_THEME_IDS)[number],
): RoomThemeManifestV3 {
  const base = createBuiltInRoomThemeManifest(themeId);
  return {
    ...base,
    manifestVersion: ROOM_THEME_MANIFEST_VERSION_V3,
    motion: { ambient: [], background: null },
    scene: {
      background: { fit: 'cover', focalX: 0.5, focalY: 0.5 },
      stage: { fit: 'cover', focalX: 0.5, focalY: 0.5 },
      profiles: {
        compact: { layouts: createProductionRoomThemeLayouts(themeId, 'compact') },
        standard: { layouts: createProductionRoomThemeLayouts(themeId, 'standard') },
        tall: { layouts: createProductionRoomThemeLayouts(themeId, 'tall') },
      },
    },
  };
}

function validateSeatLayout(value: unknown, count: number): RoomThemeManifestValidationResult {
  if (!Array.isArray(value) || value.length !== count) return invalid(`Layout ${count} must contain ${count} seats.`);
  const seen = new Set<number>();
  const positions: RoomThemeSeatPositionV1[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ['seatNumber', 'x', 'y', 'scale', 'z'])) {
      return invalid(`Layout ${count} contains an invalid seat.`);
    }
    const seatNumber = Number(candidate.seatNumber);
    const x = Number(candidate.x);
    const y = Number(candidate.y);
    const scale = Number(candidate.scale);
    const z = Number(candidate.z);
    if (
      !Number.isInteger(seatNumber)
      || seatNumber < 1
      || seatNumber > count
      || seen.has(seatNumber)
      || !inRange(x, 0.04, 0.96)
      || !inRange(y, 0.04, 0.96)
      || !inRange(scale, 0.5, 1.3)
      || !Number.isInteger(z)
      || z < 0
      || z > 100
    ) {
      return invalid(`Layout ${count} contains a duplicate or out-of-bounds seat.`);
    }
    seen.add(seatNumber);
    positions.push({ seatNumber, x, y, scale, z });
  }
  for (let left = 0; left < positions.length; left += 1) {
    for (let right = left + 1; right < positions.length; right += 1) {
      const a = positions[left];
      const b = positions[right];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const minimumDistance = 0.072 * (a.scale + b.scale);
      if (distance < minimumDistance) return invalid(`Layout ${count} contains overlapping seats.`);
    }
  }
  return { ok: true, manifest: MAJLIS_DEFAULT_MANIFEST };
}

function validateSceneMedia(value: unknown): value is RoomThemeSceneMediaV3 {
  return isRecord(value)
    && hasExactKeys(value, ['fit', 'focalX', 'focalY'])
    && (value.fit === 'cover' || value.fit === 'contain')
    && inRange(Number(value.focalX), 0, 1)
    && inRange(Number(value.focalY), 0, 1);
}

const DEFAULT_SCENE_MEDIA: RoomThemeSceneMediaV3 = Object.freeze({
  fit: 'cover',
  focalX: 0.5,
  focalY: 0.5,
});

const DEFAULT_STAGE_MEDIA: RoomThemeSceneMediaV3 = Object.freeze({
  fit: 'contain',
  focalX: 0.5,
  focalY: 0.5,
});

function parseVersion(value: string) {
  if (!CLIENT_VERSION_PATTERN.test(value)) return null;
  return value.split('.').map(Number);
}

function isMotionReference(value: unknown): value is RoomThemeMotionAssetV2 {
  return isRecord(value)
    && hasExactKeys(value, ['assetId', 'assetVersionId'])
    && typeof value.assetId === 'string'
    && /^[a-z0-9][a-z0-9_-]{2,79}$/.test(value.assetId)
    && typeof value.assetVersionId === 'string'
    && /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/.test(value.assetVersionId);
}

function inRange(value: number, minimum: number, maximum: number) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function invalid(reason: string): RoomThemeManifestValidationResult {
  return { ok: false, reason };
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const expectedSet = new Set(expected);
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expectedSet.has(key));
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
