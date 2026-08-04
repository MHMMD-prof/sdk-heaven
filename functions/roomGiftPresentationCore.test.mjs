import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildLegacyGiftPresentation,
  createGiftPhysicalApprovalReceiptId,
  inspectApprovedGiftPresentation,
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
      sha256: sha,
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
    const rejected = records();
    rejected.physicalReceipt.iosPassed = false;
    expect(inspectApprovedGiftPresentation({ presentation: presentation(), records: rejected }))
      .toEqual({ code: 'PHYSICAL_APPROVAL_REQUIRED', ok: false });
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
    expect(second).toMatchObject({ comboCount: 25, comboKey: first.comboKey, sequence: 2 });
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
