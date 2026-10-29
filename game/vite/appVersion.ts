import { readFileSync } from 'node:fs';

/** The release version in package.json, which the build label names. */
export const APP_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
