/** A directory inside game/, served at `at` (a directory, ending in a slash) relative to the server's prefix. */
export interface PagesMount {
  readonly dir: string;
  readonly at: string;
}

export interface PagesServer {
  /** The prefix on this server's origin, such as `http://localhost:4319/cosmic-assault/`. */
  readonly url: string;
  /** Swaps what is served; a refused set (a directory outside game/) keeps the old one. */
  setMounts(mounts: readonly PagesMount[]): void;
  /** Replaces the literal `from` with `to` in the file the site path `path` names, until the server closes. */
  rewrite(path: string, from: string, to: string): void;
  close(): Promise<void>;
}

/** The body of every 404 the server sends. */
export const NOT_FOUND_BODY: string;

export function createPagesServer(options: { readonly prefix?: string; readonly port?: number; readonly mounts: readonly PagesMount[] }): Promise<PagesServer>;
