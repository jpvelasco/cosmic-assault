import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';
import config from './playwright.config';

type Project = NonNullable<PlaywrightTestConfig['projects']>[number];

const withoutGrep = (project: Project): Project => Object.fromEntries(Object.entries(project).filter(([key]) => key !== 'grep' && key !== 'grepInvert'));

/** The real config with every project's `grep` and `grepInvert` dropped, so a listing shows each test that testMatch reaches. */
export default defineConfig({ ...config, projects: (config.projects ?? []).map(withoutGrep) });
