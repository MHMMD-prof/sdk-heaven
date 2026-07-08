import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const mojibakePattern = new RegExp(
  `[${String.fromCharCode(0x00c2, 0x00c3, 0x00d8, 0x00d9, 0x00e2, 0x0153, 0xfffd)}]`,
);

const sourceRoots = [
  join(process.cwd(), 'src', 'auth'),
  join(process.cwd(), 'src', 'battleship'),
  join(process.cwd(), 'src', 'components'),
  join(process.cwd(), 'src', 'data'),
  join(process.cwd(), 'src', 'drawingGuess'),
  join(process.cwd(), 'src', 'hooks'),
  join(process.cwd(), 'src', 'screens'),
  join(process.cwd(), 'src', 'utils'),
  join(process.cwd(), 'src', 'voice'),
  join(process.cwd(), 'docs'),
];

const sourceExtensions = new Set(['.md', '.ts', '.tsx']);

const collectCopyFiles = (root: string): string[] => {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(root, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === '__tests__') {
        return [];
      }

      return collectCopyFiles(fullPath);
    }

    if (!entry.isFile()) {
      return [];
    }

    const extension = entry.name.slice(entry.name.lastIndexOf('.'));
    return sourceExtensions.has(extension) ? [fullPath] : [];
  });
};

describe('app copy encoding', () => {
  it('keeps runtime Arabic and release copy free of mojibake markers', () => {
    const scannedFiles = sourceRoots.flatMap(collectCopyFiles);

    expect(scannedFiles.length).toBeGreaterThan(0);

    for (const filePath of scannedFiles) {
      expect(readFileSync(filePath, 'utf8'), filePath).not.toMatch(mojibakePattern);
    }
  });
});
