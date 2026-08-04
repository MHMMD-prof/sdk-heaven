import { ROOM_SEAT_COUNTS } from './roomV2Contract';

export const ROOM_THEME_MANIFEST_VERSION = 1 as const;
export const DEFAULT_ROOM_THEME_ID = 'majlis-default' as const;
export const ROOM_THEME_IDS = [
  DEFAULT_ROOM_THEME_ID,
  'royal-theater',
  'ruby-constellation',
] as const;

export type RoomThemeId = string;
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

export type RoomThemeManifestValidationResult =
  | { ok: true; manifest: RoomThemeManifestV1 }
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
  revision: 1,
  assets: {
    background: { uri: 'bundle://room-themes/majlis-default/background', version: 1 },
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
  layouts: {
    '5': horseshoeLayout(5),
    '10': horseshoeLayout(10),
    '15': horseshoeLayout(15),
    '20': horseshoeLayout(20),
  },
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
        uri: `bundle://room-themes/${themeId}/background`,
        version: 1,
      },
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
    layouts: {
      '5': royal ? theaterLayout(5) : constellationLayout(5),
      '10': royal ? theaterLayout(10) : constellationLayout(10),
      '15': royal ? theaterLayout(15) : constellationLayout(15),
      '20': royal ? theaterLayout(20) : constellationLayout(20),
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
      || !inRange(scale, 0.7, 1.3)
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

function horseshoeLayout(count: number): RoomThemeSeatPositionV1[] {
  if (count === 5) {
    return points([[0.16, 0.34], [0.32, 0.18], [0.5, 0.13], [0.68, 0.18], [0.84, 0.34]]);
  }
  const rows = Math.ceil(count / 5);
  const output: Array<[number, number]> = [];
  for (let row = 0; row < rows; row += 1) {
    const rowCount = Math.min(5, count - output.length);
    const progress = rows === 1 ? 1 : row / (rows - 1);
    output.push(...spreadRow(
      rowCount,
      0.18 - progress * 0.08,
      0.82 + progress * 0.08,
      rows === 2 ? 0.22 + row * 0.48 : 0.1 + row * (0.78 / (rows - 1)),
    ));
  }
  return points(output);
}

function theaterLayout(count: number): RoomThemeSeatPositionV1[] {
  const rows = Math.ceil(count / 5);
  const output: Array<[number, number]> = [];
  for (let row = 0; row < rows; row += 1) {
    const rowCount = Math.min(5, count - output.length);
    const progress = rows === 1 ? 1 : row / (rows - 1);
    output.push(...spreadRow(
      rowCount,
      0.2 - progress * 0.1,
      0.8 + progress * 0.1,
      rows === 1 ? 0.42 : 0.12 + row * (0.76 / (rows - 1)),
    ));
  }
  return points(output);
}

function constellationLayout(count: number): RoomThemeSeatPositionV1[] {
  const columns = count <= 5 ? count : 5;
  const rows = Math.ceil(count / columns);
  const output: Array<[number, number]> = [];
  for (let row = 0; row < rows; row += 1) {
    const rowCount = Math.min(columns, count - output.length);
    output.push(...spreadRow(rowCount, 0.11, 0.89, rows === 1 ? 0.4 : 0.16 + row * (0.68 / Math.max(1, rows - 1))));
  }
  return points(output);
}

function spreadRow(count: number, start: number, end: number, y: number): Array<[number, number]> {
  if (count <= 0) return [];
  if (count === 1) return [[0.5, y]];
  return Array.from({ length: count }, (_, index) => [start + ((end - start) * index) / (count - 1), y]);
}

function points(values: Array<[number, number]>): RoomThemeSeatPositionV1[] {
  return values.map(([x, y], index) => ({
    seatNumber: index + 1,
    x: round(x),
    y: round(y),
    scale: 1,
    z: index + 1,
  }));
}

function parseVersion(value: string) {
  if (!CLIENT_VERSION_PATTERN.test(value)) return null;
  return value.split('.').map(Number);
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
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
