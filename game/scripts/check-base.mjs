import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDir } from './build-dir.mjs';

// Usage: check-base.mjs [dist]   fails if the page in [dist] (game/dist by default) loads an asset from the host's root.

const dir = buildDir(process.argv[2]);
const page = join(dir, 'index.html');
if (!existsSync(page)) {
  console.error(`${dir} has no index.html; run npm run build, or pass the directory that holds the build`);
  process.exit(1);
}
if (/(src|href)="\//.test(readFileSync(page, 'utf8'))) {
  console.error(`${page} has absolute asset URLs; set base: './' in vite.config.ts`);
  process.exit(1);
}
console.log('base ok');
