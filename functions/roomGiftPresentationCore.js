'use strict';

const { createHash } = require('node:crypto');

const GIFT_PRESENTATION_TIERS = Object.freeze(['inline', 'targeted', 'major', 'global']);
const GIFT_SOUND_POLICIES = Object.freeze(['off', 'soft', 'full']);
const GIFT_HAPTIC_POLICIES = Object.freeze(['off', 'light', 'success']);
const PERFORMANCE_TIERS = Object.freeze(['low', 'standard', 'high']);
const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const VERSION_ID_PATTERN = /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/;
const CLIENT_VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const RECEIPT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,159}$/;
const STATIC_FORMATS = Object.freeze(['png', 'jpeg', 'legacy-webp']);
const VISUAL_FORMATS = Object.freeze(['lottie-json', 'mp4']);
const COMBO_WINDOW_MS = 4_000;
const MAX_COMBO_COUNT = 999;
const MIN_GIFT_DURATION_MS = 1_500;
const MAX_GIFT_DURATION_MS = 6_000;

function mapGiftPresentation(value) {
  if (!isRecord(value)) return undefined;
  if (Object.keys(value).some((key) => ![
    'animationEnabled', 'audioAsset', 'audioFormat', 'durationMs', 'fallbackAsset', 'fallbackFormat', 'hapticPolicy',
    'minimumClientVersion', 'performanceTier', 'physicalApprovalReceiptId',
    'schemaVersion', 'soundPolicy', 'tier', 'visualAsset', 'visualFormat',
  ].includes(key))) return undefined;
  if (value.schemaVersion !== 1 || typeof value.animationEnabled !== 'boolean') return undefined;
  const tier = GIFT_PRESENTATION_TIERS.includes(value.tier) ? value.tier : '';
  const performanceTier = PERFORMANCE_TIERS.includes(value.performanceTier) ? value.performanceTier : '';
  const soundPolicy = GIFT_SOUND_POLICIES.includes(value.soundPolicy) ? value.soundPolicy : '';
  const hapticPolicy = GIFT_HAPTIC_POLICIES.includes(value.hapticPolicy) ? value.hapticPolicy : '';
  const minimumClientVersion = readString(value.minimumClientVersion);
  const durationMs = Number(value.durationMs);
  if (
    !tier
    || !performanceTier
    || !soundPolicy
    || !hapticPolicy
    || !CLIENT_VERSION_PATTERN.test(minimumClientVersion)
    || !Number.isSafeInteger(durationMs)
    || durationMs < MIN_GIFT_DURATION_MS
    || durationMs > MAX_GIFT_DURATION_MS
  ) return undefined;

  if (!value.animationEnabled) {
    if (value.visualAsset !== undefined || value.fallbackAsset !== undefined || value.audioAsset !== undefined || value.physicalApprovalReceiptId !== undefined) {
      return undefined;
    }
    return {
      animationEnabled: false,
      durationMs,
      hapticPolicy,
      minimumClientVersion,
      performanceTier,
      schemaVersion: 1,
      soundPolicy: 'off',
      tier,
    };
  }

  const visualAsset = mapAssetReference(value.visualAsset);
  const fallbackAsset = mapAssetReference(value.fallbackAsset);
  const audioAsset = value.audioAsset === undefined ? undefined : mapAssetReference(value.audioAsset);
  const physicalApprovalReceiptId = readString(value.physicalApprovalReceiptId);
  if (!visualAsset || !fallbackAsset || (value.audioAsset !== undefined && !audioAsset) || !RECEIPT_ID_PATTERN.test(physicalApprovalReceiptId)) {
    return undefined;
  }
  if (soundPolicy !== 'off' && !audioAsset) return undefined;
  if (soundPolicy === 'off' && audioAsset) return undefined;
  if (value.visualFormat !== undefined && !VISUAL_FORMATS.includes(value.visualFormat)) return undefined;
  if (value.fallbackFormat !== undefined && !STATIC_FORMATS.includes(value.fallbackFormat)) return undefined;
  if (value.audioFormat !== undefined && value.audioFormat !== 'm4a-aac') return undefined;
  return {
    animationEnabled: true,
    ...(value.audioFormat ? { audioFormat: value.audioFormat } : {}),
    ...(audioAsset ? { audioAsset } : {}),
    durationMs,
    fallbackAsset,
    ...(value.fallbackFormat ? { fallbackFormat: value.fallbackFormat } : {}),
    hapticPolicy,
    minimumClientVersion,
    performanceTier,
    physicalApprovalReceiptId,
    schemaVersion: 1,
    soundPolicy,
    tier,
    visualAsset,
    ...(value.visualFormat ? { visualFormat: value.visualFormat } : {}),
  };
}

function buildLegacyGiftPresentation() {
  return {
    animationEnabled: false,
    durationMs: 3_000,
    hapticPolicy: 'off',
    minimumClientVersion: '0.0.0',
    performanceTier: 'low',
    schemaVersion: 1,
    soundPolicy: 'off',
    tier: 'inline',
  };
}

function mapAssetReference(value) {
  if (!isRecord(value) || Object.keys(value).some((key) => !['assetId', 'assetVersionId'].includes(key))) return undefined;
  const assetId = readString(value.assetId);
  const assetVersionId = readString(value.assetVersionId);
  return ASSET_ID_PATTERN.test(assetId) && VERSION_ID_PATTERN.test(assetVersionId)
    ? { assetId, assetVersionId }
    : undefined;
}

function inspectApprovedGiftPresentation({ presentation, records }) {
  if (!presentation?.animationEnabled) return { ok: true, presentation: presentation || buildLegacyGiftPresentation() };
  const visual = inspectApprovedAsset(records?.visual, presentation.visualAsset, {
    category: 'gift-effect',
    formats: VISUAL_FORMATS,
  });
  if (!visual.ok) return visual;
  const fallback = inspectApprovedAsset(records?.fallback, presentation.fallbackAsset, {
    category: 'gift-effect',
    formats: STATIC_FORMATS,
  });
  if (!fallback.ok) return fallback;
  if (
    records.visual.version.fallbackAssetId !== presentation.fallbackAsset.assetId
    || records.visual.version.fallbackAssetVersionId !== presentation.fallbackAsset.assetVersionId
  ) return { ok: false, code: 'PRESENTATION_FALLBACK_MISMATCH' };
  const audio = presentation.audioAsset
    ? inspectApprovedAsset(records?.audio, presentation.audioAsset, {
      category: 'effect-audio',
      formats: ['m4a-aac'],
    })
    : { ok: true };
  if (!audio.ok) return audio;
  if (presentation.audioAsset && (
    records.visual.version.audioAssetId !== presentation.audioAsset.assetId
    || records.visual.version.audioAssetVersionId !== presentation.audioAsset.assetVersionId
  )) return { ok: false, code: 'PRESENTATION_AUDIO_MISMATCH' };

  const receipt = records?.physicalReceipt;
  if (
    !isRecord(receipt)
    || receipt.id !== presentation.physicalApprovalReceiptId
    || receipt.status !== 'passed'
    || receipt.visualAssetId !== presentation.visualAsset.assetId
    || receipt.visualAssetVersionId !== presentation.visualAsset.assetVersionId
    || receipt.visualChecksum !== records.visual.version.sha256
    || receipt.fallbackAssetId !== presentation.fallbackAsset.assetId
    || receipt.fallbackAssetVersionId !== presentation.fallbackAsset.assetVersionId
    || receipt.fallbackChecksum !== records.fallback.version.sha256
    || receipt.durationMs !== presentation.durationMs
    || receipt.hapticPolicy !== presentation.hapticPolicy
    || receipt.minimumClientVersion !== presentation.minimumClientVersion
    || receipt.performanceTier !== presentation.performanceTier
    || receipt.soundPolicy !== presentation.soundPolicy
    || receipt.tier !== presentation.tier
    || receipt.androidPassed !== true
    || receipt.iosPassed !== true
    || readString(receipt.androidDevice).length < 2
    || readString(receipt.iosDevice).length < 2
    || !CLIENT_VERSION_PATTERN.test(readString(receipt.testedClientVersion))
    || compareClientVersions(receipt.testedClientVersion, presentation.minimumClientVersion) < 0
  ) return { ok: false, code: 'PHYSICAL_APPROVAL_REQUIRED' };
  if (presentation.audioAsset && (
    receipt.audioAssetId !== presentation.audioAsset.assetId
    || receipt.audioAssetVersionId !== presentation.audioAsset.assetVersionId
    || receipt.audioChecksum !== records.audio.version.sha256
  )) return { ok: false, code: 'PHYSICAL_APPROVAL_REQUIRED' };

  return {
    ok: true,
    presentation: {
      ...presentation,
      audioFormat: records?.audio?.version?.format || '',
      fallbackFormat: records.fallback.version.format,
      visualFormat: records.visual.version.format,
    },
  };
}

function inspectApprovedAsset(record, reference, options) {
  const summary = record?.summary;
  const version = record?.version;
  const approval = record?.approval;
  if (
    !isRecord(summary)
    || !isRecord(version)
    || !isRecord(approval)
    || summary.assetId !== reference.assetId
    || summary.moderationStatus !== 'approved'
    || summary.publicationStatus !== 'published'
    || summary.renderingEnabled !== true
    || summary.publishedVersionId !== reference.assetVersionId
    || summary.approvedVersionId !== reference.assetVersionId
    || summary.approvalId !== `${reference.assetId}__${reference.assetVersionId}`
    || version.assetId !== reference.assetId
    || version.assetVersionId !== reference.assetVersionId
    || version.category !== options.category
    || !options.formats.includes(version.format)
    || approval.assetId !== reference.assetId
    || approval.assetVersionId !== reference.assetVersionId
    || approval.decision !== 'approved'
    || typeof version.sha256 !== 'string'
    || approval.checksum !== version.sha256
  ) return { ok: false, code: 'PRESENTATION_ASSET_UNAVAILABLE' };
  return { ok: true };
}

function createGiftPhysicalApprovalReceiptId(giftId, visualAssetVersionId) {
  return `gift_physical_${createHash('sha256').update(`${giftId}|${visualAssetVersionId}`).digest('hex').slice(0, 32)}`;
}

function createGiftComboId({ giftId, senderUid, targetUid }) {
  return `combo_${createHash('sha256').update(`${senderUid}|${targetUid}|${giftId}`).digest('hex').slice(0, 32)}`;
}

function resolveGiftComboState({ existing, giftId, nowMs, quantity, senderUid, targetUid, tier }) {
  const comboId = createGiftComboId({ giftId, senderUid, targetUid });
  const compatible = isRecord(existing)
    && existing.comboId === comboId
    && existing.giftId === giftId
    && existing.senderUid === senderUid
    && existing.targetUid === targetUid
    && existing.tier === tier
    && timestampToMillis(existing.windowExpiresAt) > nowMs;
  const previousCount = compatible && Number.isSafeInteger(existing.comboCount)
    ? Math.min(MAX_COMBO_COUNT, Math.max(0, existing.comboCount))
    : 0;
  const previousSequence = compatible && Number.isSafeInteger(existing.sequence)
    ? Math.max(0, existing.sequence)
    : 0;
  return {
    comboCount: Math.min(MAX_COMBO_COUNT, previousCount + quantity),
    comboId,
    comboKey: comboId,
    giftId,
    senderUid,
    sequence: previousSequence + 1,
    targetUid,
    tier,
    windowExpiresAtMs: nowMs + COMBO_WINDOW_MS,
  };
}

function resolveGiftPresentationDelivery(presentation, flags = {}, clientVersion = '') {
  const clientCompatible = Boolean(
    CLIENT_VERSION_PATTERN.test(clientVersion)
    && compareClientVersions(clientVersion, presentation?.minimumClientVersion || '0.0.0') >= 0,
  );
  const baseAnimated = presentation?.animationEnabled === true
    && clientCompatible
    && flags.room_gift_animations === true
    && (presentation.visualFormat !== 'mp4' || flags.room_gift_video === true);
  const globalRequested = presentation?.tier === 'global';
  const global = baseAnimated && globalRequested && flags.room_gift_global_effects === true;
  const animated = baseAnimated && (!globalRequested || global);
  const audio = animated
    && presentation.soundPolicy !== 'off'
    && flags.room_gift_audio === true;
  return {
    animationEnabled: animated,
    audioEnabled: audio,
    globalEnabled: global,
    presentationTier: animated ? presentation.tier : 'inline',
  };
}

function isEligibleGlobalGiftCampaign({ campaign, giftId, nowMs, room }) {
  if (
    !isRecord(campaign)
    || campaign.enabled !== true
    || campaign.status !== 'active'
    || !Array.isArray(campaign.giftIds)
    || !campaign.giftIds.includes(giftId)
    || timestampToMillis(campaign.startsAt) > nowMs
    || timestampToMillis(campaign.endsAt) <= nowMs
    || !isRecord(room)
    || room.status !== 'active'
  ) return false;
  const visibility = room.visibility === 'public' ? 'public' : 'private';
  if (!Array.isArray(campaign.allowedRoomVisibilities) || !campaign.allowedRoomVisibilities.includes(visibility)) return false;
  if (Array.isArray(campaign.countryCodes) && campaign.countryCodes.length > 0) {
    const countryCode = readString(room.countryCode).toUpperCase();
    if (!campaign.countryCodes.includes(countryCode)) return false;
  }
  return true;
}

function compareClientVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
  }
  return 0;
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

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

module.exports = {
  COMBO_WINDOW_MS,
  GIFT_HAPTIC_POLICIES,
  GIFT_PRESENTATION_TIERS,
  GIFT_SOUND_POLICIES,
  MAX_COMBO_COUNT,
  buildLegacyGiftPresentation,
  createGiftComboId,
  createGiftPhysicalApprovalReceiptId,
  inspectApprovedGiftPresentation,
  isEligibleGlobalGiftCampaign,
  mapGiftPresentation,
  resolveGiftComboState,
  resolveGiftPresentationDelivery,
};
