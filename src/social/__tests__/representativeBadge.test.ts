import { describe, expect, it } from 'vitest';

import { hasActiveRepresentativeBadge } from '../representativeBadge';

describe('representative badge projection', () => {
  it('accepts only an active nested server projection', () => {
    expect(hasActiveRepresentativeBadge({
      representativeBadge: { active: true, updatedAt: {} },
    })).toBe(true);
    expect(hasActiveRepresentativeBadge({
      representativeBadge: { active: false, updatedAt: {} },
    })).toBe(false);
    expect(hasActiveRepresentativeBadge({ representativeBadgeActive: true })).toBe(false);
    expect(hasActiveRepresentativeBadge({ representativeBadge: true })).toBe(false);
    expect(hasActiveRepresentativeBadge(null)).toBe(false);
  });
});
