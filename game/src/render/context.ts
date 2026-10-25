export function get2dContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('2D canvas is unavailable; use a browser with Canvas 2D support');
  }
  return ctx;
}
