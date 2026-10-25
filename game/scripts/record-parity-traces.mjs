// Records reference ship trajectories from the live game's own Player.js.
// The output fixtures are the ground truth the TypeScript ship must reproduce.
// Run from game/ with: npm run record:parity
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PLAYER_URL = new URL('../../website/modules/entities/Player.js', import.meta.url);
const CONSTANTS_URL = new URL('../../website/modules/core/constants.js', import.meta.url);
const OUT_DIR = new URL('../tests/fixtures/parity/', import.meta.url);

if (!existsSync(PLAYER_URL) || !existsSync(CONSTANTS_URL)) {
  console.error(
    `Cannot find the live game's Player.js at ${fileURLToPath(PLAYER_URL)}. ` +
      'Run this script from game/ (npm run record:parity) in a checkout that still contains website/.',
  );
  process.exit(1);
}

const { Player } = await import(PLAYER_URL.href);
const { WEAPON_SPREAD } = await import(CONSTANTS_URL.href);

const DT = 1 / 60;
const FIELD = { width: 1280, height: 720 };
const START = { x: 640, y: 360 };
// Tier 1 fires a single shot at these angle offsets (a single entry, 0).
const TIER_ONE_OFFSETS = WEAPON_SPREAD[1].angles;

const NONE = { keys: [], stick: null };
const keys = (...names) => ({ keys: names, stick: null });
const stick = (angle, distance) => ({ keys: [], stick: { angle, distance } });

const SCENARIOS = [
  { name: 'idle', segments: [[60, NONE]] },
  { name: 'thrust-coast', segments: [[180, keys('ArrowUp')], [180, NONE]] },
  {
    name: 'turn-thrust',
    segments: [[60, keys('ArrowLeft')], [120, keys('ArrowLeft', 'ArrowUp')], [60, keys('ArrowRight')]],
  },
  { name: 'max-speed', segments: [[300, keys('ArrowUp')]] },
  { name: 'wrap', start: { x: 1300, y: 360, angle: 0 }, segments: [[120, keys('ArrowUp')]] },
  { name: 'fire-held', segments: [[120, keys(' ')], [30, keys(' ', 'ArrowLeft')]] },
  {
    name: 'stick',
    segments: [[120, stick(0.7, 30)], [120, stick(2.0, 90)], [120, NONE]],
  },
  { name: 'stick-deadzone', segments: [[60, stick(1.0, 5)]] },
  { name: 'invulnerability', keepInvulnerable: true, segments: [[240, NONE]] },
];

function shotsFrom(payload) {
  return TIER_ONE_OFFSETS.map((offset) => ({
    x: payload.x,
    y: payload.y,
    vx: payload.baseVx + Math.cos(payload.angle + offset) * payload.speed,
    vy: payload.baseVy + Math.sin(payload.angle + offset) * payload.speed,
  }));
}

function record({ name, start, keepInvulnerable = false, segments }) {
  const player = new Player(START.x, START.y);
  if (!keepInvulnerable) {
    player.invulnerable = false;
    player.invulnerabilityTimer = 0;
  }
  if (start) Object.assign(player, start);
  const recordedStart = { x: player.x, y: player.y, angle: player.angle };

  const frames = [];
  for (const [count, input] of segments) {
    const keyState = Object.fromEntries(input.keys.map((key) => [key, true]));
    const gameInput = {
      keys: keyState,
      joystickActive: input.stick !== null,
      joystickAngle: input.stick?.angle ?? 0,
      joystickDistance: input.stick?.distance ?? 0,
    };
    for (let i = 0; i < count; i++) {
      const shots = [];
      player.update(DT, gameInput, FIELD.width, FIELD.height, (p) => shots.push(...shotsFrom(p)), null);
      frames.push({
        input: { keys: [...input.keys], stick: input.stick },
        ship: {
          x: player.x,
          y: player.y,
          vx: player.vx,
          vy: player.vy,
          angle: player.angle,
          thrusting: player.thrusting,
          invulnerable: player.invulnerable,
        },
        shots,
      });
    }
  }
  return { scenario: name, dt: DT, field: FIELD, start: recordedStart, frames };
}

mkdirSync(OUT_DIR, { recursive: true });
for (const scenario of SCENARIOS) {
  const trace = record(scenario);
  writeFileSync(new URL(`${scenario.name}.json`, OUT_DIR), `${JSON.stringify(trace, null, 2)}\n`);
  console.log(`wrote ${scenario.name}.json (${String(trace.frames.length)} frames)`);
}
