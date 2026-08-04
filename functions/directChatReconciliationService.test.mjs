import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { sameDocumentVersion } = require('./directChatReconciliationService');

describe('direct chat reconciliation service', () => {
  it('detects projection changes before an atomic repair', () => {
    expect(sameDocumentVersion(missing(), missing())).toBe(true);
    expect(sameDocumentVersion(snapshot(10), missing())).toBe(false);
    expect(sameDocumentVersion(snapshot(10), snapshot(10))).toBe(true);
    expect(sameDocumentVersion(snapshot(11), snapshot(10))).toBe(false);
  });

  it('falls back to the application timestamp for test and migration snapshots', () => {
    expect(sameDocumentVersion(snapshot(undefined, 20), snapshot(undefined, 20))).toBe(true);
    expect(sameDocumentVersion(snapshot(undefined, 21), snapshot(undefined, 20))).toBe(false);
  });
});

function missing() {
  return { exists: false };
}

function snapshot(updateTime, updatedAt) {
  return {
    data: () => ({ updatedAt }),
    exists: true,
    updateTime,
  };
}
