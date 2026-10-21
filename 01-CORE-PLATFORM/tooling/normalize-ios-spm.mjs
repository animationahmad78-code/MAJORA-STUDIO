import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const core = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = resolve(core, 'apps/mobile/ios/App/CapApp-SPM/Package.swift');
const original = await readFile(manifest, 'utf8');
const normalized = original.replace(/(\.package\([^\n]*path: ")([^"]+)(")/g, (_, before, path, after) =>
  before + path.replaceAll('\\', '/') + after);
if (normalized !== original) {
  await writeFile(manifest, normalized, 'utf8');
  console.log('Normalized generated iOS SPM paths for macOS.');
} else {
  console.log('iOS SPM paths are ready.');
}
