import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  deriveAlertDecision,
  deriveOperationsReadiness,
  normalizeEmergencyFreeze,
  normalizeStatusOperationProposal,
} = require('./statusOperationsCore');

describe('Wave 6 status operations contracts', () => {
  it('accepts bounded typed proposals and rejects generic authority edits', () => {
    expect(normalizeStatusOperationProposal({
      operation: 'vip-point-correction', targetUid: 'user-1', pointDelta: -500,
      reason: 'linked support correction', evidenceRef: 'ticket-100', requestId: 'vip_correct_00001',
    })).toMatchObject({ ok: true, value: { pointDelta: -500 } });
    expect(normalizeStatusOperationProposal({
      operation: 'vip-point-correction', targetUid: 'user-1', pointDelta: 5_000_000,
      reason: 'unsafe correction', evidenceRef: 'ticket-100', requestId: 'vip_correct_00002',
    }).code).toBe('INVALID_REQUEST');
    expect(normalizeStatusOperationProposal({
      operation: 'set-feature-flags', flags: { aristocracyShop: true, arbitraryFlag: true },
      reason: 'unsafe generic flag', evidenceRef: 'release-1', requestId: 'status_flags_0001',
    }).code).toBe('INVALID_REQUEST');
    expect(normalizeStatusOperationProposal({
      operation: 'set-signoffs', signoffs: { security: true, qa: false },
      reason: 'record reviewed launch gates', evidenceRef: 'release-1', requestId: 'status_signoffs_01',
    })).toMatchObject({ ok: true, value: { signoffs: { qa: false, security: true } } });
    expect(normalizeStatusOperationProposal({
      operation: 'set-signoffs', signoffs: { founder: true },
      reason: 'unsafe generic signoff', evidenceRef: 'release-1', requestId: 'status_signoffs_02',
    }).code).toBe('INVALID_REQUEST');
    expect(normalizeStatusOperationProposal({
      operation: 'set-migration-state', migration: { required: false, verified: true, userCount: 0, snapshotHash: '', catalogVersion: 'vip-2026-01' },
      reason: 'verified empty production inventory', evidenceRef: 'inventory-1', requestId: 'status_migration_01',
    })).toMatchObject({ ok: true, value: { migration: { required: false, verified: true, userCount: 0 } } });
    expect(normalizeStatusOperationProposal({
      operation: 'set-migration-state', migration: { required: true, verified: true, userCount: 2, snapshotHash: '', catalogVersion: 'vip-2026-01' },
      reason: 'missing immutable evidence hash', evidenceRef: 'inventory-1', requestId: 'status_migration_02',
    }).code).toBe('INVALID_REQUEST');
  });

  it('allows emergency controls to turn approved flags off only', () => {
    expect(normalizeEmergencyFreeze({ flags: { aristocracyShop: false, statusAnimations: false }, reason: 'incident freeze', requestId: 'status_freeze_001' }).ok).toBe(true);
    expect(normalizeEmergencyFreeze({ flags: { aristocracyShop: true }, reason: 'unsafe enable', requestId: 'status_freeze_002' }).code).toBe('INVALID_REQUEST');
  });

  it('requires catalogs, clean operations, and all signoffs for direct activation', () => {
    const ready = deriveOperationsReadiness({
      vip: { activeCatalogVersion: 'vip-v1' }, aristocracy: { activeCatalogVersion: 'noble-v1' }, flags: {},
      migrations: { assessed: true, required: false, verified: true, userCount: 0 }, queues: { deadLetterCount: 0, oldestQueuedAgeMs: 0 },
      reconciliation: { assessed: true, consecutiveDriftRuns: 0 }, signoffs: { product: true, economy: true, security: true, support: true, qa: true },
    });
    expect(ready).toMatchObject({ canActivate: true, directActivationEligible: true, publicFeaturesCurrentlyOff: true });
    expect(deriveOperationsReadiness({ ...{}, vip: {}, aristocracy: {}, queues: {}, reconciliation: {}, migrations: {}, signoffs: {} }).blockers)
      .toContain('VIP_CATALOG_MISSING');
    expect(deriveOperationsReadiness({ vip: { activeCatalogVersion: 'vip-v1' }, aristocracy: { activeCatalogVersion: 'noble-v1' }, queues: {}, reconciliation: {}, migrations: {}, signoffs: {} }).blockers)
      .toEqual(expect.arrayContaining(['MIGRATION_NOT_ASSESSED', 'RECONCILIATION_NOT_RUN']));
  });

  it('pages only after drift is confirmed twice', () => {
    expect(deriveAlertDecision(true, false)).toMatchObject({ create: false, severity: 'warning' });
    expect(deriveAlertDecision(true, true)).toMatchObject({ create: true, severity: 'critical' });
    expect(deriveAlertDecision(true, true, 2)).toMatchObject({ create: false, severity: 'warning' });
    expect(deriveAlertDecision(false, true)).toMatchObject({ create: false, severity: 'none' });
  });
});
