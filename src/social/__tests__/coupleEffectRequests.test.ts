import { describe, expect, it } from 'vitest';

import {
  buildCoupleEffectsRequest,
  buildEquipCoupleEffectRequest,
  buildPurchaseCoupleEffectRequest,
  buildUnequipCoupleEffectRequest,
} from '../coupleEffectRequests';

describe('couple effect social command mapping', () => {
  it('maps inventory, purchase, equip, and unequip to exact backend actions', () => {
    expect(buildCoupleEffectsRequest('req_get')).toEqual({
      action: 'get-couple-effects',
      requestId: 'req_get',
      version: 1,
    });
    expect(buildPurchaseCoupleEffectRequest('effect-one', 'diamonds', 'req_buy')).toEqual({
      action: 'purchase-couple-effect',
      payload: { currency: 'diamonds', itemId: 'effect-one' },
      requestId: 'req_buy',
      version: 1,
    });
    expect(buildEquipCoupleEffectRequest('effect-one', 'req_equip')).toEqual({
      action: 'equip-couple-effect',
      payload: { itemId: 'effect-one' },
      requestId: 'req_equip',
      version: 1,
    });
    expect(buildUnequipCoupleEffectRequest('req_off')).toEqual({
      action: 'unequip-couple-effect',
      requestId: 'req_off',
      version: 1,
    });
  });
});
