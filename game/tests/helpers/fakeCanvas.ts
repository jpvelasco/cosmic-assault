/** A canvas stand-in for the renderer and baker tests: its 2D context logs every image drawn with the transform in force. */
export interface DrawCall {
  readonly image: unknown;
  /** The transform's x scale when the image was drawn: the field scale, times the sprite's own turn and scale. */
  readonly a: number;
  /** The transform's x skew when the image was drawn: the sine of the sprite's turn, times its scale. */
  readonly b: number;
  /** The transform's x and y offset when the image was drawn. */
  readonly e: number;
  readonly f: number;
  /** The globalAlpha in force. */
  readonly alpha: number;
  readonly smoothing: boolean;
}

export interface FakeCanvas {
  width: number;
  height: number;
  readonly style: Record<string, string>;
  readonly draws: DrawCall[];
  /** The colour of every gradient stop added so far. */
  readonly stops: string[];
  /** Arcs begun so far; the stars are the only thing drawn as arcs in the stub scene. */
  arcs: number;
  /** Every point a line or curve was drawn to, with the alpha then. */
  readonly lines: { x: number; y: number; alpha: number }[];
  /** The `save()`s not yet restored. */
  saved: number;
  getContext(kind: string): unknown;
}

/** A canvas whose 2D context accepts every call and logs each drawImage with the transform offset in force. */
export function fakeCanvas(): FakeCanvas {
  const draws: DrawCall[] = [];
  let a = 1;
  let b = 0;
  let e = 0;
  let f = 0;
  let alpha = 1;
  let smoothing = true;
  const fake: FakeCanvas = { width: 0, height: 0, style: {}, draws, stops: [], arcs: 0, lines: [], saved: 0, getContext: () => ctx };
  const gradient = { addColorStop: (_at: number, color: string) => fake.stops.push(color) };
  const ctx = new Proxy(
    {},
    {
      get: (_target, name) => {
        switch (name) {
          case 'setTransform':
            return (nextA: number, nextB: number, _c: number, _d: number, nextE: number, nextF: number) => {
              a = nextA;
              b = nextB;
              e = nextE;
              f = nextF;
            };
          case 'drawImage':
            return (image: unknown) => draws.push({ image, a, b, e, f, alpha, smoothing });
          case 'arc':
            return () => fake.arcs++;
          case 'save':
            return () => fake.saved++;
          case 'restore':
            return () => fake.saved--;
          case 'lineTo':
            return (x: number, y: number) => fake.lines.push({ x, y, alpha });
          case 'quadraticCurveTo':
            return (_cx: number, _cy: number, x: number, y: number) => fake.lines.push({ x, y, alpha });
          case 'createLinearGradient':
          case 'createRadialGradient':
            return () => gradient;
          case 'measureText':
            return (text: string) => ({ width: text.length * 10 });
          default:
            return () => undefined;
        }
      },
      set: (_target, name, value) => {
        if (name === 'globalAlpha') alpha = value as number;
        if (name === 'imageSmoothingEnabled') smoothing = value as boolean;
        return true;
      },
    },
  );
  return fake;
}

/** What a recording 2D context tells of: each method called, with its arguments; each property set; each gradient stop. */
export interface ContextLog {
  call?(name: string, args: readonly unknown[]): void;
  set?(name: string, value: unknown): void;
  stop?(offset: number, color: string): void;
}

/**
 * A Canvas 2D stand-in that accepts every call and tells `log` of it. Each gradient it makes is new, and keeps its stops
 * as `offset:colour` in `stops`.
 */
export function recordingContext(log: ContextLog = {}): unknown {
  const gradient = () => {
    const stops: string[] = [];
    return {
      stops,
      addColorStop: (offset: number, color: string) => {
        stops.push(`${String(offset)}:${color}`);
        log.stop?.(offset, color);
      },
    };
  };
  return new Proxy(
    {},
    {
      get: (_target, name) =>
        name === 'createLinearGradient' || name === 'createRadialGradient'
          ? gradient
          : (...args: unknown[]) => {
              log.call?.(String(name), args);
            },
      set: (_target, name, value) => {
        log.set?.(String(name), value);
        return true;
      },
    },
  );
}
