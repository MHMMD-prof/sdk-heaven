import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { BLOCK_MUTATION_ACTIONS, normalizeBlockTargetInput } = require('./socialBlocksCore');

describe('socialBlocksCore', () => {
  it('accepts only a different safe target UID', () => {
    expect(BLOCK_MUTATION_ACTIONS).toEqual(['block-user', 'unblock-user']);
    expect(normalizeBlockTargetInput({ targetUid: 'user-2' }, 'user-1')).toEqual({ ok: true, value: { targetUid: 'user-2' } });
    expect(normalizeBlockTargetInput({ targetUid: 'user-1' }, 'user-1')).toMatchObject({ ok: false });
    expect(normalizeBlockTargetInput({ targetUid: 'bad/path' }, 'user-1')).toMatchObject({ ok: false });
    expect(normalizeBlockTargetInput({ targetUid: 'user-2', forged: true }, 'user-1')).toMatchObject({ ok: false });
  });
});
