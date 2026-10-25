import { FIELD_HEIGHT, MAX_ASPECT, MIN_ASPECT } from './config';

export interface Field {
  readonly width: number;
  readonly height: number;
}

export function fieldForViewport(cssWidth: number, cssHeight: number): Field {
  if (!(cssWidth > 0 && cssHeight > 0 && Number.isFinite(cssWidth) && Number.isFinite(cssHeight))) {
    throw new RangeError(
      `fieldForViewport() needs positive finite sizes (got ${String(cssWidth)}×${String(cssHeight)}); wait for layout before sizing the field`,
    );
  }
  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, cssWidth / cssHeight));
  return { width: FIELD_HEIGHT * aspect, height: FIELD_HEIGHT };
}
