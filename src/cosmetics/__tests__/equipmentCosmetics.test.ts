import { describe, expect, it } from 'vitest';

import { readEquipmentCosmetics } from '../equipmentCosmetics';

describe('equipment cosmetic projections', () => {
  it('maps only exact bounded canonical references', () => {
    expect(readEquipmentCosmetics({ equippedCosmetics: {
      profileSkin: { assetId: 'profile-skin', assetVersionId: 'v1-123456789abc', itemId: 'profile-skin-item' },
      chatBubble: { assetId: 'unsafe', assetVersionId: 'latest', itemId: 'unsafe-item' },
      staff: { assetId: 'fake-staff', assetVersionId: 'v1-123456789abc', itemId: 'fake-staff-item' },
    } })).toEqual({
      profileSkin: { assetId: 'profile-skin', assetVersionId: 'v1-123456789abc', itemId: 'profile-skin-item' },
    });
  });

  it('preserves custom source for owner-bound equipment', () => {
    expect(readEquipmentCosmetics({ equippedCosmetics: {
      profileSkin: {
        assetId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
        assetVersionId: 'v1-123456789abc',
        itemId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
        source: 'custom',
      },
    } })).toEqual({
      profileSkin: {
        assetId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
        assetVersionId: 'v1-123456789abc',
        itemId: 'cu-pr-aaaaaaaaaaaaaaaaaaaa',
        source: 'custom',
      },
    });
  });
});
