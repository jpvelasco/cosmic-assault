import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BRIDGE = '__COSMIC_ASSAULT_TEST_API__';
const distDir = resolve(process.argv[2] ?? fileURLToPath(new URL('../dist', import.meta.url)));

if (!existsSync(distDir)) {
  console.error(`${distDir} does not exist; run npm run build first`);
  process.exit(1);
}

const offenders = readdirSync(distDir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => join(entry.parentPath, entry.name))
  .filter((path) => readFileSync(path, 'latin1').includes(BRIDGE));

if (offenders.length > 0) {
  console.error(
    'dist/ contains the e2e test bridge; release builds must not — check the import.meta.env.MODE guard in src/main.ts',
  );
  for (const path of offenders) console.error(`  ${path}`);
  process.exit(1);
}
console.log('bridge absent');
