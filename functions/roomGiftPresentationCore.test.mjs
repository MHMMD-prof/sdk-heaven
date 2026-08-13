import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildLegacyGiftPresentation,
  createGiftPhysicalApprovalReceiptId,
  inspectApprovedGiftPresentation,
  inspectGiftPresentation,
  isEligibleGlobalGiftCampaign,
  mapGiftPresentation,
  resolveGiftComboState,
  resolveGiftPresentationDelivery,
} = require('./roomGiftPresentationCore');

const refs = {
  audio: { assetId: 'gift-audio', assetVersionId: 'v1-cccccccccccc' },
  fallback: { assetId: 'gift-fallback', assetVersionId: 'v1-bbbbbbbbbbbb' },
  visual: { assetId: 'gift-motion', assetVersionId: 'v1-aaaaaaaaaaaa' },
};

function presentation(overrides = {}) {
  return {
    animationEnabled: true,
    approvalMode: 'strict',
    audioAsset: refs.audio,
    durationMs: 3_000,
    fallbackAsset: refs.fallback,
    hapticPolicy: 'light',
    minimumClientVersion: '1.0.0',
    performanceTier: 'standard',
    physicalApprovalReceiptId: createGiftPhysicalApprovalReceiptId('rose', refs.visual.assetVersionId),
    schemaVersion: 1,
    soundPolicy: 'soft',
    tier: 'major',
    visualAsset: refs.visual,
    ...overrides,
  };
}

function approvedRecord(reference, category, format, sha) {
  const animated = format === 'lottie-json' || format === 'mp4';
  const audio = format === 'm4a-aac';
  return {
    approval: {
      assetId: reference.assetId,
      assetVersionId: reference.assetVersionId,
      checksum: sha,
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
      audioCodec: audio ? 'aac' : '',
      byteSize: audio ? 100_000 : animated ? 500_000 : 100_000,
      durationMs: audio || animated ? 3_000 : 0,
      frameRate: animated ? 30 : 0,
      height: audio ? 0 : 720,
      loop: false,
      sha256: sha,
      transparent: format === 'lottie-json' || format === 'png',
      usage: animated || audio ? 'one-shot' : 'static',
      videoCodec: format === 'mp4' ? 'h264' : '',
      width: audio ? 0 : 1280,
    },
  };
}

function records() {
  const visual = approvedRecord(refs.visual, 'gift-effect', 'lottie-json', 'a'.repeat(64));
  visual.version.fallbackAssetId = refs.fallback.assetId;
  visual.version.fallbackAssetVersionId = refs.fallback.assetVersionId;
  visual.version.audioAssetId = refs.audio.assetId;
  visual.version.audioAssetVersionId = refs.audio.assetVersionId;
  return {
    audio: approvedRecord(refs.audio, 'effect-audio', 'm4a-aac', 'c'.repeat(64)),
    fallback: approvedRecord(refs.fallback, 'gift-effect', 'png', 'b'.repeat(64)),
    physicalReceipt: {
      androidPassed: true,
      androidDevice: 'Pixel 9',
      audioAssetId: refs.audio.assetId,
      audioAssetVersionId: refs.audio.assetVersionId,
      audioChecksum: 'c'.repeat(64),
      copyTemplateVersion: 1,
      controlsSafeZonePassed: true,
      durationMs: 3_000,
      fallbackAssetId: refs.fallback.assetId,
      fallbackAssetVersionId: refs.fallback.assetVersionId,
      fallbackChecksum: 'b'.repeat(64),
      id: presentation().physicalApprovalReceiptId,
      hapticPolicy: 'light',
      iosPassed: true,
      iosDevice: 'iPhone 16',
      minimumClientVersion: '1.0.0',
      performanceTier: 'standard',
      presentationSurface: 'bottom-stage',
      status: 'passed',
      soundPolicy: 'soft',
      testedClientVersion: '1.0.0',
      tier: 'major',
      visualAssetId: refs.visual.assetId,
      visualAssetVersionId: refs.visual.assetVersionId,
      visualChecksum: 'a'.repeat(64),
    },
    visual,
  };
}

describe('room gift presentation contract', () => {
  it('keeps legacy gifts static and economically usable', () => {
    expect(mapGiftPresentation(buildLegacyGiftPresentation())).toEqual(buildLegacyGiftPresentation());
  });

  it('requires exact approved visual, fallback, audio and physical receipts', () => {
    const inspected = inspectApprovedGiftPresentation({ presentation: presentation(), records: records() });
    expect(inspected).toMatchObject({
      ok: true,
      presentation: { fallbackFormat: 'png', visualFormat: 'lottie-json' },
    });
    const legacyReceipt = records();
    delete legacyReceipt.physicalReceipt.copyTemplateVersion;
    delete legacyReceipt.physicalReceipt.presentationSurface;
    expect(inspectApprovedGiftPresentation({ presentation: presentation(), records: legacyReceipt }).ok).toBe(true);
    const rejected = records();
    rejected.physicalReceipt.iosPassed = false;
    expect(inspectApprovedGiftPresentation({ presentation: presentation(), records: rejected }))
      .toEqual({ code: 'PHYSICAL_APPROVAL_REQUIRED', ok: false });
    const wrongSurface = records();
    wrongSurface.physicalReceipt.presentationSurface = 'full-overlay';
    expect(inspectApprovedGiftPresentation({ presentation: presentation(), records: wrongSurface }))
      .toEqual({ code: 'PHYSICAL_APPROVAL_REQUIRED', ok: false });
    for (const field of ['androidPassed', 'controlsSafeZonePassed', 'iosPassed']) {
      const failedPlatform = records();
      failedPlatform.physicalReceipt[field] = false;
      expect(inspectApprovedGiftPresentation({ presentation: presentation(), records: failedPlatform }))
        .toEqual({ code: 'PHYSICAL_APPROVAL_REQUIRED', ok: false });
    }
    for (const [field, value] of [['durationMs', 3_001], ['tier', 'global'], ['fallbackChecksum', 'd'.repeat(64)]]) {
      const staleReceipt = records();
      staleReceipt.physicalReceipt[field] = value;
      expect(inspectApprovedGiftPresentation({ presentation: presentation(), records: staleReceipt }))
        .toEqual({ code: 'PHYSICAL_APPROVAL_REQUIRED', ok: false });
    }
  });

  it('rejects oversized, overlong, unsupported, and incomplete gift media profiles', () => {
    const oversized = records();
    oversized.visual.version.byteSize = 1_048_577;
    expect(inspectApprovedGiftPresentation({ presentation: presentation(), records: oversized }))
      .toEqual({ code: 'PRESENTATION_MEDIA_PROFILE_INVALID', ok: false });

    const overlong = records();
    overlong.visual.version.durationMs = 6_001;
    expect(inspectApprovedGiftPresentation({ presentation: presentation(), records: overlong }))
      .toEqual({ code: 'PRESENTATION_MEDIA_PROFILE_INVALID', ok: false });

    const unsupported = records();
    unsupported.visual.version.videoCodec = 'hevc';
    expect(inspectApprovedGiftPresentation({ presentation: presentation(), records: unsupported }))
      .toEqual({ code: 'PRESENTATION_MEDIA_PROFILE_INVALID', ok: false });

    const missingFallback = records();
    delete missingFallback.fallback;
    expect(inspectApprovedGiftPresentation({ presentation: presentation(), records: missingFallback }))
      .toEqual({ code: 'PRESENTATION_ASSET_UNAVAILABLE', ok: false });

    expect(inspectApprovedGiftPresentation({
      presentation: presentation({ visualFormat: 'mp4' }),
      records: records(),
    })).toEqual({ code: 'PRESENTATION_VISUAL_FORMAT_MISMATCH', ok: false });
  });

  it('keeps already-published simple MP4 gifts runtime-compatible', () => {
    const simplePresentation = presentation({
      approvalMode: 'simple',
      audioAsset: undefined,
      physicalApprovalReceiptId: undefined,
      soundPolicy: 'off',
      visualFormat: 'mp4',
    });
    const simpleRecords = records();
    simpleRecords.visual = approvedRecord(refs.visual, 'gift-effect', 'mp4', 'a'.repeat(64));
    simpleRecords.visual.version.audioCodec = '';
    simpleRecords.visual.version.fallbackAssetId = refs.fallback.assetId;
    simpleRecords.visual.version.fallbackAssetVersionId = refs.fallback.assetVersionId;
    delete simpleRecords.audio;
    delete simpleRecords.physicalReceipt;
    expect(inspectGiftPresentation({ presentation: simplePresentation, records: simpleRecords })).toMatchObject({
      ok: true,
      presentation: { approvalMode: 'simple', visualFormat: 'mp4' },
    });
    expect(mapGiftPresentation(simplePresentation)).toMatchObject({
      approvalMode: 'simple',
      visualFormat: 'mp4',
    });
  });

  it('rejects embedded audio in MP4 even when the visual registry version is approved', () => {
    const simplePresentation = presentation({
      approvalMode: 'simple',
      audioAsset: undefined,
      physicalApprovalReceiptId: undefined,
      soundPolicy: 'off',
      visualFormat: 'mp4',
    });
    const simpleRecords = records();
    simpleRecords.visual = approvedRecord(refs.visual, 'gift-effect', 'mp4', 'a'.repeat(64));
    simpleRecords.visual.version.audioCodec = 'aac';
    simpleRecords.visual.version.fallbackAssetId = refs.fallback.assetId;
    simpleRecords.visual.version.fallbackAssetVersionId = refs.fallback.assetVersionId;
    expect(inspectGiftPresentation({ presentation: simplePresentation, records: simpleRecords }))
      .toEqual({ code: 'PRESENTATION_EMBEDDED_AUDIO_FORBIDDEN', ok: false });
  });

  it('rejects simple-mode Lottie so owners stay on convertible MP4 packs', () => {
    const simplePresentation = presentation({
      approvalMode: 'simple',
      audioAsset: undefined,
      physicalApprovalReceiptId: undefined,
      soundPolicy: 'off',
    });
    const simpleRecords = records();
    delete simpleRecords.audio;
    delete simpleRecords.physicalReceipt;
    expect(inspectGiftPresentation({ presentation: simplePresentation, records: simpleRecords }))
      .toEqual({ code: 'PRESENTATION_ASSET_UNAVAILABLE', ok: false });
  });

  it('authors bounded cumulative combo state inside the active window', () => {
    const first = resolveGiftComboState({ giftId: 'rose', nowMs: 1_000, quantity: 5, senderUid: 'sender', targetUid: 'target', tier: 'major' });
    const second = resolveGiftComboState({
      existing: { ...first, windowExpiresAt: 5_000 },
      giftId: 'rose',
      nowMs: 2_000,
      quantity: 20,
      senderUid: 'sender',
      targetUid: 'target',
      tier: 'major',
    });
    expect(first.comboWindowId).toMatch(/^gcw_[a-f0-9]{24}$/);
    expect(second).toMatchObject({
      comboCount: 25,
      comboKey: first.comboKey,
      comboWindowId: first.comboWindowId,
      sequence: 2,
    });
    const capped = resolveGiftComboState({
      existing: { ...second, comboCount: 995, windowExpiresAt: 9_000 },
      giftId: 'rose',
      nowMs: 3_000,
      quantity: 20,
      senderUid: 'sender',
      targetUid: 'target',
      tier: 'major',
    });
    expect(capped.comboCount).toBe(999);
    const nextWindow = resolveGiftComboState({
      existing: { ...second, windowExpiresAt: 2_999 },
      giftId: 'rose',
      nowMs: 3_000,
      quantity: 1,
      requestId: 'new_window_request_0001',
      senderUid: 'sender',
      targetUid: 'target',
      tier: 'major',
    });
    expect(nextWindow).toMatchObject({ comboCount: 1, sequence: 1 });
    expect(nextWindow.comboWindowId).not.toBe(first.comboWindowId);
  });

  it('kills presentation independently from the gift economy', () => {
    expect(resolveGiftPresentationDelivery(presentation(), {})).toEqual({
      animationEnabled: false,
      audioEnabled: false,
      globalEnabled: false,
      presentationTier: 'inline',
    });
    expect(resolveGiftPresentationDelivery(presentation({ tier: 'global', visualFormat: 'mp4' }), {
      room_gift_animations: true,
      room_gift_audio: true,
      room_gift_global_effects: true,
      room_gift_video: true,
    }, '1.0.0')).toEqual({
      animationEnabled: true,
      audioEnabled: true,
      globalEnabled: true,
      presentationTier: 'global',
    });
  });

  it('requires an active room-scoped campaign before global fan-out', () => {
    const campaign = {
      allowedRoomVisibilities: ['public'],
      countryCodes: ['IQ'],
      enabled: true,
      endsAt: 2_000,
      giftIds: ['rose'],
      startsAt: 500,
      status: 'active',
    };
    expect(isEligibleGlobalGiftCampaign({
      campaign,
      giftId: 'rose',
      nowMs: 1_000,
      room: { countryCode: 'IQ', status: 'active', visibility: 'public' },
    })).toBe(true);
    expect(isEligibleGlobalGiftCampaign({
      campaign,
      giftId: 'rose',
      nowMs: 2_000,
      room: { countryCode: 'IQ', status: 'active', visibility: 'public' },
    })).toBe(false);
  });
});
