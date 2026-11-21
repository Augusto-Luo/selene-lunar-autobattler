import { build } from 'vite';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const output = await build({ configFile: false, logLevel: 'error', build: { write: false, minify: false, lib: { entry: 'tests/navigation.test.ts', formats: ['es'], fileName: 'navigation-tests' }, rolldownOptions: { external: ['node:assert/strict'] } } });
const chunk = (Array.isArray(output) ? output : [output]).flatMap(result => result.output).find(item => item.type === 'chunk' && item.isEntry);
if (!chunk) throw new Error('Navigation test bundle is missing');
const directory = await mkdtemp(join(tmpdir(), 'selene-navigation-test-'));
try {
  const file = join(directory, 'tests.mjs');
  await writeFile(file, chunk.code);
  await import(pathToFileURL(file).href);
} finally { await rm(directory, { recursive: true, force: true }); }
