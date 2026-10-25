/**
 * The one place the e2e test bridge reaches into the frame loop. `game.ts` reads it only under
 * `import.meta.env.MODE === 'e2e'` and the bridge is its only writer, so release builds drop both the
 * read and this module. The long property name is deliberate: unlike a local name it survives
 * minification, which lets `check:no-bridge` find it.
 */
export const e2eSeam: { e2eBeforeFrame: (() => void) | null } = { e2eBeforeFrame: null };
