import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { parseOptions } = require('./dryRunVipContributionMigration');

describe('dryRunVipContributionMigration', () => {
  it('defaults to a bounded dry run', () => {
    expect(parseOptions([])).toEqual({ catalogVersion: '', maxDocs: 100_000, pageSize: 500 });
    expect(parseOptions(['--catalog-version=VIP-2026-01', '--page-size=250', '--max-docs=5000']))
      .toEqual({ catalogVersion: 'vip-2026-01', maxDocs: 5_000, pageSize: 250 });
  });

  it('refuses any apply mode and invalid bounds', () => {
    expect(() => parseOptions(['--apply'])).toThrow(/dry-run-only/);
    expect(() => parseOptions(['--page-size=0'])).toThrow(/--page-size/);
    expect(() => parseOptions(['--catalog-version=..\/secret'])).toThrow(/catalog-version/);
  });
});
