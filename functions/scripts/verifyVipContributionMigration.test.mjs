import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { parseOptions } = require('./verifyVipContributionMigration');

describe('verifyVipContributionMigration options', () => {
  it('is read-only by default and requires explicit apply to record verification', () => {
    expect(parseOptions([])).toEqual({ apply: false, maxDocs: 100_000, pageSize: 500 });
    expect(parseOptions(['--apply', '--page-size=250', '--max-docs=5000']))
      .toEqual({ apply: true, maxDocs: 5_000, pageSize: 250 });
    expect(() => parseOptions(['--unknown'])).toThrow('UNKNOWN_ARGUMENT');
  });
});
