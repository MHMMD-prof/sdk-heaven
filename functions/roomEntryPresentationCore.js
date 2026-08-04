'use strict';

const { createHash } = require('node:crypto');

const ENTRY_SOUND_POLICIES = Object.freeze(['off', 'soft', 'full']);
const PERFORMANCE_TIERS = Object.freeze(['low', 'standard', 'high']);
const ASSET_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,79}$/;
const VERSION_ID_PATTERN = /^v[1-9][0-9]{0,8}-[a-f0-9]{12}$/;
const CLIENT_VERSION_PATTERN = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const RECEIPT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{15,159}$/;
const STATIC_FORMATS = Object.freeze(['png', 'legacy-webp']);
const VISUAL_FORMATS = Object.freeze(['lottie-json', 'mp4']);
const MIN_ENTRY_DURATION_MS = 3_000;
const MAX_ENTRY_DURATION_MS = 5_000;

function mapEntryPresentation(value) {
  if (!isRecord(value) || Object.keys(value).some((key) => ![
    'animationEnabled', 'audioAsset', 'audioFormat', 'durationMs', 'fallbackAsset', 'fallbackFormat',
    'minimumClientVersion', 'performanceTier', 'physicalApprovalReceiptId', 'schemaVersion',
    'soundPolicy', 'visualAsset', 'visualFormat',
  ].includes(key))) return undefined;
  if (value.schemaVersion !== 1 || typeof value.animationEnabled !== 'boolean') return undefined;
  const durationMs = Number(value.durationMs);
  const minimumClientVersion = readString(value.minimumClientVersion);
  const performanceTier = PERFORMANCE_TIERS.includes(value.performanceTier) ? value.performanceTier : '';
  const soundPolicy = ENTRY_SOUND_POLICIES.includes(value.soundPolicy) ? value.soundPolicy : '';
  if (
    !Number.isSafeInteger(durationMs)
    || durationMs < MIN_ENTRY_DURATION_MS
    || durationMs > MAX_ENTRY_DURATION_MS
    || !CLIENT_VERSION_PATTERN.test(minimumClientVersion)
    || !performanceTier
    || !soundPolicy
  ) return undefined;

  if (!value.animationEnabled) {
    if (
      value.visualAsset !== undefined
      || value.fallbackAsset !== undefined
      || value.audioAsset !== undefined
      || value.physicalApprovalReceiptId !== undefined
    ) return undefined;
    return {
      animationEnabled: false,
      durationMs,
      minimumClientVersion,
      performanceTier,
      schemaVersion: 1,
      soundPolicy: 'off',
    };
  }

  const visualAsset = mapAssetReference(value.visualAsset);
  const fallbackAsset = mapAssetReference(value.fallbackAsset);
  const audioAsset = value.audioAsset === undefined ? undefined : mapAssetReference(value.audioAsset);
  const physicalApprovalReceiptId = readString(value.physicalApprovalReceiptId);
  if (
    !visualAsset
    || !fallbackAsset
    || (value.audioAsset !== undefined && !audioAsset)
    || !RECEIPT_ID_PATTERN.test(physicalApprovalReceiptId)
    || (soundPolicy === 'off' && audioAsset)
    || (soundPolicy !== 'off' && !audioAsset)
    || (value.visualFormat !== undefined && !VISUAL_FORMATS.includes(value.visualFormat))
    || (value.fallbackFormat !== undefined && !STATIC_FORMATS.includes(value.fallbackFormat))
    || (value.audioFormat !== undefined && value.audioFormat !== 'm4a-aac')
  ) return undefined;
  return {
    animationEnabled: true,
    ...(audioAsset ? { audioAsset } : {}),
    ...(value.audioFormat ? { audioFormat: value.audioFormat } : {}),
    durationMs,
    fallbackAsset,
    ...(value.fallbackFormat ? { fallbackFormat: value.fallbackFormat } : {}),
    minimumClientVersion,
    performanceTier,
    physicalApprovalReceiptId,
    schemaVersion: 1,
    soundPolicy,
    visualAsset,
    ...(value.visualFormat ? { visualFormat: value.visualFormat } : {}),
  };
}

function buildLegacyEntryPresentation() {
  return {
    animationEnabled: false,
    durationMs: 4_000,
    minimumClientVersion: '0.0.0',
    performanceTier: 'low',
    schemaVersion: 1,
    soundPolicy: 'off',
  };
}

function inspectApprovedEntryPresentation({ presentation, records }) {
  if (!presentation?.animationEnabled) {
    return { ok: true, presentation: presentation || buildLegacyEntryPresentation() };
  }
  const visual = inspectApprovedAsset(records?.visual, presentation.visualAsset, {
    category: 'entry-effect',
    formats: VISUAL_FORMATS,
  });
  if (!visual.ok) return visual;
  const fallback = inspectApprovedAsset(records?.fallback, presentation.fallbackAsset, {
    category: 'entry-effect',
    formats: STATIC_FORMATS,
  });
  if (!fallback.ok) return fallback;
  if (
    records.visual.version.width !== 1280
    || records.visual.version.height !== 720
    || records.fallback.version.width !== 1280
    || records.fallback.version.height !== 720
    || records.visual.version.durationMs !== presentation.durationMs
    || (records.visual.version.format === 'lottie-json' && records.visual.version.transparent !== true)
    || (records.visual.version.format === 'mp4' && records.visual.version.transparent !== false)
  ) return { ok: false, code: 'ENTRY_PRESENTATION_REGION_INVALID' };
  if (
    records.visual.version.fallbackAssetId !== presentation.fallbackAsset.assetId
    || records.visual.version.fallbackAssetVersionId !== presentation.fallbackAsset.assetVersionId
  ) return { ok: false, code: 'ENTRY_FALLBACK_MISMATCH' };
  const audio = presentation.audioAsset
    ? inspectApprovedAsset(records?.audio, presentation.audioAsset, {
      category: 'effect-audio',
      formats: ['m4a-aac'],
    })
    : { ok: true };
  if (!audio.ok) return audio;
  if (presentation.audioAsset && (
    !Number.isSafeInteger(records.audio.version.durationMs)
    || records.audio.version.durationMs < 1
    || records.audio.version.durationMs > presentation.durationMs
  )) return { ok: false, code: 'ENTRY_AUDIO_DURATION_INVALID' };
  if (presentation.audioAsset && (
    records.visual.version.audioAssetId !== presentation.audioAsset.assetId
    || records.visual.version.audioAssetVersionId !== presentation.audioAsset.assetVersionId
  )) return { ok: false, code: 'ENTRY_AUDIO_MISMATCH' };

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
    || receipt.minimumClientVersion !== presentation.minimumClientVersion
    || receipt.performanceTier !== presentation.performanceTier
    || receipt.soundPolicy !== presentation.soundPolicy
    || receipt.androidPassed !== true
    || receipt.iosPassed !== true
    || receipt.controlsSafeZonePassed !== true
    || readString(receipt.androidDevice).length < 2
    || readString(receipt.iosDevice).length < 2
    || !CLIENT_VERSION_PATTERN.test(readString(receipt.testedClientVersion))
    || compareClientVersions(receipt.testedClientVersion, presentation.minimumClientVersion) < 0
    || (records.visual.version.format === 'mp4' && receipt.opaqueCompositionPassed !== true)
  ) return { ok: false, code: 'ENTRY_PHYSICAL_APPROVAL_REQUIRED' };
  if (presentation.audioAsset && (
    receipt.audioAssetId !== presentation.audioAsset.assetId
    || receipt.audioAssetVersionId !== presentation.audioAsset.assetVersionId
    || receipt.audioChecksum !== records.audio.version.sha256
  )) return { ok: false, code: 'ENTRY_PHYSICAL_APPROVAL_REQUIRED' };

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
    || version.usage !== (options.category === 'effect-audio' ? 'one-shot' : version.usage)
    || approval.assetId !== reference.assetId
    || approval.assetVersionId !== reference.assetVersionId
    || approval.decision !== 'approved'
    || typeof version.sha256 !== 'string'
    || approval.checksum !== version.sha256
  ) return { ok: false, code: 'ENTRY_ASSET_UNAVAILABLE' };
  if (options.category === 'entry-effect' && !STATIC_FORMATS.includes(version.format) && version.usage !== 'one-shot') {
    return { ok: false, code: 'ENTRY_ASSET_UNAVAILABLE' };
  }
  return { ok: true };
}

function resolveEntryPresentationDelivery(presentation, flags = {}) {
  const animationEnabled = presentation?.animationEnabled === true
    && flags.room_entry_animations === true
    && (presentation.visualFormat !== 'mp4' || flags.room_entry_video === true);
  return {
    animationEnabled,
    audioEnabled: animationEnabled
      && presentation.soundPolicy !== 'off'
      && flags.room_entry_audio === true,
  };
}

function createEntryPhysicalApprovalReceiptId(itemId, visualAssetVersionId) {
  return `entry_physical_${createHash('sha256').update(`${itemId}|${visualAssetVersionId}`).digest('hex').slice(0, 32)}`;
}

function mapEntryPhysicalApproval(value) {
  if (!isRecord(value) || Object.keys(value).some((key) => ![
    'androidDevice', 'androidPassed', 'controlsSafeZonePassed', 'iosDevice', 'iosPassed',
    'notes', 'opaqueCompositionPassed', 'testedClientVersion',
  ].includes(key))) return undefined;
  const androidDevice = readString(value.androidDevice).slice(0, 120);
  const iosDevice = readString(value.iosDevice).slice(0, 120);
  const notes = readString(value.notes).slice(0, 500);
  const testedClientVersion = readString(value.testedClientVersion);
  if (
    value.androidPassed !== true
    || value.iosPassed !== true
    || value.controlsSafeZonePassed !== true
    || typeof value.opaqueCompositionPassed !== 'boolean'
    || androidDevice.length < 2
    || iosDevice.length < 2
    || !CLIENT_VERSION_PATTERN.test(testedClientVersion)
  ) return undefined;
  return {
    androidDevice,
    androidPassed: true,
    controlsSafeZonePassed: true,
    iosDevice,
    iosPassed: true,
    notes,
    opaqueCompositionPassed: value.opaqueCompositionPassed,
    testedClientVersion,
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

function compareClientVersions(left, right) {
  const leftParts = String(left).split('.').map(Number);
  const rightParts = String(right).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1;
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
  ENTRY_SOUND_POLICIES,
  MAX_ENTRY_DURATION_MS,
  MIN_ENTRY_DURATION_MS,
  buildLegacyEntryPresentation,
  createEntryPhysicalApprovalReceiptId,
  inspectApprovedEntryPresentation,
  mapEntryPhysicalApproval,
  mapEntryPresentation,
  resolveEntryPresentationDelivery,
};
