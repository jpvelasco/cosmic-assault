/** Keeps the items whose index is not flagged, in order, without allocating. */
export function removeFlagged(items: unknown[], flagged: readonly boolean[]): void {
  let kept = 0;
  for (let i = 0; i < items.length; i++) {
    if (flagged[i] !== true) {
      items[kept++] = items[i];
    }
  }
  items.length = kept;
}

/** Sizes `flags` to `length`, all false, reusing its storage. */
export function resetFlags(flags: boolean[], length: number): void {
  flags.length = length;
  flags.fill(false);
}
