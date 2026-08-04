import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  allocateRoomTargetReturns,
  applyRoomTargetGiftProgress,
  buildRoomTargetSettlementInputs,
  calculateRoomTargetReturn,
  calculateRoomTargetRisk,
  createRoomTargetGoalEventId,
  createRoomTargetProjectionReceiptId,
  normalizeRoomTargetRosterInput,
  validateRoomTargetTemplateV1,
} = require('./roomTargetCore');

function template(overrides = {}) {
  return {
    conversion: {
      denominator: 1,
      numerator: 1,
      payoutCurrency: 'coins',
      rounding: 'floor',
      sourceCurrency: 'coins',
    },
    eligibleGiftRules: {
      committedOnly: true,
      excludeSelfGifts: true,
      minimumDebitedCoins: 1,
    },
    enabled: true,
    maxSelectedUsers: 5,
    perRoomReturnCap: 50_000,
    perUserReturnCap: 20_000,
    publicationStatus: 'published',
    returnBps: 500,
    riskValuation: {
      diamondValueCoins: 10,
      itemValuesCoins: { badge_gold: 250 },
    },
    schemaVersion: 1,
    targetSupportPoints: 1_000_000,
    templateId: 'global-room-target',
    templateVersion: 1,
    timeZone: 'Asia/Baghdad',
    ...overrides,
  };
}

test('validates a published Room Target template and rejects unsafe conversion shapes', () => {
  assert.equal(validateRoomTargetTemplateV1(template())?.returnBps, 500);
  assert.equal(validateRoomTargetTemplateV1(template({
    conversion: {
      denominator: 3,
      numerator: 2,
      payoutCurrency: 'diamonds',
      rounding: 'floor',
      sourceCurrency: 'coins',
    },
  }))?.conversion.payoutCurrency, 'diamonds');
  assert.equal(validateRoomTargetTemplateV1(template({
    conversion: {
      denominator: 2,
      numerator: 2,
      payoutCurrency: 'diamonds',
      rounding: 'floor',
      sourceCurrency: 'coins',
    },
  })), undefined);
  assert.equal(validateRoomTargetTemplateV1(template({ perRoomReturnCap: 10_000 })), undefined);
});

test('normalizes a unique next-cycle roster command', () => {
  assert.deepEqual(normalizeRoomTargetRosterInput({
    requestId: 'request_123456789',
    roomId: 'room-one',
    selectedUids: ['a', 'b'],
  }), {
    ok: true,
    value: {
      requestId: 'request_123456789',
      roomId: 'room-one',
      selectedUids: ['a', 'b'],
    },
  });
  assert.equal(normalizeRoomTargetRosterInput({
    requestId: 'request_123456789',
    roomId: 'room-one',
    selectedUids: ['a', 'a'],
  }).code, 'DUPLICATE_ROSTER_USER');
});

test('projects only matching eligible facts and crosses the goal once', () => {
  const cycle = {
    cycleId: 'weekly_2026-07-27_asia-baghdad',
    eligibleGiftRules: { minimumDebitedCoins: 10 },
    eligibleSpendCoins: 80,
    giftCount: 1,
    roomId: 'room-one',
    state: 'active',
    supportPoints: 80,
    targetSupportPoints: 100,
  };
  const member = { eligibleSpendCoins: 80, giftCount: 1, supportPoints: 80, uid: 'sender' };
  const fact = {
    debitedCoins: 25,
    eventId: 'gift-1',
    recipientUid: 'recipient',
    roomId: 'room-one',
    senderUid: 'sender',
    supportPoints: 25,
    weekId: cycle.cycleId,
  };
  const result = applyRoomTargetGiftProgress(cycle, member, fact);
  assert.equal(result.ok, true);
  assert.equal(result.value.crossedGoal, true);
  assert.equal(result.value.cycle.state, 'unlocked');
  assert.equal(result.value.cycle.eligibleSpendCoins, 105);
  assert.equal(result.value.member.eligibleSpendCoins, 105);
  assert.equal(applyRoomTargetGiftProgress(
    { ...cycle, roomId: 'another-room' },
    member,
    fact,
  ).code, 'INVALID_TARGET_PROGRESS');
});

test('returns use actual debited spend, floor conversion, and per-user caps', () => {
  assert.equal(calculateRoomTargetReturn(999, template()), 49);
  assert.equal(calculateRoomTargetReturn(1_000_000, template()), 20_000);
  assert.equal(calculateRoomTargetReturn(1001, template({
    conversion: {
      denominator: 3,
      numerator: 2,
      payoutCurrency: 'diamonds',
      rounding: 'floor',
      sourceCurrency: 'coins',
    },
  })), 33);
  assert.equal(calculateRoomTargetReturn(
    Number.MAX_SAFE_INTEGER,
    template({ perRoomReturnCap: 1_000_000_000, perUserReturnCap: 1_000_000_000 }),
  ), 1_000_000_000);
});

test('room cap uses deterministic proportional largest-remainder allocation', () => {
  const result = allocateRoomTargetReturns([
    { eligibleSpendCoins: 100_000, uid: 'b' },
    { eligibleSpendCoins: 100_000, uid: 'a' },
    { eligible: false, eligibleSpendCoins: 100_000, uid: 'held' },
  ], template({ perRoomReturnCap: 5_001, perUserReturnCap: 5_000 }));
  assert.equal(result.ok, true);
  assert.equal(result.value.total, 5_001);
  assert.deepEqual(result.value.allocations.map(({ amount, uid }) => ({ amount, uid })), [
    { amount: 2_500, uid: 'b' },
    { amount: 2_501, uid: 'a' },
    { amount: 0, uid: 'held' },
  ]);
});

test('builds retry-stable wallet settlements and excludes zero allocations', () => {
  const result = buildRoomTargetSettlementInputs({
    allocations: [
      { amount: 250, uid: 'owner' },
      { amount: 0, uid: 'held' },
    ],
    cycle: {
      conversion: { payoutCurrency: 'coins' },
      cycleId: 'weekly_2026-07-27_asia-baghdad',
    },
    roomId: 'room-one',
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.length, 1);
  assert.equal(result.value[0].feature, 'owner-targets');
  assert.equal(result.value[0].rewardBundle.coins, 250);
  assert.match(result.value[0].settlementId, /^ris_[a-f0-9]{40}$/);
});

test('validates target liability against commission and valued stacked Rocket rewards', () => {
  const result = calculateRoomTargetRisk({
    commissionBps: 1_500,
    rocketRewardLiability: {
      coins: 10_000,
      diamonds: 1_000,
      items: ['badge_gold'],
    },
    template: template(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.targetCommissionCoins, 150_000);
  assert.equal(result.value.roomTargetLiabilityCoins, 50_000);
  assert.equal(result.value.rocketLiabilityCoins, 20_250);
  assert.equal(result.value.viable, true);
  assert.equal(calculateRoomTargetRisk({
    commissionBps: 1_500,
    rocketRewardLiability: { coins: 0, diamonds: 0, items: ['unknown'] },
    template: template(),
  }).code, 'UNVALUED_ROCKET_ITEM');
});

test('creates stable, scope-separated receipt and goal event IDs', () => {
  assert.equal(createRoomTargetProjectionReceiptId('event-a'), createRoomTargetProjectionReceiptId('event-a'));
  assert.notEqual(createRoomTargetProjectionReceiptId('event-a'), createRoomTargetProjectionReceiptId('event-b'));
  assert.equal(
    createRoomTargetGoalEventId('room-one', 'cycle-one'),
    createRoomTargetGoalEventId('room-one', 'cycle-one'),
  );
});
