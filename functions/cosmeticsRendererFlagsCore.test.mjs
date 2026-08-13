import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  parseCosmeticsRendererOffArguments,
  parseCosmeticsRendererOnArguments,
} = require('./cosmeticsRendererFlagsCore');

describe('cosmetics renderer dark controls', () => {
  it('builds an off-only patch with independent couple controls', () => {
    const result = parseCosmeticsRendererOffArguments(['--apply', '--actor-uid', 'owner-1']);
    expect(result).toMatchObject({
      ok: true,
      value: {
        actorUid: 'owner-1',
        apply: true,
        patch: {
          cosmetics_couple_effects: false,
          cosmetics_couple_entrances: false,
          room_bottom_effect_stage: false,
        },
        rolloutPatch: { room_bottom_effect_stage_rollout: 'off' },
      },
    });
    expect(Object.values(result.value.patch).every((value) => value === false)).toBe(true);
  });

  it('rejects enable or unknown switches and requires an actor for apply', () => {
    expect(parseCosmeticsRendererOffArguments(['--enable']).ok).toBe(false);
    expect(parseCosmeticsRendererOffArguments(['--apply']).ok).toBe(false);
    expect(parseCosmeticsRendererOffArguments([])).toMatchObject({ ok: true, value: { apply: false } });
  });

  it('builds an enable-all patch only with explicit --enable-all', () => {
    expect(parseCosmeticsRendererOnArguments(['--apply', '--actor-uid', 'owner-1']).ok).toBe(false);
    const result = parseCosmeticsRendererOnArguments([
      '--enable-all',
      '--apply',
      '--actor-uid',
      'owner-1',
    ]);
    expect(result.ok).toBe(true);
    expect(Object.values(result.value.patch).every((value) => value === true)).toBe(true);
    expect(result.value.rolloutPatch).toMatchObject({
      room_bottom_effect_stage_rollout: 'global',
    });
  });

  it('records both emergency disable and test enable writes in the admin audit log', () => {
    const disableScript = readFileSync(new URL('./scripts/setCosmeticsRendererFlags.js', import.meta.url), 'utf8');
    const enableScript = readFileSync(new URL('./scripts/setCosmeticsRendererEnable.js', import.meta.url), 'utf8');

    expect(disableScript).toContain("action: 'cosmetics-renderer-disable'");
    expect(disableScript).toContain('transaction.create(auditRef');
    expect(disableScript).toContain('buildPreviousConfigSnapshot(before, combinedPatch)');
    expect(enableScript).toContain('buildPreviousConfigSnapshot(before, { ...patch, ...rolloutPatch })');
  });
});
