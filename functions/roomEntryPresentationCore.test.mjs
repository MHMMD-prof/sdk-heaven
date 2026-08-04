import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createEntryPhysicalApprovalReceiptId,
  inspectApprovedEntryPresentation,
  mapEntryPhysicalApproval,
  mapEntryPresentation,
  resolveEntryPresentationDelivery,
} = require('./roomEntryPresentationCore');

const visualAsset = { assetId: 'royal-entry', assetVersionId: 'v1-aaaaaaaaaaaa' };
const fallbackAsset = { assetId: 'royal-entry-static', assetVersionId: 'v1-bbbbbbbbbbbb' };
const receiptId = createEntryPhysicalApprovalReceiptId('car-1', visualAsset.assetVersionId);
const presentation = {
  animationEnabled: true,
  durationMs: 4_000,
  fallbackAsset,
  minimumClientVersion: '1.0.0',
  performanceTier: 'standard',
  physicalApprovalReceiptId: receiptId,
  schemaVersion: 1,
  soundPolicy: 'off',
  visualAsset,
  visualFormat: 'lottie-json',
};

describe('roomEntryPresentationCore', () => {
  it('maps only exact animated bundles and safe physical approvals', () => {
    expect(mapEntryPresentation(presentation)).toEqual(presentation);
    expect(mapEntryPresentation({ ...presentation, durationMs: 8_000 })).toBeUndefined();
    expect(mapEntryPresentation({ ...presentation, visualAsset: { assetId: '../bad', assetVersionId: 'latest' } })).toBeUndefined();
    expect(mapEntryPhysicalApproval({
      androidDevice: 'Pixel 9',
      androidPassed: true,
      controlsSafeZonePassed: true,
      iosDevice: 'iPhone 16',
      iosPassed: true,
      notes: 'No overlap.',
      opaqueCompositionPassed: false,
      testedClientVersion: '1.0.0',
    })).toMatchObject({ controlsSafeZonePassed: true, testedClientVersion: '1.0.0' });
  });

  it('requires published exact versions and a matching immutable device receipt', () => {
    const records = approvedRecords('lottie-json');
    expect(inspectApprovedEntryPresentation({ presentation, records })).toMatchObject({
      ok: true,
      presentation: { fallbackFormat: 'png', visualFormat: 'lottie-json' },
    });
    expect(inspectApprovedEntryPresentation({
      presentation,
      records: {
        ...records,
        visual: { ...records.visual, summary: { ...records.visual.summary, moderationStatus: 'suspended' } },
      },
    })).toMatchObject({ code: 'ENTRY_ASSET_UNAVAILABLE', ok: false });
    expect(inspectApprovedEntryPresentation({
      presentation,
      records: { ...records, physicalReceipt: { ...records.physicalReceipt, controlsSafeZonePassed: false } },
    })).toMatchObject({ code: 'ENTRY_PHYSICAL_APPROVAL_REQUIRED', ok: false });
  });

  it('requires an opaque physical composition pass for MP4 and keeps rollout flags independent', () => {
    const mp4Presentation = { ...presentation, visualFormat: 'mp4' };
    const records = approvedRecords('mp4');
    expect(inspectApprovedEntryPresentation({ presentation: mp4Presentation, records }))
      .toMatchObject({ code: 'ENTRY_PHYSICAL_APPROVAL_REQUIRED', ok: false });
    expect(inspectApprovedEntryPresentation({
      presentation: mp4Presentation,
      records: { ...records, physicalReceipt: { ...records.physicalReceipt, opaqueCompositionPassed: true } },
    }).ok).toBe(true);
    expect(resolveEntryPresentationDelivery(
      { ...mp4Presentation, visualFormat: 'mp4' },
      { room_entry_animations: true, room_entry_audio: true, room_entry_video: false },
    )).toEqual({ animationEnabled: false, audioEnabled: false });
    expect(resolveEntryPresentationDelivery(
      { ...presentation, soundPolicy: 'soft', visualFormat: 'lottie-json' },
      { room_entry_animations: true, room_entry_audio: false },
    )).toEqual({ animationEnabled: true, audioEnabled: false });
  });
});

function approvedRecords(format) {
  const visualChecksum = 'a'.repeat(64);
  const fallbackChecksum = 'b'.repeat(64);
  return {
    fallback: assetRecord(fallbackAsset, 'entry-effect', 'png', fallbackChecksum, { usage: 'static' }),
    physicalReceipt: {
      androidDevice: 'Pixel 9',
      androidPassed: true,
      controlsSafeZonePassed: true,
      durationMs: 4_000,
      fallbackAssetId: fallbackAsset.assetId,
      fallbackAssetVersionId: fallbackAsset.assetVersionId,
      fallbackChecksum,
      id: receiptId,
      iosDevice: 'iPhone 16',
      iosPassed: true,
      minimumClientVersion: '1.0.0',
      opaqueCompositionPassed: false,
      performanceTier: 'standard',
      soundPolicy: 'off',
      status: 'passed',
      testedClientVersion: '1.0.0',
      visualAssetId: visualAsset.assetId,
      visualAssetVersionId: visualAsset.assetVersionId,
      visualChecksum,
    },
    visual: assetRecord(visualAsset, 'entry-effect', format, visualChecksum, {
      fallbackAssetId: fallbackAsset.assetId,
      fallbackAssetVersionId: fallbackAsset.assetVersionId,
      usage: 'one-shot',
    }),
  };
}

function assetRecord(reference, category, format, checksum, extra) {
  return {
    approval: {
      assetId: reference.assetId,
      assetVersionId: reference.assetVersionId,
      checksum,
      decision: 'approved',
    },
    summary: {
      approvalId: `${reference.assetId}__${reference.assetVersionId}`,
      approvedVersionId: reference.assetVersionId,
      assetId: reference.assetId,
      moderationStatus: 'approved',
      publicationStatus: 'published',
      publishedVersionId: reference.assetVersionId,
      renderingEnabled: true,
    },
    version: {
      assetId: reference.assetId,
      assetVersionId: reference.assetVersionId,
      category,
      format,
      ...(category === 'entry-effect' ? { height: 720, transparent: format === 'lottie-json', width: 1280 } : {}),
      ...(['lottie-json', 'mp4'].includes(format) ? { durationMs: 4_000 } : {}),
      sha256: checksum,
      ...extra,
    },
  };
}
