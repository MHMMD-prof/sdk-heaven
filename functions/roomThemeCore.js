const { createHash } = require('node:crypto');

const DEFAULT_ROOM_THEME_ID = 'majlis-default';
const ROOM_THEME_MANIFEST_VERSION = 1;
const ROOM_THEME_ACTIONS = Object.freeze([
  'purchase-room-theme',
  'equip-room-theme',
  'get-room-theme-inventory',
]);
const ROOM_SEAT_COUNTS = Object.freeze([5, 10, 15, 20]);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const FIRESTORE_ID_PATTERN = /^[^/]{1,128}$/;
const THEME_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const HTTPS_ASSET_PATTERN = /^https:\/\/[^\s]{1,2039}$/;
const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;
const ASSET_SLOTS = Object.freeze([
  'background',
  'stage',
  'emptySeatFrame',
  'badge',
  'dock',
  'drawer',
]);
const COLOR_TOKENS = Object.freeze([
  'background',
  'panel',
  'panelRaised',
  'ruby',
  'rubyBright',
  'gold',
  'goldSoft',
  'text',
  'textMuted',
]);

function normalizeRoomThemeBody(body = {}) {
  return {
    action: typeof body.action === 'string' ? body.action.trim() : '',
    applyTheme: body.applyTheme !== false,
    clientVersion: typeof body.clientVersion === 'string' ? body.clientVersion.trim() : '',
    currency: typeof body.currency === 'string' ? body.currency.trim() : '',
    requestId: typeof body.requestId === 'string' ? body.requestId.trim() : '',
    roomId: typeof body.roomId === 'string' ? body.roomId.trim() : '',
    themeId: typeof body.themeId === 'string' ? body.themeId.trim() : '',
  };
}

function validateRoomThemeRequest(command) {
  if (
    !ROOM_THEME_ACTIONS.includes(command.action)
    || !FIRESTORE_ID_PATTERN.test(command.roomId)
    || !REQUEST_ID_PATTERN.test(command.requestId)
  ) {
    return roomThemeError('INVALID_REQUEST', 400, 'A valid room-theme command is required.');
  }
  if (command.action === 'get-room-theme-inventory') {
    if (command.themeId || command.currency) {
      return roomThemeError('INVALID_REQUEST', 400, 'Inventory accepts only a room ID.');
    }
    return { ok: true, value: command };
  }
  if (!THEME_ID_PATTERN.test(command.themeId) || !VERSION_PATTERN.test(command.clientVersion)) {
    return roomThemeError('INVALID_REQUEST', 400, 'A valid theme and client version are required.');
  }
  if (command.action === 'purchase-room-theme' && !['coins', 'diamonds'].includes(command.currency)) {
    return roomThemeError('INVALID_REQUEST', 400, 'A valid purchase currency is required.');
  }
  if (command.action === 'equip-room-theme' && command.currency) {
    return roomThemeError('INVALID_REQUEST', 400, 'Equip does not accept a currency.');
  }
  return { ok: true, value: command };
}

function validateRoomThemeManifestV1(data, documentId) {
  if (!isRecord(data) || data.manifestVersion !== ROOM_THEME_MANIFEST_VERSION || data.themeId !== documentId) return undefined;
  if (
    !THEME_ID_PATTERN.test(data.themeId)
    || !['draft', 'published', 'disabled'].includes(data.publicationStatus)
    || typeof data.renderingEnabled !== 'boolean'
    || typeof data.purchasingEnabled !== 'boolean'
    || !VERSION_PATTERN.test(data.minimumClientVersion)
    || !Number.isSafeInteger(data.revision)
    || data.revision < 1
  ) return undefined;
  if (!hasExactKeys(data.colors, COLOR_TOKENS)) return undefined;
  for (const token of COLOR_TOKENS) {
    if (typeof data.colors[token] !== 'string' || !HEX_COLOR_PATTERN.test(data.colors[token])) return undefined;
  }
  if (!hasExactKeys(data.assets, ASSET_SLOTS)) return undefined;
  for (const slot of ASSET_SLOTS) {
    const asset = data.assets[slot];
    if (asset === null) continue;
    if (
      !hasExactKeys(asset, ['uri', 'version'])
      || typeof asset.uri !== 'string'
      || !HTTPS_ASSET_PATTERN.test(asset.uri)
      || !Number.isSafeInteger(asset.version)
      || asset.version < 1
    ) return undefined;
  }
  if (!hasExactKeys(data.layouts, ROOM_SEAT_COUNTS.map(String))) return undefined;
  for (const count of ROOM_SEAT_COUNTS) {
    if (!validateSeatLayout(data.layouts[String(count)], count)) return undefined;
  }
  return {
    manifestVersion: ROOM_THEME_MANIFEST_VERSION,
    themeId: data.themeId,
    publicationStatus: data.publicationStatus,
    renderingEnabled: data.renderingEnabled,
    purchasingEnabled: data.purchasingEnabled,
    minimumClientVersion: data.minimumClientVersion,
    revision: data.revision,
    assets: data.assets,
    colors: data.colors,
    layouts: data.layouts,
  };
}

function isClientVersionCompatible(minimumVersion, currentVersion) {
  const minimum = parseVersion(minimumVersion);
  const current = parseVersion(currentVersion);
  if (!minimum || !current) return false;
  for (let index = 0; index < 3; index += 1) {
    if (current[index] > minimum[index]) return true;
    if (current[index] < minimum[index]) return false;
  }
  return true;
}

function buildRoomThemeFingerprint(uid, command) {
  return createHash('sha256').update(JSON.stringify({
    action: command.action,
    applyTheme: command.applyTheme,
    clientVersion: command.clientVersion,
    currency: command.currency,
    roomId: command.roomId,
    themeId: command.themeId,
    uid,
  })).digest('hex');
}

function mapRoomThemeEntitlement(data, themeId, nowMs = Date.now()) {
  if (!isRecord(data) || data.themeId !== themeId || !THEME_ID_PATTERN.test(themeId)) return undefined;
  const expiresAtMs = timestampToMillis(data.expiresAt);
  const expired = data.state === 'expired' || (expiresAtMs > 0 && expiresAtMs <= nowMs);
  return {
    acquiredAt: data.acquiredAt || null,
    expiresAt: data.expiresAt || null,
    itemId: typeof data.itemId === 'string' ? data.itemId : themeId,
    roomId: typeof data.roomId === 'string' ? data.roomId : '',
    state: expired ? 'expired' : 'active',
    themeId,
  };
}

function roomThemeError(code, status, error, details = undefined) {
  return { ok: false, code, status, error, ...(details ? { details } : {}) };
}

function validateSeatLayout(value, count) {
  if (!Array.isArray(value) || value.length !== count) return false;
  const seen = new Set();
  for (const seat of value) {
    if (!hasExactKeys(seat, ['seatNumber', 'x', 'y', 'scale', 'z'])) return false;
    if (
      !Number.isInteger(seat.seatNumber)
      || seat.seatNumber < 1
      || seat.seatNumber > count
      || seen.has(seat.seatNumber)
      || !inRange(seat.x, 0.04, 0.96)
      || !inRange(seat.y, 0.04, 0.96)
      || !inRange(seat.scale, 0.7, 1.3)
      || !Number.isInteger(seat.z)
      || seat.z < 0
      || seat.z > 100
    ) return false;
    seen.add(seat.seatNumber);
  }
  for (let left = 0; left < value.length; left += 1) {
    for (let right = left + 1; right < value.length; right += 1) {
      const a = value[left];
      const b = value[right];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.072 * (a.scale + b.scale)) return false;
    }
  }
  return true;
}

function parseVersion(value) {
  return VERSION_PATTERN.test(value) ? value.split('.').map(Number) : undefined;
}

function timestampToMillis(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (Number.isFinite(value)) return Number(value);
  return 0;
}

function inRange(value, minimum, maximum) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const expectedSet = new Set(expected);
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expectedSet.has(key));
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

module.exports = {
  DEFAULT_ROOM_THEME_ID,
  ROOM_THEME_ACTIONS,
  ROOM_THEME_MANIFEST_VERSION,
  buildRoomThemeFingerprint,
  isClientVersionCompatible,
  mapRoomThemeEntitlement,
  normalizeRoomThemeBody,
  roomThemeError,
  validateRoomThemeManifestV1,
  validateRoomThemeRequest,
};
