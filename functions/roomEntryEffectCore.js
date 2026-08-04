const { createHash } = require('node:crypto');
const {
  buildLegacyEntryPresentation,
  inspectApprovedEntryPresentation,
  resolveEntryPresentationDelivery,
} = require('./roomEntryPresentationCore');

const ROOM_ENTRY_EFFECT_ACTIONS = Object.freeze(['announce-entry-effect']);
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const FIRESTORE_ID_PATTERN = /^[^/]{1,128}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,95}$/;
const CLIENT_VERSION_PATTERN = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(?:[-+][A-Za-z0-9.-]{1,24})?$/;
const DEFAULT_DURATION_MS = 4_000;
const MIN_DURATION_MS = 3_000;
const MAX_DURATION_MS = 5_000;
const EFFECT_TTL_MS = 10_000;
const EFFECT_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_QUEUE_HINT = 8;
const MAX_EFFECT_DIMENSION = 2_048;
const PERFORMANCE_TIERS = Object.freeze(['low', 'standard', 'high']);
const SOUND_POLICIES = Object.freeze(['off', 'soft', 'full']);

function normalizeRoomEntryEffectBody(body = {}) {
  return {
    action: typeof body.action === 'string' ? body.action.trim() : '',
    requestId: typeof body.requestId === 'string' ? body.requestId.trim() : '',
    roomId: typeof body.roomId === 'string' ? body.roomId.trim() : '',
    sessionId: typeof body.sessionId === 'string' ? body.sessionId.trim() : '',
    clientVersion: typeof body.clientVersion === 'string' ? body.clientVersion.trim() : '',
  };
}

function validateRoomEntryEffectRequest(command) {
  if (
    !ROOM_ENTRY_EFFECT_ACTIONS.includes(command.action)
    || !FIRESTORE_ID_PATTERN.test(command.roomId)
    || !REQUEST_ID_PATTERN.test(command.requestId)
    || !SESSION_ID_PATTERN.test(command.sessionId)
    || (command.clientVersion && !CLIENT_VERSION_PATTERN.test(command.clientVersion))
  ) {
    return entryEffectError('INVALID_REQUEST', 400, 'A valid entry-effect command is required.');
  }
  return { ok: true, value: command };
}

function mapCarEntryEffectMetadata(catalogData, catalogItem) {
  if (!catalogItem || catalogItem.category !== 'cars') return undefined;
  const raw = catalogData && typeof catalogData === 'object' ? catalogData : {};
  const thumbnailUrl = isApprovedEntryAssetUrl(catalogItem.thumbnailUrl)
    ? catalogItem.thumbnailUrl
    : '';
  const previewAssetUrl = isApprovedEntryAssetUrl(catalogItem.previewAssetUrl)
    ? catalogItem.previewAssetUrl
    : '';
  if (!thumbnailUrl || !previewAssetUrl) return undefined;
  const durationMs = Number.isInteger(raw.entryEffectDurationMs)
    ? Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, raw.entryEffectDurationMs))
    : DEFAULT_DURATION_MS;
  const performanceTier = PERFORMANCE_TIERS.includes(raw.entryEffectPerformanceTier)
    ? raw.entryEffectPerformanceTier
    : 'standard';
  const soundPolicy = SOUND_POLICIES.includes(raw.entryEffectSoundPolicy)
    ? raw.entryEffectSoundPolicy
    : 'off';
  const assetVersion = typeof raw.entryEffectAssetVersion === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(raw.entryEffectAssetVersion.trim())
    ? raw.entryEffectAssetVersion.trim()
    : 'static-1';
  const minimumClientVersion = typeof raw.entryEffectMinimumClientVersion === 'string'
    && CLIENT_VERSION_PATTERN.test(raw.entryEffectMinimumClientVersion.trim())
    ? raw.entryEffectMinimumClientVersion.trim()
    : '';
  const width = Number.isInteger(raw.entryEffectWidth)
    ? Math.min(MAX_EFFECT_DIMENSION, Math.max(1, raw.entryEffectWidth))
    : 720;
  const height = Number.isInteger(raw.entryEffectHeight)
    ? Math.min(MAX_EFFECT_DIMENSION, Math.max(1, raw.entryEffectHeight))
    : 405;
  const fallbackArtworkUrl = isApprovedEntryAssetUrl(raw.entryEffectFallbackUrl)
    ? raw.entryEffectFallbackUrl.trim()
    : thumbnailUrl;
  return {
    assetVersion,
    durationMs,
    fallbackArtworkUrl,
    height,
    minimumClientVersion,
    nameAr: catalogItem.name?.ar || catalogItem.itemId,
    nameEn: catalogItem.name?.en || catalogItem.itemId,
    performanceTier,
    previewAssetUrl,
    soundPolicy,
    thumbnailUrl,
    width,
  };
}

function resolveEntryEffectAnnouncement({
  catalogData,
  catalogItem,
  command,
  cosmeticsFlags,
  equipment,
  featureFlags,
  nowMs,
  ownership,
  presentationRecords,
  publicProfile,
  room,
  senderUid,
}) {
  if (featureFlags?.voice_room_entry_effects !== true) {
    return entryEffectError('FEATURE_DISABLED', 503, 'Room entry effects are not enabled.');
  }
  if (!isActiveRoom(room)) {
    return entryEffectError('ROOM_NOT_ACTIVE', 409, 'The room is not available for entry effects.');
  }
  if (!isEligiblePublicProfile(publicProfile, senderUid)) {
    return entryEffectError('ACCOUNT_RESTRICTED', 403, 'A complete active profile is required.');
  }
  if (
    room.effectsPolicy === 'off'
    || room.roomCustomizationSuspended === true
    || (room.staffLockdown && typeof room.staffLockdown === 'object')
  ) {
    return { ok: true, value: { skipped: true, reason: 'ROOM_EFFECTS_DISABLED' } };
  }
  const equippedCarId = typeof equipment?.slots?.cars === 'string' ? equipment.slots.cars.trim() : '';
  if (!equippedCarId) {
    return { ok: true, value: { skipped: true, reason: 'NO_EQUIPPED_CAR' } };
  }
  if (!ownership || ownership.itemId !== equippedCarId || ownership.uid !== senderUid) {
    return entryEffectError('OWNERSHIP_REQUIRED', 409, 'Equipped entry vehicle ownership is required.');
  }
  if (ownership.state !== 'active' || ownership.category !== 'cars') {
    return entryEffectError('OWNERSHIP_INACTIVE', 409, 'The equipped entry vehicle is not active.');
  }
  const expiresAtMs = timestampToMillis(ownership.expiresAt);
  if (expiresAtMs && expiresAtMs <= nowMs) {
    return entryEffectError('OWNERSHIP_EXPIRED', 409, 'The equipped entry vehicle has expired.');
  }
  if (!catalogItem || catalogItem.itemId !== equippedCarId || catalogItem.category !== 'cars') {
    return entryEffectError('CATALOG_UNAVAILABLE', 404, 'Entry vehicle catalog item is unavailable.');
  }
  if (catalogItem.availability !== 'available') {
    return entryEffectError('CATALOG_UNAVAILABLE', 404, 'Entry vehicle catalog item is unavailable.');
  }
  const metadata = mapCarEntryEffectMetadata(catalogData, catalogItem);
  if (!metadata) {
    return entryEffectError('CATALOG_UNAVAILABLE', 404, 'Entry vehicle effect metadata is unavailable.');
  }
  const presentationInspection = catalogItem.entryPresentation
    ? inspectApprovedEntryPresentation({
      presentation: catalogItem.entryPresentation,
      records: presentationRecords,
    })
    : { ok: true, presentation: buildLegacyEntryPresentation() };
  if (!presentationInspection.ok) {
    return entryEffectError(
      presentationInspection.code || 'ENTRY_ASSET_UNAVAILABLE',
      409,
      'The equipped entry effect is not approved for playback.',
    );
  }
  const presentation = catalogItem.entryPresentation
    ? presentationInspection.presentation
    : {
      ...presentationInspection.presentation,
      durationMs: metadata.durationMs,
      minimumClientVersion: metadata.minimumClientVersion || '0.0.0',
      performanceTier: metadata.performanceTier,
      soundPolicy: metadata.soundPolicy,
    };
  if (
    presentation.minimumClientVersion !== '0.0.0'
    && (!command.clientVersion || compareClientVersions(command.clientVersion, presentation.minimumClientVersion) < 0)
  ) {
    return entryEffectError(
      'CLIENT_UPDATE_REQUIRED',
      426,
      'The equipped entry vehicle requires a newer client version.',
      { minimumClientVersion: presentation.minimumClientVersion },
    );
  }
  const delivery = resolveEntryPresentationDelivery(presentation, cosmeticsFlags);
  const roomEffectsPolicy = ['full', 'reduced', 'off'].includes(room.effectsPolicy)
    ? room.effectsPolicy
    : 'full';
  const eventId = createEntryEffectEventId(command.roomId, senderUid, command.sessionId);
  return {
    ok: true,
    value: {
      skipped: false,
      effect: {
        assetVersion: metadata.assetVersion,
        ...(delivery.animationEnabled ? {
          assetSnapshot: {
            audioAsset: presentation.audioAsset || null,
            audioChecksum: presentationRecords?.audio?.version?.sha256 || '',
            fallbackAsset: presentation.fallbackAsset,
            fallbackChecksum: presentationRecords?.fallback?.version?.sha256 || '',
            physicalApprovalReceiptId: presentation.physicalApprovalReceiptId,
            visualAsset: presentation.visualAsset,
            visualChecksum: presentationRecords?.visual?.version?.sha256 || '',
          },
          cosmeticAsset: presentation.visualAsset,
        } : {}),
        animationEnabled: delivery.animationEnabled,
        audioEnabled: delivery.audioEnabled,
        canonicalSlot: 'entry-effect',
        displayName: publicProfile.displayName,
        durationMs: presentation.durationMs,
        eventId,
        expiresAtMs: nowMs + EFFECT_TTL_MS,
        fallbackArtworkUrl: metadata.fallbackArtworkUrl,
        height: metadata.height,
        itemId: equippedCarId,
        kind: 'room-entry',
        legacyEquipmentSlot: 'cars',
        minimumClientVersion: presentation.minimumClientVersion,
        nameAr: metadata.nameAr,
        nameEn: metadata.nameEn,
        performanceTier: presentation.performanceTier,
        previewAssetUrl: metadata.previewAssetUrl,
        priority: presentation.performanceTier === 'high' ? 3 : 2,
        queueHintMax: MAX_QUEUE_HINT,
        roomEffectsPolicy,
        roomId: command.roomId,
        senderUid,
        sessionId: command.sessionId,
        soundPolicy: presentation.soundPolicy,
        thumbnailUrl: metadata.thumbnailUrl,
        ...(presentation.visualFormat ? { visualFormat: presentation.visualFormat } : {}),
        width: metadata.width,
      },
    },
  };
}

function createEntryEffectEventId(roomId, senderUid, sessionId) {
  return `ree_${createHash('sha256').update(`${roomId}|${senderUid}|${sessionId}`).digest('hex').slice(0, 24)}`;
}

function buildEntryEffectFingerprint(uid, command) {
  return createHash('sha256')
    .update([
      uid,
      command.action,
      command.roomId,
      command.sessionId,
      command.clientVersion,
      command.requestId,
    ].join('|'))
    .digest('hex');
}

function entryEffectError(code, status, error, details) {
  return {
    ok: false,
    code,
    status,
    error,
    ...(details ? { details } : {}),
  };
}

function isActiveRoom(room) {
  return Boolean(
    room
    && room.status === 'active'
    && (room.availability === undefined || room.availability === 'active'),
  );
}

function isEligiblePublicProfile(profile, uid) {
  return Boolean(
    profile
    && profile.uid === uid
    && profile.moderationStatus === 'active'
    && typeof profile.displayName === 'string'
    && profile.displayName.length >= 2,
  );
}

function timestampToMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function compareClientVersions(left, right) {
  const parse = (value) => String(value).split(/[+-]/, 1)[0].split('.').map((part) => Number(part));
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
}

function isApprovedEntryAssetUrl(value) {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!/^https:\/\/[^\s]{1,2039}$/.test(url)) return false;
  try {
    const parsed = new URL(url);
    const decodedPath = decodeURIComponent(parsed.pathname);
    if (parsed.hostname === 'firebasestorage.googleapis.com') {
      return /\/o\/store-assets\/[^/]+\/(thumbnail|preview)\/[A-Za-z0-9_-]{16,80}$/.test(decodedPath);
    }
    if (parsed.hostname === 'storage.googleapis.com') {
      return /\/store-assets\/[^/]+\/(thumbnail|preview)\/[A-Za-z0-9_-]{16,80}$/.test(decodedPath);
    }
    return false;
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULT_DURATION_MS,
  EFFECT_RETENTION_MS,
  EFFECT_TTL_MS,
  MAX_QUEUE_HINT,
  ROOM_ENTRY_EFFECT_ACTIONS,
  buildEntryEffectFingerprint,
  compareClientVersions,
  createEntryEffectEventId,
  entryEffectError,
  mapCarEntryEffectMetadata,
  normalizeRoomEntryEffectBody,
  resolveEntryEffectAnnouncement,
  timestampToMillis,
  validateRoomEntryEffectRequest,
};
