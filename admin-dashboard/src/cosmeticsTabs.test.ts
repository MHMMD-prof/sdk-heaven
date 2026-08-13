import { describe, expect, it } from 'vitest';

import { parseCosmeticsTab } from './cosmeticsTabs';

describe('cosmetics workspace tabs', () => {
  it('accepts known tab keys', () => {
    expect(parseCosmeticsTab('registry')).toBe('registry');
    expect(parseCosmeticsTab('upload')).toBe('upload');
    expect(parseCosmeticsTab('custom')).toBe('custom');
  });

  it('falls back to registry for unknown or empty values', () => {
    expect(parseCosmeticsTab('')).toBe('registry');
    expect(parseCosmeticsTab('missing')).toBe('registry');
    expect(parseCosmeticsTab('REGISTRY')).toBe('registry');
  });
});
