import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const suites = ['battle', 'campaign', 'navigation', 'editor', 'i18n', 'public', 'onboarding', 'maps'];
for (const suite of suites) {
  const result = spawnSync(process.execPath, [`scripts/test-${suite}.mjs`], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`All ${suites.length} test suites passed.`);
