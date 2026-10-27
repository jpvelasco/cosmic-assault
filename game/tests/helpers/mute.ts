import type { KindRamp, ThreatKind } from '../../src/content/types';

/** A ramp that never picks its kind. */
export const MUTE: KindRamp = { from: 0, base: 0, step: 0, max: 0 };

/** Ramps under which the director spawns nothing, so only a scenario's own threats exist. */
export const MUTED_KINDS: Readonly<Record<ThreatKind, KindRamp>> = { large: MUTE, medium: MUTE, small: MUTE, splitter: MUTE, drone: MUTE };
