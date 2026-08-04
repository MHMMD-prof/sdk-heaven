import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  isActivePlatformOwner,
  normalizeRepresentativeFlagCommand,
} = require('./representativeKillSwitchCore');

describe('representativeKillSwitchCore', () => {
  it('defaults to a non-mutating disable preview', () => {
    expect(normalizeRepresentativeFlagCommand([])).toEqual({
      ok: true,
      value: { actorUid: '', apply: false, enable: false, reason: '' },
    });
  });

  it('requires an actor and reason before applying an emergency disable', () => {
    expect(normalizeRepresentativeFlagCommand(['--apply'])).toMatchObject({ ok: false });
    expect(normalizeRepresentativeFlagCommand([
      '--apply',
      '--actor-uid', 'owner-1',
      '--reason', 'Payment provider incident',
    ])).toEqual({
      ok: true,
      value: {
        actorUid: 'owner-1',
        apply: true,
        enable: false,
        reason: 'Payment provider incident',
      },
    });
  });

  it('requires an explicit acknowledgement before enabling', () => {
    expect(normalizeRepresentativeFlagCommand([
      '--enable',
      '--actor-uid', 'owner-1',
      '--reason', 'Incident resolved',
    ])).toMatchObject({ ok: false });
    expect(normalizeRepresentativeFlagCommand([
      '--apply',
      '--enable',
      '--acknowledge-enable',
      '--actor-uid', 'owner-1',
      '--reason', 'Incident resolved',
    ])).toMatchObject({ ok: true, value: { apply: true, enable: true } });
    expect(normalizeRepresentativeFlagCommand(['--unexpected'])).toMatchObject({ ok: false });
  });

  it('accepts only the active Platform Owner as the recorded actor', () => {
    expect(isActivePlatformOwner({ role: 'owner', status: 'active', uid: 'owner-1' }, 'owner-1')).toBe(true);
    expect(isActivePlatformOwner({ role: 'owner', status: 'disabled', uid: 'owner-1' }, 'owner-1')).toBe(false);
    expect(isActivePlatformOwner({ role: 'support', status: 'active', uid: 'owner-1' }, 'owner-1')).toBe(false);
    expect(isActivePlatformOwner({ role: 'owner', status: 'active', uid: 'owner-2' }, 'owner-1')).toBe(false);
  });
});
