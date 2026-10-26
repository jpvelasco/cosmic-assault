const SHORT_SHA_LENGTH = 7;

export function formatBuildLabel(sha: string | undefined, isoDate: string): string {
  const revision = sha ? sha.slice(0, SHORT_SHA_LENGTH) : 'local';
  return `preview · ${revision} · ${isoDate.slice(0, 10)}`;
}

/** This build's label; `__BUILD_SHA__` is empty outside CI. */
export function currentBuildLabel(): string {
  return formatBuildLabel(__BUILD_SHA__ || undefined, __BUILD_DATE__);
}
