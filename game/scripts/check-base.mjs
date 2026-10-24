import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

if (/(src|href)="\//.test(html)) {
  console.error("dist/index.html has absolute asset URLs; set base: './' in vite.config.ts");
  process.exit(1);
}
console.log('base ok');
