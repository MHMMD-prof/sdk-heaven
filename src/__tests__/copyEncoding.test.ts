import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const mojibakePattern = new RegExp(
  `[${String.fromCharCode(0x00c2, 0x00c3, 0x00d8, 0x00d9, 0x00e2, 0x0153, 0xfffd)}]`,
);

const projectRoot = process.cwd();

const skippedDirectories = new Set([
  '.expo',
  '.firebase',
  '.git',
  'coverage',
  'dist',
  'node_modules',
]);

const skippedFiles = new Set([
  'package-lock.json',
  'skills-lock.json',
]);

const sourceExtensions = new Set(['.cjs', '.js', '.json', '.md', '.mjs', '.ts', '.tsx']);

const collectCopyFiles = (root: string): string[] => {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(root, entry.name);

    if (entry.isDirectory()) {
      if (skippedDirectories.has(entry.name)) {
        return [];
      }

      return collectCopyFiles(fullPath);
    }

    if (!entry.isFile()) {
      return [];
    }

    if (skippedFiles.has(entry.name)) {
      return [];
    }

    const extension = entry.name.slice(entry.name.lastIndexOf('.'));
    return sourceExtensions.has(extension) ? [fullPath] : [];
  });
};

describe('app copy encoding', () => {
  it('keeps project copy free of mojibake markers', () => {
    const scannedFiles = collectCopyFiles(projectRoot);

    expect(scannedFiles.length).toBeGreaterThan(0);

    for (const filePath of scannedFiles) {
      expect(readFileSync(filePath, 'utf8'), filePath).not.toMatch(mojibakePattern);
    }
  });
});
