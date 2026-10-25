const HASH_PRIME_X = 73856093;
const HASH_PRIME_Y = 19349663;

/** Strict test: circles that exactly touch do not overlap, matching the live game. */
export function circlesOverlap(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const reach = ar + br;
  return dx * dx + dy * dy < reach * reach;
}

function cellKey(cx: number, cy: number): number {
  return (cx * HASH_PRIME_X) ^ (cy * HASH_PRIME_Y);
}

/**
 * Uniform-grid broad phase. Buckets and the visit-stamp array are reused
 * across `clear()` calls so a per-frame rebuild does not reallocate.
 */
export class SpatialHash {
  private readonly cellSize: number;
  private readonly cells = new Map<number, number[]>();
  private readonly spareBuckets: number[][] = [];
  private readonly stamps: number[] = [];
  private queryId = 0;
  private minCx = 0;
  private minCy = 0;
  private maxCx = 0;
  private maxCy = 0;

  constructor(cellSize: number) {
    if (!(cellSize > 0 && Number.isFinite(cellSize))) {
      throw new RangeError(
        `SpatialHash needs a positive finite cellSize (got ${String(cellSize)}); use roughly the diameter of the largest circle`,
      );
    }
    this.cellSize = cellSize;
  }

  clear(): void {
    for (const bucket of this.cells.values()) {
      bucket.length = 0;
      this.spareBuckets.push(bucket);
    }
    this.cells.clear();
  }

  insert(index: number, x: number, y: number, radius: number): void {
    this.locate('insert', x, y, radius);
    for (let cy = this.minCy; cy <= this.maxCy; cy++) {
      for (let cx = this.minCx; cx <= this.maxCx; cx++) {
        const key = cellKey(cx, cy);
        let bucket = this.cells.get(key);
        if (bucket === undefined) {
          bucket = this.spareBuckets.pop() ?? [];
          this.cells.set(key, bucket);
        }
        bucket.push(index);
      }
    }
  }

  /** Calls visit once per indexed item whose cells touch the circle; caller still checks circlesOverlap. */
  forEachCandidate(x: number, y: number, radius: number, visit: (index: number) => void): void {
    this.locate('forEachCandidate', x, y, radius);
    const stamp = ++this.queryId;
    for (let cy = this.minCy; cy <= this.maxCy; cy++) {
      for (let cx = this.minCx; cx <= this.maxCx; cx++) {
        const bucket = this.cells.get(cellKey(cx, cy));
        if (bucket === undefined) {
          continue;
        }
        for (const index of bucket) {
          if (this.stamps[index] !== stamp) {
            this.stamps[index] = stamp;
            visit(index);
          }
        }
      }
    }
  }

  private locate(caller: string, x: number, y: number, radius: number): void {
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(radius))) {
      throw new RangeError(
        `SpatialHash.${caller}() needs finite x, y and radius (got ${String(x)}, ${String(y)}, ${String(radius)}); fix the caller's inputs`,
      );
    }
    this.minCx = Math.floor((x - radius) / this.cellSize);
    this.maxCx = Math.floor((x + radius) / this.cellSize);
    this.minCy = Math.floor((y - radius) / this.cellSize);
    this.maxCy = Math.floor((y + radius) / this.cellSize);
  }
}
