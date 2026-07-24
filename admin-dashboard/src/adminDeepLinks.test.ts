import { describe, expect, it } from 'vitest';

import { readAdminQueryParameter } from './adminDeepLinks';

describe('admin deep links', () => {
  it('normalizes and bounds detail identifiers', () => {
    expect(readAdminQueryParameter('?report=%20report-1%20', 'report')).toBe('report-1');
    expect(readAdminQueryParameter(`?item=${'a'.repeat(300)}`, 'item', 80)).toHaveLength(80);
  });
});
