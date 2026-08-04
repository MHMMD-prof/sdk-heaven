import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { normalizeAdminRoomRocketMutation } = require('./adminRoomRocketCore');

function template() {
  const version = 1;
  return {
    animationApproval: {
      approvalId: 'physical_test_001',
      fallbackVerified: true,
      memoryVerified: true,
      physicalAndroidDevice: 'Samsung A52 physical',
      reducedMotionVerified: true,
      testedClientVersion: '1.0.0',
    },
    appearance: {
      animationAsset: {
        bytes: 1000, durationMs: 2000, format: 'animated-webp', height: 1000,
        storagePath: `room-rockets/global-room-rocket/v${version}/animation.webp`,
        uri: 'https://cdn.example.com/animation.webp', version, width: 800,
      },
      name: { ar: 'الصاروخ', en: 'Rocket' },
      staticAsset: {
        bytes: 1000, format: 'webp', height: 1000,
        storagePath: `room-rockets/global-room-rocket/v${version}/static.webp`,
        uri: 'https://cdn.example.com/static.webp', version, width: 800,
      },
    },
    enabledRankCount: 1,
    minimumClientVersion: '1.0.0',
    rewards: { 1: { coins: 100, diamonds: 0, items: [] } },
    targetSupportPoints: 1000,
    timeZone: 'Asia/Baghdad',
  };
}

describe('adminRoomRocketCore', () => {
  it('normalizes a publish operation and forces contract identity fields', () => {
    const result = normalizeAdminRoomRocketMutation({
      expectedRevision: 0,
      operation: 'publish',
      reason: 'Initial safe campaign',
      requestId: 'request_rocket_0001',
      template: template(),
    });
    expect(result.ok).toBe(true);
    expect(result.value.template).toMatchObject({
      publicationStatus: 'published',
      schemaVersion: 1,
      templateId: 'global-room-rocket',
      templateVersion: 1,
    });
  });

  it('rejects publication without physical device approval', () => {
    const candidate = template();
    delete candidate.animationApproval;
    expect(normalizeAdminRoomRocketMutation({
      expectedRevision: 0,
      operation: 'publish',
      reason: 'Unsafe campaign',
      requestId: 'request_rocket_0002',
      template: candidate,
    }).ok).toBe(false);
  });

  it('accepts rollback only with an immutable revision target', () => {
    expect(normalizeAdminRoomRocketMutation({
      expectedRevision: 4,
      operation: 'rollback',
      reason: 'Restore safe version',
      requestId: 'request_rocket_0003',
      rollbackRevision: 2,
    })).toMatchObject({ ok: true, value: { rollbackRevision: 2 } });
  });
});
