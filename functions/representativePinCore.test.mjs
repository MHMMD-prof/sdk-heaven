import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { hashRepresentativePin, normalizeRepresentativePinHash, verifyRepresentativePin } = require('./representativePinCore');

describe('representativePinCore', () => {
  it('stores a parameterized salted scrypt hash and verifies it', async () => {
    const document = await hashRepresentativePin('012345', { randomBytes: (size) => Buffer.alloc(size, 7) });
    expect(document).toMatchObject({ algorithm: 'scrypt', params: { blockSize: 8, cost: 16384, keyBytes: 32, parallelization: 1 } });
    expect(document).not.toHaveProperty('pin');
    expect(normalizeRepresentativePinHash(document)).toBeDefined();
    await expect(verifyRepresentativePin('012345', document)).resolves.toBe(true);
    await expect(verifyRepresentativePin('012346', document)).resolves.toBe(false);
  });

  it('rejects malformed hashes and non-six-digit PINs', async () => {
    await expect(hashRepresentativePin('12345')).rejects.toThrow();
    await expect(verifyRepresentativePin('123456', { algorithm: 'scrypt', derivedKey: '', params: {}, salt: '' })).resolves.toBe(false);
  });
});
