import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/** Every `.ts` file under `dir`, relative to `src/`. */
export function sourcesUnder(dir: string): string[] {
  return readdirSync(join(SRC, dir), { recursive: true })
    .map(String)
    .filter((name) => name.endsWith('.ts') && statSync(join(SRC, dir, name)).isFile())
    .map((name) => join(dir, name));
}

/** The import specifiers of `file` (relative to `src/`), static and dynamic, re-exports included. */
export function importsOf(file: string): string[] {
  const text = readFileSync(join(SRC, file), 'utf8');
  return [...text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
}

/** The module an import resolves to, relative to `src/` and without its extension, or null for a package. */
export function resolveImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  return relative(SRC, resolve(SRC, dirname(from), specifier)).replace(/\.ts$/, '');
}

/** Every module `file` (relative to `src/`) loads, itself and its imports' imports included, without extensions, sorted. */
export function importClosure(file: string): string[] {
  const seen = new Set<string>();
  const visit = (module: string): void => {
    if (seen.has(module)) return;
    seen.add(module);
    for (const specifier of importsOf(`${module}.ts`)) {
      const target = resolveImport(`${module}.ts`, specifier);
      if (target !== null) visit(target);
    }
  };
  visit(file.replace(/\.ts$/, ''));
  return [...seen].sort();
}
