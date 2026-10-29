/** The build directory a guard checks: `argument`, or else game/<fallback>; exits with a hint when it is missing. */
export function buildDir(argument: string | undefined, options?: { readonly fallback?: string; readonly buildScript?: string }): string;

/** Every file under `dir`, as a path relative to it with forward slashes, sorted. */
export function filesIn(dir: string): string[];

/** `text` as the address of a site's directory, or undefined unless it is http(s), ends in a slash and has no query or hash. */
export function siteAddress(text: string): URL | undefined;
