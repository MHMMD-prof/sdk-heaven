import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import type { CosmeticAssetDescriptorV1 } from '../contracts';
import { disabledCosmeticsFeatureFlags } from '../featureFlags';
import { resolveCosmeticRenderPlan } from '../rendererCore';
import {
  recordCosmeticsRuntimeEvent,
  resetCosmeticsRuntimeEventsForTests,
  summarizeCosmeticsRuntimeRates,
} from '../runtimeTelemetry';
import {
  MAX_AMBIENT_REACTION_COUNT,
  MAX_AMBIENT_REACTION_GROUPS,
  aggregateAmbientReaction,
  type AmbientReactionGroup,
  type RoomReactionEnvelope,
} from '../../voice/roomAmbientReactions';
import {
  MAX_ROOM_EFFECT_QUEUE,
  enqueueRoomEffect,
  type QueuedRoomEffect,
} from '../../voice/roomEffectsQueue';

const require = createRequire(import.meta.url);
const {
  removeEquipmentCosmeticProjection,
  setEquipmentCosmeticProjection,
} = require('../../../functions/equipmentCosmeticsCore');

const fallback: CosmeticAssetDescriptorV1 = {
  schemaVersion: 1,
  assetId: 'gift-poster',
  assetVersionId: 'v1-aaaaaaaaaaaa',
  ownerType: 'platform',
  category: 'gift-effect',
  format: 'png',
  usage: 'static',
  uri: 'https://cdn.example.test/gift-poster.png',
  width: 1280,
  height: 720,
  byteSize: 100_000,
  sha256: 'a'.repeat(64),
  transparent: true,
  loop: false,
  performanceTier: 'low',
  minimumClientVersion: '1.0.0',
  moderationStatus: 'approved',
  publicationStatus: 'published',
  approvalId: 'approval_123456789',
  revision: 1,
};

const motion: CosmeticAssetDescriptorV1 = {
  ...fallback,
  assetId: 'gift-motion',
  assetVersionId: 'v2-bbbbbbbbbbbb',
  format: 'lottie-json',
  usage: 'one-shot',
  fallbackAssetId: fallback.assetId,
  fallbackAssetVersionId: fallback.assetVersionId,
  durationMs: 3000,
  frameRate: 30,
  byteSize: 200_000,
  sha256: 'b'.repeat(64),
};

const enabledFlags = {
  ...disabledCosmeticsFeatureFlags,
  assetRegistry: true,
  lottie: true,
  sharedRenderer: true,
};

function giftEffect(index: number, nowMs: number): QueuedRoomEffect {
  return {
    durationMs: 3_000,
    eventId: `gift-${index}`,
    expiresAtMs: nowMs + 3_000,
    kind: 'room-gift',
    label: `Gift ${index}`,
    priority: 50,
    comboKey: `combo-${index}`,
  };
}

function entryEffect(index: number, nowMs: number): QueuedRoomEffect {
  return {
    durationMs: 4_000,
    eventId: `entry-${index}`,
    expiresAtMs: nowMs + 4_000,
    kind: 'room-entry',
    label: `Entry ${index}`,
    priority: 80,
  };
}

function reaction(index: number, nowMs: number): RoomReactionEnvelope {
  return {
    assetId: 'reaction-wave',
    assetVersionId: 'v1-aaaaaaaaaaaa',
    checksum: 'c'.repeat(64),
    count: 1,
    createdAtMs: nowMs,
    eventId: `rr_${index.toString(16).padStart(24, '0')}`,
    expiresAtMs: nowMs + 3_000,
    format: 'png',
    roomId: 'room-1',
    senderUid: `user-${index}`,
    type: 'room-reaction',
    version: 1,
  };
}

describe('cosmetics wave 10 hardening harness', () => {
  it('bounds gift burst and twenty-entry burst to the room effect queue', () => {
    const nowMs = 1_700_000_000_000;
    let giftQueue: QueuedRoomEffect[] = [];
    for (let index = 0; index < 40; index += 1) {
      giftQueue = enqueueRoomEffect(giftQueue, giftEffect(index, nowMs), nowMs);
    }
    expect(giftQueue.length).toBeLessThanOrEqual(MAX_ROOM_EFFECT_QUEUE);

    let entryQueue: QueuedRoomEffect[] = [];
    for (let index = 0; index < 20; index += 1) {
      entryQueue = enqueueRoomEffect(entryQueue, entryEffect(index, nowMs), nowMs);
    }
    expect(entryQueue).toHaveLength(MAX_ROOM_EFFECT_QUEUE);
  });

  it('aggregates reaction spam without exceeding ambient group or count caps', () => {
    const nowMs = 1_700_000_000_000;
    let groups: AmbientReactionGroup[] = [];
    for (let index = 0; index < 50; index += 1) {
      const envelope = {
        ...reaction(index, nowMs),
        assetId: index % 2 === 0 ? 'reaction-wave' : `reaction-${index}`,
        count: 20,
      };
      groups = aggregateAmbientReaction(groups, envelope, nowMs + (index % 3));
    }
    expect(groups.length).toBeLessThanOrEqual(MAX_AMBIENT_REACTION_GROUPS);
    expect(groups.every((group) => group.count <= MAX_AMBIENT_REACTION_COUNT)).toBe(true);
  });

  it('keeps rapid equip/unequip projection updates idempotent', () => {
    const item = {
      category: 'profile-skins',
      cosmeticAsset: { assetId: 'skin-a', assetVersionId: 'v1-aaaaaaaaaaaa' },
      itemId: 'skin-item',
    };
    let document = {};
    for (let index = 0; index < 12; index += 1) {
      document = setEquipmentCosmeticProjection(document, item);
    }
    expect(document).toEqual({
      cosmetics: {
        profileSkin: {
          assetId: 'skin-a',
          assetVersionId: 'v1-aaaaaaaaaaaa',
          itemId: 'skin-item',
        },
      },
    });
    for (let index = 0; index < 12; index += 1) {
      document = removeEquipmentCosmeticProjection(document, 'profile-skins');
    }
    expect(document).toEqual({});
  });

  it('falls back on checksum mismatch and asset fetch miss', () => {
    expect(resolveCosmeticRenderPlan({
      currentClientVersion: '1.0.0',
      descriptor: motion,
      fallbackDescriptor: fallback,
      flags: enabledFlags,
      integrity: 'failed',
      viewerMode: 'full',
    })).toMatchObject({ reason: 'checksum-failed', source: 'fallback', renderer: 'static' });

    expect(resolveCosmeticRenderPlan({
      cached: false,
      currentClientVersion: '1.0.0',
      descriptor: motion,
      fallbackDescriptor: fallback,
      flags: enabledFlags,
      online: false,
      viewerMode: 'full',
    })).toMatchObject({ reason: 'offline-cache-miss', source: 'fallback', renderer: 'static' });
  });

  it('summarizes local telemetry rates for threshold evaluators', () => {
    resetCosmeticsRuntimeEventsForTests();
    recordCosmeticsRuntimeEvent('ready');
    recordCosmeticsRuntimeEvent('failure');
    recordCosmeticsRuntimeEvent('fallback');
    recordCosmeticsRuntimeEvent('first-frame', { elapsedMs: 1_800 });
    recordCosmeticsRuntimeEvent('queue-expiry');
    const summary = summarizeCosmeticsRuntimeRates();
    expect(summary.sampleCount).toBe(5);
    expect(summary.assetFailureRate).toBeGreaterThan(0);
    expect(summary.firstFrameDelayP95Ms).toBe(1_800);
  });
});
