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

interface CellRange {
  readonly minCx: number;
  readonly maxCx: number;
  readonly minCy: number;
  readonly maxCy: number;
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
  private querying = false;

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

  /**
   * `index` must be a small non-negative integer (the item's dense array index);
   * it stays valid until the caller's array changes, so call `clear()` and
   * re-insert after any reorder. Do not call from inside a `forEachCandidate` visit.
   */
  insert(index: number, x: number, y: number, radius: number): void {
    if (!Number.isInteger(index) || index < 0) {
      throw new RangeError(
        `SpatialHash.insert() needs a non-negative integer index (got ${String(index)}); pass the item's array index`,
      );
    }
    const { minCx, maxCx, minCy, maxCy } = this.cellRange('insert', x, y, radius);
    for (let cy = minCy; cy <= maxCy; cy++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
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

  /**
   * Calls visit once per indexed item whose cells touch the circle; caller still checks circlesOverlap.
   * `visit` must not call `insert()` or `clear()` (buckets are being iterated) or start another
   * query on this instance (it throws a RangeError; use a second SpatialHash).
   */
  forEachCandidate(x: number, y: number, radius: number, visit: (index: number) => void): void {
    const { minCx, maxCx, minCy, maxCy } = this.cellRange('forEachCandidate', x, y, radius);
    if (this.querying) {
      throw new RangeError(
        'forEachCandidate() was called while another query on the same SpatialHash is running; finish the outer query first or use a second SpatialHash',
      );
    }
    this.querying = true;
    try {
      const stamp = ++this.queryId;
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
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
    } finally {
      this.querying = false;
    }
  }

  private cellRange(caller: string, x: number, y: number, radius: number): CellRange {
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(radius))) {
      throw new RangeError(
        `SpatialHash.${caller}() needs finite x, y and radius (got ${String(x)}, ${String(y)}, ${String(radius)}); fix the caller's inputs`,
      );
    }
    return {
      minCx: Math.floor((x - radius) / this.cellSize),
      maxCx: Math.floor((x + radius) / this.cellSize),
      minCy: Math.floor((y - radius) / this.cellSize),
      maxCy: Math.floor((y + radius) / this.cellSize),
    };
  }
}
