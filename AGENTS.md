# Repository instructions

## Current structure

- `website/` is the deployable static HTML, CSS, and JavaScript site. It has no
  package manifest, bundler, or build step. Serve it over HTTP for ES modules.
- `website/index.html` loads `game-modular.js`, which initializes
  `modules/core/Game.js`. Keep game orchestration and state in `modules/core/`,
  game objects in `modules/entities/`, input/audio/spawning/effects/collision
  systems in `modules/systems/`, and existing shared utilities in `modules/utils/`.
- `tests/` is a separate npm package containing Playwright specs and helpers.
  `tests/helpers/game-helper.js` uses the browser API exposed by
  `website/modules/core/TestAPI.js`. Preserve that contract when changing gameplay.
- `game/` is a separate npm package: the work-in-progress TypeScript build (Vite,
  Vitest, ESLint, Playwright). Its `dist/` build is deployed to `/next/` on the
  Pages site. Its scripts include `build:e2e` (an e2e build in `dist-e2e/` that
  carries the test bridge and the `?seed=`/`?lives=`/`?quality=`/`?galaxy=` URL overrides,
  and checks that it does), `check:no-bridge` (fails if the release `dist/`
  contains the bridge or that URL parsing), and `record:parity` (records the
  parity traces), `icons` (re-renders the committed PNG icons in
  `game/public/icons/` from `game/assets-src/icon.svg` with Playwright's
  Chromium; run it after editing the SVG and commit the PNGs), and `find-seeds`
  (re-picks an e2e seed: every seed a Playwright spec depends on is listed with its
  claim in `game/e2e/seeds.ts`, a unit test guards each claim, and a failing guard
  prints the `npm run find-seeds -- <claim>` command to run; a new seed gets a
  table entry plus a claim check in `game/tests/helpers/seedClaims.ts`). Dev builds also
  honour the URL overrides; release builds never parse them, and `check:no-bridge`
  also fails if an e2e hook (frame, fast-forward, boss damage, pickup grant, event
  tally, frame-stats restart) reaches `dist/`. Each hook lives in
  `app/e2eHooks.ts`, is set only under
  `import.meta.env.MODE === 'e2e'`, and has a mark in `scripts/check-no-bridge.mjs`
  and a case in `tests/unit/checkNoBridge.test.ts`; a new hook needs all three.
  `?galaxy=` jumps straight into a level (see `app/seed.ts`). A run started with `?galaxy=`,
  `?seed=` or `?lives=` never writes the save.
  Gameplay code under `game/src/sim/` is deterministic and DOM-free; ESLint
  enforces it. Ship handling is pinned to recorded traces of the live game in
  `game/tests/fixtures/parity/`; do not re-record them after `website/` changes
  without owner approval.
- In `game/src/`, `content/` holds the level tables (levels grouped in sets,
  each set ending in a boss level), the difficulty curves, the pacing rules and
  the bosses as typed data; `meta/` holds the pure save, unlock, star
  and Rank rules; `app/` owns the screen flow (`flow.ts`, pure), the run
  controller (save, World and Rank wiring), commands, hit-stop, frame monitor
  and settings; `render/` owns drawing; `audio/` owns sound; `input/`
  owns keyboard, touch and gamepad input and menu focus; `ui/` owns the DOM
  cards (title, mode select, the level map and level select, results and game
  over, pause, settings, records, crash, rotate prompt); `platform/`
  owns full screen, the service worker registration, the install offer, the
  crash guard and the local log; `sw/` is the service worker itself; `bot/`
  holds the headless bots and their level runner (`run.ts`), used by tests and
  never shipped to players.
  - `bot/` is pure like `sim/` (ESLint enforces it: no DOM, clock or `Math.random`). A bot reads
    a `BotView` (the World's state, refilled in place) and returns controls; it
    never changes the World. There are three profiles: `statue` sends no input
    (the baseline of what a level does to an idle ship), `casual` is a
    handicapped player (late reactions, a wobbling aim, dodges only some
    threats), and `expert` is the full pilot, which the casual wraps. `createBot`
    gives each run its own random stream, derived from the run's seed with
    `deriveSeed(seed, 'bot')`; a bot draws from nothing else, so a bot run
    replays exactly and never shifts a sim stream. A change to the expert changes
    what the casual does, so rerun the balance suites after either.
  - Pickups and weapon tiers (`sim/pickups/`, `content/pickups.ts`): a kill can
    drop a pickup, with a chance that follows the level's difficulty and a pool
    of kinds that widens by set; the `'pickups'` stream decides both. A
    `Loadout` holds the weapon tier (0 to 3; one kind raises it, and a Rank death
    lowers it by one) and the timed effects, each with a clock; collecting a
    running kind refreshes it and never stacks. `volley.ts` composes the ship's
    barrels from the tier and the running effects, and effects only ever add
    shots or shorten the fire interval. A protective pickup absorbs one hit.
    The HUD shows a pill with a countdown for each running timed effect
    (`render/hudPickups.ts`). Which kinds the player has collected is saved
    (`seenPickups`) and decided in `app/pickupNotices.ts`, because the sim
    knows nothing of what the player has seen: a kind's first drop is announced
    once, and collecting it ends the callout for good.
  - Foes and hazards: `content/foes.ts` and `content/hazards.ts` hold their
    stats and schedules as typed data; `sim/foes/` has one behaviour per foe
    kind over a pooled `Foe` (never hold one across steps), and `FoeField` owns
    the pool, spawning, hits and rams. The director spends foes from the same
    threat budget as rocks, by cost. Foe motion draws from the `'foes'` stream
    and hazards from `'hazards'`. A gravity well (`sim/hazards/`) is scheduled
    by a level event, telegraphed, then pulling; each foe kind says whether a
    well pulls it. Foes and wells are drawn by `render/foePass.ts` and
    `render/hazardPass.ts`; a well holds still under reduced motion.
  - A boss is three pieces, and a new one needs all of them. Its definition in
    `content/bosses.ts` gives hit points, radius, the attacks of each phase and
    the rests between them. Its behaviour in `sim/boss/` implements
    `BossBehaviour` (`behaviour.ts`): an `AttackSpec` for every attack its phases
    name, each with a telegraph of at least `MIN_WINDUP_SECONDS`; and optionally
    its drift, parts, `vulnerable`, `hurtsAt` and `target` (where a shot does
    harm), its exposure events and a per-step hook. A factory builds it afresh
    for each fight, drawing only from the fight's `'boss'` stream, and
    `GalaxyRun` registers it. `BossRunner` owns what every boss shares (intro,
    phases, windups, dying) and publishes one `BossView` updated in place, which
    the renderer, the bots and the e2e bridge read; a boss never touches the
    renderer. Its look in `render/boss/` implements `BossDrawer` (`drawer.ts`):
    a glow and a `body`, with optional underglow, `advance`, `handle` and
    `reset`; the boss pass draws what every boss shares (windup rings,
    shockwave, hit flash) and looks the drawer up by boss id. A drawer bakes its
    sprites by key and allocates nothing per frame. Cover a new boss with unit
    tests for its behaviour and drawer, a bot kill-rate case in
    `game/tests/balance/`, and an e2e spec that fights it through the bridge's
    `boss` state and `damageBoss`.
  - Ship controls (input, thrust, fire, turn, the volley and the frame loop)
    are tested with real input, never with bridge shortcuts: change any of them
    only with `e2e/keyboard.spec.ts` (every thrust, fire and turn chord, in both
    directions, on arrows and WASD, plus Space, Shift, Z and X) and the touch and
    gamepad specs passing, and add a chord case for any new binding. A held
    turn key always turns the ship.
  - Game key handling stands down while a form control has focus
    (`input/keyEvent.ts`), so sliders and radios keep their keys. `F` requests
    full screen synchronously in its keydown handler, because Safari and
    Firefox refuse a deferred request.
  - Gamepads use the standard mapping: the left stick steers like the touch
    joystick, the D-pad turns and thrusts, A/RB/RT fire, Start pauses, and on
    menus the D-pad moves focus, A confirms and B goes back.
  - The crash guard wraps each frame. A crash shows a recovery card with
    *Try again* and *Copy report*; the report comes from an in-memory ring log
    and nothing is sent anywhere.
  - Draw sizes scale up on small screens (`render/visualScale.ts`) while the
    720-unit field and every hitbox stay identical on all devices.
  - `render/` draws from interpolated sim poses. Sprites are baked once into a
    bounded LRU cache (`spriteCache.ts`, `sprites.ts`); glows are baked or
    additive sprites. Never set `shadowBlur` (ESLint bans it) or a canvas
    `filter` per frame. `fieldPen.ts` lands an upright sprite drawn at its baked
    size on whole device pixels, which a CPU-rasterized canvas copies several
    times faster than a resampled one; `turnedSprite.ts` turns a big sprite once
    onto its own canvas and draws that upright until its angle moves its corners
    half a pixel. Effects (`effects.ts`) drive a pooled particle system,
    shake and flash, and honour `prefers-reduced-motion`.
  - `render/quality.ts` steps through `QUALITY_LEVELS` from measured frame
    time with hysteresis, judged against the display's own frame interval as
    measured on idle screens (so a 30 Hz-capped display is not read as
    overloaded); the lowest levels add the `lite` body class, which
    turns off CSS backdrop blur. `?quality=` pins a level in e2e and dev builds.
  - `audio/` is all synthesized WebAudio: no audio files. The `AudioContext` is
    created on the first user gesture, suspended while the tab is hidden, and
    builds no nodes while suspended or muted. `M` or the sound chip toggles mute.
  - `World` takes a rules strategy. Practice rules (the old game's spawning,
    kept for tests and pinned by `game/tests/fixtures/practice-log.json`) and level
    rules: a threat-budget director (`sim/galaxy/director.ts`) keeps the
    on-field cost under a budget normalised to field area, a scripted pacing
    (opening, build, lull, surge, warp-out) shapes it, meteor showers are
    scheduled and telegraphed and their rocks pass through instead of wrapping,
    and boss levels run a phased boss (`sim/boss/`). `galaxyCleared` fires
    when the warp starts (the timer runs out, or the boss's HP hits 0), and the
    app records the clear at that moment.
  - Progress saves under `cosmic-assault.v2` (`meta/save.ts`, `app/saveStore.ts`).
    Loading sanitizes field by field; every write re-reads, merges (`mergeSaves`:
    furthest frontier, best score and stars per level, the ranked run with the
    higher `rankSeq`) and never writes after a failed read. Other tabs' changes
    arrive through the `storage` event, and a ranked run playing in another
    tab is detected over `BroadcastChannel` before any forfeit.
  - Settings persist in `localStorage` under the key
    `cosmic-assault.v2.settings` (`app/settings.ts`): mute, music and effects
    volume, screen shake (`auto`, `on` or `off`; `auto` follows
    `prefers-reduced-motion`) and left-handed touch controls. Loading sanitizes
    field by field and never throws. New stored data must use the `cosmic-assault.v2.`
    prefix, because the legacy site shares the origin.
- There is no root npm package or workspace. Run npm commands from `game/` or
  `tests/`, whichever package you are changing. `ReadMe.md` is the README's
  exact filename.

## Local development and validation

Use Node.js 24 (the version in `.nvmrc`; local ≥22.12 works). Install locked
dependencies with `npm ci` in `game/` or `tests/`, whichever package you are
changing.

For the website, run `npm run serve` from `tests/` after installing its
dependencies, then open `http://localhost:8080`.

Run applicable checks in this order: lint, typecheck, tests, verification.

1. **Lint:** For `game/` changes, run `npm run lint` from `game/`. `tests/` has
   no lint script; report its lint as unavailable rather than inventing a gate.
2. **Typecheck:** For `game/` changes, run `npm run typecheck` from `game/`.
   `tests/` has no typecheck script.
3. **Tests:** For `game/` changes, run `npm test` (Vitest) and `npm run test:e2e`
   (Playwright against the e2e build, plus a smoke test of the release build)
   from `game/`; install Chromium first with `npx playwright install chromium`.
   Locally, `test:e2e` builds both before serving them on ports 4317 (e2e) and
   4318 (release), clear of Vite's default preview port. `npm run test:perf`
   (the report-only `perf` project: 4x CPU slowdown, a busy field and a boss
   fight, both written to `game/test-results/perf.json`) is not part of
   `test:e2e`; CI runs it as the
   non-required `perf` job. `npm run test:balance` runs the slow many-seed bot
   suites in `game/tests/balance/` (boss kill rates and clear rates against the
   targets in `targets.ts`), which `npm test` leaves out; run it after any change
   to level content, difficulty curves, pacing, boss stats or the bots, and
   before changing a target; CI runs it as the non-required `balance` job. For changes to
   `website/` gameplay, UI, or the legacy tests, install Chromium with
   `npx playwright install chromium` from `tests/`, then run
   `npm test -- --project=chromium-desktop`. Linux hosts may need Playwright's
   browser system dependencies installed separately.
4. **Verification:** For game changes, check the affected desktop
   and mobile behavior in a browser, including browser console errors.
   For documentation-only changes, verify referenced paths and commands and run
   `git diff --check`; application suites are unnecessary.

In `tests/`, Playwright starts the local server automatically unless `TEST_URL`
is set. Set `TEST_URL` to test an existing deployed site. The full `npm test` suite includes
Chromium, Firefox, WebKit, mobile Chrome, and mobile Safari; install the corresponding
browsers before running it. CI currently runs only `chromium-desktop`, with one
worker and retries. Reports and failure artifacts live under `tests/playwright-report/`
and `tests/test-results/` and are ignored by Git.

## Change workflow

- Work on a feature branch from `main`; never commit directly to `main`.
  Use intentional conventional commits and a pull request for each change.
- Keep changes focused. After non-trivial code edits, apply the native `refactor`
  skill (dedup, then simplify) to the touched scope before tests. Reuse the existing
  owner of behavior instead of copying helpers or introducing one-call wrappers.
- Before declaring a PR ready, inspect unresolved review threads, CI logs,
  Codacy findings, and Codecov patch coverage when available. Fix actionable
  failures, and report unavailable checks explicitly.
- When the Codacy MCP server is available in the session, follow
  `.github/instructions/codacy.instructions.md`. Otherwise report Codacy
  analysis as unavailable and continue. `.codacy.yml` only lists
  exclusions; the repository is not currently analysed on Codacy. No Codecov
  configuration or coverage upload is currently committed.
- `.github/workflows/ci.yml` is the only workflow. It runs on pull requests to
  `main`, pushes to `main`, and manual dispatch. Job `game` runs the `game/`
  workflow guard, lint, typecheck, unit tests, the expert D1–D2 digests
  (`npm run test:digests`, one file of the balance suite), release build, base check,
  no-test-bridge check, e2e build, and e2e tests (the `chromium-desktop` and
  `mobile-landscape` projects against `dist-e2e/`, plus the `release-smoke`
  project against `dist/`);
  job `legacy` runs the `tests/` Playwright suite in `chromium-desktop` against
  `website/`. Job `deploy` runs only on pushes to `main`, and only after both
  `game` and `legacy` pass. `npm run check:workflow` in `game/` guards that gate.
  Job `perf` builds both bundles and runs `npm run test:perf`, and job `balance`
  runs `npm run test:balance`; neither is a required check, and neither gates
  deployment.
- Resolve review threads only after implementing the requested change or posting
  a justified reply. Merge only when required checks pass and no actionable
  threads remain, then remove the merged branch and prune stale references.
  CI failures caused by infrastructure or billing problems are not grounds
  to merge; stop and report them.
- Do not commit dependencies, generated build output, browser artifacts,
  credentials, or real account-specific cloud identifiers.
- On Windows 11, load native `env-detect` and `windows-execution` skills and use
  PowerShell 7 for terminal work, except repository-required POSIX workflows.
  Invoke native executables directly with argument arrays and literal paths;
  inspect `$LASTEXITCODE`.

## Deployment context

GitHub Pages is the only deployment, published by the `deploy` job in
`.github/workflows/ci.yml`. Pages serves `website/` at the root and `game/dist`
at `next/`. The job fails if the published root differs from `website/`.
There are no other hosting paths.

The `game/` build is an installable, offline-capable web app. `vite/precache.ts`
emits `src/sw/worker.ts` as `sw.js` with the list of every built file. The worker
registers from `./sw.js` with its default scope, so it controls only `/next/`
and never the legacy root; it is never registered by the Vite dev server. Each
deploy gets a new cache version, and older `cosmic-assault-next-*` caches are
deleted when the new worker activates.
