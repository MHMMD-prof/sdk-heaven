import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  normalizeAdminRoomTargetMemberHold,
  normalizeAdminRoomTargetMutation,
} = require('./adminRoomTargetCore');

const template = {
  conversion: { denominator: 1, numerator: 1, payoutCurrency: 'coins', rounding: 'floor', sourceCurrency: 'coins' },
  eligibleGiftRules: { committedOnly: true, excludeSelfGifts: true, minimumDebitedCoins: 1 },
  enabled: true,
  maxSelectedUsers: 5,
  perRoomReturnCap: 20_000,
  perUserReturnCap: 5_000,
  returnBps: 500,
  riskValuation: { diamondValueCoins: 10, itemValuesCoins: {} },
  targetSupportPoints: 1_000_000,
  timeZone: 'Asia/Baghdad',
};

test('normalizes a publish request and injects immutable contract fields', () => {
  const result = normalizeAdminRoomTargetMutation({
    expectedRevision: 0,
    operation: 'publish',
    reason: 'Initial safe campaign',
    requestId: 'request_123456789',
    template,
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.template.publicationStatus, 'published');
  assert.equal(result.value.template.templateId, 'global-room-target');
});

test('requires revision, reason, request ID, and rollback target', () => {
  assert.equal(normalizeAdminRoomTargetMutation({}).ok, false);
  assert.equal(normalizeAdminRoomTargetMutation({
    expectedRevision: 1,
    operation: 'rollback',
    reason: 'restore prior',
    requestId: 'request_123456789',
  }).ok, false);
});

test('normalizes audited staff apply and release member holds', () => {
  assert.deepEqual(normalizeAdminRoomTargetMemberHold({
    cycleId: 'weekly_2026-07-27_asia-baghdad',
    operation: 'apply',
    reason: 'Fraud review',
    requestId: 'hold_request_123456',
    roomId: 'room-one',
    targetUid: 'member-one',
  }), {
    ok: true,
    value: {
      cycleId: 'weekly_2026-07-27_asia-baghdad',
      operation: 'apply',
      reason: 'Fraud review',
      requestId: 'hold_request_123456',
      roomId: 'room-one',
      targetUid: 'member-one',
    },
  });
});
