import { FIELD_HEIGHT, MAX_ASPECT, MIN_ASPECT } from './config';

export interface Field {
  readonly width: number;
  readonly height: number;
}

/** True for a width and height that are both finite and greater than zero. */
export function isPositiveFiniteSize(width: number, height: number): boolean {
  return width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height);
}

export function fieldForViewport(cssWidth: number, cssHeight: number): Field {
  if (!isPositiveFiniteSize(cssWidth, cssHeight)) {
    throw new RangeError(
      `fieldForViewport() needs positive finite sizes (got ${String(cssWidth)}×${String(cssHeight)}); wait for layout before sizing the field`,
    );
  }
  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, cssWidth / cssHeight));
  return { width: FIELD_HEIGHT * aspect, height: FIELD_HEIGHT };
}
