const SHORT_SHA_LENGTH = 7;

export function formatBuildLabel(sha: string | undefined, isoDate: string): string {
  const revision = sha ? sha.slice(0, SHORT_SHA_LENGTH) : 'local';
  return `preview · ${revision} · ${isoDate.slice(0, 10)}`;
}
