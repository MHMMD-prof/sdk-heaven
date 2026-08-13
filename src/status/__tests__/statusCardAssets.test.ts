import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { STATUS_CARD_ASSET_MANIFEST } from '../statusCardAssets';

describe('Wave 4 bundled card assets', () => {
  it.each(Object.values(STATUS_CARD_ASSET_MANIFEST))('pins $id dimensions, byte budget, and checksum', (asset) => {
    const bytes = readFileSync(resolve(process.cwd(), asset.path));
    expect(bytes.length).toBe(asset.byteSize);
    expect(bytes.length).toBeLessThan(1024 * 1024);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
    expect(asset.width / asset.height).toBe(3.4);
  });
});
