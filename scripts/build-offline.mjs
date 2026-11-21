import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
let html = await readFile(resolve(dist, 'index.html'), 'utf8');

async function inlineAssets(pattern, wrap) {
  const matches = [...html.matchAll(pattern)];
  if (matches.length !== 1) throw new Error('Expected one bundled asset per type.');
  const [tag, asset] = matches[0];
  const assetPath = resolve(dist, asset);
  if (!assetPath.startsWith(dist + sep)) throw new Error('Asset is outside dist.');
  const code = await readFile(assetPath, 'utf8');
  html = html.replace(tag, () => wrap(code));
}

const scriptPattern = /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g;
const stylePattern = /<link\b[^>]*\bhref="([^"]+\.css)"[^>]*>/g;
await inlineAssets(scriptPattern, code => `<script type="module">${code.replace(/<\/script/gi, '<\\/script')}</script>`);
await inlineAssets(stylePattern, css => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`);

const output = resolve(root, '试玩.html');
await writeFile(output, html);
console.log(`Offline game: ${output}`);
