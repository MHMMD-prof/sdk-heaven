const crypto = require('node:crypto');
const { isValidRepresentativeTransferPin } = require('./representativePortalCore');

const REPRESENTATIVE_PIN_HASH_ALGORITHM = 'scrypt';
const REPRESENTATIVE_PIN_SALT_BYTES = 16;
const REPRESENTATIVE_PIN_KEY_BYTES = 32;
const REPRESENTATIVE_PIN_SCRYPT_PARAMS = Object.freeze({ blockSize: 8, cost: 16384, parallelization: 1 });

async function hashRepresentativePin(pin, dependencies = {}) {
  if (!isValidRepresentativeTransferPin(pin)) throw new Error('A valid representative PIN is required.');
  const randomBytes = dependencies.randomBytes || crypto.randomBytes;
  const saltBuffer = randomBytes(REPRESENTATIVE_PIN_SALT_BYTES);
  if (!Buffer.isBuffer(saltBuffer) || saltBuffer.length !== REPRESENTATIVE_PIN_SALT_BYTES) throw new Error('Secure random bytes are required.');
  const derivedKey = await deriveRepresentativePin(pin, saltBuffer, dependencies.scrypt);
  return {
    algorithm: REPRESENTATIVE_PIN_HASH_ALGORITHM,
    derivedKey: derivedKey.toString('base64url'),
    params: { ...REPRESENTATIVE_PIN_SCRYPT_PARAMS, keyBytes: REPRESENTATIVE_PIN_KEY_BYTES },
    salt: saltBuffer.toString('base64url'),
  };
}

async function verifyRepresentativePin(pin, document, dependencies = {}) {
  if (!isValidRepresentativeTransferPin(pin)) return false;
  const normalized = normalizeRepresentativePinHash(document);
  if (!normalized) return false;
  const derivedKey = await deriveRepresentativePin(pin, normalized.salt, dependencies.scrypt);
  return derivedKey.length === normalized.derivedKey.length && crypto.timingSafeEqual(derivedKey, normalized.derivedKey);
}

function normalizeRepresentativePinHash(document) {
  if (document?.algorithm !== REPRESENTATIVE_PIN_HASH_ALGORITHM || !document?.params || typeof document.params !== 'object') return undefined;
  const { blockSize, cost, keyBytes, parallelization } = document.params;
  if (blockSize !== REPRESENTATIVE_PIN_SCRYPT_PARAMS.blockSize || cost !== REPRESENTATIVE_PIN_SCRYPT_PARAMS.cost
    || parallelization !== REPRESENTATIVE_PIN_SCRYPT_PARAMS.parallelization || keyBytes !== REPRESENTATIVE_PIN_KEY_BYTES) return undefined;
  try {
    const salt = Buffer.from(document.salt, 'base64url');
    const derivedKey = Buffer.from(document.derivedKey, 'base64url');
    if (salt.length !== REPRESENTATIVE_PIN_SALT_BYTES || derivedKey.length !== REPRESENTATIVE_PIN_KEY_BYTES) return undefined;
    return { derivedKey, salt };
  } catch {
    return undefined;
  }
}

function deriveRepresentativePin(pin, salt, scrypt = crypto.scrypt) {
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, REPRESENTATIVE_PIN_KEY_BYTES, {
      N: REPRESENTATIVE_PIN_SCRYPT_PARAMS.cost,
      maxmem: 64 * 1024 * 1024,
      p: REPRESENTATIVE_PIN_SCRYPT_PARAMS.parallelization,
      r: REPRESENTATIVE_PIN_SCRYPT_PARAMS.blockSize,
    }, (error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

module.exports = {
  REPRESENTATIVE_PIN_HASH_ALGORITHM,
  REPRESENTATIVE_PIN_KEY_BYTES,
  REPRESENTATIVE_PIN_SALT_BYTES,
  REPRESENTATIVE_PIN_SCRYPT_PARAMS,
  hashRepresentativePin,
  normalizeRepresentativePinHash,
  verifyRepresentativePin,
};
