/**
 * The decisions of the worker that retires the preview address (`src/sw/retire.ts`), kept free of worker globals so
 * they run under Vitest. This file imports nothing, so that worker shares no code with the game or the game's worker.
 */

/**
 * The caches of the worker that served the preview address. The name is frozen: it is what the devices that ran the
 * preview hold.
 */
export const RETIRED_CACHE_PREFIX = 'cosmic-assault-next-';

/** An open page, as the worker's clients list gives it. */
export interface RetireWindow {
  readonly url: string;
  navigate(url: string): Promise<unknown>;
}

/** What the retiring worker reaches in its global scope: its clients, the origin's caches and its own registration. */
export interface RetireHost {
  claim(): Promise<unknown>;
  cacheNames(): Promise<readonly string[]>;
  deleteCache(name: string): Promise<unknown>;
  windows(): Promise<readonly RetireWindow[]>;
  unregister(): Promise<unknown>;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs `act` on every item, each one even if another fails, then throws one error naming every failure. */
async function settleEach<T>(items: readonly T[], nameOf: (item: T) => string, act: (item: T) => Promise<unknown>): Promise<void> {
  const failures = (
    await Promise.all(
      items.map(async (item) => {
        try {
          await act(item);
          return [];
        } catch (error) {
          return [`${nameOf(item)} (${reasonOf(error)})`];
        }
      }),
    )
  ).flat();
  if (failures.length > 0) throw new Error(failures.join('; '));
}

function isUnder(url: string, scope: URL): boolean {
  const page = new URL(url);
  return page.origin === scope.origin && page.pathname.startsWith(scope.pathname);
}

/**
 * Retires the preview at `scope`, in order: takes control of its pages, so they can be navigated; deletes the
 * preview's caches and no other; sends every page under `scope` to the site root, the directory above it; and
 * unregisters. Each step runs even if an earlier one failed. Never throws: the result names each step that failed.
 */
export async function retirePreview(host: RetireHost, scope: URL): Promise<readonly string[]> {
  const root = new URL('../', scope).href;
  const steps: readonly (readonly [string, () => Promise<unknown>])[] = [
    ["take control of the preview's pages", () => host.claim()],
    [
      "delete the preview's caches",
      async () => {
        const names = (await host.cacheNames()).filter((name) => name.startsWith(RETIRED_CACHE_PREFIX));
        await settleEach(names, (name) => name, (name) => host.deleteCache(name));
      },
    ],
    [
      "send the preview's pages to the game",
      async () => {
        const pages = (await host.windows()).filter((page) => isUnder(page.url, scope));
        await settleEach(pages, (page) => page.url, (page) => page.navigate(root));
      },
    ],
    ['unregister the retired preview worker', () => host.unregister()],
  ];
  const problems: string[] = [];
  for (const [what, run] of steps) {
    try {
      await run();
    } catch (error) {
      problems.push(`Could not ${what}: ${reasonOf(error)}`);
    }
  }
  return problems;
}
