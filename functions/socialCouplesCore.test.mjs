import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const couplesCore = require('./socialCouplesCore');

const {
  createCoupleId,
  normalizeCoupleTargetInput,
  otherCoupleUid,
  resolveCoupleRelationship,
} = couplesCore;

describe('socialCouplesCore', () => {
  it('creates stable order-independent relationship ids', () => {
    expect(createCoupleId('a', 'b')).toBe(createCoupleId('b', 'a'));
    expect(createCoupleId('a', 'b')).toMatch(/^[a-f0-9]{64}$/);
    expect(createCoupleId('a', 'b')).not.toBe(createCoupleId('a', 'c'));
  });

  it('accepts only one different target uid', () => {
    expect(normalizeCoupleTargetInput({ targetUid: ' target ' }, 'self')).toEqual({ ok: true, value: { targetUid: 'target' } });
    expect(normalizeCoupleTargetInput({ targetUid: 'self' }, 'self').ok).toBe(false);
    expect(normalizeCoupleTargetInput({ targetUid: 'target', extra: true }, 'self').ok).toBe(false);
  });

  it('resolves relationship state relative to the requester', () => {
    expect(resolveCoupleRelationship({ couple: { memberUids: ['a', 'b'] }, requestingUid: 'a' })).toBe('coupled');
    expect(resolveCoupleRelationship({ request: { senderUid: 'a', recipientUid: 'b', status: 'pending' }, requestingUid: 'a' })).toBe('outgoing');
    expect(resolveCoupleRelationship({ request: { senderUid: 'a', recipientUid: 'b', status: 'pending' }, requestingUid: 'b' })).toBe('incoming');
    expect(resolveCoupleRelationship({ request: { senderUid: 'a', recipientUid: 'b', status: 'declined' }, requestingUid: 'b' })).toBe('none');
  });

  it('returns only the partner uid', () => {
    expect(otherCoupleUid(['a', 'b'], 'a')).toBe('b');
    expect(otherCoupleUid(undefined, 'a')).toBeUndefined();
  });
});
