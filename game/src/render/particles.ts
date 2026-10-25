export type ParticleKind = 'shard' | 'spark' | 'ring' | 'smoke' | 'glow';

export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds left; the particle expires at 0. */
  life: number;
  /** Seconds it started with, so `life / max` is the fade fraction. */
  max: number;
  size: number;
  rot: number;
  spin: number;
  /** Fraction of velocity kept after one second: `v *= drag ** dt`. */
  drag: number;
  color: string;
  /** Seconds before the particle appears; it is hidden and does not age until then. */
  delay: number;
}

export interface EmitOptions {
  readonly drag?: number;
  readonly spin?: number;
  readonly rot?: number;
  readonly delay?: number;
}

function assertCapacity(capacity: number): void {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(
      `ParticlePool needs a capacity of at least 1 (got ${String(capacity)}); pass a whole number of 1 or more`,
    );
  }
}

function blankParticle(): Particle {
  return { kind: 'spark', x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0, size: 0, rot: 0, spin: 0, drag: 1, color: '#ffffff', delay: 0 };
}

/**
 * A fixed-capacity ring of preallocated particles. Live particles sit in emission order starting
 * at `head`; a full pool reuses its oldest slot, so nothing is allocated after construction or
 * `setCapacity`. `count` includes particles still waiting out their delay.
 */
export class ParticlePool {
  private slots: Particle[] = [];
  private head = 0;
  private live = 0;

  constructor(capacity: number) {
    assertCapacity(capacity);
    for (let i = 0; i < capacity; i++) this.slots.push(blankParticle());
  }

  get capacity(): number {
    return this.slots.length;
  }

  get count(): number {
    return this.live;
  }

  /** Keeps the newest particles that fit. Allocates only the slots a larger capacity adds. */
  setCapacity(capacity: number): void {
    assertCapacity(capacity);
    const old = this.slots;
    const kept = Math.min(this.live, capacity);
    const next: Particle[] = [];
    const spare: Particle[] = [];
    for (let i = 0; i < old.length; i++) {
      const particle = old[(this.head + i) % old.length] as Particle;
      if (i >= this.live - kept && i < this.live) next.push(particle);
      else spare.push(particle);
    }
    for (let i = 0; next.length < capacity; i++) next.push(spare[i] ?? blankParticle());
    this.slots = next;
    this.head = 0;
    this.live = kept;
  }

  emit(
    kind: ParticleKind,
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    color: string,
    opts?: EmitOptions,
  ): void {
    const cap = this.slots.length;
    if (this.live === cap) {
      this.head = (this.head + 1) % cap;
      this.live--;
    }
    const p = this.slots[(this.head + this.live) % cap] as Particle;
    this.live++;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = life;
    p.max = life;
    p.size = size;
    p.rot = opts?.rot ?? 0;
    p.spin = opts?.spin ?? 0;
    p.drag = opts?.drag ?? 1;
    p.color = color;
    p.delay = opts?.delay ?? 0;
  }

  /** Ages, moves and expires particles, compacting survivors in place by swapping slots. */
  step(dt: number): void {
    const cap = this.slots.length;
    let kept = 0;
    for (let i = 0; i < this.live; i++) {
      const src = (this.head + i) % cap;
      const p = this.slots[src] as Particle;
      if (p.delay > 0) {
        p.delay = Math.max(0, p.delay - dt);
      } else {
        const damping = p.drag === 1 ? 1 : p.drag ** dt;
        p.vx *= damping;
        p.vy *= damping;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
        p.life -= dt;
        if (p.life <= 0) continue;
      }
      const dst = (this.head + kept) % cap;
      this.slots[src] = this.slots[dst] as Particle;
      this.slots[dst] = p;
      kept++;
    }
    this.live = kept;
  }

  /** Visits visible particles oldest first. The visitor must not emit or step the pool. */
  forEach(visit: (p: Readonly<Particle>) => void): void {
    const cap = this.slots.length;
    for (let i = 0; i < this.live; i++) {
      const p = this.slots[(this.head + i) % cap] as Particle;
      if (p.delay <= 0) visit(p);
    }
  }
}
