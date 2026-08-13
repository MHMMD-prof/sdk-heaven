import type { StoreCurrency } from '../store/contracts';
import { createSocialRequestId } from './publicProfile';
import type { SocialCommandRequest } from './types';

export function buildCoupleEffectsRequest(
  requestId = createSocialRequestId('coupleeffects'),
): SocialCommandRequest<'get-couple-effects'> {
  return { action: 'get-couple-effects', requestId, version: 1 };
}

export function buildPurchaseCoupleEffectRequest(
  itemId: string,
  currency: StoreCurrency,
  requestId = createSocialRequestId('coupleeffectpurchase'),
): SocialCommandRequest<'purchase-couple-effect', { currency: StoreCurrency; itemId: string }> {
  return { action: 'purchase-couple-effect', payload: { currency, itemId }, requestId, version: 1 };
}

export function buildEquipCoupleEffectRequest(
  itemId: string,
  requestId = createSocialRequestId('coupleeffectequip'),
): SocialCommandRequest<'equip-couple-effect', { itemId: string }> {
  return { action: 'equip-couple-effect', payload: { itemId }, requestId, version: 1 };
}

export function buildUnequipCoupleEffectRequest(
  requestId = createSocialRequestId('coupleeffectunequip'),
): SocialCommandRequest<'unequip-couple-effect'> {
  return { action: 'unequip-couple-effect', requestId, version: 1 };
}
