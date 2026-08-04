import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildPublicTargetTemplate,
  flattenRocketRewards,
} = require('./adminRoomTargetService');

test('flattens configured Rocket rewards for worst-case stacked liability', () => {
  assert.deepEqual(flattenRocketRewards({
    1: { coins: 100, diamonds: 2, items: [{ itemId: 'badge' }] },
    2: { coins: 50, diamonds: 3, items: [] },
  }), {
    coins: 150,
    diamonds: 5,
    items: ['badge'],
  });
});

test('public template omits internal risk valuations', () => {
  const result = buildPublicTargetTemplate({
    conversion: { payoutCurrency: 'coins' },
    eligibleGiftRules: { minimumDebitedCoins: 1 },
    enabled: true,
    maxSelectedUsers: 5,
    perRoomReturnCap: 100,
    perUserReturnCap: 50,
    returnBps: 500,
    riskValuation: { diamondValueCoins: 10, itemValuesCoins: { badge: 50 } },
    targetSupportPoints: 10_000,
    timeZone: 'Asia/Baghdad',
  });
  assert.equal('riskValuation' in result, false);
  assert.equal(result.returnBps, 500);
});
