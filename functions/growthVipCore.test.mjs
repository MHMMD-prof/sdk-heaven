import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  DEFAULT_VIP_TIERS,
  listDefaultVipCatalog,
  mapVipProjection,
  mapVipTier,
  normalizeVipCatalogUpsert,
  resolveVipTierForCredit,
} = require('./growthVipCore');

describe('growthVipCore', () => {
  it('exposes five default tiers with ascending credit floors', () => {
    expect(DEFAULT_VIP_TIERS.map((tier) => tier.id)).toEqual([
      'bronze',
      'silver',
      'gold',
      'platinum',
      'diamond',
    ]);
    expect(DEFAULT_VIP_TIERS.map((tier) => tier.minLifetimeCreditCoins)).toEqual([
      1000, 5000, 20000, 50000, 150000,
    ]);
    expect(DEFAULT_VIP_TIERS.map((tier) => tier.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(listDefaultVipCatalog()).toHaveLength(5);
  });

  it('maps valid catalog rows and rejects incomplete ones', () => {
    expect(mapVipTier({
      accentColor: '#CD7F32',
      id: 'Bronze',
      minLifetimeCreditCoins: 1000,
      nameAr: 'برونزي',
      rank: 1,
    })).toMatchObject({ id: 'bronze', rank: 1 });
    expect(mapVipTier({ id: 'bronze', rank: 1 })).toBeNull();
    expect(normalizeVipCatalogUpsert({
      accentColor: '#CD7F32',
      id: 'bronze',
      minLifetimeCreditCoins: 1000,
      nameAr: 'برونزي',
      rank: 1,
    }).ok).toBe(true);
    expect(normalizeVipCatalogUpsert({ id: 'bronze' }).ok).toBe(false);
  });

  it('resolves current and next VIP tiers from lifetime credit', () => {
    expect(resolveVipTierForCredit(0).tier).toBeNull();
    expect(resolveVipTierForCredit(999).tier).toBeNull();
    expect(resolveVipTierForCredit(1000).tier?.id).toBe('bronze');
    expect(resolveVipTierForCredit(1000).nextTier?.id).toBe('silver');
    expect(resolveVipTierForCredit(20000).tier?.id).toBe('gold');
    expect(resolveVipTierForCredit(20000).nextTier?.id).toBe('platinum');
    expect(resolveVipTierForCredit(200000).tier?.id).toBe('diamond');
    expect(resolveVipTierForCredit(200000).nextTier).toBeNull();
  });

  it('maps public profile VIP projections', () => {
    expect(mapVipProjection({
      vipTier: {
        accentColor: '#D4AF37',
        id: 'gold',
        nameAr: 'ذهبي',
        rank: 3,
      },
    })).toEqual({
      accentColor: '#D4AF37',
      id: 'gold',
      nameAr: 'ذهبي',
      rank: 3,
    });
    expect(mapVipProjection({ id: 'gold', rank: 3 })).toBeNull();
  });
});
